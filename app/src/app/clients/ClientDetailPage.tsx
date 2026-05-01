import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { LuArrowLeft, LuPencil, LuFileCheck, LuUndo2 } from 'react-icons/lu';
import {
  useQuery,
  getClientDetail,
  getProjects,
  deleteDocument,
  updateDocumentStatus,
  setDocumentType,
  deleteMeeting,
  updateClient,
} from 'wasp/client/operations';
import { Modal, useConfirm, IconBtn, TrashIcon } from '../../client/ui';
import { formatCurrency, formatDate } from '../../shared/format';
import type { Client } from 'wasp/entities';
import type { ClientDetail } from './operations';
import { DocumentForm } from '../shared/DocumentForm';
import { MeetingForm } from '../meetings/MeetingForm';

// ─── Status maps ──────────────────────────────────────────────────────────────
const QUOTE_STATUS: Record<string, { label: string; className: string }> = {
  brouillon: { label: 'Brouillon', className: 'badge-neutral' },
  envoyee: { label: 'Envoyée', className: 'badge-info' },
  acceptee: { label: 'Acceptée', className: 'badge-success' },
  refusee: { label: 'Refusée', className: 'badge-danger' },
  expiree: { label: 'Expirée', className: 'badge-warning' },
};

const INVOICE_STATUS: Record<string, { label: string; className: string }> = {
  brouillon: { label: 'Brouillon', className: 'badge-neutral' },
  envoyee: { label: 'Envoyée', className: 'badge-info' },
  payee: { label: 'Payée', className: 'badge-success' },
  en_retard: { label: 'En retard', className: 'badge-danger' },
  annulee: { label: 'Annulée', className: 'badge-neutral' },
};

function statusFor(doc: { type: string; status: string }) {
  const map = doc.type === 'invoice' ? INVOICE_STATUS : QUOTE_STATUS;
  return map[doc.status] || { label: doc.status, className: 'badge-neutral' };
}

const CLIENT_STATUS: Record<string, { label: string; className: string }> = {
  actif: { label: 'Actif', className: 'badge-success' },
  prospect: { label: 'Prospect', className: 'badge-info' },
  inactif: { label: 'Inactif', className: 'badge-neutral' },
};

// ─── Tabs ─────────────────────────────────────────────────────────────────────
type Tab = 'resume' | 'documents' | 'paiements' | 'rencontres';

const TABS: { id: Tab; label: string }[] = [
  { id: 'resume', label: 'Résumé' },
  { id: 'documents', label: 'Facturation' },
  { id: 'paiements', label: 'Paiements' },
  { id: 'rencontres', label: 'Rencontres' },
];

// ─── Main page ────────────────────────────────────────────────────────────────
export default function ClientDetailPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();
  const { data: client, isLoading } = useQuery(getClientDetail, { clientId: clientId! });
  const { data: projects } = useQuery(getProjects);
  const [tab, setTab] = useState<Tab>('resume');
  const [editingClient, setEditingClient] = useState(false);

  if (isLoading) return <div className='text-muted p-6'>Chargement…</div>;
  if (!client) return <div className='text-muted p-6'>Client introuvable.</div>;

  const clientProjects = (projects || []).filter((p: any) => p.clientId === client.id);

  return (
    <>
      {/* Header */}
      <div className='flex items-center gap-3 mb-6'>
        <button
          onClick={() => navigate('/clients')}
          className='p-2 rounded-lg hover:bg-canvas transition-colors text-muted hover:text-ink'
          title='Retour aux clients'
        >
          <LuArrowLeft size={20} />
        </button>
        <div className='flex-1 min-w-0'>
          <div className='flex items-center gap-2 flex-wrap'>
            <h1 className='text-2xl font-bold text-ink truncate'>{client.name}</h1>
            <span className={CLIENT_STATUS[client.status]?.className || 'badge-neutral'}>
              {CLIENT_STATUS[client.status]?.label || client.status}
            </span>
          </div>
          {client.contactName && (
            <p className='text-sm text-muted mt-0.5'>{client.contactName}</p>
          )}
        </div>
        <button className='btn-secondary flex items-center gap-1.5' onClick={() => setEditingClient(true)}>
          <LuPencil size={14} />
          Modifier
        </button>
      </div>

      {/* Tabs */}
      <div className='flex gap-1 border-b border-gray-200 mb-6 overflow-x-auto'>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              tab === t.id
                ? 'border-accent text-accent'
                : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'resume' && <ResumeTab client={client} />}
      {tab === 'documents' && <DocumentsTab client={client} projects={clientProjects} />}
      {tab === 'paiements' && <PaiementsTab client={client} />}
      {tab === 'rencontres' && <RencontresTab client={client} />}

      {editingClient && <ClientEditModal client={client} onClose={() => setEditingClient(false)} />}
    </>
  );
}

// ─── Résumé ───────────────────────────────────────────────────────────────────
function ResumeTab({ client }: { client: ClientDetail }) {
  const quotes = client.documents.filter((d) => d.type === 'quote');
  const invoices = client.documents.filter((d) => d.type === 'invoice');
  const totalFacture = invoices.reduce((s, inv) => s + inv.total, 0);
  const totalRecu = invoices.reduce((s, inv) => s + inv.amountPaid, 0);
  const totalSoumissions = quotes.reduce((s, q) => s + q.total, 0);

  const stats = [
    { label: 'Soumissions', value: quotes.length.toString(), sub: formatCurrency(totalSoumissions) },
    { label: 'Factures', value: invoices.length.toString(), sub: formatCurrency(totalFacture) },
    { label: 'Montant reçu', value: formatCurrency(totalRecu), sub: `solde ${formatCurrency(totalFacture - totalRecu)}` },
    { label: 'Rencontres', value: client.meetings.length.toString(), sub: '' },
  ];

  return (
    <div className='space-y-6'>
      {/* Stat cards */}
      <div className='grid grid-cols-2 md:grid-cols-4 gap-4'>
        {stats.map((s) => (
          <div key={s.label} className='bg-white border border-gray-100 rounded-xl p-4 shadow-sm'>
            <p className='text-xs text-muted uppercase tracking-wide mb-1'>{s.label}</p>
            <p className='text-2xl font-bold text-ink'>{s.value}</p>
            {s.sub && <p className='text-xs text-muted mt-0.5'>{s.sub}</p>}
          </div>
        ))}
      </div>

      {/* Client info */}
      <div className='bg-white border border-gray-100 rounded-xl p-5 shadow-sm'>
        <h2 className='text-sm font-semibold text-ink mb-4 uppercase tracking-wide'>Informations</h2>
        <dl className='grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm'>
          {client.contactName && <InfoRow label='Contact' value={client.contactName} />}
          {client.email && <InfoRow label='Courriel' value={client.email} />}
          {client.phone && <InfoRow label='Téléphone' value={client.phone} />}
          {client.address && <InfoRow label='Adresse' value={client.address} />}
          <InfoRow label='Client depuis' value={formatDate(client.createdAt)} />
        </dl>
        {client.notes && (
          <div className='mt-4 pt-4 border-t border-gray-100'>
            <p className='text-xs text-muted uppercase tracking-wide mb-1'>Notes</p>
            <p className='text-sm text-ink whitespace-pre-wrap'>{client.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className='text-muted'>{label}</dt>
      <dd className='font-medium text-ink'>{value}</dd>
    </div>
  );
}

// ─── Documents (soumissions + factures) ──────────────────────────────────────
function DocumentsTab({ client, projects }: { client: ClientDetail; projects: any[] }) {
  const { ask, Dialog: ConfirmDialog } = useConfirm();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [filter, setFilter] = useState<'all' | 'quote' | 'invoice'>('all');

  const docs = filter === 'all'
    ? client.documents
    : client.documents.filter((d) => d.type === filter);

  return (
    <>
      <div className='flex items-center justify-between mb-4 gap-3 flex-wrap'>
        <div className='flex items-center gap-2'>
          <p className='text-sm text-muted'>{client.documents.length} soumission(s) / facture(s)</p>
          <div className='inline-flex rounded-lg border border-line p-0.5 bg-canvas ml-2'>
            {([
              { v: 'all', l: 'Tous' },
              { v: 'quote', l: 'Soumissions' },
              { v: 'invoice', l: 'Factures' },
            ] as const).map((opt) => (
              <button
                key={opt.v}
                onClick={() => setFilter(opt.v)}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  filter === opt.v ? 'bg-white text-ink shadow-sm' : 'text-muted hover:text-ink'
                }`}
              >
                {opt.l}
              </button>
            ))}
          </div>
        </div>
        <button className='btn-primary' onClick={() => setCreating(true)}>
          Nouvelle soumission / facture
        </button>
      </div>

      {docs.length === 0 ? (
        <p className='text-muted text-sm'>
          {filter === 'invoice' ? 'Aucune facture.' : filter === 'quote' ? 'Aucune soumission.' : 'Aucune soumission ni facture.'}
        </p>
      ) : (
        <div className='table-wrap'>
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Numéro</th>
                <th>Titre</th>
                <th>Émis le</th>
                <th>Statut</th>
                <th className='text-right'>Total</th>
                <th className='text-right'>Actions</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => {
                const st = statusFor(d);
                return (
                  <tr key={d.id}>
                    <td>
                      <span className={d.type === 'invoice' ? 'badge-info' : 'badge-neutral'}>
                        {d.type === 'invoice' ? 'Facture' : 'Soumission'}
                      </span>
                    </td>
                    <td className='font-mono text-sm'>{d.number}</td>
                    <td>{d.title || '—'}</td>
                    <td className='text-muted'>{formatDate(d.issueDate)}</td>
                    <td><span className={st.className}>{st.label}</span></td>
                    <td className='text-right font-medium'>{formatCurrency(d.total)}</td>
                    <td className='text-right'>
                      <div className='flex items-center justify-end gap-1'>
                        <IconBtn title='Modifier' onClick={() => setEditing(d)}>
                          <LuPencil size={14} />
                        </IconBtn>
                        {d.type === 'quote' ? (
                          <IconBtn title='Convertir en facture' onClick={async () => {
                            if (await ask(`Convertir la soumission ${d.number} en facture ?`, { confirmLabel: 'Convertir', variant: 'primary' })) {
                              await setDocumentType({ id: d.id, type: 'invoice' });
                            }
                          }}>
                            <LuFileCheck size={14} />
                          </IconBtn>
                        ) : (
                          <IconBtn title='Repasser en soumission' onClick={async () => {
                            if (await ask(`Repasser la facture ${d.number} en soumission ?`, { confirmLabel: 'Repasser en soumission', variant: 'primary' })) {
                              await setDocumentType({ id: d.id, type: 'quote' });
                            }
                          }}>
                            <LuUndo2 size={14} />
                          </IconBtn>
                        )}
                        <IconBtn variant='danger' title='Supprimer' onClick={async () => {
                          if (await ask(`Supprimer ${d.number} ?`)) await deleteDocument({ id: d.id });
                        }}>
                          <TrashIcon />
                        </IconBtn>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {creating && (
        <DocumentForm
          defaultMode='quote'
          clientId={client.id}
          projects={projects}
          onClose={() => setCreating(false)}
        />
      )}
      {editing && (
        <DocumentForm
          clientId={client.id}
          projects={projects}
          document={editing}
          allowModeToggle={false}
          onClose={() => setEditing(null)}
        />
      )}
      {ConfirmDialog}
    </>
  );
}

// ─── Paiements ────────────────────────────────────────────────────────────────
function PaiementsTab({ client }: { client: ClientDetail }) {
  const payments = client.documents
    .filter((d) => d.type === 'invoice')
    .flatMap((inv) => inv.payments.map((p) => ({ ...p, invoiceNumber: inv.number })))
    .sort((a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime());

  const METHOD: Record<string, string> = {
    virement: 'Virement',
    cheque: 'Chèque',
    comptant: 'Comptant',
    carte: 'Carte',
    autre: 'Autre',
  };

  return (
    <>
      <div className='flex items-center justify-between mb-4'>
        <p className='text-sm text-muted'>{payments.length} paiement(s)</p>
      </div>

      {payments.length === 0 ? (
        <p className='text-muted text-sm'>Aucun paiement enregistré pour ce client.</p>
      ) : (
        <div className='table-wrap'>
          <table>
            <thead>
              <tr>
                <th>Facture</th>
                <th>Date</th>
                <th>Méthode</th>
                <th>Référence</th>
                <th className='text-right'>Montant</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className='font-mono text-sm'>{p.invoiceNumber}</td>
                  <td className='text-muted'>{formatDate(p.paidAt)}</td>
                  <td className='text-muted'>{METHOD[p.method] || p.method}</td>
                  <td className='text-muted'>{p.reference || '—'}</td>
                  <td className='text-right font-medium'>{formatCurrency(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ─── Rencontres ───────────────────────────────────────────────────────────────
function RencontresTab({ client }: { client: ClientDetail }) {
  const { ask, Dialog: ConfirmDialog } = useConfirm();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const MEETING_STATUS: Record<string, { label: string; className: string }> = {
    prevue: { label: 'Prévue', className: 'badge-info' },
    confirmee: { label: 'Confirmée', className: 'badge-info' },
    terminee: { label: 'Terminée', className: 'badge-success' },
    annulee: { label: 'Annulée', className: 'badge-neutral' },
  };

  return (
    <>
      <div className='flex items-center justify-between mb-4'>
        <p className='text-sm text-muted'>{client.meetings.length} rencontre(s)</p>
        <button className='btn-primary' onClick={() => setCreating(true)}>
          Nouvelle rencontre
        </button>
      </div>

      {client.meetings.length === 0 ? (
        <p className='text-muted text-sm'>Aucune rencontre pour ce client.</p>
      ) : (
        <div className='table-wrap'>
          <table>
            <thead>
              <tr>
                <th>Titre</th>
                <th>Date</th>
                <th>Lieu / URL</th>
                <th>Statut</th>
                <th className='text-right'>Actions</th>
              </tr>
            </thead>
            <tbody>
              {client.meetings.map((m) => {
                const st = MEETING_STATUS[m.status] || { label: m.status, className: 'badge-neutral' };
                return (
                  <tr key={m.id}>
                    <td className='font-medium'>{m.title}</td>
                    <td className='text-muted'>{formatDate(m.startsAt)}</td>
                    <td className='text-muted'>{m.location || m.meetingUrl || '—'}</td>
                    <td><span className={st.className}>{st.label}</span></td>
                    <td className='text-right'>
                      <div className='flex items-center justify-end gap-1'>
                        <IconBtn title='Modifier' onClick={() => setEditing(m)}>
                          <LuPencil size={14} />
                        </IconBtn>
                        <IconBtn variant='danger' title='Supprimer' onClick={async () => {
                          if (await ask(`Supprimer la rencontre « ${m.title} » ?`)) await deleteMeeting({ id: m.id });
                        }}>
                          <TrashIcon />
                        </IconBtn>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {(creating || editing) && (
        <MeetingForm
          meeting={editing}
          clientId={client.id}
          onClose={() => { setCreating(false); setEditing(null); }}
        />
      )}
      {ConfirmDialog}
    </>
  );
}

// ─── Edit modal (reuses same form as ClientsPage) ────────────────────────────
function maskPhone(raw: string): string {
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('1')) digits = digits.slice(1);
  digits = digits.slice(0, 10);
  const a = digits.slice(0, 3);
  const p = digits.slice(3, 6);
  const l = digits.slice(6, 10);
  if (digits.length === 0) return '';
  if (digits.length <= 3) return `+1 (${a}`;
  if (digits.length <= 6) return `+1 (${a}) ${p}`;
  return `+1 (${a}) ${p}-${l}`;
}

function ClientEditModal({ client, onClose }: { client: Client; onClose: () => void }) {
  const [form, setForm] = useState({
    name: client.name || '',
    contactName: client.contactName || '',
    email: client.email || '',
    phone: client.phone || '',
    address: client.address || '',
    notes: client.notes || '',
    status: client.status || 'actif',
  });
  const [saving, setSaving] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateClient({ id: client.id, ...form });
      onClose();
    } catch (err: any) {
      alert(err?.message || 'Erreur');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title='Modifier le client'
      footer={
        <>
          <button className='btn-secondary' onClick={onClose}>Annuler</button>
          <button form='client-edit-form' type='submit' className='btn-primary' disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </>
      }
    >
      <form id='client-edit-form' onSubmit={onSubmit} className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
        <div className='col-span-2'>
          <label className='label'>Nom de l'entreprise / client *</label>
          <input className='input' required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <label className='label'>Personne contact</label>
          <input className='input' value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
        </div>
        <div>
          <label className='label'>Statut</label>
          <select className='input' value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value='actif'>Actif</option>
            <option value='prospect'>Prospect</option>
            <option value='inactif'>Inactif</option>
          </select>
        </div>
        <div>
          <label className='label'>Courriel</label>
          <input type='email' className='input' value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div>
          <label className='label'>Téléphone</label>
          <input
            className='input'
            placeholder='+1 (514) 000-0000'
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: maskPhone(e.target.value) })}
          />
        </div>
        <div className='col-span-2'>
          <label className='label'>Adresse</label>
          <input className='input' placeholder='123 rue Exemple, Montréal, QC H1A 1A1' value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </div>
        <div className='col-span-2'>
          <label className='label'>Notes</label>
          <textarea className='input' rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
      </form>
    </Modal>
  );
}

