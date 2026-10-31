import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { LuArrowRight, LuX, LuBriefcase, LuMessageSquare } from 'react-icons/lu';
import { useQuery, getSuppliers, getSupplierInvoices } from 'wasp/client/operations';
import { PageHeader, EmptyState } from '../../client/ui';
import { formatCurrency } from '../../shared/format';
import { SUPPLIER_STATUS, SUPPLIER_TYPES, supplierTypeLabel, formatRate, invoiceBalance, invoiceDisplayStatus } from '../../shared/supplier';
import { SupplierForm } from './SupplierForm';
import { SupplierInvoiceList, type SupplierForInvoice, type SupplierInvoiceRow } from './InvoiceComponents';

type View = 'fournisseurs' | 'factures';

export default function SuppliersPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const view: View = searchParams.get('vue') === 'factures' ? 'factures' : 'fournisseurs';
  const setView = (v: View) => setSearchParams(v === 'factures' ? { vue: 'factures' } : {}, { replace: true });
  const { data: suppliers, isLoading } = useQuery(getSuppliers);
  const { data: invoices } = useQuery(getSupplierInvoices);
  const [creating, setCreating] = useState(false);

  const kpis = useMemo(() => {
    const all = (invoices || []) as SupplierInvoiceRow[];
    const approved = all.filter((i) => i.status === 'approuvee');
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    return {
      toApprove: all.filter((i) => i.status === 'a_approuver'),
      due: approved.reduce((s, i) => s + invoiceBalance(i), 0),
      overdue: approved.filter((i) => invoiceDisplayStatus(i) === 'en_retard'),
      paidThisMonth: all.flatMap((i) => i.payments).filter((p) => new Date(p.paidAt) >= monthStart).reduce((s, p) => s + p.amount, 0),
    };
  }, [invoices]);

  const supplierMap = useMemo(
    () => Object.fromEntries(((suppliers || []) as any[]).map((s) => [s.id, s])) as Record<string, SupplierForInvoice>,
    [suppliers],
  );

  return (
    <>
      <PageHeader
        title='Fournisseurs'
        subtitle='Consultants, travailleurs autonomes et fournisseurs que vous payez.'
        actions={<button className='btn-primary' onClick={() => setCreating(true)}>Nouveau fournisseur</button>}
      />

      <div className='grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6'>
        <Kpi label='À approuver' value={String(kpis.toApprove.length)} sub={formatCurrency(kpis.toApprove.reduce((s, i) => s + i.total, 0))} tone={kpis.toApprove.length ? 'warning' : undefined} onClick={() => setView('factures')} />
        <Kpi label='Solde à payer' value={formatCurrency(kpis.due)} sub='factures approuvées' onClick={() => setView('factures')} />
        <Kpi label='En retard' value={String(kpis.overdue.length)} sub={formatCurrency(kpis.overdue.reduce((s, i) => s + invoiceBalance(i), 0))} tone={kpis.overdue.length ? 'danger' : undefined} onClick={() => setView('factures')} />
        <Kpi label='Payé ce mois-ci' value={formatCurrency(kpis.paidThisMonth)} sub='tous fournisseurs' />
      </div>

      <div className='flex gap-1 border-b border-line mb-5 overflow-x-auto'>
        {([['fournisseurs', 'Fournisseurs'], ['factures', 'Factures à payer']] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setView(id)}
            className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
              view === id ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            {label}
            {id === 'factures' && kpis.toApprove.length > 0 && <span className='ml-1.5 badge-warning'>{kpis.toApprove.length}</span>}
          </button>
        ))}
      </div>

      {view === 'factures' ? (
        <SupplierInvoiceList
          invoices={(invoices || []) as SupplierInvoiceRow[]}
          suppliers={supplierMap}
          showSupplier
          emptyMessage='Aucune facture fournisseur. Ajoutez-en une depuis la fiche d’un fournisseur, ou partagez-lui son portail pour qu’il dépose les siennes.'
        />
      ) : isLoading ? (
        <div className='text-muted'>Chargement…</div>
      ) : (
        <SupplierDirectory suppliers={(suppliers || []) as any[]} onCreate={() => setCreating(true)} onOpen={(id) => navigate(`/fournisseurs/${id}`)} />
      )}

      {creating && <SupplierForm onClose={() => setCreating(false)} onSaved={(s) => navigate(`/fournisseurs/${s.id}`)} />}
    </>
  );
}

function Kpi({ label, value, sub, tone, onClick }: { label: string; value: string; sub?: string; tone?: 'warning' | 'danger'; onClick?: () => void }) {
  const color = tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-ink';
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick} className={`card p-4 text-left ${onClick ? 'hover:border-ink/20 transition-colors' : ''}`}>
      <p className='text-xs text-muted uppercase tracking-wide mb-1'>{label}</p>
      <p className={`text-xl sm:text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className='text-xs text-muted mt-0.5 truncate'>{sub}</p>}
    </Tag>
  );
}

function SupplierDirectory({ suppliers, onCreate, onOpen }: { suppliers: any[]; onCreate: () => void; onOpen: (id: string) => void }) {
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('actif');

  const q = search.trim().toLowerCase();
  const filtered = suppliers.filter((s) => {
    if (status && s.status !== status) return false;
    if (type && s.type !== type) return false;
    if (q && ![s.name, s.contactName, s.email, s.specialty].some((v: string | null) => (v || '').toLowerCase().includes(q))) return false;
    return true;
  });

  if (suppliers.length === 0) {
    return (
      <EmptyState
        icon={<LuBriefcase size={22} />}
        title='Aucun fournisseur pour l’instant'
        description='Ajoutez un consultant, un travailleur autonome ou un fournisseur pour rédiger son entente, recevoir ses factures et suivre vos paiements.'
        action={<button className='btn-primary' onClick={onCreate}>Ajouter un fournisseur</button>}
      />
    );
  }

  return (
    <>
      <div className='flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 mb-4'>
        <input className='input sm:max-w-xs' placeholder='Rechercher un fournisseur…' value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className='flex gap-2'>
          <select className='input sm:w-auto' value={type} onChange={(e) => setType(e.target.value)}>
            <option value=''>Tous les types</option>
            {SUPPLIER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <select className='input sm:w-auto' value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value=''>Tous les statuts</option>
            {Object.entries(SUPPLIER_STATUS).map(([v, { label }]) => <option key={v} value={v}>{label}</option>)}
          </select>
          {(search || type || status !== 'actif') && (
            <button className='p-2 rounded-md text-muted hover:text-ink hover:bg-canvas transition-colors shrink-0' title='Réinitialiser les filtres' onClick={() => { setSearch(''); setType(''); setStatus('actif'); }}>
              <LuX size={15} />
            </button>
          )}
        </div>
        <span className='text-sm text-muted sm:ml-auto'>{filtered.length} fournisseur(s)</span>
      </div>

      {filtered.length === 0 ? (
        <div className='card p-8 text-center text-sm text-muted'>Aucun fournisseur ne correspond aux filtres.</div>
      ) : (
        <>
          {/* Cellulaire */}
          <div className='md:hidden space-y-2'>
            {filtered.map((s) => (
              <button key={s.id} onClick={() => onOpen(s.id)} className='card w-full text-left p-4 active:bg-canvas-100'>
                <div className='flex items-start justify-between gap-3'>
                  <div className='min-w-0'>
                    <p className='font-medium text-ink truncate'>{s.name}</p>
                    <p className='text-xs text-muted truncate'>{supplierTypeLabel(s.type)}{s.specialty ? ` · ${s.specialty}` : ''}</p>
                  </div>
                  <Alerts stats={s.stats} />
                </div>
                <div className='flex items-center justify-between mt-3 text-sm'>
                  <span className='text-muted'>{formatRate(s.rate, s.rateType) || '—'}</span>
                  <span className={s.stats.balanceDue > 0 ? 'font-semibold text-ink' : 'text-muted'}>
                    {s.stats.balanceDue > 0 ? `${formatCurrency(s.stats.balanceDue)} à payer` : 'À jour'}
                  </span>
                </div>
              </button>
            ))}
          </div>

          {/* Grand écran */}
          <div className='table-wrap hidden md:block'>
            <table>
              <thead>
                <tr>
                  <th>Fournisseur</th>
                  <th>Type</th>
                  <th>Contact</th>
                  <th>Tarif</th>
                  <th className='text-right'>Solde à payer</th>
                  <th>À traiter</th>
                  <th className='w-8'></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id} className='cursor-pointer' onClick={() => onOpen(s.id)}>
                    <td>
                      <p className='font-medium text-ink'>{s.name}</p>
                      {s.specialty && <p className='text-xs text-muted truncate max-w-xs'>{s.specialty}</p>}
                    </td>
                    <td className='text-muted'>{supplierTypeLabel(s.type)}</td>
                    <td className='text-muted'>
                      <p>{s.contactName || '—'}</p>
                      {s.email && <p className='text-xs truncate max-w-[14rem]'>{s.email}</p>}
                    </td>
                    <td className='text-muted whitespace-nowrap'>{formatRate(s.rate, s.rateType) || '—'}</td>
                    <td className={`text-right whitespace-nowrap ${s.stats.balanceDue > 0 ? 'font-semibold' : 'text-muted'}`}>
                      {formatCurrency(s.stats.balanceDue)}
                    </td>
                    <td><Alerts stats={s.stats} /></td>
                    <td><LuArrowRight size={16} className='text-muted' /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function Alerts({ stats }: { stats: any }) {
  const items = [
    stats.toApprove > 0 && <span key='a' className='badge-warning'>{stats.toApprove} à approuver</span>,
    stats.overdue > 0 && <span key='o' className='badge-danger'>{stats.overdue} en retard</span>,
    stats.unreadMessages > 0 && <span key='m' className='badge-info'><LuMessageSquare size={11} /> {stats.unreadMessages}</span>,
  ].filter(Boolean);
  if (!items.length) return <span className='text-xs text-muted'>—</span>;
  return <div className='flex flex-wrap gap-1 justify-end md:justify-start'>{items}</div>;
}
