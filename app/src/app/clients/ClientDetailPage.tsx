import { useState } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router';
import { LuArrowLeft, LuPencil, LuArchive, LuFolderOpen, LuExternalLink } from 'react-icons/lu';
import toast from 'react-hot-toast';
import {
  useQuery,
  getClientDetail,
  getProjects,
  createProject,
  updateProject,
  deleteProject,
  deleteMeeting,
  archiveMeeting,
  updateClient,
  getClientActivities,
  getGoogleCalendarStatus,
} from 'wasp/client/operations';
import { Modal, useConfirm, IconBtn, TrashIcon, EditIcon } from '../../client/ui';
import { MagicInput, MagicTextarea } from '../../client/magic';
import { formatCurrency, formatDate, formatDateTime } from '../../shared/format';
import type { Client } from 'wasp/entities';
import type { ClientDetail } from './operations';
import { DocumentForm } from '../shared/DocumentForm';
import { DocumentTable } from '../shared/DocumentTable';
import { MeetingForm } from '../meetings/MeetingForm';
import { PaymentsSection } from '../payments/PaymentsSection';
import { downloadDocumentPdf } from '../documents/pdf';

// ─── Status maps ──────────────────────────────────────────────────────────────

const CLIENT_STATUS: Record<string, { label: string; className: string }> = {
  actif: { label: 'Actif', className: 'badge-success' },
  prospect: { label: 'Prospect', className: 'badge-info' },
  inactif: { label: 'Inactif', className: 'badge-neutral' },
};

// ─── Tabs ─────────────────────────────────────────────────────────────────────
type Tab = 'resume' | 'documents' | 'paiements' | 'rencontres' | 'projets';

const TABS: { id: Tab; label: string }[] = [
  { id: 'resume', label: 'Résumé' },
  { id: 'documents', label: 'Facturation' },
  { id: 'paiements', label: 'Paiements' },
  { id: 'rencontres', label: 'Rencontres' },
  { id: 'projets', label: 'Projets' },
];

// ─── Main page ────────────────────────────────────────────────────────────────
export default function ClientDetailPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab') as Tab | null;
  const tab: Tab = TABS.some((t) => t.id === rawTab) ? rawTab! : 'resume';
  const setTab = (id: Tab) => setSearchParams({ tab: id }, { replace: true });
  const { data: client, isLoading } = useQuery(getClientDetail, { clientId: clientId! });
  const { data: projects } = useQuery(getProjects);
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
      {tab === 'projets' && <ProjetsTab clientId={client.id} projects={clientProjects} />}

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

      <ActivityHistory clientId={client.id} />
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
  const [creating, setCreating] = useState(false);

  return (
    <>
      <div className='flex items-center justify-between mb-4 gap-3 flex-wrap'>
        <p className='text-xs text-muted'>
          Astuce : cliquez sur le statut pour le changer. À l'envoi du courriel, le document passe à « Envoyée ».
          Après la date d'échéance, les soumissions deviennent « Expirée » et les factures impayées passent « En retard ». Sur une facture, utilisez l'icône
          portefeuille pour enregistrer un acompte ou le solde — le statut suit automatiquement.
        </p>
        <button className='btn-primary shrink-0' onClick={() => setCreating(true)}>
          Nouvelle soumission / facture
        </button>
      </div>

      <DocumentTable
        clientId={client.id}
        clientForPdf={client}
        projects={projects}
      />

      {creating && (
        <DocumentForm
          defaultMode='quote'
          clientId={client.id}
          projects={projects}
          onClose={() => setCreating(false)}
        />
      )}
    </>
  );
}

// ─── Paiements ────────────────────────────────────────────────────────────────
function PaiementsTab({ client }: { client: ClientDetail }) {
  return (
    <PaymentsSection
      clientId={client.id}
      emptyMessage='Aucun paiement enregistré pour ce client.'
    />
  );
}

// ─── Rencontres ───────────────────────────────────────────────────────────────
function RencontresTab({ client }: { client: ClientDetail }) {
  const { ask, Dialog: ConfirmDialog } = useConfirm();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [showPast, setShowPast] = useState(false);
  const { data: calStatus } = useQuery(getGoogleCalendarStatus);
  const calConnected = (calStatus as { connected?: boolean } | undefined)?.connected ?? false;

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const upcoming = client.meetings.filter((m) => new Date(m.startsAt) >= today);
  const past = client.meetings.filter((m) => new Date(m.startsAt) < today);

  return (
    <>
      <div className='flex items-center justify-between mb-4'>
        <p className='text-sm text-muted'>{upcoming.length} rencontre(s) à venir</p>
        <button
          className='btn-primary'
          onClick={() => setCreating(true)}
          disabled={!calConnected}
          title={!calConnected ? 'Connectez Google Agenda pour créer des rencontres' : undefined}
        >
          Nouvelle rencontre
        </button>
      </div>

      {!calConnected && (
        <div className='mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-start gap-3'>
          <span className='text-lg leading-tight'>⚠️</span>
          <div>
            <strong>Google Agenda non connecté.</strong> Connectez votre Google Agenda dans{' '}
            <Link to='/parametres' className='underline font-medium'>Paramètres → Intégrations</Link>{' '}pour créer des rencontres.
          </div>
        </div>
      )}

      {calConnected && (
        <div className='mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 flex items-start gap-3'>
          <span className='text-lg leading-tight'>ℹ️</span>
          <div>
            <strong>Synchronisation unidirectionnelle.</strong>{' '}
            Les rencontres sont synchronisées vers Google Agenda et les invités reçoivent une invitation par courriel.{' '}
            Les modifications faites <em>directement dans Google Agenda</em> ne sont pas reflétées ici — gérez toujours vos rencontres depuis cette application.
          </div>
        </div>
      )}

      {/* Upcoming meetings */}
      {upcoming.length === 0 && past.length === 0 ? (
        <p className='text-muted text-sm'>Aucune rencontre pour ce client.</p>
      ) : upcoming.length === 0 ? (
        <p className='text-muted text-sm'>Aucune rencontre à venir.</p>
      ) : (
        <div className='table-wrap mb-4'>
          <table>
            <thead>
              <tr>
                <th>Titre</th>
                <th>Date</th>
                <th>Invités</th>
                <th>Lien Meet</th>
                <th className='text-right'>Actions</th>
              </tr>
            </thead>
            <tbody>
              {upcoming.map((m) => {
                let attendees: string[] = [];
                try { attendees = JSON.parse((m as any).attendeeEmails || '[]'); } catch { /* ignore */ }
                return (
                  <tr key={m.id}>
                    <td className='font-medium'>{m.title}</td>
                    <td className='text-muted'>{formatDateTime(m.startsAt)}</td>
                    <td className='text-muted text-sm'>
                      {attendees.length > 0
                        ? <span title={attendees.join(', ')}>{attendees.length} invité{attendees.length > 1 ? 's' : ''}</span>
                        : '—'}
                    </td>
                    <td>
                      {(m as any).meetLink ? (
                        <a href={(m as any).meetLink} target='_blank' rel='noreferrer'
                          className='text-sm text-blue-600 hover:underline font-medium'>
                          🎥 Rejoindre
                        </a>
                      ) : <span className='text-muted text-sm'>—</span>}
                    </td>
                    <td className='text-right'>
                      <div className='flex items-center justify-end gap-1'>
                        <IconBtn title='Modifier' onClick={() => setEditing(m)}><LuPencil size={14} /></IconBtn>
                        <IconBtn variant='danger' title='Supprimer' onClick={async () => {
                          if (await ask(`Supprimer la rencontre « ${m.title} » ?`, { description: 'Les invités recevront automatiquement un email d\'annulation.' })) {
                            try {
                              await deleteMeeting({ id: m.id });
                              const att: string[] = (() => { try { return JSON.parse((m as any).attendeeEmails || '[]'); } catch { return []; } })();
                              const msg = att.length > 0 ? ` — ${att.length} invité${att.length > 1 ? 's' : ''} notifié${att.length > 1 ? 's' : ''}` : '';
                              toast.success(`Rencontre supprimée${msg}`);
                            } catch (err: any) { toast.error(err?.message || 'Erreur lors de la suppression'); }
                          }
                        }}><TrashIcon /></IconBtn>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Past meetings */}
      {past.length > 0 && (
        <div className='mt-2'>
          <button
            type='button'
            onClick={() => setShowPast((v) => !v)}
            className='flex items-center gap-2 text-sm text-muted hover:text-foreground transition-colors font-medium mb-3'
          >
            <span className={`transition-transform ${showPast ? 'rotate-90' : ''}`}>›</span>
            {showPast ? 'Masquer' : 'Afficher'} les rencontres passées ({past.length})
          </button>
          {showPast && (
            <div className='table-wrap opacity-70'>
              <table>
                <thead>
                  <tr>
                    <th>Titre</th>
                    <th>Date</th>
                    <th>Invités</th>
                    <th>Lien Meet</th>
                    <th className='text-right'>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {past.map((m) => {
                    let attendees: string[] = [];
                    try { attendees = JSON.parse((m as any).attendeeEmails || '[]'); } catch { /* ignore */ }
                    return (
                      <tr key={m.id}>
                        <td className='font-medium'>{m.title}</td>
                        <td className='text-muted'>{formatDateTime(m.startsAt)}</td>
                        <td className='text-muted text-sm'>
                          {attendees.length > 0
                            ? <span title={attendees.join(', ')}>{attendees.length} invité{attendees.length > 1 ? 's' : ''}</span>
                            : '—'}
                        </td>
                        <td>
                          {(m as any).meetLink ? (
                            <a href={(m as any).meetLink} target='_blank' rel='noreferrer'
                              className='text-sm text-blue-600 hover:underline font-medium'>
                              🎥 Rejoindre
                            </a>
                          ) : <span className='text-muted text-sm'>—</span>}
                        </td>
                        <td className='text-right'>
                          <div className='flex items-center justify-end gap-1'>
                            <button
                              type='button'
                              onClick={async () => {
                                try { await archiveMeeting({ id: m.id }); toast.success('Rencontre archivée'); }
                                catch (err: any) { toast.error(err?.message || 'Erreur'); }
                              }}
                              className='inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-canvas-300 text-muted hover:bg-canvas-100 transition-colors'
                            >
                              <LuArchive size={12} /> Archiver
                            </button>
                            <IconBtn title='Modifier' onClick={() => setEditing(m)}><LuPencil size={14} /></IconBtn>
                            <IconBtn variant='danger' title='Supprimer' onClick={async () => {
                              if (await ask(`Supprimer la rencontre « ${m.title} » ?`, { description: 'Les invités recevront automatiquement un email d\'annulation.' })) {
                                try {
                                  await deleteMeeting({ id: m.id });
                                  toast.success('Rencontre supprimée');
                                } catch (err: any) { toast.error(err?.message || 'Erreur lors de la suppression'); }
                              }
                            }}><TrashIcon /></IconBtn>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {(creating || editing) && (
        <MeetingForm
          meeting={editing}
          clientId={client.id}
          clientName={client.name ?? undefined}
          clientEmail={client.email ?? undefined}
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
      toast.success('Client modifié');
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Une erreur est survenue');
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
          <MagicInput className='input' required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <label className='label'>Personne contact</label>
          <MagicInput className='input' value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
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
          <MagicInput className='input' placeholder='123 rue Exemple, Montréal, QC H1A 1A1' value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </div>
        <div className='col-span-2'>
          <label className='label'>Notes</label>
          <MagicTextarea className='input' rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
      </form>
    </Modal>
  );
}

// ─── Projets ─────────────────────────────────────────────────────────────────
const PROJECT_STATUS: Record<string, { label: string; className: string }> = {
  brouillon: { label: 'Brouillon', className: 'badge-neutral' },
  en_cours: { label: 'En cours', className: 'badge-info' },
  en_pause: { label: 'En pause', className: 'badge-warning' },
  termine: { label: 'Terminé', className: 'badge-success' },
  annule: { label: 'Annulé', className: 'badge-danger' },
};

function ProjetsTab({ clientId, projects }: { clientId: string; projects: any[] }) {
  const { ask, Dialog: ConfirmDialog } = useConfirm();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const filtered = projects.filter((p: any) => {
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterStatus && p.status !== filterStatus) return false;
    return true;
  });

  return (
    <>
      <div className='flex flex-wrap items-center justify-between gap-3 mb-4'>
        <div className='flex flex-wrap items-center gap-2'>
          <input
            className='input max-w-xs'
            placeholder='Rechercher…'
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className='input w-auto' value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value=''>Tous les statuts</option>
            {Object.entries(PROJECT_STATUS).map(([val, { label }]) => (
              <option key={val} value={val}>{label}</option>
            ))}
          </select>
          <span className='text-sm text-muted'>{filtered.length} projet(s)</span>
        </div>
        <button className='btn-primary shrink-0' onClick={() => setCreating(true)}>Nouveau projet</button>
      </div>

      {projects.length === 0 ? (
        <div className='text-center py-12 text-muted'>
          <LuFolderOpen size={32} className='mx-auto mb-3 opacity-40' />
          <p className='text-sm'>Aucun projet pour ce client.</p>
        </div>
      ) : filtered.length === 0 ? (
        <p className='text-muted text-sm'>Aucun projet ne correspond aux filtres.</p>
      ) : (
        <div className='table-wrap'>
          <table>
            <thead>
              <tr>
                <th>Projet</th>
                <th>Statut</th>
                <th>Créé le</th>
                <th className='text-right'>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p: any) => (
                <tr key={p.id} className='group'>
                  <td className='font-medium'>
                    <a
                      href={`/projets/${p.id}`}
                      target='_blank'
                      rel='noreferrer'
                      className='flex items-center gap-2 hover:text-accent transition-colors'
                    >
                      <LuFolderOpen size={16} className='text-muted shrink-0' />
                      {p.name}
                      <LuExternalLink size={12} className='text-muted opacity-0 group-hover:opacity-100 transition-opacity' />
                    </a>
                  </td>
                  <td>
                    <span className={PROJECT_STATUS[p.status]?.className || 'badge-neutral'}>
                      {PROJECT_STATUS[p.status]?.label || p.status}
                    </span>
                  </td>
                  <td className='text-muted'>{formatDate(p.createdAt)}</td>
                  <td className='text-right'>
                    <div className='flex items-center justify-end gap-1'>
                      <IconBtn title='Modifier' onClick={() => setEditing(p)}><EditIcon /></IconBtn>
                      <IconBtn
                        variant='danger'
                        title='Supprimer'
                        onClick={async () => {
                          if (await ask(`Supprimer le projet « ${p.name} » ?`, { description: 'Toutes les tâches, notes, médias et accès clients seront supprimés.' })) {
                            try {
                              await deleteProject({ id: p.id });
                              toast.success('Projet supprimé');
                            } catch (err: any) {
                              toast.error(err?.message || 'Erreur lors de la suppression');
                            }
                          }
                        }}
                      >
                        <TrashIcon />
                      </IconBtn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <CreateClientProjectModal clientId={clientId} onClose={() => setCreating(false)} />
      )}
      {editing && (
        <EditClientProjectModal project={editing} onClose={() => setEditing(null)} />
      )}
      {ConfirmDialog}
    </>
  );
}

function CreateClientProjectModal({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  const [form, setForm] = useState({ name: '', description: '', status: 'en_cours' });
  const [saving, setSaving] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await createProject({ name: form.name, description: form.description || undefined, clientId, status: form.status });
      toast.success('Projet créé');
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Une erreur est survenue');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title='Nouveau projet'
      footer={
        <>
          <button className='btn-secondary' onClick={onClose}>Annuler</button>
          <button form='create-client-project-form' type='submit' className='btn-primary' disabled={saving}>
            {saving ? 'Création…' : 'Créer le projet'}
          </button>
        </>
      }
    >
      <form id='create-client-project-form' onSubmit={onSubmit} className='flex flex-col gap-4'>
        <div>
          <label className='label'>Titre du projet *</label>
          <input
            className='input'
            required
            placeholder='Ex: Refonte du site web'
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div>
          <label className='label'>Description</label>
          <textarea
            className='input'
            rows={3}
            placeholder='Description optionnelle…'
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>
        <div>
          <label className='label'>Statut</label>
          <select className='input' value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value='brouillon'>Brouillon</option>
            <option value='en_cours'>En cours</option>
            <option value='en_pause'>En pause</option>
            <option value='termine'>Terminé</option>
            <option value='annule'>Annulé</option>
          </select>
        </div>
      </form>
    </Modal>
  );
}

function EditClientProjectModal({ project, onClose }: { project: any; onClose: () => void }) {
  const [form, setForm] = useState({
    name: project.name || '',
    description: project.description || '',
    status: project.status || 'en_cours',
  });
  const [saving, setSaving] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateProject({ id: project.id, name: form.name, description: form.description || undefined, status: form.status });
      toast.success('Projet modifié');
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Une erreur est survenue');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title='Modifier le projet'
      footer={
        <>
          <button className='btn-secondary' onClick={onClose}>Annuler</button>
          <button form='edit-client-project-form' type='submit' className='btn-primary' disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </>
      }
    >
      <form id='edit-client-project-form' onSubmit={onSubmit} className='flex flex-col gap-4'>
        <div>
          <label className='label'>Titre du projet *</label>
          <input
            className='input'
            required
            autoFocus
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div>
          <label className='label'>Description</label>
          <textarea
            className='input'
            rows={3}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>
        <div>
          <label className='label'>Statut</label>
          <select className='input' value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value='brouillon'>Brouillon</option>
            <option value='en_cours'>En cours</option>
            <option value='en_pause'>En pause</option>
            <option value='termine'>Terminé</option>
            <option value='annule'>Annulé</option>
          </select>
        </div>
      </form>
    </Modal>
  );
}

// ─── Activity history ─────────────────────────────────────────────────────────
const ACTIVITY_TYPE_META: Record<string, { label: string; className: string }> = {
  'document.email_sent': { label: 'Courriel envoyé', className: 'badge-info' },
  'document.status_changed': { label: 'Statut modifié', className: 'badge-neutral' },
  'document.converted_to_invoice': { label: 'Soumission → Facture', className: 'badge-success' },
  'document.reverted_to_quote': { label: 'Facture → Soumission', className: 'badge-warning' },
};

function ActivityHistory({ clientId }: { clientId: string }) {
  const { data: activities, isLoading } = useQuery(getClientActivities, { clientId, limit: 50 });

  return (
    <div className='bg-white border border-gray-100 rounded-xl p-5 shadow-sm'>
      <h2 className='text-sm font-semibold text-ink mb-4 uppercase tracking-wide'>
        Historique d'activité
      </h2>
      {isLoading ? (
        <p className='text-muted text-sm'>Chargement…</p>
      ) : !activities || activities.length === 0 ? (
        <p className='text-muted text-sm'>Aucune activité enregistrée pour ce client.</p>
      ) : (
        <ol className='space-y-3'>
          {activities.map((a: any) => {
            const meta = ACTIVITY_TYPE_META[a.type] || { label: a.type, className: 'badge-neutral' };
            const who = a.user?.fullName || a.user?.email || 'Système';
            return (
              <li key={a.id} className='flex items-start gap-3 text-sm'>
                <span className={`${meta.className} shrink-0 mt-0.5`}>{meta.label}</span>
                <div className='flex-1 min-w-0'>
                  <p className='text-ink'>{a.message}</p>
                  <p className='text-xs text-muted mt-0.5'>
                    {formatDate(a.createdAt)} · {who}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

