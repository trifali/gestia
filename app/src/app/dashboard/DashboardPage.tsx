import { useQuery, getDashboardStats, getCurrentCompany, createCompany } from 'wasp/client/operations';
import { Link } from 'react-router';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { LuTriangleAlert, LuClock } from 'react-icons/lu';
import { PageHeader, EmptyState } from '../../client/ui';
import { MagicInput } from '../../client/magic';
import { formatCurrency, formatDate, formatTime } from '../../shared/format';
import type { AlertDocument } from './operations';

const INVOICE_STATUS: Record<string, { label: string; className: string }> = {
  brouillon: { label: 'Brouillon', className: 'badge-neutral' },
  envoyee: { label: 'Envoyée', className: 'badge-info' },
  acompte_recu: { label: 'Acompte reçu', className: 'badge-accent' },
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
        title='Bonjour'
        subtitle={`Voici l'état de ${company.name} aujourd'hui — ${formatDate(new Date())}.`}
      />

      {isLoading || !stats ? (
        <div className='text-muted'>Chargement des données…</div>
      ) : (
        <>
          <div className='mb-6'>
            <div className='flex items-center gap-2 mb-2'>
              <LuTriangleAlert size={15} className='text-muted' />
              <h2 className='text-sm font-semibold text-muted uppercase tracking-wide'>Alertes</h2>
              <span className='text-xs text-muted font-normal ml-1'>— factures en retard et soumissions expirées nécessitant une action</span>
            </div>
            <div className='space-y-3'>
              {stats.overdueInvoices.length === 0 && stats.expiredQuotes.length === 0 ? (
                <div className='rounded-xl border border-line bg-canvas px-5 py-4 text-sm text-muted'>
                  Aucune alerte pour le moment — toutes vos factures et soumissions sont à jour.
                </div>
              ) : (
                <>
                  {stats.overdueInvoices.length > 0 && (
                    <div className='rounded-xl border border-red-200 bg-red-50 overflow-hidden'>
                      <div className='flex items-center gap-2 px-5 py-3 bg-red-100 border-b border-red-200'>
                        <LuTriangleAlert className='text-red-600 shrink-0' size={18} />
                        <h2 className='font-semibold text-red-800'>
                          {stats.overdueInvoices.length} facture{stats.overdueInvoices.length > 1 ? 's' : ''} en retard
                        </h2>
                        <span className='text-xs text-red-600 ml-auto'>La date d'échéance est dépassée — contactez le client</span>
                      </div>
                      <ul className='divide-y divide-red-100'>
                        {stats.overdueInvoices.map((doc) => (
                          <AlertRow key={doc.id} doc={doc} clientLinkTo={`/clients/${doc.clientId}?tab=documents&type=invoice&status=en_retard`} amountValue={doc.total - doc.amountPaid} />
                        ))}
                      </ul>
                    </div>
                  )}
                  {stats.expiredQuotes.length > 0 && (
                    <div className='rounded-xl border border-amber-200 bg-amber-50 overflow-hidden'>
                      <div className='flex items-center gap-2 px-5 py-3 bg-amber-100 border-b border-amber-200'>
                        <LuClock className='text-amber-600 shrink-0' size={18} />
                        <h2 className='font-semibold text-amber-800'>
                          {stats.expiredQuotes.length} soumission{stats.expiredQuotes.length > 1 ? 's' : ''} expirée{stats.expiredQuotes.length > 1 ? 's' : ''}
                        </h2>
                        <span className='text-xs text-amber-700 ml-auto'>Date d'échéance dépassée — relancez ou fermez</span>
                      </div>
                      <ul className='divide-y divide-amber-100'>
                        {stats.expiredQuotes.map((doc) => (
                          <AlertRow key={doc.id} doc={doc} clientLinkTo={`/clients/${doc.clientId}?tab=documents&type=quote&status=expiree`} amountValue={doc.total} />
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          <div className='grid grid-cols-2 lg:grid-cols-4 gap-4'>
            <Link to='/clients?status=prospect' className='stat-card hover:border-accent/40 transition-colors cursor-pointer'>
              <div className='stat-label'>Prospects</div>
              <div className='stat-value'>{stats.prospectsCount}</div>
            </Link>
            <Link to='/projets?status=en_cours' className='stat-card hover:border-accent/40 transition-colors cursor-pointer'>
              <div className='stat-label'>Projets en cours</div>
              <div className='stat-value'>{stats.inProgressProjectsCount}</div>
            </Link>
            <Link to='/facturation?type=quote&status=envoyee' className='stat-card hover:border-accent/40 transition-colors cursor-pointer'>
              <div className='stat-label'>Soumissions en attente</div>
              <div className='stat-value'>{stats.pendingQuotesCount}</div>
            </Link>
            <Link to='/facturation?type=invoice&status=acompte_recu' className='stat-card hover:border-accent/40 transition-colors cursor-pointer'>
              <div className='stat-label'>Acomptes reçus</div>
              <div className='stat-value'>{stats.acompteRecuCount}</div>
            </Link>
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

function AlertRow({ doc, clientLinkTo, amountValue }: { doc: AlertDocument; clientLinkTo: string; amountValue: number }) {
  return (
    <li className='flex items-center gap-4 px-5 py-3 text-sm'>
      <div className='min-w-0 flex-1'>
        <Link to={clientLinkTo} className='font-medium hover:underline'>
          {doc.number}
        </Link>
        <span className='text-muted mx-2'>·</span>
        <Link to={clientLinkTo} className='text-muted hover:text-ink hover:underline'>
          {doc.clientName}
        </Link>
      </div>
      {doc.dueDate && (
        <span className='text-xs text-muted shrink-0'>Échéance : {formatDate(doc.dueDate)}</span>
      )}
      <span className='font-semibold shrink-0'>{formatCurrency(amountValue)}</span>
    </li>
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
