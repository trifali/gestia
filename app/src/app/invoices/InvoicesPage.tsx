import { useState, useMemo } from 'react';
import {
  useQuery,
  getInvoices,
  getClients,
  getProjects,
  createInvoice,
  updateInvoiceStatus,
  deleteInvoice,
} from 'wasp/client/operations';
import { PageHeader, EmptyState, Modal, useConfirm, IconBtn, TrashIcon } from '../../client/ui';
import { formatCurrency, formatDate } from '../../shared/format';

const STATUS: Record<string, { label: string; className: string }> = {
  brouillon: { label: 'Brouillon', className: 'badge-neutral' },
  envoyee: { label: 'Envoyée', className: 'badge-info' },
  payee: { label: 'Payée', className: 'badge-success' },
  en_retard: { label: 'En retard', className: 'badge-danger' },
  annulee: { label: 'Annulée', className: 'badge-neutral' },
};

const TPS = 0.05;
const TVQ = 0.09975;

export default function InvoicesPage() {
  const { data: invoices, isLoading } = useQuery(getInvoices);
  const { data: clients } = useQuery(getClients);
  const { data: projects } = useQuery(getProjects);
  const [creating, setCreating] = useState(false);
  const { ask, Dialog: ConfirmDialog } = useConfirm();

  return (
    <>
      <PageHeader
        title='Factures'
        subtitle='Émettez vos factures, suivez leur statut et leurs paiements.'
        actions={<button className='btn-primary' onClick={() => setCreating(true)}>Nouvelle facture</button>}
      />

      {isLoading ? (
        <div className='text-muted'>Chargement…</div>
      ) : !invoices || invoices.length === 0 ? (
        <EmptyState
          title='Aucune facture'
          description='Émettez votre première facture pour commencer à être payé.'
          action={<button className='btn-primary' onClick={() => setCreating(true)}>Créer une facture</button>}
        />
      ) : (
        <div className='table-wrap'>
          <table>
            <thead>
              <tr>
                <th>Numéro</th>
                <th>Client</th>
                <th>Émise</th>
                <th>Échéance</th>
                <th>Statut</th>
                <th className='text-right'>Total</th>
                <th className='text-right'>Solde</th>
                <th className='text-right'>Actions</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv: any) => {
                const balance = +(inv.total - inv.amountPaid).toFixed(2);
                return (
                  <tr key={inv.id}>
                    <td className='font-mono text-xs'>{inv.number}</td>
                    <td className='font-medium'>{inv.client.name}</td>
                    <td className='text-muted'>{formatDate(inv.issueDate)}</td>
                    <td className='text-muted'>{inv.dueDate ? formatDate(inv.dueDate) : '—'}</td>
                    <td>
                      <select
                        className={`text-xs px-2 py-1 rounded-md border-0 cursor-pointer ${STATUS[inv.status]?.className || 'badge-neutral'}`}
                        value={inv.status}
                        onChange={async (e) => { await updateInvoiceStatus({ id: inv.id, status: e.target.value }); }}
                      >
                        {Object.entries(STATUS).map(([key, val]) => (
                          <option key={key} value={key}>{val.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className='text-right font-medium'>{formatCurrency(inv.total)}</td>
                    <td className='text-right'>
                      <span className={balance > 0 ? 'text-danger font-medium' : 'text-success'}>
                        {formatCurrency(balance)}
                      </span>
                    </td>
                    <td className='text-right'>
                      <IconBtn variant='danger' title='Supprimer' onClick={async () => {
                        if (await ask(`Supprimer la facture ${inv.number} ?`)) await deleteInvoice({ id: inv.id });
                      }}><TrashIcon /></IconBtn>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <InvoiceForm clients={clients || []} projects={projects || []} onClose={() => setCreating(false)} />
      )}
      {ConfirmDialog}
    </>
  );
}

function InvoiceForm({ clients, projects, onClose }: { clients: any[]; projects: any[]; onClose: () => void }) {
  const [clientId, setClientId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState([{ description: '', quantity: 1, unitPrice: 0 }]);
  const [saving, setSaving] = useState(false);

  const filteredProjects = projects.filter((p) => !clientId || p.clientId === clientId);

  const totals = useMemo(() => {
    const sub = items.reduce((s, it) => s + (it.quantity || 0) * (it.unitPrice || 0), 0);
    return { sub, gst: sub * TPS, qst: sub * TVQ, total: sub * (1 + TPS + TVQ) };
  }, [items]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientId) { alert('Sélectionnez un client.'); return; }
    if (items.some((i) => !i.description.trim())) { alert('Chaque item nécessite une description.'); return; }
    setSaving(true);
    try {
      await createInvoice({
        clientId,
        projectId: projectId || null,
        dueDate: dueDate || null,
        notes,
        items: items.map((i) => ({ ...i, quantity: +i.quantity, unitPrice: +i.unitPrice })),
      });
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
      title='Nouvelle facture'
      footer={
        <>
          <button className='btn-secondary' onClick={onClose}>Annuler</button>
          <button form='invoice-form' type='submit' className='btn-primary' disabled={saving}>
            {saving ? 'Création…' : 'Créer la facture'}
          </button>
        </>
      }
    >
      <form id='invoice-form' onSubmit={onSubmit} className='space-y-4'>
        <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
          <div>
            <label className='label'>Client *</label>
            <select className='input' required value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value=''>— Sélectionner —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className='label'>Projet (optionnel)</label>
            <select className='input' value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value=''>— Aucun —</option>
              {filteredProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className='label'>Date d'échéance</label>
            <input type='date' className='input' value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>

        <div>
          <div className='label'>Items</div>
          <div className='space-y-2'>
            {items.map((it, idx) => (
              <div key={idx} className='flex flex-col sm:grid sm:grid-cols-12 gap-2'>
                <input
                  className='input sm:col-span-6'
                  placeholder='Description'
                  value={it.description}
                  onChange={(e) => {
                    const next = [...items]; next[idx] = { ...it, description: e.target.value }; setItems(next);
                  }}
                />
                <div className='flex gap-2 sm:contents'>
                  <input
                    type='number' step='0.01' className='input sm:col-span-2 flex-1' placeholder='Qté'
                    value={it.quantity}
                    onChange={(e) => {
                      const next = [...items]; next[idx] = { ...it, quantity: parseFloat(e.target.value) || 0 }; setItems(next);
                    }}
                  />
                  <input
                    type='number' step='0.01' className='input sm:col-span-3 flex-[2]' placeholder='Prix unitaire'
                    value={it.unitPrice}
                    onChange={(e) => {
                      const next = [...items]; next[idx] = { ...it, unitPrice: parseFloat(e.target.value) || 0 }; setItems(next);
                    }}
                  />
                  <button
                    type='button' className='btn-ghost sm:col-span-1 text-danger shrink-0'
                    onClick={() => setItems(items.filter((_, i) => i !== idx))}
                    disabled={items.length === 1}
                  >×</button>
                </div>
              </div>
            ))}
          </div>
          <button type='button' className='btn-secondary mt-2 text-sm' onClick={() => setItems([...items, { description: '', quantity: 1, unitPrice: 0 }])}>
            + Ajouter un item
          </button>
        </div>

        <div className='border-t border-line pt-4 grid grid-cols-2 gap-2 text-sm'>
          <div className='text-muted'>Sous-total</div><div className='text-right'>{formatCurrency(totals.sub)}</div>
          <div className='text-muted'>TPS (5 %)</div><div className='text-right'>{formatCurrency(totals.gst)}</div>
          <div className='text-muted'>TVQ (9,975 %)</div><div className='text-right'>{formatCurrency(totals.qst)}</div>
          <div className='font-semibold border-t border-line pt-2'>Total</div>
          <div className='font-semibold border-t border-line pt-2 text-right'>{formatCurrency(totals.total)}</div>
        </div>

        <div>
          <label className='label'>Notes</label>
          <textarea className='input' rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </form>
    </Modal>
  );
}
