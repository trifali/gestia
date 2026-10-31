import { useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import MDEditor from '@uiw/react-md-editor';
import toast from 'react-hot-toast';
import {
  LuLock, LuReceipt, LuFilePenLine, LuFolderOpen, LuMessageSquare, LuUpload, LuPaperclip, LuX, LuDownload,
  LuSend, LuCircleCheck, LuExternalLink, LuBriefcase,
} from 'react-icons/lu';
import {
  useQuery,
  useAction,
  getSupplierPortal,
  getSupplierPortalBrand,
  submitSupplierPortalInvoice,
  submitSupplierPortalNote,
  signSupplierContract,
  getSupplierPortalFiles,
  uploadSupplierPortalFile,
  createSupplierPortalFolder,
  deleteSupplierPortalFiles,
  renameSupplierPortalFile,
  moveSupplierPortalFiles,
} from 'wasp/client/operations';
import { Modal } from '../../client/ui';
import { formatCurrency, formatDate, formatDateTime } from '../../shared/format';
import { computeTaxes, invoiceBalance, invoiceDisplayStatus, withSignature, type InvoiceDisplayStatus } from '../../shared/supplier';
import { SharedFileManager } from '../projects/SharedFileManager';
import { PaidBar, readFileAsDataUrl, todayInput, MAX_UPLOAD_BYTES } from './InvoiceComponents';
import { ContractStatusBadge, downloadContractPdf, contractPeriod } from './ContractComponents';
import { MessageBody, MessageComposer } from './MessageMarkdown';

const TABS = [
  { id: 'factures', label: 'Factures', icon: LuReceipt },
  { id: 'ententes', label: 'Ententes', icon: LuFilePenLine },
  { id: 'documents', label: 'Documents', icon: LuFolderOpen },
  { id: 'messages', label: 'Messages', icon: LuMessageSquare },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function SupplierPortalPage() {
  const { token } = useParams<{ token: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get('tab') as TabId | null;
  const tab: TabId = TABS.some((t) => t.id === raw) ? raw! : 'factures';
  const setTab = (id: TabId) => setSearchParams({ tab: id }, { replace: true });
  const { data, isLoading, error } = useQuery(getSupplierPortal, { token: token! }, { retry: false });

  if (isLoading) {
    return <Shell><div className='flex items-center justify-center h-64 text-muted'>Chargement…</div></Shell>;
  }
  if (error || !data) {
    return (
      <Shell>
        <div className='card p-8 text-center max-w-md mx-auto'>
          <LuLock size={40} className='mx-auto mb-4 text-muted' />
          <h2 className='font-semibold text-ink text-lg mb-2'>Lien invalide ou révoqué</h2>
          <p className='text-muted text-sm'>Ce lien d'accès n'est plus valide. Communiquez avec votre contact pour en obtenir un nouveau.</p>
        </div>
      </Shell>
    );
  }

  const d = data as any;
  const toSign = d.contracts.filter((c: any) => !c.signedAt && c.status === 'envoyee');
  const badges: Partial<Record<TabId, number>> = { ententes: toSign.length };

  return (
    <Shell companyName={d.company.name}>
      <div className='mb-5'>
        <p className='text-sm text-muted'>Bonjour {d.supplier.contactName || d.supplier.name},</p>
        <h1 className='text-xl sm:text-2xl font-bold text-ink'>Votre espace fournisseur</h1>
      </div>

      {toSign.length > 0 && tab !== 'ententes' && (
        <button onClick={() => setTab('ententes')} className='w-full mb-5 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-left text-sm text-sky-900 flex items-center gap-3'>
          <LuFilePenLine size={18} className='shrink-0' />
          <span className='flex-1'>{toSign.length === 1 ? 'Une entente attend votre signature.' : `${toSign.length} ententes attendent votre signature.`}</span>
          <span className='font-medium'>Voir →</span>
        </button>
      )}

      <div className='grid grid-cols-3 gap-2 sm:gap-3 mb-6'>
        <MiniStat label='Facturé' value={formatCurrency(d.stats.totalInvoiced)} />
        <MiniStat label='Payé' value={formatCurrency(d.stats.totalPaid)} />
        <MiniStat label='En attente' value={formatCurrency(d.stats.pending)} />
      </div>

      <div className='flex gap-1 border-b border-line mb-6 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0'>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-3 sm:px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
              tab === t.id ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            <t.icon size={16} />
            {t.label}
            {!!badges[t.id] && <span className='badge-info'>{badges[t.id]}</span>}
          </button>
        ))}
      </div>

      {tab === 'factures' && <InvoicesPanel token={token!} invoices={d.invoices} companyName={d.company.name} />}
      {tab === 'ententes' && <ContractsPanel token={token!} contracts={d.contracts} defaultName={d.supplier.contactName || ''} />}
      {tab === 'documents' && <DocumentsPanel token={token!} companyName={d.company.name} />}
      {tab === 'messages' && <MessagesPanel token={token!} notes={d.notes} companyName={d.company.name} defaultName={d.supplier.contactName || ''} />}
    </Shell>
  );
}

function Shell({ children, companyName }: { children: React.ReactNode; companyName?: string }) {
  return (
    <div className='min-h-screen bg-canvas-100'>
      <header className='bg-white border-b border-line sticky top-0 z-10'>
        <div className='max-w-4xl mx-auto px-4 py-3 flex items-center gap-3'>
          <LuBriefcase size={20} className='text-accent shrink-0' />
          <span className='font-semibold text-ink truncate'>{companyName ? `Portail fournisseur — ${companyName}` : 'Portail fournisseur'}</span>
          <span className='ml-auto text-xs text-muted items-center gap-1 hidden sm:flex shrink-0'><LuLock size={12} /> Accès sécurisé</span>
        </div>
      </header>
      <main className='max-w-4xl mx-auto px-4 py-6 sm:py-8'>{children}</main>
    </div>
  );
}

// Les mêmes états que dans l'application, dits du point de vue du fournisseur :
// « À approuver » ou « À payer » n'ont de sens que pour celui qui paie.
const PORTAL_INVOICE_STATUS: Record<InvoiceDisplayStatus, { label: string; className: string }> = {
  a_approuver: { label: 'En vérification', className: 'badge-warning' },
  a_payer: { label: 'Approuvée — paiement à venir', className: 'badge-info' },
  en_retard: { label: 'Approuvée — paiement à venir', className: 'badge-info' },
  partielle: { label: 'Payée en partie', className: 'badge-accent' },
  payee: { label: 'Payée', className: 'badge-success' },
  rejetee: { label: 'Refusée', className: 'badge-danger' },
};

function PortalInvoiceBadge({ invoice }: { invoice: any }) {
  const s = PORTAL_INVOICE_STATUS[invoiceDisplayStatus(invoice)];
  return <span className={`${s.className} shrink-0`}>{s.label}</span>;
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className='card p-3 text-center'>
      <div className='text-sm sm:text-xl font-bold text-ink truncate'>{value}</div>
      <div className='text-[11px] sm:text-xs text-muted'>{label}</div>
    </div>
  );
}

// ─── Factures ─────────────────────────────────────────────────────────────────

function InvoicesPanel({ token, invoices, companyName }: { token: string; invoices: any[]; companyName: string }) {
  const [showForm, setShowForm] = useState(invoices.length === 0);
  return (
    <div className='space-y-5'>
      {showForm ? (
        <InvoiceUploadForm token={token} companyName={companyName} onDone={() => setShowForm(false)} canCancel={invoices.length > 0} />
      ) : (
        <button onClick={() => setShowForm(true)} className='btn-primary w-full sm:w-auto'><LuUpload size={16} /> Déposer une facture</button>
      )}

      {invoices.length > 0 && (
        <div>
          <h3 className='text-xs font-semibold uppercase tracking-wider text-muted mb-2'>Vos factures ({invoices.length})</h3>
          <div className='space-y-2'>
            {invoices.map((inv) => (
              <div key={inv.id} className='card p-4 space-y-2'>
                <div className='flex items-start justify-between gap-3'>
                  <div className='min-w-0'>
                    <p className='font-medium text-ink truncate'>{inv.number ? `Facture ${inv.number}` : inv.description || 'Facture'}</p>
                    <p className='text-xs text-muted'>
                      Du {formatDate(inv.issueDate)}{inv.dueDate ? ` · échéance ${formatDate(inv.dueDate)}` : ''}
                    </p>
                  </div>
                  <PortalInvoiceBadge invoice={inv} />
                </div>
                <div className='flex items-center justify-between text-sm'>
                  <span className='text-muted'>Payé {formatCurrency(inv.amountPaid)} sur {formatCurrency(inv.total)}</span>
                  {invoiceBalance(inv) > 0 && inv.status !== 'rejetee' && <span className='font-medium text-ink'>Reste {formatCurrency(invoiceBalance(inv))}</span>}
                </div>
                <PaidBar total={inv.total} amountPaid={inv.amountPaid} />
                {inv.status === 'rejetee' && inv.rejectionReason && (
                  <p className='text-xs text-red-700 bg-red-50 rounded-md px-2 py-1.5'>Motif : {inv.rejectionReason}</p>
                )}
                {inv.payments.length > 0 && (
                  <ul className='text-xs text-muted space-y-0.5'>
                    {inv.payments.map((p: any) => (
                      <li key={p.id} className='flex items-center gap-1.5'><LuCircleCheck size={12} className='text-success' /> {formatCurrency(p.amount)} payé le {formatDate(p.paidAt)}</li>
                    ))}
                  </ul>
                )}
                {inv.fileUrl && (
                  <a href={inv.fileUrl} target='_blank' rel='noreferrer' className='inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink'>
                    <LuPaperclip size={12} /> {inv.fileName || 'Pièce jointe'} <LuExternalLink size={11} />
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function InvoiceUploadForm({ token, companyName, onDone, canCancel }: { token: string; companyName: string; onDone: () => void; canCancel: boolean }) {
  const submit = useAction(submitSupplierPortalInvoice);
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState({ number: '', issueDate: todayInput(), dueDate: '', subtotal: '', taxGst: '', taxQst: '', description: '', note: '' });
  const [withTaxes, setWithTaxes] = useState(false);
  const [saving, setSaving] = useState(false);

  const setSubtotal = (v: string) => {
    const t = computeTaxes(parseFloat(v) || 0);
    setForm({ ...form, subtotal: v, ...(withTaxes ? { taxGst: String(t.taxGst), taxQst: String(t.taxQst) } : {}) });
  };
  const toggleTaxes = (on: boolean) => {
    setWithTaxes(on);
    const t = computeTaxes(parseFloat(form.subtotal) || 0);
    setForm({ ...form, taxGst: on ? String(t.taxGst) : '', taxQst: on ? String(t.taxQst) : '' });
  };
  const total = (parseFloat(form.subtotal) || 0) + (parseFloat(form.taxGst) || 0) + (parseFloat(form.taxQst) || 0);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) { toast.error('Joignez le fichier de votre facture.'); return; }
    if (file.size > MAX_UPLOAD_BYTES) { toast.error('Fichier trop volumineux (max 20 Mo)'); return; }
    setSaving(true);
    try {
      await submit({
        token,
        ...form,
        subtotal: form.subtotal || 0,
        taxGst: form.taxGst || 0,
        taxQst: form.taxQst || 0,
        file: { dataUrl: await readFileAsDataUrl(file), name: file.name },
      });
      toast.success(`Facture transmise à ${companyName}`);
      onDone();
    } catch (err: any) {
      toast.error(err?.message || 'Erreur lors de l’envoi');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className='card p-4 sm:p-5 space-y-4'>
      <div className='flex items-center justify-between'>
        <h3 className='font-semibold text-ink flex items-center gap-2'><LuUpload size={16} className='text-accent' /> Déposer une facture</h3>
        {canCancel && <button type='button' onClick={onDone} className='text-muted hover:text-ink'><LuX size={18} /></button>}
      </div>

      <input ref={fileInput} type='file' accept='application/pdf,image/*' className='hidden' onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      {file ? (
        <div className='flex items-center gap-2 rounded-lg border border-line bg-canvas-100 px-3 py-2.5 text-sm'>
          <LuPaperclip size={15} className='text-muted shrink-0' />
          <span className='flex-1 truncate'>{file.name}</span>
          <button type='button' className='text-xs text-muted hover:text-ink' onClick={() => fileInput.current?.click()}>Changer</button>
        </div>
      ) : (
        <button type='button' onClick={() => fileInput.current?.click()} className='w-full flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-line px-3 py-6 text-sm text-muted hover:border-ink/30 hover:text-ink transition-colors'>
          <LuUpload size={22} />
          <span className='font-medium'>Choisir le fichier de la facture</span>
          <span className='text-xs'>PDF ou photo · 20 Mo max</span>
        </button>
      )}

      <div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
        <div>
          <label className='label'>N° de facture</label>
          <input className='input' value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} />
        </div>
        <div>
          <label className='label'>Date de la facture</label>
          <input type='date' className='input' value={form.issueDate} onChange={(e) => setForm({ ...form, issueDate: e.target.value })} />
        </div>
        <div className='sm:col-span-2'>
          <label className='label'>Description</label>
          <input className='input' value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder='Ex. Services rendus en octobre' />
        </div>
        <div>
          <label className='label'>Montant avant taxes *</label>
          <input type='number' step='0.01' min='0' required className='input' value={form.subtotal} onChange={(e) => setSubtotal(e.target.value)} inputMode='decimal' />
        </div>
        <div>
          <label className='label'>Échéance (optionnel)</label>
          <input type='date' className='input' value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
        </div>
      </div>

      <div className='rounded-lg border border-line p-3 space-y-3'>
        <label className='flex items-center gap-2 text-sm cursor-pointer'>
          <input type='checkbox' className='accent-ink' checked={withTaxes} onChange={(e) => toggleTaxes(e.target.checked)} />
          Je facture la TPS et la TVQ
        </label>
        {withTaxes && (
          <div className='grid grid-cols-2 gap-3'>
            <div>
              <label className='block text-xs text-muted mb-1'>TPS (5 %)</label>
              <input type='number' step='0.01' min='0' className='input' value={form.taxGst} onChange={(e) => setForm({ ...form, taxGst: e.target.value })} inputMode='decimal' />
            </div>
            <div>
              <label className='block text-xs text-muted mb-1'>TVQ (9,975 %)</label>
              <input type='number' step='0.01' min='0' className='input' value={form.taxQst} onChange={(e) => setForm({ ...form, taxQst: e.target.value })} inputMode='decimal' />
            </div>
          </div>
        )}
        <div className='flex items-center justify-between text-sm pt-2 border-t border-line'>
          <span className='text-muted'>Total de la facture</span>
          <span className='font-semibold text-ink'>{formatCurrency(total)}</span>
        </div>
      </div>

      <div>
        <label className='label'>Message (optionnel)</label>
        <textarea className='input' rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
      </div>

      <button type='submit' className='btn-primary w-full sm:w-auto' disabled={saving}>{saving ? 'Envoi…' : 'Envoyer la facture'}</button>
    </form>
  );
}

// ─── Ententes ─────────────────────────────────────────────────────────────────

function ContractsPanel({ token, contracts, defaultName }: { token: string; contracts: any[]; defaultName: string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = contracts.find((c) => c.id === openId);
  if (contracts.length === 0) {
    return <p className='text-muted text-sm text-center py-10'>Aucune entente partagée avec vous pour l'instant.</p>;
  }
  return (
    <>
      <div className='space-y-2'>
        {contracts.map((c) => (
          <button key={c.id} onClick={() => setOpenId(c.id)} className='card w-full text-left p-4 hover:border-ink/20 transition-colors'>
            <div className='flex items-start justify-between gap-3'>
              <div className='min-w-0'>
                <p className='font-medium text-ink'>{c.title}</p>
                <p className='text-xs text-muted mt-0.5'>{contractPeriod(c)}{c.rateLabel ? ` · ${c.rateLabel}` : ''}</p>
              </div>
              <ContractStatusBadge contract={c} />
            </div>
            {c.signedAt && <p className='text-xs text-emerald-700 mt-2'>Signée par {c.signedByName} le {formatDateTime(c.signedAt)}</p>}
            {!c.signedAt && c.status === 'envoyee' && <p className='text-xs text-sky-700 mt-2 font-medium'>À lire et signer →</p>}
          </button>
        ))}
      </div>
      {open && <ContractViewer token={token} contract={open} defaultName={defaultName} onClose={() => setOpenId(null)} />}
    </>
  );
}

function ContractViewer({ token, contract, defaultName, onClose }: { token: string; contract: any; defaultName: string; onClose: () => void }) {
  const sign = useAction(signSupplierContract);
  const { refetch: loadBrand } = useQuery(getSupplierPortalBrand, { token }, { enabled: false });
  const [name, setName] = useState(defaultName);
  const [agree, setAgree] = useState(false);
  const [signing, setSigning] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const canSign = !contract.signedAt && contract.status === 'envoyee';

  const download = async () => {
    setDownloading(true);
    try {
      const { data } = await loadBrand();
      await downloadContractPdf(contract, (data as any)?.brand ?? null, (data as any)?.companyName ?? '');
    } catch (err: any) {
      toast.error(err?.message || 'Téléchargement impossible');
    } finally {
      setDownloading(false);
    }
  };

  const submit = async () => {
    setSigning(true);
    try {
      await sign({ token, contractId: contract.id, name });
      toast.success('Entente signée — merci !');
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Erreur lors de la signature');
    } finally {
      setSigning(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size='lg'
      title={contract.title}
      headerRight={<button className='btn-secondary px-2.5 py-1 text-xs mr-2' onClick={download} disabled={downloading}><LuDownload size={13} /> PDF</button>}
      footer={canSign ? (
        <div className='w-full space-y-3'>
          <label className='flex items-start gap-2 text-sm cursor-pointer'>
            <input type='checkbox' className='mt-0.5 accent-ink' checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            J'ai lu l'entente et j'en accepte les conditions.
          </label>
          <div className='flex flex-col sm:flex-row gap-2'>
            <input className='input flex-1' placeholder='Votre nom complet' value={name} onChange={(e) => setName(e.target.value)} />
            <button className='btn-primary' disabled={!agree || !name.trim() || signing} onClick={submit}>{signing ? 'Signature…' : 'Signer l’entente'}</button>
          </div>
        </div>
      ) : undefined}
    >
      {contract.signedAt && (
        <div className='mb-4 rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2 text-sm text-emerald-800 flex items-center gap-2'>
          <LuCircleCheck size={16} /> Signée par {contract.signedByName} le {formatDateTime(contract.signedAt)}
        </div>
      )}
      <div data-color-mode='light'>
        <MDEditor.Markdown source={withSignature(contract.content, contract.signedByName, contract.signedAt)} style={{ background: 'transparent' }} />
      </div>
    </Modal>
  );
}

// ─── Documents ────────────────────────────────────────────────────────────────

function DocumentsPanel({ token, companyName }: { token: string; companyName: string }) {
  const { data: files, refetch, isFetching } = useQuery(getSupplierPortalFiles, { token });
  const upload = useAction(uploadSupplierPortalFile);
  const createFolder = useAction(createSupplierPortalFolder);
  const remove = useAction(deleteSupplierPortalFiles);
  const rename = useAction(renameSupplierPortalFile);
  const move = useAction(moveSupplierPortalFiles);
  return (
    <>
      <p className='text-sm text-muted mb-4'>Documents partagés entre vous et {companyName}. Déposez ici ce qui n'est pas une facture : rapports, livrables, pièces justificatives…</p>
      <SharedFileManager
        ops={{
          files: files as any[] | undefined,
          isFetching,
          refetch,
          upload: ({ dataUrl, name, originalName, parentId }) => upload({ token, dataUrl, name, originalName, parentId }),
          createFolder: ({ name, parentId }) => createFolder({ token, name, parentId }),
          deleteFiles: ({ ids }) => remove({ token, ids }),
          renameFile: ({ id, name }) => rename({ token, id, name }),
          moveFiles: ({ ids, targetParentId }) => move({ token, ids, targetParentId }),
          instanceId: `supplier-portal-${token}`,
        }}
      />
    </>
  );
}

// ─── Messages ─────────────────────────────────────────────────────────────────

function MessagesPanel({ token, notes, companyName, defaultName }: { token: string; notes: any[]; companyName: string; defaultName: string }) {
  const send = useAction(submitSupplierPortalNote);
  const [content, setContent] = useState('');
  const [authorName, setAuthorName] = useState(defaultName);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!content.trim()) return;
    setSaving(true);
    try {
      await send({ token, content, authorName });
      setContent('');
      toast.success('Message envoyé');
    } catch (err: any) {
      toast.error(err?.message || 'Erreur');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className='max-w-2xl space-y-5'>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className='card p-4 space-y-3'>
        <input className='input' placeholder='Votre nom' value={authorName} onChange={(e) => setAuthorName(e.target.value)} />
        <MessageComposer value={content} onChange={setContent} onSubmitShortcut={submit} placeholder={`Votre message à ${companyName}…`} />
        <button type='submit' className='btn-primary w-full sm:w-auto' disabled={saving || !content.trim()}><LuSend size={14} /> {saving ? 'Envoi…' : 'Envoyer'}</button>
      </form>
      {notes.length === 0 ? (
        <p className='text-muted text-sm text-center py-6'>Aucun message pour l'instant.</p>
      ) : (
        <ul className='space-y-3'>
          {notes.map((n) => (
            <li key={n.id} className={`card p-4 ${n.isFromSupplier ? 'ml-6 sm:ml-12 bg-sky-50 border-sky-100' : 'mr-6 sm:mr-12'}`}>
              <div className='flex items-center gap-2 mb-1.5 text-xs'>
                <span className='font-medium text-ink'>{n.isFromSupplier ? n.authorName || 'Vous' : companyName}</span>
                <span className='text-muted ml-auto'>{formatDateTime(n.createdAt)}{n.editedAt && ' · modifié'}</span>
              </div>
              <MessageBody source={n.content} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
