import { PageHeader } from '../../client/ui';
import { PaymentsSection } from './PaymentsSection';

export default function PaymentsPage() {
  return (
    <>
      <PageHeader
        title='Paiements'
        subtitle='Enregistrez les paiements reçus et suivez vos encaissements.'
      />
      <PaymentsSection showClientColumn />
    </>
  );
}
