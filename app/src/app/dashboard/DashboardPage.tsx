import { useQuery, getDashboardStats, getCurrentCompany, createCompany } from 'wasp/client/operations';
import { Link } from 'react-router';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { PageHeader, EmptyState } from '../../client/ui';
import { MagicInput } from '../../client/magic';
import { formatCurrency, formatDate, formatTime } from '../../shared/format';

const INVOICE_STATUS: Record<string, { label: string; className: string }> = {
  brouillon: { label: 'Brouillon', className: 'badge-neutral' },
  envoyee: { label: 'Envoyée', className: 'badge-info' },
  payee: { label: 'Payée', className: 'badge-success' },
  en_retard: { label: 'En retard', className: 'badge-danger' },
  annulee: { label: 'Annulée', className: 'badge-neutral' },
};

export default function DashboardPage() {
  const { data: company, isLoading: loadingCompany } = useQuery(getCurrentCompany);
  const { data: stats, isLoading } = useQuery(getDashboardStats, undefined, { enabled: !!company });
  const [companyName, setCompanyName] = useState('');
  const [creating, setCreating] = useState(false);

  if (loadingCompany) {
    return <div className='text-muted'>Chargement…</div>;
  }

  if (!company) {
    return (
      <div className='max-w-md mx-auto pt-12'>
        <div className='card p-8'>
          <h1 className='text-2xl font-semibold'>Bienvenue sur Gestia</h1>
          <p className='text-muted mt-2 text-sm'>Pour commencer, créez votre entreprise. Vous deviendrez automatiquement administrateur.</p>
          <form
            className='mt-6 space-y-4'
            onSubmit={async (e) => {
              e.preventDefault();
              if (!companyName.trim()) return;
              setCreating(true);
              try {
                await createCompany({ name: companyName.trim() });
                window.location.reload();
              } catch (err: any) {
                toast.error(err?.message || 'Erreur lors de la création');
              } finally {
                setCreating(false);
              }
            }}
          >
            <div>
              <label className='label'>Nom de l'entreprise</label>
              <MagicInput className='input' value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder='Ex. Trifali Concept inc.' required />
            </div>
            <button type='submit' className='btn-primary w-full' disabled={creating}>
              {creating ? 'Création…' : 'Créer mon entreprise'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title={`Bonjour 👋`}
        subtitle={`Voici l'état de ${company.name} aujourd'hui — ${formatDate(new Date())}.`}
      />

      {isLoading || !stats ? (
        <div className='text-muted'>Chargement des données…</div>
      ) : (
        <>
          <div className='grid grid-cols-2 lg:grid-cols-4 gap-4'>
            <div className='stat-card'>
              <div className='stat-label'>Clients</div>
              <div className='stat-value'>{stats.clientsCount}</div>
            </div>
            <div className='stat-card'>
              <div className='stat-label'>Projets actifs</div>
              <div className='stat-value'>{stats.activeProjectsCount}</div>
            </div>
            <div className='stat-card'>
              <div className='stat-label'>Soumissions en attente</div>
              <div className='stat-value'>{stats.pendingQuotesCount}</div>
            </div>
            <div className='stat-card'>
              <div className='stat-label'>Factures impayées</div>
              <div className='stat-value'>{stats.unpaidInvoicesCount}</div>
              <div className='text-xs text-muted mt-1'>{formatCurrency(stats.unpaidTotal)}</div>
            </div>
          </div>

          <div className='grid lg:grid-cols-3 gap-4 mt-6'>
            <div className='card p-5 lg:col-span-2'>
              <div className='flex items-center justify-between'>
                <h2 className='font-semibold'>Revenus des 6 derniers mois</h2>
                <span className='text-xs text-muted'>Encaissé ce mois : {formatCurrency(stats.paidThisMonth)}</span>
              </div>
              <RevenueChart data={stats.monthlyRevenue} />
            </div>
            <div className='card p-5'>
              <div className='flex items-center justify-between'>
                <h2 className='font-semibold'>Prochaines rencontres</h2>
                <Link to='/rencontres' className='text-xs text-muted hover:text-ink'>Voir tout</Link>
              </div>
              {stats.upcomingMeetings.length === 0 ? (
                <p className='text-sm text-muted mt-3'>Aucune rencontre planifiée.</p>
              ) : (
                <ul className='mt-3 space-y-3'>
                  {stats.upcomingMeetings.map((m) => (
                    <li key={m.id} className='flex items-start justify-between gap-3'>
                      <div className='min-w-0'>
                        <div className='font-medium truncate'>{m.title}</div>
                        <div className='text-xs text-muted'>{m.clientName || 'Sans client'}</div>
                      </div>
                      <div className='text-xs text-right text-muted shrink-0'>
                        <div>{formatDate(m.startsAt)}</div>
                        <div>{formatTime(m.startsAt)}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className='card mt-6 overflow-hidden'>
            <div className='px-5 py-4 border-b border-line flex items-center justify-between'>
              <h2 className='font-semibold'>Factures récentes</h2>
              <Link to='/facturation?type=invoice' className='text-xs text-muted hover:text-ink'>Voir toutes les factures</Link>
            </div>
            {stats.recentInvoices.length === 0 ? (
              <EmptyState title='Aucune facture' description='Créez votre première facture pour commencer.' />
            ) : (
              <table className='w-full text-sm'>
                <thead>
                  <tr>
                    <th className='text-left text-xs uppercase tracking-wide text-muted px-5 py-3'>Numéro</th>
                    <th className='text-left text-xs uppercase tracking-wide text-muted px-5 py-3'>Client</th>
                    <th className='text-left text-xs uppercase tracking-wide text-muted px-5 py-3'>Date</th>
                    <th className='text-left text-xs uppercase tracking-wide text-muted px-5 py-3'>Statut</th>
                    <th className='text-right text-xs uppercase tracking-wide text-muted px-5 py-3'>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.recentInvoices.map((inv) => (
                    <tr key={inv.id} className='border-t border-line/60'>
                      <td className='px-5 py-3 font-mono text-xs'>{inv.number}</td>
                      <td className='px-5 py-3'>{inv.clientName}</td>
                      <td className='px-5 py-3 text-muted'>{formatDate(inv.createdAt)}</td>
                      <td className='px-5 py-3'>
                        <span className={INVOICE_STATUS[inv.status]?.className || 'badge-neutral'}>
                          {INVOICE_STATUS[inv.status]?.label || inv.status}
                        </span>
                      </td>
                      <td className='px-5 py-3 text-right font-medium'>{formatCurrency(inv.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </>
  );
}

function RevenueChart({ data }: { data: { month: string; total: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.total));
  const monthLabel = (m: string) => {
    const [, mm] = m.split('-');
    const labels = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
    return labels[parseInt(mm, 10) - 1] || m;
  };
  return (
    <div className='mt-6 flex items-end gap-3 h-44'>
      {data.map((d) => (
        <div key={d.month} className='flex-1 flex flex-col items-center justify-end gap-2'>
          <div className='text-[10px] text-muted'>{d.total > 0 ? formatCurrency(d.total) : ''}</div>
          <div
            className='w-full rounded-t-md bg-accent/80'
            style={{ height: `${Math.max(2, (d.total / max) * 100)}%` }}
          />
          <div className='text-xs text-muted'>{monthLabel(d.month)}</div>
        </div>
      ))}
    </div>
  );
}
