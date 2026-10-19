// Réponse automatique au prospect : trois messages, un par tranche de la journée.
//
// Le prospect qui remplit un formulaire à 22 h reçoit « on vous rappelle demain
// matin » ; celui de 14 h reçoit « on vous rappelle d'ici peu ». Les bornes sont
// réglables parce que la journée ne finit pas à la même heure pour un bureau et
// pour un commerce.
//
// Enregistrement d'un bloc, par un bouton, et non à chaque frappe : un message
// se rédige puis se relit, et une tranche cochée ne doit pas partir vers un vrai
// prospect avec un texte à moitié écrit.

import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { LuLoader, LuMessageSquareText } from 'react-icons/lu';
import { saveLeadIntakeAutoReply } from 'wasp/client/operations';
import { MagicTextarea } from '../../../client/magic';
import { SmsCostHint } from '../../../client/sms/SmsCostHint';
import { toGsm7 } from '../../../client/sms/smsText';
import {
  AUTO_REPLY_MAX_CHARS,
  AUTO_REPLY_MAX_LEADS_PER_CALL,
  AUTO_REPLY_MAX_LEADS_PER_HOUR,
  AUTO_REPLY_VARS,
  AUTO_REPLY_WINDOW_KEYS,
  DEFAULT_AUTO_REPLY_TEXTS,
  autoReplyWindowHint,
  autoReplyWindowLabel,
  formatHour,
  isAutoReplyActive,
  renderAutoReply,
  type AutoReplyWindowKey,
  type IntakeAutoReply,
} from '../../../shared/leadIntakeAutoReply';

const HOURS = Array.from({ length: 25 }, (_, h) => h);

export function IntakeAutoReplyPanel({
  searchId,
  isAdmin,
  saved,
  canSend,
  onSaved,
}: {
  searchId: string;
  isAdmin: boolean;
  /** Ce qui est en base. Le brouillon local repart de là à chaque rechargement. */
  saved: IntakeAutoReply;
  /** Un numéro Telnyx et sa clé existent. */
  canSend: boolean;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<IntakeAutoReply>(saved);
  const [saving, setSaving] = useState(false);
  // Replié par défaut quand rien n'est réglé : trois zones de texte vides
  // alourdiraient un panneau dont la plupart des sources n'ont pas besoin.
  const [open, setOpen] = useState(isAutoReplyActive(saved));

  // Le brouillon repart de la base quand *son contenu* change — pas à chaque
  // objet neuf que renvoie un rafraîchissement de la requête, qui effacerait un
  // message en cours de frappe.
  const savedKey = JSON.stringify(saved);
  useEffect(() => {
    setDraft(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);
  const active = isAutoReplyActive(saved);
  const blocked = canSend ? null : 'Envoi de SMS non configuré — Paramètres › Intégrations';

  function setWindow(key: AutoReplyWindowKey, patch: Partial<IntakeAutoReply[AutoReplyWindowKey]>) {
    setDraft(d => ({ ...d, [key]: { ...d[key], ...patch } }));
  }

  function setHours(dayStartHour: number, dayEndHour: number) {
    // Une fin qui passe sous le début est repoussée d'une heure, pas refusée : on
    // règle deux listes à la suite, et la seconde doit pouvoir rattraper la première.
    const end = Math.max(dayEndHour, dayStartHour + 1);
    setDraft(d => ({ ...d, dayStartHour, dayEndHour: Math.min(end, 24) }));
  }

  async function save() {
    for (const key of AUTO_REPLY_WINDOW_KEYS) {
      if (draft[key].enabled && !draft[key].text.trim()) {
        toast.error(`Écrivez le message « ${autoReplyWindowLabel(draft, key)} » avant de l'activer.`);
        return;
      }
    }
    setSaving(true);
    try {
      await saveLeadIntakeAutoReply({ searchId, autoReply: draft });
      toast.success('Réponse automatique enregistrée.');
      onSaved();
    } catch (err: any) {
      toast.error(err?.message ?? 'Enregistrement impossible');
    } finally {
      setSaving(false);
    }
  }

  const summary = active
    ? AUTO_REPLY_WINDOW_KEYS.filter(k => saved[k].enabled).map(k => autoReplyWindowLabel(saved, k)).join(' · ')
    : 'Désactivée';

  return (
    <div>
      <div className='flex items-center justify-between gap-2'>
        <label className='label'>Réponse automatique au prospect</label>
        <button
          type='button'
          className='text-xs text-muted hover:text-ink underline underline-offset-2'
          onClick={() => setOpen(o => !o)}
        >
          {open ? 'Replier' : 'Régler'}
        </button>
      </div>

      {!open ? (
        <div className='flex items-center gap-2.5 rounded-xl border border-line p-2.5'>
          <LuMessageSquareText size={16} className={`shrink-0 ${active ? 'text-accent-700' : 'text-muted'}`} />
          <div className='min-w-0 flex-1'>
            <p className='text-sm text-ink'>
              {active ? 'Un SMS part au prospect dès son arrivée' : 'Aucun SMS envoyé au prospect'}
            </p>
            <p className='truncate text-xs text-muted' title={summary}>{summary}</p>
          </div>
        </div>
      ) : (
        <div className='space-y-3 rounded-xl border border-line p-3'>
          {blocked && <p className='text-xs text-warning'>{blocked}</p>}

          {/* ── Bornes ── */}
          <div className='flex flex-wrap items-center gap-2 text-sm'>
            <span className='text-muted'>Journée de</span>
            <HourSelect
              value={draft.dayStartHour}
              options={HOURS.filter(h => h <= 23)}
              disabled={!isAdmin || saving}
              onChange={h => setHours(h, draft.dayEndHour)}
            />
            <span className='text-muted'>à</span>
            <HourSelect
              value={draft.dayEndHour}
              options={HOURS.filter(h => h > draft.dayStartHour)}
              disabled={!isAdmin || saving}
              onChange={h => setHours(draft.dayStartHour, h)}
            />
            <span className='text-xs text-muted'>(heure de Montréal)</span>
          </div>

          {/* ── Les trois messages ── */}
          {AUTO_REPLY_WINDOW_KEYS.map(key => (
            <WindowEditor
              key={key}
              label={autoReplyWindowLabel(draft, key)}
              hint={autoReplyWindowHint(key)}
              defaultText={DEFAULT_AUTO_REPLY_TEXTS[key]}
              window={draft[key]}
              disabled={!isAdmin || saving || !!blocked}
              onChange={patch => setWindow(key, patch)}
            />
          ))}

          <div className='flex flex-wrap items-center gap-1.5 text-xs text-muted'>
            <span>Variables :</span>
            {AUTO_REPLY_VARS.map(v => (
              <code key={v.token} className='rounded bg-canvas-200 px-1 py-0.5 font-mono' title={v.label}>
                {v.token}
              </code>
            ))}
          </div>

          <p className='text-xs text-muted'>
            Envoyé au numéro du prospect dès qu'un appel le crée à l'adresse ci-dessus — pas pour un
            prospect ajouté à la main ni pour un appel rejoué depuis le journal. Un SMS facturé par
            prospect, et chaque envoi apparaît dans le fil SMS de la fiche.
          </p>
          <p className='text-xs text-muted'>
            Rien ne part vers un numéro invalide ou hors Canada, vers un numéro avec lequel un SMS a
            déjà été échangé dans les 24 dernières heures, ni vers un numéro qui a un jour répondu
            « STOP ». Rien non plus pour un appel qui porte plus de {AUTO_REPLY_MAX_LEADS_PER_CALL}{' '}
            prospects (un import), ni au-delà de {AUTO_REPLY_MAX_LEADS_PER_HOUR} prospects reçus en une
            heure sur cette source (une rafale).
          </p>

          {isAdmin && (
            <div className='flex items-center justify-end gap-2'>
              {dirty && (
                <button
                  type='button'
                  className='btn-secondary'
                  disabled={saving}
                  onClick={() => setDraft(saved)}
                >
                  Annuler
                </button>
              )}
              <button type='button' className='btn-primary gap-1.5' disabled={!dirty || saving} onClick={save}>
                {saving && <LuLoader size={14} className='animate-spin' />}
                Enregistrer
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function HourSelect({
  value,
  options,
  disabled,
  onChange,
}: {
  value: number;
  options: number[];
  disabled: boolean;
  onChange: (hour: number) => void;
}) {
  return (
    <select
      className='input w-auto py-1 text-sm'
      value={value}
      disabled={disabled}
      onChange={e => onChange(parseInt(e.target.value, 10))}
    >
      {options.map(h => (
        <option key={h} value={h}>{formatHour(h)}</option>
      ))}
    </select>
  );
}

function WindowEditor({
  label,
  hint,
  defaultText,
  window,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  /** Le message proposé d'origine, pour y revenir après l'avoir abîmé. */
  defaultText: string;
  window: { enabled: boolean; text: string };
  disabled: boolean;
  onChange: (patch: Partial<{ enabled: boolean; text: string }>) => void;
}) {
  // L'aperçu chiffre le coût du message *rendu* : « {{company.name}} » fait
  // quinze caractères, le nom qu'il remplace peut en faire quarante.
  const preview = renderAutoReply(window.text, {
    leadName: 'Jean Tremblay',
    companyName: 'Mon entreprise',
    searchTitle: 'Formulaire du site',
  });

  return (
    <div className={`rounded-xl border p-2.5 ${window.enabled ? 'border-accent-200 bg-accent-50/40' : 'border-line'}`}>
      <label className={`flex items-start gap-2.5 ${disabled ? '' : 'cursor-pointer'}`}>
        <input
          type='checkbox'
          className='mt-0.5 rounded border-line text-accent focus:ring-accent/30'
          checked={window.enabled}
          disabled={disabled}
          onChange={e => onChange({ enabled: e.target.checked })}
        />
        <span className='min-w-0 flex-1'>
          <span className='block text-sm font-medium text-ink'>{label}</span>
          <span className='block text-xs text-muted'>{hint}</span>
        </span>
      </label>
      <MagicTextarea
        containerClassName='mt-2'
        className='input w-full resize-y text-sm'
        rows={3}
        maxLength={AUTO_REPLY_MAX_CHARS}
        placeholder='Bonjour {{lead.name}}, merci pour votre demande. Nous vous rappelons…'
        value={window.text}
        disabled={disabled}
        onChange={e => onChange({ text: e.target.value })}
      />
      <div className='mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted'>
        <SmsCostHint
          text={preview}
          compact
          onSimplify={disabled ? undefined : () => onChange({ text: toGsm7(window.text) })}
        />
        {!disabled && window.text !== defaultText && (
          <button
            type='button'
            className='ml-auto underline underline-offset-2 hover:text-ink'
            onClick={() => onChange({ text: defaultText })}
          >
            Rétablir le message proposé
          </button>
        )}
      </div>
    </div>
  );
}
