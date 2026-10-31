import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import MDEditor from '@uiw/react-md-editor';
import toast from 'react-hot-toast';
import {
  LuX, LuSave, LuDownload, LuEye, LuWand, LuFileText, LuChevronRight, LuSparkles, LuLock, LuPencil, LuUndo2, LuCheck, LuTriangleAlert,
} from 'react-icons/lu';
import {
  useQuery,
  getDocumentTemplates,
  getCompanyBrandAssets,
  getCurrentCompany,
  createSupplierContract,
  updateSupplierContract,
  draftSupplierContractWithAi,
} from 'wasp/client/operations';
import { Modal } from '../../client/ui';
import { formatDate, formatDateTime } from '../../shared/format';
import {
  CONTRACT_STATUS,
  RATE_TYPES,
  SUPPLIER_VARIABLE_GROUPS,
  isCommissionRate,
  isPercentRate,
  buildSupplierContractVars,
  applyVars,
  findUnresolvedVars,
  withSignature,
} from '../../shared/supplier';
import { getTemplatePdfBase64 } from '../settings/templatePdf';
import type { BrandAssets } from '../documents/pdf';
import { BUILTIN_AGREEMENTS } from './serviceAgreement';

export type ContractRow = {
  id: string;
  title: string;
  content: string;
  status: string;
  startDate: string | Date | null;
  endDate: string | Date | null;
  rate?: number | null;
  rateType?: string | null;
  sharedWithSupplier?: boolean;
  signedAt: string | Date | null;
  signedByName: string | null;
  createdAt: string | Date;
};

// ─── PDF ─────────────────────────────────────────────────────────────────────

/** Le texte de l'entente, plus la mention d'acceptation quand elle a été signée. */
/** Le texte de l'entente, bloc de signature rempli quand elle a été signée. */
function contractBody(contract: Pick<ContractRow, 'content' | 'signedAt' | 'signedByName'>): string {
  return withSignature(contract.content, contract.signedByName, contract.signedAt);
}

async function contractPdfBlob(contract: ContractRow, brand: BrandAssets, companyName: string): Promise<Blob> {
  const b64 = await getTemplatePdfBase64(
    { name: contract.title, type: 'contract', description: null, content: contractBody(contract) },
    brand,
    companyName,
  );
  const bytes = atob(b64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: 'application/pdf' });
}

/** Le texte d'une entente non signée, variables remplacées, pour l'imprimer hors de l'éditeur. */
export function resolveContract<T extends Pick<ContractRow, 'content' | 'signedAt'>>(contract: T, vars: Record<string, string>): T {
  return contract.signedAt ? contract : { ...contract, content: applyVars(contract.content, vars) };
}

export async function downloadContractPdf(contract: ContractRow, brand: BrandAssets, companyName: string) {
  const url = URL.createObjectURL(await contractPdfBlob(contract, brand, companyName));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${contract.title.replace(/[/\\?%*:|"<>]/g, '-')}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function ContractStatusBadge({ contract }: { contract: Pick<ContractRow, 'status'> }) {
  const s = CONTRACT_STATUS[contract.status] ?? { label: contract.status, className: 'badge-neutral' };
  return <span className={s.className}>{s.label}</span>;
}

// ─── Nouvelle entente ────────────────────────────────────────────────────────

type SupplierForContract = {
  id: string;
  name: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
  specialty?: string | null;
  neq?: string | null;
  taxNumberGst?: string | null;
  taxNumberQst?: string | null;
  rate?: number | null;
  rateType?: string | null;
  paymentTermsDays?: number | null;
};

export function NewContractModal({
  supplier,
  onClose,
  onCreated,
}: {
  supplier: SupplierForContract;
  onClose: () => void;
  onCreated: (contract: ContractRow) => void;
}) {
  const { data: templates = [] } = useQuery(getDocumentTemplates);
  const [step, setStep] = useState<'pick' | 'fill'>('pick');
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState('');
  // Le modèle intégré qui colle à la rémunération déjà convenue avec ce fournisseur.
  const recommendedId = isCommissionRate(supplier.rateType) ? 'builtin:commission' : 'builtin';
  const [form, setForm] = useState({
    title: '',
    startDate: '',
    endDate: '',
    rateType: supplier.rateType ?? 'horaire',
    rate: supplier.rate != null ? String(supplier.rate) : '',
  });
  // Commission fixe qui varie selon le type de client.
  const [useTiers, setUseTiers] = useState(false);
  const [tiers, setTiers] = useState<{ label: string; amount: string }[]>(() => [
    { label: 'Client A — ', amount: supplier.rateType === 'commission_fixe' && supplier.rate != null ? String(supplier.rate) : '' },
    { label: 'Client B — ', amount: '' },
  ]);
  const tiersOn = form.rateType === 'commission_fixe' && useTiers;
  const setTier = (i: number, patch: Partial<{ label: string; amount: string }>) =>
    setTiers((ts) => ts.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  const [saving, setSaving] = useState(false);

  // Les modèles de type « Contrat » d'abord : ce sont presque toujours eux qu'on veut.
  const active = useMemo(
    () => (templates as any[]).filter((t) => t.isActive).sort((a, b) => Number(b.type === 'contract') - Number(a.type === 'contract')),
    [templates],
  );

  const pick = (id: string | null, name: string, rateType?: string) => {
    setTemplateId(id);
    setTemplateName(name);
    setForm((f) => ({
      ...f,
      title: `${name} — ${supplier.name}`,
      // Le modèle à la commission impose une commission ; on garde celle du
      // fournisseur (pourcentage ou montant fixe) s'il en a déjà une.
      ...(rateType === 'commission' && !isCommissionRate(f.rateType) ? { rateType: 'commission', rate: '' } : {}),
    }));
    setStep('fill');
  };

  const create = async () => {
    setSaving(true);
    try {
      const contract = await createSupplierContract({
        supplierId: supplier.id,
        templateId,
        title: form.title,
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        rate: form.rate || null,
        rateType: form.rateType || null,
        commissionTiers: tiersOn
          ? tiers.map((t) => ({ label: t.label.trim().replace(/\s*—\s*$/, ''), amount: t.amount })).filter((t) => t.label || t.amount)
          : null,
      });
      toast.success('Entente créée — relisez-la et complétez la description des services.');
      onCreated(contract as any);
    } catch (err: any) {
      toast.error(err?.message || 'Erreur lors de la création');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={step === 'pick' ? 'Nouvelle entente de service' : templateName}
      headerRight={step === 'fill' ? <button className='text-sm text-muted hover:text-ink mr-2' onClick={() => setStep('pick')}>← Modèles</button> : undefined}
      footer={step === 'fill' ? (
        <>
          <button className='btn-secondary' onClick={onClose}>Annuler</button>
          <button className='btn-primary' onClick={create} disabled={saving || !form.title.trim()}>
            {saving ? 'Création…' : 'Créer et rédiger'}
          </button>
        </>
      ) : undefined}
    >
      {step === 'pick' ? (
        <div className='space-y-4'>
          <div className='space-y-2'>
            {BUILTIN_AGREEMENTS.map((b) => {
              const recommended = b.id === recommendedId;
              return (
                <button
                  key={b.id}
                  onClick={() => pick(b.id, b.name, b.rateType)}
                  className={`w-full text-left rounded-xl p-4 flex items-start gap-3 transition-colors ${
                    recommended ? 'border-2 border-accent/40 bg-accent-50/50 hover:bg-accent-50' : 'border border-line hover:bg-canvas-100'
                  }`}
                >
                  <LuSparkles size={18} className={`shrink-0 mt-0.5 ${recommended ? 'text-accent' : 'text-muted'}`} />
                  <div className='flex-1 min-w-0'>
                    <p className='font-semibold text-ink'>{b.name} {recommended && <span className='badge-accent ml-1'>Recommandé</span>}</p>
                    <p className='text-xs text-muted mt-1'>{b.description}</p>
                  </div>
                  <LuChevronRight size={16} className='text-muted shrink-0 mt-0.5' />
                </button>
              );
            })}
          </div>

          {active.length > 0 && (
            <div>
              <p className='text-xs font-semibold text-muted uppercase tracking-wide mb-2'>Vos modèles (Paramètres → Modèles)</p>
              <div className='space-y-1.5'>
                {active.map((t: any) => (
                  <button
                    key={t.id}
                    onClick={() => pick(t.id, t.name)}
                    className='w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-line hover:bg-canvas-100 text-left transition-colors'
                  >
                    <LuFileText size={15} className='text-muted shrink-0' />
                    <span className='flex-1 text-sm font-medium text-ink truncate'>{t.name}</span>
                    <LuChevronRight size={14} className='text-muted shrink-0' />
                  </button>
                ))}
              </div>
              <p className='text-xs text-muted mt-2'>Les variables {'{{client.*}}'} d'un modèle client sont remplies avec les coordonnées du fournisseur.</p>
            </div>
          )}

          <button onClick={() => pick(null, 'Entente de services')} className='text-sm text-muted hover:text-ink underline'>
            Partir d'une page blanche
          </button>
        </div>
      ) : (
        <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
          <div className='sm:col-span-2'>
            <label className='label'>Titre *</label>
            <input className='input' value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} autoFocus />
          </div>
          <div>
            <label className='label'>Début</label>
            <input type='date' className='input' value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
          </div>
          <div>
            <label className='label'>Fin</label>
            <input type='date' className='input' value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
          </div>
          <div>
            <label className='label'>Rémunération</label>
            <select className='input' value={form.rateType} onChange={(e) => setForm({ ...form, rateType: e.target.value })}>
              {RATE_TYPES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div>
            {tiersOn ? (
              <>
                <label className='label'>Montant par client</label>
                <p className='input bg-canvas-100 text-muted'>Selon le barème ci-dessous</p>
              </>
            ) : (
              <RateInput rateType={form.rateType} value={form.rate} onChange={(rate) => setForm({ ...form, rate })} />
            )}
          </div>
          {form.rateType === 'commission_fixe' && (
            <div className='sm:col-span-2 rounded-lg border border-line p-3 space-y-3'>
              <label className='flex items-center gap-2 text-sm cursor-pointer'>
                <input type='checkbox' className='accent-ink' checked={useTiers} onChange={(e) => setUseTiers(e.target.checked)} />
                Le montant varie selon le type de client
              </label>
              {tiersOn && (
                <>
                  {tiers.map((t, i) => (
                    <div key={i} className='flex items-center gap-2'>
                      <input
                        className='input flex-1 min-w-0'
                        placeholder='Ex. Client A — contrat annuel'
                        value={t.label}
                        onChange={(e) => setTier(i, { label: e.target.value })}
                      />
                      <div className='relative w-28 shrink-0'>
                        <input
                          type='number'
                          step='0.01'
                          min='0'
                          inputMode='decimal'
                          className='input pr-6'
                          placeholder='100'
                          value={t.amount}
                          onChange={(e) => setTier(i, { amount: e.target.value })}
                        />
                        <span className='absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-muted pointer-events-none'>$</span>
                      </div>
                      <button
                        type='button'
                        className='p-1.5 text-muted hover:text-danger shrink-0 disabled:opacity-30'
                        title='Retirer ce type de client'
                        disabled={tiers.length <= 1}
                        onClick={() => setTiers((ts) => ts.filter((_, j) => j !== i))}
                      >
                        <LuX size={15} />
                      </button>
                    </div>
                  ))}
                  <button type='button' className='text-sm text-muted hover:text-ink' onClick={() => setTiers((ts) => [...ts, { label: '', amount: '' }])}>
                    + Ajouter un type de client
                  </button>
                  <p className='text-xs text-muted'>Décrivez chaque type pour qu'il n'y ait pas de doute (ex. « Client A — contrat annuel », « Client B — achat ponctuel »). Le barème est écrit tel quel dans l'entente.</p>
                </>
              )}
            </div>
          )}
          <div className='sm:col-span-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800'>
            <span className='font-semibold'>Rempli automatiquement :</span> coordonnées de {supplier.name} et de votre entreprise, dates,
            rémunération, délai de paiement{supplier.paymentTermsDays != null ? ` (${supplier.paymentTermsDays} jours)` : ''}. Laissez vide ce que vous ne savez pas encore.
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Champ du taux : un pourcentage pour une commission sur les ventes, des dollars sinon. */
export function RateInput({ rateType, value, onChange }: { rateType: string; value: string; onChange: (v: string) => void }) {
  const percent = isPercentRate(rateType);
  return (
    <>
      <label className='label'>
        {percent ? 'Taux de commission (%)' : rateType === 'commission_fixe' ? 'Montant par client ($)' : 'Montant ($)'}
      </label>
      <input
        type='number'
        step='0.01'
        min='0'
        max={percent ? 100 : undefined}
        inputMode='decimal'
        className='input'
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={percent ? 'Ex. 10' : rateType === 'commission_fixe' ? 'Ex. 100' : 'Ex. 95'}
      />
    </>
  );
}

// ─── Éditeur ─────────────────────────────────────────────────────────────────

export function ContractEditorModal({
  contract,
  supplier,
  onClose,
}: {
  contract: ContractRow;
  supplier: SupplierForContract;
  onClose: () => void;
}) {
  const { data: brand } = useQuery(getCompanyBrandAssets);
  const { data: company } = useQuery(getCurrentCompany);
  const [title, setTitle] = useState(contract.title);
  const [content, setContent] = useState(contract.content);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busyPdf, setBusyPdf] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [proposal, setProposal] = useState<AiProposal | null>(null);
  // Le texte d'avant la dernière proposition appliquée : un clic pour revenir en arrière.
  const [beforeAi, setBeforeAi] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useState<'edit' | 'read'>('edit');
  const editorRef = useRef<{ textarea?: HTMLTextAreaElement }>(null);
  const locked = !!contract.signedAt;
  const companyName = (company as any)?.name ?? 'Mon entreprise';

  const vars = useMemo(
    () => buildSupplierContractVars(supplier, (company as any) ?? { name: '' }, contract),
    [supplier, company, contract],
  );
  // Les variables ne sont pas seulement remplacées à la création : l'IA en écrit,
  // on en tape, on en colle d'un autre modèle. Tout passe donc par ici avant
  // d'être enregistré ou imprimé. Une entente signée reste telle qu'acceptée.
  const resolve = useCallback((md: string) => (locked || !company ? md : applyVars(md, vars)), [locked, company, vars]);
  const unresolved = useMemo(() => (locked || !company ? [] : findUnresolvedVars(resolve(content))), [locked, company, resolve, content]);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const resolved = resolve(content);
      await updateSupplierContract({ id: contract.id, title, ...(locked ? {} : { content: resolved }) });
      if (resolved !== content) setContent(resolved);
      setDirty(false);
      toast.success('Entente enregistrée');
    } catch (err: any) {
      toast.error(err?.message || 'Erreur de sauvegarde');
    } finally {
      setSaving(false);
    }
  }, [contract.id, title, content, locked, resolve]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); if (dirty && !saving) save(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dirty, saving, save]);

  const close = () => {
    if (dirty && !window.confirm('Des modifications ne sont pas enregistrées. Fermer quand même ?')) return;
    onClose();
  };

  const current = { ...contract, title, content: resolve(content) };

  const preview = async () => {
    setBusyPdf(true);
    try {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(await contractPdfBlob(current, (brand as BrandAssets) ?? null, companyName)));
    } catch (err: any) {
      toast.error(err?.message || 'Erreur lors de la génération du PDF');
    } finally {
      setBusyPdf(false);
    }
  };

  const download = async () => {
    setBusyPdf(true);
    try {
      await downloadContractPdf(current, (brand as BrandAssets) ?? null, companyName);
    } catch (err: any) {
      toast.error(err?.message || 'Erreur lors de la génération du PDF');
    } finally {
      setBusyPdf(false);
    }
  };

  const insert = (key: string) => {
    const value = vars[key] ?? key;
    const el = editorRef.current?.textarea;
    if (!el) { setContent((c) => c + value); setDirty(true); return; }
    el.focus();
    if (!document.execCommand('insertText', false, value)) {
      const { selectionStart: s, selectionEnd: e } = el;
      setContent(content.slice(0, s) + value + content.slice(e));
    } else {
      setContent(el.value);
    }
    setDirty(true);
  };

  const generate = async (instruction = aiPrompt) => {
    if (!instruction.trim()) return;
    setAiLoading(true);
    try {
      const res = await draftSupplierContractWithAi({ contractId: contract.id, instruction, currentContent: content });
      setProposal(res as AiProposal);
    } catch (err: any) {
      toast.error(err?.message || 'Erreur de génération IA');
    } finally {
      setAiLoading(false);
    }
  };

  const applyProposal = () => {
    if (!proposal) return;
    setBeforeAi(content);
    setContent(proposal.content);
    setDirty(true);
    setProposal(null);
    setAiOpen(false);
    setAiPrompt('');
    toast.success('Proposition appliquée — enregistrez pour la conserver.');
  };

  const undoAi = () => {
    if (beforeAi == null) return;
    setContent(beforeAi);
    setBeforeAi(null);
    setDirty(true);
    toast.success('Modification de l’IA annulée');
  };

  return createPortal(
    <div className='fixed inset-0 bg-ink/40 backdrop-blur-sm z-[60] flex items-stretch sm:items-center justify-center sm:p-4'>
      <div className='bg-white sm:rounded-2xl shadow-2xl flex flex-col w-full max-w-7xl h-full sm:h-[92vh] overflow-hidden'>
        {/* En-tête */}
        <div className='shrink-0 px-3 sm:px-5 py-3 border-b border-line flex items-center gap-2'>
          <input
            className='flex-1 min-w-0 font-semibold text-base sm:text-lg text-ink bg-transparent border-0 rounded px-1 -mx-1 focus:outline-none focus:ring-2 focus:ring-ink/10'
            value={title}
            onChange={(e) => { setTitle(e.target.value); setDirty(true); }}
          />
          <span className='hidden sm:inline-flex'><ContractStatusBadge contract={contract} /></span>
          {dirty && <span className='hidden sm:inline text-[10px] text-muted border border-line rounded px-1.5 py-0.5 shrink-0'>Non enregistré</span>}
          <button onClick={close} className='p-1.5 text-muted hover:text-ink shrink-0' aria-label='Fermer'><LuX size={18} /></button>
        </div>

        {/* Barre d'actions */}
        <div className='shrink-0 px-3 sm:px-5 py-2 border-b border-line flex items-center gap-2 overflow-x-auto bg-canvas-100'>
          <button className='btn-primary px-3 py-1.5 shrink-0' onClick={save} disabled={saving || !dirty}>
            <LuSave size={14} /> {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
          <button className='btn-secondary px-3 py-1.5 shrink-0' onClick={download} disabled={busyPdf}><LuDownload size={14} /> PDF</button>
          <button className='btn-secondary px-3 py-1.5 shrink-0 hidden lg:inline-flex' onClick={preview} disabled={busyPdf}><LuEye size={14} /> Aperçu PDF</button>
          {!locked && (
            <button className='btn-secondary px-3 py-1.5 shrink-0' onClick={() => setAiOpen((v) => !v)}><LuWand size={14} className='text-amber-500' /> IA</button>
          )}
          {beforeAi != null && (
            <button className='btn-ghost px-3 py-1.5 shrink-0 text-xs' onClick={undoAi} title='Revenir au texte d’avant la proposition de l’IA'><LuUndo2 size={14} /> Annuler l'IA</button>
          )}
          <div className='sm:hidden ml-auto flex rounded-lg border border-line overflow-hidden shrink-0'>
            <button className={`px-2.5 py-1 text-xs ${mobilePane === 'edit' ? 'bg-ink text-white' : 'bg-white'}`} onClick={() => setMobilePane('edit')}><LuPencil size={12} /></button>
            <button className={`px-2.5 py-1 text-xs ${mobilePane === 'read' ? 'bg-ink text-white' : 'bg-white'}`} onClick={() => setMobilePane('read')}><LuEye size={12} /></button>
          </div>
        </div>

        {unresolved.length > 0 && (
          <div className='shrink-0 px-4 sm:px-5 py-2 bg-amber-50 border-b border-amber-100 text-xs sm:text-sm text-amber-800'>
            {unresolved.length === 1 ? 'Cette variable ne peut' : 'Ces variables ne peuvent'} pas être remplie{unresolved.length > 1 ? 's' : ''} pour une entente fournisseur :{' '}
            <span className='font-mono'>{unresolved.join(', ')}</span>. Remplacez-la{unresolved.length > 1 ? 's' : ''} par du texte avant d'envoyer l'entente.
          </div>
        )}

        {locked && (
          <div className='shrink-0 px-4 sm:px-5 py-2 bg-emerald-50 border-b border-emerald-100 text-xs sm:text-sm text-emerald-800 flex items-center gap-2'>
            <LuLock size={14} className='shrink-0' />
            Signée par {contract.signedByName} le {formatDateTime(contract.signedAt)}. Le texte est verrouillé — dupliquez l'entente pour en faire une nouvelle version.
          </div>
        )}

        {aiOpen && (
          <div className='shrink-0 px-3 sm:px-5 py-3 border-b border-line bg-amber-50/60 space-y-2'>
            <div className='flex flex-col sm:flex-row gap-2'>
              <textarea
                className='input flex-1 h-20 sm:h-auto resize-none'
                rows={2}
                autoFocus
                placeholder={content.trim()
                  ? 'Ex. À l’article 5, ajoute un plafond de 2 000 $ de commission par mois…'
                  : 'Ex. Développeur web, mandat de 3 mois, 40 h/semaine, travail à distance…'}
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generate(); }}
              />
              <div className='flex sm:flex-col gap-2 justify-end'>
                <button className='btn-ghost px-3 py-1.5 text-xs' onClick={() => setAiOpen(false)}>Fermer</button>
                <button className='btn px-3 py-1.5 text-xs bg-amber-500 text-white hover:bg-amber-600' onClick={() => generate()} disabled={aiLoading || !aiPrompt.trim()}>
                  <LuWand size={12} /> {aiLoading ? 'Rédaction…' : content.trim() ? 'Proposer' : 'Rédiger'}
                </button>
              </div>
            </div>
            {content.trim() && (
              <div className='flex gap-1.5 overflow-x-auto pb-0.5'>
                {AI_SUGGESTIONS.map((sugg) => (
                  <button
                    key={sugg}
                    disabled={aiLoading}
                    onClick={() => { setAiPrompt(sugg); generate(sugg); }}
                    className='shrink-0 rounded-full border border-amber-200 bg-white px-2.5 py-1 text-xs text-ink hover:bg-amber-50 disabled:opacity-50'
                  >
                    {sugg}
                  </button>
                ))}
              </div>
            )}
            <p className='text-[11px] text-muted'>
              L'IA ne réécrit que les sections concernées et garde vos montants, dates et noms. Vous relisez sa proposition avant qu'elle soit appliquée.
            </p>
          </div>
        )}

        {/* Corps */}
        <div className='flex flex-1 min-h-0'>
          <div className={`flex-1 min-w-0 flex-col ${mobilePane === 'edit' ? 'flex' : 'hidden'} sm:flex`} data-color-mode='light'>
            <MDEditor
              ref={editorRef as any}
              value={locked ? contractBody(contract) : content}
              onChange={(v) => { if (!locked) { setContent(v ?? ''); setDirty(true); } }}
              preview={locked ? 'preview' : 'edit'}
              hideToolbar={locked}
              height='100%'
              visibleDragbar={false}
              style={{ height: '100%', borderRadius: 0, border: 'none', boxShadow: 'none' }}
              textareaProps={{ placeholder: 'Rédigez l’entente en Markdown…', spellCheck: true, readOnly: locked }}
            />
          </div>

          {/* Lecture (cellulaire) */}
          <div className={`flex-1 min-w-0 overflow-y-auto p-4 ${mobilePane === 'read' ? 'block' : 'hidden'} sm:hidden`} data-color-mode='light'>
            <MDEditor.Markdown source={locked ? contractBody(contract) : content} />
          </div>

          {/* Variables */}
          {!locked && (
            <aside className='w-64 shrink-0 border-l border-line bg-canvas-100 overflow-y-auto hidden lg:block'>
              <p className='px-4 pt-4 pb-2 text-xs text-muted'>Cliquez pour insérer la valeur à l'endroit du curseur.</p>
              {SUPPLIER_VARIABLE_GROUPS.map((g) => (
                <div key={g.group} className='px-3 pb-3'>
                  <p className='px-1 text-[11px] font-semibold uppercase tracking-wide text-muted mb-1'>{g.group}</p>
                  {g.vars.map((v) => (
                    <button
                      key={v.key}
                      onClick={() => insert(v.key)}
                      className='w-full text-left px-2 py-1.5 rounded-md hover:bg-white transition-colors'
                    >
                      <span className='block text-xs text-muted'>{v.label}</span>
                      <span className='block text-sm text-ink truncate'>{vars[v.key] || <em className='text-muted'>non renseigné</em>}</span>
                    </button>
                  ))}
                </div>
              ))}
            </aside>
          )}

          {previewUrl && (
            <div className='w-[45%] shrink-0 border-l border-line hidden lg:flex flex-col'>
              <div className='flex items-center justify-between px-3 py-2 border-b border-line text-xs text-muted'>
                Aperçu PDF
                <button onClick={() => setPreviewUrl(null)} className='hover:text-ink'><LuX size={14} /></button>
              </div>
              <iframe src={previewUrl} className='flex-1 w-full' title='Aperçu PDF' />
            </div>
          )}
        </div>
      </div>
      {proposal && <AiReview proposal={proposal} onApply={applyProposal} onCancel={() => setProposal(null)} />}
    </div>,
    document.body,
  );
}

// ─── Relecture d'une proposition de l'IA ─────────────────────────────────────

type AiProposal = {
  content: string;
  mode: 'generate' | 'edit';
  modified: string[];
  added: string[];
  removed: string[];
  lostFacts: string[];
  unresolved: string[];
};

const AI_SUGGESTIONS = [
  'Corrige le français et la typographie sans changer le sens',
  'Rends le texte plus simple à lire',
  'Ajoute une clause d’assurance responsabilité professionnelle',
  'Ajoute un préavis de résiliation de 30 jours',
  'Précise la description des services',
];

/** Les sections nommées dans `headings`, prises dans le texte proposé. */
function pickSections(md: string, headings: string[]): string {
  const wanted = new Set(headings);
  return md
    .split(/\n(?=## )/)
    .filter((chunk) => wanted.has(chunk.split('\n')[0].replace(/^##\s*/, '').trim()))
    .join('\n\n');
}

function AiReview({ proposal, onApply, onCancel }: { proposal: AiProposal; onApply: () => void; onCancel: () => void }) {
  const changed = proposal.mode === 'edit' ? pickSections(proposal.content, [...proposal.modified, ...proposal.added]) : proposal.content;
  const nothing = proposal.mode === 'edit' && !proposal.modified.length && !proposal.added.length && !proposal.removed.length;
  return (
    <div className='absolute inset-0 z-[70] bg-ink/40 flex items-stretch sm:items-center justify-center sm:p-6'>
      <div className='bg-white sm:rounded-2xl shadow-2xl flex flex-col w-full max-w-3xl max-h-full sm:max-h-[85vh] overflow-hidden'>
        <div className='shrink-0 px-5 py-4 border-b border-line flex items-center gap-2'>
          <LuWand size={16} className='text-amber-500' />
          <h3 className='font-semibold text-ink flex-1'>{proposal.mode === 'edit' ? 'Proposition de modification' : 'Entente proposée'}</h3>
          <button onClick={onCancel} className='text-muted hover:text-ink' aria-label='Fermer'><LuX size={18} /></button>
        </div>

        <div className='flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4'>
          {proposal.mode === 'edit' && (
            <div className='flex flex-wrap gap-1.5 text-xs'>
              {proposal.modified.map((h) => <span key={`m${h}`} className='badge-info'>Modifiée : {h}</span>)}
              {proposal.added.map((h) => <span key={`a${h}`} className='badge-success'>Ajoutée : {h}</span>)}
              {proposal.removed.map((h) => <span key={`r${h}`} className='badge-danger'>Supprimée : {h}</span>)}
              {nothing && <span className='text-muted'>L'IA n'a proposé aucun changement. Reformulez la demande en nommant la section visée.</span>}
            </div>
          )}

          {proposal.lostFacts.length > 0 && (
            <div className='rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 flex gap-2'>
              <LuTriangleAlert size={16} className='shrink-0 mt-0.5' />
              <div>
                <p className='font-medium'>Ces valeurs ne se retrouvent plus dans le texte :</p>
                <p className='font-mono text-xs mt-0.5'>{proposal.lostFacts.join(' · ')}</p>
                <p className='text-xs mt-1'>Si vous ne l'avez pas demandé, annulez et précisez votre demande.</p>
              </div>
            </div>
          )}
          {proposal.unresolved.length > 0 && (
            <p className='rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900'>
              Variables à remplacer par du texte : <span className='font-mono'>{proposal.unresolved.join(', ')}</span>
            </p>
          )}

          {changed.trim() && (
            <div data-color-mode='light' className='rounded-lg border border-line p-4'>
              <MDEditor.Markdown source={changed} style={{ background: 'transparent', fontSize: 14 }} />
            </div>
          )}
        </div>

        <div className='shrink-0 px-5 py-3 border-t border-line flex justify-end gap-2 bg-canvas-100'>
          <button className='btn-secondary' onClick={onCancel}>Ignorer</button>
          <button className='btn-primary' onClick={onApply} disabled={nothing}><LuCheck size={14} /> Appliquer</button>
        </div>
      </div>
    </div>
  );
}

// ─── Partage ─────────────────────────────────────────────────────────────────

export async function toggleContractShare(contract: ContractRow) {
  const next = !contract.sharedWithSupplier;
  try {
    await updateSupplierContract({ id: contract.id, sharedWithSupplier: next });
    toast.success(next ? 'Entente visible dans le portail du fournisseur' : 'Entente retirée du portail');
  } catch (err: any) {
    toast.error(err?.message || 'Erreur');
  }
}

export function contractPeriod(c: Pick<ContractRow, 'startDate' | 'endDate'>): string {
  if (c.startDate && c.endDate) return `${formatDate(c.startDate)} → ${formatDate(c.endDate)}`;
  if (c.startDate) return `Depuis le ${formatDate(c.startDate)}`;
  if (c.endDate) return `Jusqu'au ${formatDate(c.endDate)}`;
  return 'Durée non précisée';
}

