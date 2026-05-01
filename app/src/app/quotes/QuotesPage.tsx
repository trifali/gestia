import { useState, useMemo } from 'react';
import {
  useQuery,
  getQuotes,
  getClients,
  getProjects,
  createQuote,
  updateQuoteStatus,
  deleteQuote,
} from 'wasp/client/operations';
import { PageHeader, EmptyState, Modal, useConfirm } from '../../client/ui';
import { formatCurrency, formatDate, formatDateForInput } from '../../shared/format';

const STATUS: Record<string, { label: string; className: string }> = {
  brouillon: { label: 'Brouillon', className: 'badge-neutral' },
  envoyee: { label: 'Envoyée', className: 'badge-info' },
  acceptee: { label: 'Acceptée', className: 'badge-success' },
  refusee: { label: 'Refusée', className: 'badge-danger' },
  expiree: { label: 'Expirée', className: 'badge-warning' },
};

const TPS = 0.05;
const TVQ = 0.09975;

export default function QuotesPage() {
  const { data: quotes, isLoading } = useQuery(getQuotes);
  const { data: clients } = useQuery(getClients);
  const { data: projects } = useQuery(getProjects);
  const [creating, setCreating] = useState(false);
  const { ask, Dialog: ConfirmDialog } = useConfirm();

  return (
    <>
      <PageHeader
        title='Soumissions'
        subtitle='Préparez et envoyez vos soumissions avec calculs de taxes intégrés.'
        actions={<button className='btn-primary' onClick={() => setCreating(true)}>Nouvelle soumission</button>}
      />

      {isLoading ? (
        <div className='text-muted'>Chargement…</div>
      ) : !quotes || quotes.length === 0 ? (
        <EmptyState
          title='Aucune soumission'
          description='Créez votre première soumission. La TPS (5 %) et la TVQ (9,975 %) seront calculées automatiquement.'
          action={<button className='btn-primary' onClick={() => setCreating(true)}>Créer une soumission</button>}
        />
      ) : (
        <div className='table-wrap'>
          <table>
            <thead>
              <tr>
                <th>Numéro</th>
                <th>Titre</th>
                <th>Client</th>
                <th>Émise</th>
                <th>Valide jusqu'au</th>
                <th>Statut</th>
                <th className='text-right'>Total</th>
                <th className='text-right'>Actions</th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((q: any) => (
                <tr key={q.id}>
                  <td className='font-mono text-xs'>{q.number}</td>
                  <td className='font-medium'>{q.title}</td>
                  <td className='text-muted'>{q.client.name}</td>
                  <td className='text-muted'>{formatDate(q.issueDate)}</td>
                  <td className='text-muted'>{q.validUntil ? formatDate(q.validUntil) : '—'}</td>
                  <td>
                    <select
                      className={`text-xs px-2 py-1 rounded-md border-0 cursor-pointer ${STATUS[q.status]?.className || 'badge-neutral'}`}
                      value={q.status}
                      onChange={async (e) => { await updateQuoteStatus({ id: q.id, status: e.target.value }); }}
                    >
                      {Object.entries(STATUS).map(([key, val]) => (
                        <option key={key} value={key}>{val.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className='text-right font-medium'>{formatCurrency(q.total)}</td>
                  <td className='text-right'>
                    <button
                      className='btn-ghost text-xs text-danger'
                      onClick={async () => {
                        if (await ask(`Supprimer la soumission ${q.number} ?`)) {
                          await deleteQuote({ id: q.id });
                        }
                      }}
                    >
                      Supprimer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <QuoteForm clients={clients || []} projects={projects || []} onClose={() => setCreating(false)} />
      )}
      {ConfirmDialog}
    </>
  );
}

function QuoteForm({ clients, projects, onClose }: { clients: any[]; projects: any[]; onClose: () => void }) {
  const [clientId, setClientId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState([{ description: '', quantity: 1, unitPrice: 0 }]);
  const [saving, setSaving] = useState(false);

  const filteredProjects = projects.filter((p) => !clientId || p.clientId === clientId);

  const totals = useMemo(() => {
    const sub = items.reduce((s, it) => s + (it.quantity || 0) * (it.unitPrice || 0), 0);
    const gst = sub * TPS;
    const qst = sub * TVQ;
    return { sub, gst, qst, total: sub + gst + qst };
  }, [items]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientId) { alert('Veuillez sélectionner un client.'); return; }
    if (!items.length || items.some((i) => !i.description.trim())) {
      alert('Chaque item doit avoir une description.');
      return;
    }
    setSaving(true);
    try {
      await createQuote({
        clientId,
        projectId: projectId || null,
        title,
        description,
        validUntil: validUntil || null,
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
      title='Nouvelle soumission'
      footer={
        <>
          <button className='btn-secondary' onClick={onClose}>Annuler</button>
          <button form='quote-form' type='submit' className='btn-primary' disabled={saving}>
            {saving ? 'Création…' : 'Créer la soumission'}
          </button>
        </>
      }
    >
      <form id='quote-form' onSubmit={onSubmit} className='space-y-4'>
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
          <div className='col-span-2'>
            <label className='label'>Titre *</label>
            <input className='input' required value={title} onChange={(e) => setTitle(e.target.value)} placeholder='Ex. Refonte du site web' />
          </div>
          <div className='col-span-2'>
            <label className='label'>Description</label>
            <textarea className='input' rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div>
            <label className='label'>Valide jusqu'au</label>
            <input type='date' className='input' value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
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
                    type='button'
                    className='btn-ghost sm:col-span-1 text-danger shrink-0'
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
