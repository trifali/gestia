import { useState } from 'react';
import { useQuery, getClients, createClient, updateClient, deleteClient } from 'wasp/client/operations';
import type { Client } from 'wasp/entities';
import { PageHeader, EmptyState, Modal, useConfirm, IconBtn, EditIcon, TrashIcon } from '../../client/ui';
import { formatDate } from '../../shared/format';

/** Formate les digits saisis en +1 (438) 444-4343 */
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

const STATUS = {
  actif: { label: 'Actif', className: 'badge-success' },
  prospect: { label: 'Prospect', className: 'badge-info' },
  inactif: { label: 'Inactif', className: 'badge-neutral' },
} as const;

export default function ClientsPage() {
  const { data: clients, isLoading } = useQuery(getClients);
  const { ask, Dialog: ConfirmDialog } = useConfirm();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Client | null>(null);
  const [creating, setCreating] = useState(false);

  const filtered = (clients || []).filter((c) =>
    !search ||
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.email || '').toLowerCase().includes(search.toLowerCase()) ||
    (c.contactName || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <>
      <PageHeader
        title='Clients'
        subtitle='Gérez vos clients, prospects et contacts.'
        actions={<button className='btn-primary' onClick={() => setCreating(true)}>Nouveau client</button>}
      />

      <div className='mb-4 flex items-center gap-3'>
        <input
          className='input max-w-xs'
          placeholder='Rechercher un client…'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className='text-sm text-muted'>{filtered.length} client(s)</span>
      </div>

      {isLoading ? (
        <div className='text-muted'>Chargement…</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title="Aucun client pour l'instant"
          description='Ajoutez votre premier client pour commencer à créer des soumissions et factures.'
          action={<button className='btn-primary' onClick={() => setCreating(true)}>Ajouter un client</button>}
        />
      ) : (
        <div className='table-wrap'>
          <table>
            <thead>
              <tr>
                <th>Nom</th>
                <th>Contact</th>
                <th>Courriel</th>
                <th>Téléphone</th>
                <th>Statut</th>
                <th>Ajouté le</th>
                <th className='text-right'>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td className='font-medium'>{c.name}</td>
                  <td className='text-muted'>{c.contactName || '—'}</td>
                  <td className='text-muted'>{c.email || '—'}</td>
                  <td className='text-muted'>{c.phone || '—'}</td>
                  <td>
                    <span className={STATUS[c.status as keyof typeof STATUS]?.className || 'badge-neutral'}>
                      {STATUS[c.status as keyof typeof STATUS]?.label || c.status}
                    </span>
                  </td>
                  <td className='text-muted'>{formatDate(c.createdAt)}</td>
                  <td className='text-right'>
                    <div className='flex items-center justify-end gap-1'>
                      <IconBtn title='Modifier' onClick={() => setEditing(c)}><EditIcon /></IconBtn>
                      <IconBtn variant='danger' title='Supprimer' onClick={async () => {
                        if (await ask(`Supprimer le client « ${c.name} » ?`)) await deleteClient({ id: c.id });
                      }}><TrashIcon /></IconBtn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && <ClientForm onClose={() => setCreating(false)} />}
      {editing && <ClientForm client={editing} onClose={() => setEditing(null)} />}
      {ConfirmDialog}
    </>
  );
}

function ClientForm({ client, onClose }: { client?: Client; onClose: () => void }) {
  const [form, setForm] = useState({
    name: client?.name || '',
    contactName: client?.contactName || '',
    email: client?.email || '',
    phone: client?.phone || '',
    address: client?.address || '',
    notes: client?.notes || '',
    status: client?.status || 'actif',
  });
  const [saving, setSaving] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (client) {
        await updateClient({ id: client.id, ...form });
      } else {
        await createClient(form);
      }
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
      title={client ? 'Modifier le client' : 'Nouveau client'}
      footer={
        <>
          <button className='btn-secondary' onClick={onClose}>Annuler</button>
          <button form='client-form' type='submit' className='btn-primary' disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </>
      }
    >
      <form id='client-form' onSubmit={onSubmit} className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
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
