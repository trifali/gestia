// Le formulaire d'ajout d'un prospect, partagé par le tableau de l'application
// et par le lien de partage : seul l'appel serveur diffère.

import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { LuLoader, LuPlus } from 'react-icons/lu';
import type { Lead } from 'wasp/entities';
import { UNKNOWN_STATUS_KEY } from '../../shared/leadStatus';
import { PhoneInput } from '../../client/ui';
import {
  extraFieldId,
  isExtraFieldKey,
  leadExtras,
  MAX_EXTRA_VALUE_CHARS,
  type CardFieldConfig,
  type LeadSourceOption,
} from './leads.shared';

export type NewLeadInput = {
  name: string;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  category?: string;
  status?: string;
  source?: string;
  extras: { key: string; label: string; value: string }[];
};

/** Les colonnes du prospect qu'on peut saisir à la main, avec leur libellé par défaut. */
const BUILTIN_INPUTS: Record<string, { label: string; placeholder: string; wide?: boolean; type?: string }> = {
  phone: { label: 'Téléphone', placeholder: '' },
  email: { label: 'Courriel', placeholder: 'nom@exemple.com', type: 'email' },
  website: { label: 'Site web', placeholder: 'https://…', wide: true, type: 'url' },
  address: { label: 'Adresse', placeholder: '', wide: true },
  category: { label: 'Catégorie', placeholder: '' },
};

type AddLeadField =
  | { kind: 'builtin'; key: string; label: string }
  | { kind: 'extra'; key: string; label: string; example?: string; multiline: boolean };

/**
 * Le formulaire d'ajout d'un prospect, composé à partir du tableau plutôt que
 * d'une liste figée.
 *
 * Il pose les mêmes questions que celles auxquelles les autres prospects du
 * tableau ont répondu : les champs du réglage « Cartes », dans leur ordre — ceux
 * qu'une correspondance de webhook a déclarés, budget ou créneau de rappel —
 * puis les informations que des prospects portent sans qu'elles soient
 * déclarées. Un champ standard qu'aucun prospect du tableau n'a jamais rempli
 * (un site web sur un tableau de formulaire Facebook) se range derrière un lien
 * plutôt que de réclamer une réponse que personne d'autre n'a donnée.
 */
export function AddLeadModal({
  statusConfigs,
  sources,
  cardFields,
  leads,
  canPickColumn = true,
  create,
  onClose,
  onCreated,
}: {
  statusConfigs: { key: string; label: string }[];
  sources: LeadSourceOption[];
  cardFields: CardFieldConfig[];
  /** Les prospects déjà sur le tableau : ce qu'ils ont reçu décide de ce qu'on demande. */
  leads: Lead[];
  /** Faux sur un lien de partage sans le droit de déplacer : le prospect arrive dans la première colonne. */
  canPickColumn?: boolean;
  /** L'appel serveur : `createLead` dans l'application, `createLeadByToken` sur un lien. */
  create: (input: NewLeadInput) => Promise<any>;
  onClose: () => void;
  onCreated: (lead: any) => void;
}) {
  // La première vraie colonne, celle où atterrit tout nouveau prospect.
  const [status, setStatus] = useState<string>(
    statusConfigs.find(s => s.key !== UNKNOWN_STATUS_KEY)?.key ?? 'nouveau',
  );
  const [source, setSource] = useState<string>('manual');
  const [values, setValues] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const { fields, tucked } = useMemo(() => {
    // Du plus récent au plus ancien : l'exemple affiché est la réponse la plus fraîche.
    const recent = [...leads].sort((a, b) => new Date(b.createdAt as any).getTime() - new Date(a.createdAt as any).getTime());
    const extrasOf = new Map(recent.map(l => [l.id, leadExtras(l)]));
    const usedBuiltin = (key: string) => recent.some(l => !!(l as any)[key]);
    const extraSamples = (id: string) => recent.flatMap(l => extrasOf.get(l.id)!.filter(e => e.key === id).map(e => e.value));

    const fields: AddLeadField[] = [];
    const tucked: AddLeadField[] = [];
    const seenExtras = new Set<string>();
    const ordered = [...cardFields].sort((a, b) => a.order - b.order);

    for (const f of ordered) {
      if (isExtraFieldKey(f.key)) {
        const id = extraFieldId(f.key);
        seenExtras.add(id);
        const samples = extraSamples(id);
        fields.push({ kind: 'extra', key: id, label: f.label, example: samples[0], multiline: samples.some(v => v.length > 60 || v.includes('\n')) });
        continue;
      }
      if (!(f.key in BUILTIN_INPUTS)) continue; // nom, provenance, note Google : à part ou non saisissables.
      const field: AddLeadField = { kind: 'builtin', key: f.key, label: f.label || BUILTIN_INPUTS[f.key].label };
      // Un tableau encore vide n'a rien à imiter : on suit alors le seul réglage.
      const relevant = (f.onDetail ?? true) && (leads.length === 0 || usedBuiltin(f.key));
      (relevant ? fields : tucked).push(field);
    }
    // Les colonnes standard absentes du réglage restent accessibles.
    for (const key of Object.keys(BUILTIN_INPUTS)) {
      if (![...fields, ...tucked].some(f => f.kind === 'builtin' && f.key === key)) {
        tucked.push({ kind: 'builtin', key, label: BUILTIN_INPUTS[key].label });
      }
    }
    // Les informations que des prospects portent sans qu'un champ les déclare.
    for (const l of recent) {
      for (const e of extrasOf.get(l.id)!) {
        if (seenExtras.has(e.key)) continue;
        seenExtras.add(e.key);
        const samples = extraSamples(e.key);
        fields.push({ kind: 'extra', key: e.key, label: e.label, example: samples[0], multiline: samples.some(v => v.length > 60 || v.includes('\n')) });
      }
    }
    return { fields, tucked };
  }, [cardFields, leads]);

  const shown = [...fields, ...tucked.filter(f => revealed.has(f.key))];
  const hidden = tucked.filter(f => !revealed.has(f.key));
  const set = (key: string, v: string) => setValues(prev => ({ ...prev, [key]: v }));

  async function handleSave() {
    const name = (values.name ?? '').trim();
    if (!name) {
      toast.error("Le nom est requis");
      return;
    }
    setSaving(true);
    try {
      const builtin = (key: string) => (values[`b:${key}`] ?? '').trim() || undefined;
      const lead = await create({
        name,
        phone: builtin('phone'),
        email: builtin('email'),
        website: builtin('website'),
        address: builtin('address'),
        category: builtin('category'),
        status: canPickColumn ? status : undefined,
        source,
        extras: shown
          .filter(f => f.kind === 'extra')
          .map(f => ({ key: f.key, label: f.label, value: (values[`x:${f.key}`] ?? '').trim() }))
          .filter(e => e.value),
      });
      toast.success(`${name} ajouté`);
      onCreated(lead);
      onClose();
    } catch (err: any) {
      toast.error(err?.message || "Erreur lors de l'ajout");
    } finally {
      setSaving(false);
    }
  }

  function renderField(f: AddLeadField) {
    if (f.kind === 'builtin') {
      const spec = BUILTIN_INPUTS[f.key];
      const id = `b:${f.key}`;
      return (
        <div key={id} className={spec.wide ? 'sm:col-span-2' : undefined}>
          <label className='label'>{f.label}</label>
          {f.key === 'phone' ? (
            <PhoneInput className='input' value={values[id] ?? ''} onChange={v => set(id, v)} />
          ) : (
            <input className='input' type={spec.type ?? 'text'} value={values[id] ?? ''} onChange={e => set(id, e.target.value)} placeholder={spec.placeholder} />
          )}
        </div>
      );
    }
    const id = `x:${f.key}`;
    const example = f.example ? `ex. : ${f.example.length > 50 ? f.example.slice(0, 50) + '…' : f.example}` : '';
    return (
      <div key={id} className={f.multiline ? 'sm:col-span-2' : undefined}>
        <label className='label'>{f.label}</label>
        {f.multiline ? (
          <textarea className='input' rows={3} value={values[id] ?? ''} onChange={e => set(id, e.target.value)} placeholder={example} maxLength={MAX_EXTRA_VALUE_CHARS} />
        ) : (
          <input className='input' value={values[id] ?? ''} onChange={e => set(id, e.target.value)} placeholder={example} maxLength={MAX_EXTRA_VALUE_CHARS} />
        )}
      </div>
    );
  }

  return (
    <div className='space-y-4'>
      <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
        <div className='sm:col-span-2'>
          <label className='label'>Nom</label>
          <input className='input' autoFocus value={values.name ?? ''} onChange={e => set('name', e.target.value)} />
        </div>
        {shown.map(renderField)}
      </div>

      {hidden.length > 0 && (
        <div className='flex flex-wrap items-center gap-1.5'>
          <span className='text-xs text-muted'>Autres champs :</span>
          {hidden.map(f => (
            <button
              key={f.key}
              type='button'
              className='inline-flex items-center gap-1 rounded-md bg-canvas-200 px-2 py-0.5 text-xs font-medium text-ink-700 hover:bg-canvas-300'
              onClick={() => setRevealed(prev => new Set(prev).add(f.key))}
            >
              <LuPlus size={11} />
              {f.label}
            </button>
          ))}
        </div>
      )}

      <div className='grid grid-cols-1 gap-3 border-t border-line pt-4 sm:grid-cols-2'>
        {canPickColumn && <div>
          <label className='label'>Colonne</label>
          <select className='input' value={status} onChange={e => setStatus(e.target.value)}>
            {statusConfigs.filter(s => s.key !== UNKNOWN_STATUS_KEY).map(s => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </div>}
        <div>
          <label className='label'>Provenance</label>
          <select className='input' value={source} onChange={e => setSource(e.target.value)}>
            {sources.map(s => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className='flex justify-end gap-2 pt-1'>
        <button className='btn-secondary' onClick={onClose} disabled={saving}>Annuler</button>
        <button className='btn-primary gap-1.5' onClick={handleSave} disabled={saving}>
          {saving ? <LuLoader size={14} className='animate-spin' /> : <LuPlus size={14} />}
          {saving ? 'Ajout…' : 'Ajouter le prospect'}
        </button>
      </div>
    </div>
  );
}

