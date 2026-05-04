import { useMemo } from 'react';
import { useQuery, getPayments, getDocuments } from 'wasp/client/operations';
import { PageHeader } from '../../client/ui';
import { PaymentsSection } from './PaymentsSection';
import type { PaymentRow } from './PaymentsSection';
import type { InvoiceLite } from './PaymentForm';

export default function PaymentsPage() {
  const { data: payments, isLoading } = useQuery(getPayments);
  const { data: documents } = useQuery(getDocuments);

  const invoices: InvoiceLite[] = useMemo(
    () => (documents || []).filter((d: any) => d.type === 'invoice'),
    [documents]
  );

  const rows: PaymentRow[] = useMemo(
    () => (payments || []).map((p: any) => ({
      id: p.id,
      documentId: p.documentId,
      amount: p.amount,
      method: p.method,
      paidAt: p.paidAt,
      reference: p.reference,
      notes: p.notes,
      document: {
        id: p.document.id,
        number: p.document.number,
        type: p.document.type,
        total: p.document.total,
        amountPaid: p.document.amountPaid,
        subtotal: p.document.subtotal,
        taxGst: p.document.taxGst,
        taxQst: p.document.taxQst,
        client: p.document.client,
      },
    })),
    [payments]
  );

  return (
    <>
      <PageHeader
        title='Paiements'
        subtitle='Enregistrez les paiements reçus et suivez vos encaissements.'
      />

      {isLoading ? (
        <div className='text-muted'>Chargement…</div>
      ) : (
        <PaymentsSection
          payments={rows}
          invoices={invoices}
          showClientColumn
          scopeLabel={`${rows.length} paiement(s) — toutes factures confondues`}
          emptyMessage='Aucun paiement reçu pour le moment.'
        />
      )}
    </>
  );
}
