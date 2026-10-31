import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import toast from 'react-hot-toast';
import {
  LuArrowLeft, LuPencil, LuTrash2, LuFilePenLine, LuReceipt, LuShare2, LuCopy, LuExternalLink, LuX, LuPlus,
  LuDownload, LuMail, LuLock, LuBell, LuFolderOpen, LuSend, LuCircleAlert, LuMessageSquare, LuEye, LuEyeOff,
} from 'react-icons/lu';
import {
  useQuery,
  useAction,
  getSupplierDetail,
  getCompanyBrandAssets,
  getCurrentCompany,
  deleteSupplier,
  updateSupplier,
  updateSupplierContract,
  duplicateSupplierContract,
  deleteSupplierContract,
  createSupplierNote,
  deleteSupplierNote,
  markSupplierNotesRead,
  createSupplierPortalAccess,
  revokeSupplierPortalAccess,
  getSupplierFiles,
  createSupplierFolder,
  uploadSupplierFile,
  deleteSupplierFiles,
  renameSupplierFile,
  moveSupplierFiles,
} from 'wasp/client/operations';
import { useConfirm, IconBtn } from '../../client/ui';
import { formatCurrency, formatDate, formatDateTime } from '../../shared/format';
import {
  SUPPLIER_STATUS, CONTRACT_STATUS, supplierTypeLabel, formatRate, invoiceBalance, invoiceDisplayStatus, isPayable,
  buildSupplierContractVars, SIGNED_CONTRACT_STATUSES,
} from '../../shared/supplier';
import type { BrandAssets } from '../documents/pdf';
import { PAYMENT_METHODS } from '../payments/PaymentForm';
import { SharedFileManager } from '../projects/SharedFileManager';
import { SupplierForm } from './SupplierForm';
import { SupplierInvoiceForm, SupplierInvoiceList, type SupplierInvoiceRow } from './InvoiceComponents';
import {
  NewContractModal, ContractEditorModal, ContractStatusBadge, downloadContractPdf, toggleContractShare, contractPeriod, resolveContract,
  type ContractRow,
} from './ContractComponents';

type Tab = 'resume' | 'ententes' | 'factures' | 'fichiers' | 'messages' | 'portail';

const TABS: { id: Tab; label: string }[] = [
  { id: 'resume', label: 'Résumé' },
  { id: 'ententes', label: 'Ententes' },
  { id: 'factures', label: 'Factures' },
  { id: 'fichiers', label: 'Fichiers' },
  { id: 'messages', label: 'Messages' },
  { id: 'portail', label: 'Portail' },
];

export default function SupplierDetailPage() {
  const { supplierId } = useParams<{ supplierId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab') as Tab | null;
  const tab: Tab = TABS.some((t) => t.id === rawTab) ? rawTab! : 'resume';
  const setTab = (id: Tab) => setSearchParams({ tab: id }, { replace: true });
  const { data: supplier, isLoading, error } = useQuery(getSupplierDetail, { supplierId: supplierId! });
  const [editing, setEditing] = useState(false);
  const { ask, Dialog } = useConfirm();

  if (isLoading) return <div className='text-muted p-6'>Chargement…</div>;
  if (error || !supplier) return <div className='text-muted p-6'>Fournisseur introuvable.</div>;
  const s = supplier as any;

  const toApprove = s.invoices.filter((i: any) => i.status === 'a_approuver').length;
  const unread = s.messages.filter((m: any) => m.isFromSupplier && !m.readAt).length;
  const badges: Partial<Record<Tab, number>> = { factures: toApprove, messages: unread };

  const remove = async () => {
    if (!(await ask(`Supprimer « ${s.name} » ?`, { description: 'Ententes, factures, paiements, fichiers et liens de portail seront supprimés définitivement.' }))) return;
    try {
      await deleteSupplier({ id: s.id });
      toast.success('Fournisseur supprimé');
      navigate('/fournisseurs');
    } catch (err: any) {
      toast.error(err?.message || 'Erreur lors de la suppression');
    }
  };

  return (
    <>
      <div className='flex items-start gap-2 sm:gap-3 mb-6'>
        <button onClick={() => navigate('/fournisseurs')} className='p-2 rounded-lg hover:bg-canvas transition-colors text-muted hover:text-ink shrink-0' title='Retour aux fournisseurs'>
          <LuArrowLeft size={20} />
        </button>
        <div className='flex-1 min-w-0'>
          <div className='flex items-center gap-2 flex-wrap'>
            <h1 className='text-xl sm:text-2xl font-bold text-ink truncate'>{s.name}</h1>
            <span className={SUPPLIER_STATUS[s.status]?.className || 'badge-neutral'}>{SUPPLIER_STATUS[s.status]?.label || s.status}</span>
          </div>
          <p className='text-sm text-muted mt-0.5 truncate'>
            {supplierTypeLabel(s.type)}{s.specialty ? ` · ${s.specialty}` : ''}{s.contactName ? ` · ${s.contactName}` : ''}
          </p>
        </div>
        <div className='flex items-center gap-1 shrink-0'>
          <button className='btn-secondary px-3' onClick={() => setEditing(true)}><LuPencil size={14} /><span className='hidden sm:inline'>Modifier</span></button>
          <IconBtn variant='danger' title='Supprimer le fournisseur' onClick={remove}><LuTrash2 size={16} /></IconBtn>
        </div>
      </div>

      <div className='flex gap-1 border-b border-line mb-6 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0'>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 sm:px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
              tab === t.id ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            {t.label}
            {!!badges[t.id] && <span className={`ml-1.5 ${t.id === 'factures' ? 'badge-warning' : 'badge-info'}`}>{badges[t.id]}</span>}
          </button>
        ))}
      </div>

      {tab === 'resume' && <ResumeTab supplier={s} setTab={setTab} />}
      {tab === 'ententes' && <ContractsTab supplier={s} />}
      {tab === 'factures' && <InvoicesTab supplier={s} />}
      {tab === 'fichiers' && <FilesTab supplierId={s.id} />}
      {tab === 'messages' && <MessagesTab supplier={s} />}
      {tab === 'portail' && <PortalTab supplier={s} />}

      {editing && <SupplierForm supplier={s} onClose={() => setEditing(false)} />}
      {Dialog}
    </>
  );
}

// ─── Résumé ───────────────────────────────────────────────────────────────────

function ResumeTab({ supplier: s, setTab }: { supplier: any; setTab: (t: Tab) => void }) {
  const invoices = s.invoices as SupplierInvoiceRow[];
  const valid = invoices.filter((i) => i.status !== 'rejetee');
  const invoiced = valid.reduce((sum, i) => sum + i.total, 0);
  const paid = invoices.reduce((sum, i) => sum + i.amountPaid, 0);
  const due = invoices.filter(isPayable).reduce((sum, i) => sum + invoiceBalance(i), 0);
  const toApprove = invoices.filter((i) => i.status === 'a_approuver');
  const overdue = invoices.filter((i) => invoiceDisplayStatus(i) === 'en_retard');
  const awaitingSignature = (s.contracts as ContractRow[]).filter((c) => c.status === 'envoyee');
  const signed = (s.contracts as ContractRow[]).filter((c) => c.status === 'signee');
  const unread = s.messages.filter((m: any) => m.isFromSupplier && !m.readAt);
  const activePortal = s.access.filter((a: any) => !a.isRevoked).length;

  const todo = [
    toApprove.length > 0 && { tab: 'factures' as Tab, tone: 'text-warning', text: `${toApprove.length} facture(s) à approuver`, icon: <LuReceipt size={15} /> },
    overdue.length > 0 && { tab: 'factures' as Tab, tone: 'text-danger', text: `${overdue.length} facture(s) en retard de paiement`, icon: <LuCircleAlert size={15} /> },
    awaitingSignature.length > 0 && { tab: 'ententes' as Tab, tone: 'text-sky-700', text: `${awaitingSignature.length} entente(s) en attente de signature`, icon: <LuFilePenLine size={15} /> },
    unread.length > 0 && { tab: 'messages' as Tab, tone: 'text-sky-700', text: `${unread.length} nouveau(x) message(s)`, icon: <LuMessageSquare size={15} /> },
  ].filter(Boolean) as { tab: Tab; tone: string; text: string; icon: React.ReactNode }[];

  return (
    <div className='space-y-6'>
      <div className='grid grid-cols-2 lg:grid-cols-4 gap-3'>
        <Stat label='Facturé' value={formatCurrency(invoiced)} sub={`${valid.length} facture(s)`} />
        <Stat label='Payé' value={formatCurrency(paid)} />
        <Stat label='Solde à payer' value={formatCurrency(due)} sub={overdue.length ? `${overdue.length} en retard` : undefined} danger={overdue.length > 0} />
        <Stat label='Ententes signées' value={String(signed.length)} sub={awaitingSignature.length ? `${awaitingSignature.length} en attente` : undefined} />
      </div>

      <div className='grid grid-cols-1 sm:grid-cols-3 gap-2'>
        <QuickAction icon={<LuFilePenLine size={18} />} label='Rédiger une entente' onClick={() => setTab('ententes')} />
        <QuickAction icon={<LuReceipt size={18} />} label='Ajouter une facture' onClick={() => setTab('factures')} />
        <QuickAction icon={<LuShare2 size={18} />} label={activePortal ? 'Gérer le portail' : 'Ouvrir un portail'} onClick={() => setTab('portail')} />
      </div>

      {todo.length > 0 && (
        <div className='card p-5'>
          <h2 className='text-sm font-semibold text-ink mb-3 uppercase tracking-wide'>À traiter</h2>
          <ul className='space-y-1'>
            {todo.map((t) => (
              <li key={t.text}>
                <button onClick={() => setTab(t.tab)} className={`w-full flex items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-canvas-100 text-left ${t.tone}`}>
                  {t.icon}<span className='flex-1 text-ink'>{t.text}</span><span className='text-xs text-muted'>Voir →</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className='grid grid-cols-1 lg:grid-cols-2 gap-6'>
        <div className='card p-5'>
          <h2 className='text-sm font-semibold text-ink mb-4 uppercase tracking-wide'>Coordonnées</h2>
          <dl className='grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm'>
            <Info label='Contact' value={s.contactName} />
            <Info label='Courriel' value={s.email} href={s.email ? `mailto:${s.email}` : undefined} />
            <Info label='Téléphone' value={s.phone} href={s.phone ? `tel:${s.phone}` : undefined} />
            <Info label='Site web' value={s.website} href={s.website || undefined} />
            <Info label='Adresse' value={[s.address, s.city, s.province, s.postalCode].filter(Boolean).join(', ')} wide />
            <Info label='NEQ' value={s.neq} />
            <Info label='TPS / TVQ' value={[s.taxNumberGst, s.taxNumberQst].filter(Boolean).join(' · ') || 'Non inscrit'} />
            <Info label='Fournisseur depuis' value={formatDate(s.createdAt)} />
          </dl>
        </div>
        <div className='card p-5'>
          <h2 className='text-sm font-semibold text-ink mb-4 uppercase tracking-wide'>Conditions et paiement</h2>
          <dl className='grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm'>
            <Info label='Rémunération' value={formatRate(s.rate, s.rateType)} />
            <Info label='Délai de paiement' value={s.paymentTermsDays != null ? `${s.paymentTermsDays} jours` : null} />
            <Info label='Méthode' value={s.paymentMethod ? PAYMENT_METHODS[s.paymentMethod] || s.paymentMethod : null} />
            <Info label='Coordonnées de paiement' value={s.paymentDetails} wide pre />
          </dl>
          {s.notes && (
            <div className='mt-4 pt-4 border-t border-line'>
              <p className='text-xs text-muted uppercase tracking-wide mb-1'>Notes</p>
              <p className='text-sm text-ink whitespace-pre-wrap'>{s.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, danger }: { label: string; value: string; sub?: string; danger?: boolean }) {
  return (
    <div className='card p-4'>
      <p className='text-xs text-muted uppercase tracking-wide mb-1'>{label}</p>
      <p className={`text-xl sm:text-2xl font-bold ${danger ? 'text-danger' : 'text-ink'}`}>{value}</p>
      {sub && <p className='text-xs text-muted mt-0.5'>{sub}</p>}
    </div>
  );
}

function QuickAction({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className='card flex items-center gap-3 px-4 py-3 text-sm font-medium text-ink hover:border-ink/20 transition-colors'>
      <span className='text-accent'>{icon}</span>{label}
    </button>
  );
}

function Info({ label, value, href, wide, pre }: { label: string; value?: string | null; href?: string; wide?: boolean; pre?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <dt className='text-muted'>{label}</dt>
      <dd className={`font-medium text-ink break-words ${pre ? 'whitespace-pre-wrap' : ''}`}>
        {!value ? <span className='text-muted font-normal'>—</span> : href ? <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel='noreferrer' className='hover:underline'>{value}</a> : value}
      </dd>
    </div>
  );
}

// ─── Ententes ─────────────────────────────────────────────────────────────────

function ContractsTab({ supplier }: { supplier: any }) {
  const { data: brand } = useQuery(getCompanyBrandAssets);
  const { data: company } = useQuery(getCurrentCompany);
  const { ask, Dialog } = useConfirm();
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState<ContractRow | null>(null);
  const contracts = supplier.contracts as ContractRow[];
  // L'entente fraîchement créée n'est pas encore dans la requête rechargée.
  const open = contracts.find((c) => c.id === openId) ?? (justCreated?.id === openId ? justCreated : null);
  const hasPortal = supplier.access.some((a: any) => !a.isRevoked);

  const setStatus = async (c: ContractRow, status: string) => {
    try {
      await updateSupplierContract({ id: c.id, status });
      toast.success('Statut mis à jour');
    } catch (err: any) {
      toast.error(err?.message || 'Erreur');
    }
  };

  const duplicate = async (c: ContractRow, asNewVersion = false) => {
    try {
      const copy = await duplicateSupplierContract({ id: c.id, asNewVersion });
      toast.success(asNewVersion ? 'Nouvelle version créée — modifiez-la puis partagez-la pour signature.' : 'Entente dupliquée');
      setJustCreated(copy as any);
      setOpenId((copy as any).id);
    } catch (err: any) {
      toast.error(err?.message || 'Erreur');
    }
  };

  const remove = async (c: ContractRow) => {
    if (!(await ask(`Supprimer « ${c.title} » ?`, c.signedAt ? { description: 'Cette entente a été signée. Téléchargez-en le PDF avant de la supprimer si vous devez la conserver.' } : undefined))) return;
    try {
      await deleteSupplierContract({ id: c.id });
      toast.success('Entente supprimée');
    } catch (err: any) {
      toast.error(err?.message || 'Erreur');
    }
  };

  const pdf = async (c: ContractRow) => {
    try {
      const vars = buildSupplierContractVars(supplier, (company as any) ?? { name: '' }, c);
      await downloadContractPdf(resolveContract(c, vars), (brand as BrandAssets) ?? null, (company as any)?.name ?? '');
    } catch (err: any) {
      toast.error(err?.message || 'Erreur lors de la génération du PDF');
    }
  };

  return (
    <>
      <div className='flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4'>
        <p className='text-xs text-muted max-w-2xl'>
          Rédigez l'entente, relisez-la, puis partagez-la : le fournisseur la lit et la signe depuis son portail. Une entente signée est verrouillée.
        </p>
        <button className='btn-primary shrink-0' onClick={() => setCreating(true)}><LuPlus size={16} /> Nouvelle entente</button>
      </div>

      {contracts.length === 0 ? (
        <div className='card p-10 text-center'>
          <LuFilePenLine size={32} className='mx-auto mb-3 text-muted opacity-50' />
          <p className='font-semibold text-ink'>Aucune entente pour {supplier.name}</p>
          <p className='text-sm text-muted mt-1 max-w-md mx-auto'>Partez du modèle intégré d'entente de services professionnels : les coordonnées, le tarif et le délai de paiement sont remplis pour vous.</p>
          <button className='btn-primary mt-5' onClick={() => setCreating(true)}>Rédiger une entente de service</button>
        </div>
      ) : (
        <div className='space-y-3'>
          {contracts.map((c) => (
            <div key={c.id} className='card p-4'>
              <div className='flex flex-col sm:flex-row sm:items-start gap-3'>
                <button className='flex-1 min-w-0 text-left' onClick={() => setOpenId(c.id)}>
                  <div className='flex items-center gap-2 flex-wrap'>
                    <p className='font-medium text-ink hover:underline'>{c.title}</p>
                    <ContractStatusBadge contract={c} />
                    {c.sharedWithSupplier && <span className='badge-info'><LuEye size={11} /> Dans le portail</span>}
                  </div>
                  <p className='text-xs text-muted mt-1'>
                    {contractPeriod(c)}{formatRate(c.rate, c.rateType) ? ` · ${formatRate(c.rate, c.rateType)}` : ''} · créée le {formatDate(c.createdAt)}
                  </p>
                  {c.signedAt && <p className='text-xs text-emerald-700 mt-1'>Signée par {c.signedByName} le {formatDateTime(c.signedAt)}</p>}
                </button>
                <div className='flex items-center gap-1 flex-wrap'>
                  <select
                    className='input w-auto py-1 text-xs'
                    value={c.status}
                    onChange={(e) => setStatus(c, e.target.value)}
                    title='Statut'
                  >
                    {Object.entries(CONTRACT_STATUS)
                      .filter(([v]) => !c.signedAt || SIGNED_CONTRACT_STATUSES.includes(v))
                      .map(([v, { label }]) => <option key={v} value={v}>{label}</option>)}
                  </select>
                  <IconBtn title={c.sharedWithSupplier ? 'Retirer du portail' : 'Partager dans le portail'} onClick={() => toggleContractShare(c)}>
                    {c.sharedWithSupplier ? <LuEyeOff size={15} /> : <LuShare2 size={15} />}
                  </IconBtn>
                  <IconBtn title='Télécharger le PDF' onClick={() => pdf(c)}><LuDownload size={15} /></IconBtn>
                  <IconBtn title={c.signedAt ? 'Voir' : 'Rédiger'} onClick={() => setOpenId(c.id)}><LuPencil size={15} /></IconBtn>
                  <IconBtn title='Dupliquer' onClick={() => duplicate(c)}><LuCopy size={15} /></IconBtn>
                  <IconBtn variant='danger' title='Supprimer' onClick={() => remove(c)}><LuTrash2 size={15} /></IconBtn>
                </div>
              </div>
              {c.signedAt && c.status === 'annulee' && (
                <div className='mt-3 flex flex-col sm:flex-row sm:items-center gap-2 rounded-md bg-canvas-100 px-3 py-2'>
                  <p className='text-xs text-muted flex-1'>
                    Entente annulée. La signature de {c.signedByName} reste au dossier ; la nouvelle version devra être signée à son tour.
                  </p>
                  <button className='btn-secondary px-3 py-1.5 text-xs shrink-0' onClick={() => duplicate(c, true)}>
                    <LuCopy size={13} /> Remplacer par une nouvelle version
                  </button>
                </div>
              )}
              {c.sharedWithSupplier && !hasPortal && (
                <p className='text-xs text-amber-700 bg-amber-50 rounded-md px-2 py-1 mt-3'>Aucun lien de portail actif : créez-en un dans l'onglet Portail pour que le fournisseur puisse la consulter.</p>
              )}
            </div>
          ))}
        </div>
      )}

      {creating && (
        <NewContractModal
          supplier={supplier}
          onClose={() => setCreating(false)}
          onCreated={(c) => { setCreating(false); setJustCreated(c); setOpenId(c.id); }}
        />
      )}
      {open && <ContractEditorModal key={open.id} contract={open} supplier={supplier} onClose={() => setOpenId(null)} />}
      {Dialog}
    </>
  );
}

// ─── Factures ─────────────────────────────────────────────────────────────────

function InvoicesTab({ supplier }: { supplier: any }) {
  const [creating, setCreating] = useState(false);
  const invoices = useMemo(
    () => (supplier.invoices as SupplierInvoiceRow[]).map((i) => ({ ...i, supplier: { id: supplier.id, name: supplier.name } })),
    [supplier],
  );
  return (
    <>
      <div className='flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4'>
        <p className='text-xs text-muted max-w-2xl'>
          Les factures déposées dans le portail arrivent « À approuver ». Approuvez-les, puis enregistrez chaque paiement — complet ou partiel — le statut suit tout seul.
        </p>
        <button className='btn-primary shrink-0' onClick={() => setCreating(true)}><LuPlus size={16} /> Ajouter une facture</button>
      </div>
      <SupplierInvoiceList
        invoices={invoices}
        suppliers={{ [supplier.id]: supplier }}
        defaultFilter='all'
        emptyMessage={`Aucune facture de ${supplier.name} pour l'instant.`}
      />
      {creating && <SupplierInvoiceForm supplier={supplier} onClose={() => setCreating(false)} />}
    </>
  );
}

// ─── Fichiers ─────────────────────────────────────────────────────────────────

function FilesTab({ supplierId }: { supplierId: string }) {
  const { data: files, refetch, isFetching } = useQuery(getSupplierFiles, { supplierId });
  const createFolder = useAction(createSupplierFolder);
  const upload = useAction(uploadSupplierFile);
  const remove = useAction(deleteSupplierFiles);
  const rename = useAction(renameSupplierFile);
  const move = useAction(moveSupplierFiles);

  return (
    <>
      <div className='mb-4 rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-900 flex items-start gap-2'>
        <LuFolderOpen size={14} className='shrink-0 mt-0.5' />
        <span>
          Tout ce qui est dans le dossier <strong>« Partagé avec le fournisseur »</strong> est visible dans son portail, et c'est là qu'arrivent les documents qu'il y dépose.
          Le reste du drive (soumissions, CV, notes…) demeure interne.
        </span>
      </div>
      <SharedFileManager
        ops={{
          files: files as any[] | undefined,
          isFetching,
          refetch,
          upload: ({ dataUrl, name, originalName, parentId }) => upload({ supplierId, dataUrl, name, originalName, parentId }),
          createFolder: ({ name, parentId }) => createFolder({ supplierId, name, parentId }),
          deleteFiles: ({ ids }) => remove({ supplierId, ids }),
          renameFile: ({ id, name }) => rename({ id, name }),
          moveFiles: ({ ids, targetParentId }) => move({ supplierId, ids, targetParentId }),
          instanceId: `supplier-${supplierId}`,
        }}
      />
    </>
  );
}

// ─── Messages ─────────────────────────────────────────────────────────────────

function MessagesTab({ supplier }: { supplier: any }) {
  const { ask, Dialog } = useConfirm();
  const [content, setContent] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [saving, setSaving] = useState(false);
  const hasUnread = supplier.messages.some((m: any) => m.isFromSupplier && !m.readAt);
  const hasPortal = supplier.access.some((a: any) => !a.isRevoked);

  useEffect(() => {
    if (hasUnread) markSupplierNotesRead({ supplierId: supplier.id }).catch(() => {});
  }, [hasUnread, supplier.id]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    setSaving(true);
    try {
      await createSupplierNote({ supplierId: supplier.id, content, isPrivate });
      setContent('');
      toast.success(isPrivate ? 'Note interne ajoutée' : 'Message publié dans le portail');
    } catch (err: any) {
      toast.error(err?.message || 'Erreur');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!(await ask('Supprimer ce message ?'))) return;
    try {
      await deleteSupplierNote({ id });
    } catch (err: any) {
      toast.error(err?.message || 'Erreur');
    }
  };

  return (
    <div className='max-w-2xl space-y-5'>
      <form onSubmit={submit} className={`card p-4 space-y-3 ${isPrivate ? 'border-amber-200 bg-amber-50/40' : ''}`}>
        <textarea
          className='input'
          rows={3}
          placeholder={isPrivate ? 'Note interne : jamais visible par le fournisseur…' : `Message à ${supplier.contactName || supplier.name}…`}
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
        <div className='flex flex-col sm:flex-row sm:items-center gap-3'>
          <label className='flex items-center gap-2 text-sm cursor-pointer'>
            <input type='checkbox' className='accent-ink' checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
            <LuLock size={13} className='text-muted' /> Note interne
          </label>
          <button type='submit' className='btn-primary sm:ml-auto' disabled={saving || !content.trim()}>
            <LuSend size={14} /> {saving ? 'Envoi…' : isPrivate ? 'Ajouter la note' : 'Publier'}
          </button>
        </div>
        {!isPrivate && !hasPortal && <p className='text-xs text-amber-700'>Le fournisseur lira ce message dans son portail : créez un lien dans l'onglet Portail.</p>}
      </form>

      {supplier.messages.length === 0 ? (
        <p className='text-sm text-muted text-center py-8'>Aucun message pour l'instant.</p>
      ) : (
        <ul className='space-y-3'>
          {supplier.messages.map((m: any) => (
            <li
              key={m.id}
              className={`card p-4 group ${m.isFromSupplier ? 'bg-sky-50 border-sky-100 mr-6 sm:mr-12' : m.isPrivate ? 'bg-amber-50 border-amber-100' : 'ml-6 sm:ml-12'}`}
            >
              <div className='flex items-center gap-2 mb-1.5 text-xs'>
                <span className='font-medium text-ink'>{m.isFromSupplier ? m.authorName || supplier.name : m.authorName || 'Vous'}</span>
                {m.isPrivate && <span className='badge-warning'><LuLock size={10} /> Interne</span>}
                <span className='text-muted ml-auto'>{formatDateTime(m.createdAt)}</span>
                {!m.isFromSupplier && (
                  <button className='text-muted hover:text-danger sm:opacity-0 group-hover:opacity-100 transition-opacity' title='Supprimer' onClick={() => remove(m.id)}>
                    <LuTrash2 size={13} />
                  </button>
                )}
              </div>
              <p className='text-sm text-ink whitespace-pre-wrap leading-relaxed'>{m.content}</p>
            </li>
          ))}
        </ul>
      )}
      {Dialog}
    </div>
  );
}

// ─── Portail ──────────────────────────────────────────────────────────────────

function PortalTab({ supplier }: { supplier: any }) {
  const { ask, Dialog } = useConfirm();
  const [label, setLabel] = useState('');
  const [creating, setCreating] = useState(false);
  const base = typeof window !== 'undefined' ? `${window.location.origin}/portail-fournisseur/` : '/portail-fournisseur/';
  const active = supplier.access.filter((a: any) => !a.isRevoked);
  const revoked = supplier.access.filter((a: any) => a.isRevoked);

  const create = async () => {
    setCreating(true);
    try {
      await createSupplierPortalAccess({ supplierId: supplier.id, label: label.trim() || undefined });
      setLabel('');
      toast.success('Lien de portail créé');
    } catch (err: any) {
      toast.error(err?.message || 'Erreur');
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (a: any) => {
    if (!(await ask('Révoquer ce lien ?', { description: 'Le fournisseur ne pourra plus accéder au portail avec ce lien.' }))) return;
    try {
      await revokeSupplierPortalAccess({ id: a.id });
      toast.success('Lien révoqué');
    } catch (err: any) {
      toast.error(err?.message || 'Erreur');
    }
  };

  const copy = async (token: string) => {
    try {
      await navigator.clipboard.writeText(`${base}${token}`);
      toast.success('Lien copié');
    } catch {
      toast.error('Copie impossible');
    }
  };

  const mailto = (token: string) => {
    const subject = encodeURIComponent('Votre portail fournisseur');
    const body = encodeURIComponent(
      `Bonjour ${supplier.contactName || supplier.name},\n\nVoici votre accès à votre portail fournisseur. Vous pourrez y déposer vos factures, consulter et signer vos ententes, échanger des documents et suivre vos paiements :\n\n${base}${token}\n\nConservez ce lien : il vous est personnel.\n\nMerci !`,
    );
    return `mailto:${supplier.email || ''}?subject=${subject}&body=${body}`;
  };

  const toggleNotify = async (v: boolean) => {
    try {
      await updateSupplier({ id: supplier.id, notifyOnPortalActivity: v });
    } catch (err: any) {
      toast.error(err?.message || 'Erreur');
    }
  };

  return (
    <div className='max-w-2xl space-y-6'>
      <div className='card p-5 bg-sky-50 border-sky-100'>
        <h3 className='font-semibold text-ink mb-2 flex items-center gap-2'><LuShare2 size={17} className='text-sky-600' /> Portail fournisseur</h3>
        <p className='text-sm text-muted leading-relaxed'>
          Un lien sécurisé, sans compte à créer. {supplier.name} pourra y <strong>déposer ses factures</strong> et voir leur statut de paiement,
          <strong> lire et signer</strong> les ententes que vous partagez, échanger des <strong>documents</strong> (dossier « Partagé avec le fournisseur »)
          et vous écrire. Notes internes, coordonnées bancaires et autres fichiers n'y apparaissent jamais.
        </p>
      </div>

      <div className='card p-5'>
        <h3 className='font-semibold text-ink mb-3'>Créer un lien</h3>
        <div className='flex flex-col sm:flex-row gap-2'>
          <input className='input flex-1' placeholder='Étiquette (optionnel) — ex. Lien 2026' value={label} onChange={(e) => setLabel(e.target.value)} />
          <button className='btn-primary' onClick={create} disabled={creating}><LuPlus size={16} /> {creating ? 'Création…' : 'Générer'}</button>
        </div>
      </div>

      {active.length > 0 && (
        <div>
          <h3 className='text-xs font-semibold uppercase tracking-wider text-muted mb-2'>Liens actifs ({active.length})</h3>
          <div className='space-y-3'>
            {active.map((a: any) => (
              <div key={a.id} className='card p-4'>
                <p className='text-sm font-medium text-ink'>{a.label || 'Lien sans étiquette'}</p>
                <p className='text-xs text-muted mt-0.5 truncate font-mono'>{base}{a.token}</p>
                <p className='text-xs text-muted mt-1'>
                  Créé le {formatDate(a.createdAt)}{a.lastUsedAt ? ` · dernière visite ${formatDateTime(a.lastUsedAt)}` : ' · jamais ouvert'}
                </p>
                <div className='flex flex-wrap gap-2 mt-3'>
                  <button className='btn-secondary px-3 py-1.5 text-xs' onClick={() => copy(a.token)}><LuCopy size={13} /> Copier</button>
                  <a className='btn-secondary px-3 py-1.5 text-xs' href={mailto(a.token)}><LuMail size={13} /> Envoyer par courriel</a>
                  <a className='btn-secondary px-3 py-1.5 text-xs' href={`/portail-fournisseur/${a.token}`} target='_blank' rel='noreferrer'><LuExternalLink size={13} /> Voir</a>
                  <button className='btn-danger px-3 py-1.5 text-xs' onClick={() => revoke(a)}><LuX size={13} /> Révoquer</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {revoked.length > 0 && (
        <div>
          <h3 className='text-xs font-semibold uppercase tracking-wider text-muted mb-2'>Liens révoqués ({revoked.length})</h3>
          {revoked.map((a: any) => (
            <p key={a.id} className='text-sm text-muted opacity-60'>{a.label || 'Lien sans étiquette'} — créé le {formatDate(a.createdAt)}</p>
          ))}
        </div>
      )}

      <div className='card p-5'>
        <label className='flex items-start gap-3 cursor-pointer'>
          <input type='checkbox' className='mt-0.5 accent-ink' checked={supplier.notifyOnPortalActivity} onChange={(e) => toggleNotify(e.target.checked)} />
          <div>
            <p className='text-sm font-medium text-ink flex items-center gap-1.5'><LuBell size={14} className='text-muted' /> M'avertir par courriel</p>
            <p className='text-xs text-muted'>Un courriel à l'adresse de l'entreprise quand {supplier.name} dépose une facture, signe une entente ou écrit un message. Nécessite le courriel sortant (Paramètres → Intégrations).</p>
          </div>
        </label>
      </div>
      {Dialog}
    </div>
  );
}
