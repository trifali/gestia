import { useState } from 'react';
import toast from 'react-hot-toast';
import { createSupplier, updateSupplier } from 'wasp/client/operations';
import { Modal, PhoneInput } from '../../client/ui';
import { MagicInput, MagicTextarea } from '../../client/magic';
import { SUPPLIER_TYPES, RATE_TYPES } from '../../shared/supplier';
import { PAYMENT_METHOD_OPTIONS } from '../payments/PaymentForm';
import { RateInput } from './ContractComponents';

type SupplierLike = Record<string, any> & { id: string; name: string };

const EMPTY = {
  type: 'consultant',
  name: '',
  contactName: '',
  email: '',
  phone: '',
  address: '',
  city: '',
  province: 'QC',
  postalCode: '',
  website: '',
  specialty: '',
  status: 'actif',
  neq: '',
  taxNumberGst: '',
  taxNumberQst: '',
  rateType: 'horaire',
  rate: '',
  paymentTermsDays: '30',
  paymentMethod: 'virement',
  paymentDetails: '',
  notes: '',
};

type FormState = typeof EMPTY;

function fromSupplier(s: SupplierLike): FormState {
  const out: any = { ...EMPTY };
  for (const k of Object.keys(EMPTY)) {
    const v = s[k];
    out[k] = v == null ? (k === 'paymentTermsDays' || k === 'rate' ? '' : (EMPTY as any)[k]) : String(v);
  }
  return out;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className='sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2'>
      <legend className='sm:col-span-2 text-xs font-semibold uppercase tracking-wide text-muted mb-1'>{title}</legend>
      {children}
    </fieldset>
  );
}

export function SupplierForm({
  supplier,
  onClose,
  onSaved,
}: {
  supplier?: SupplierLike;
  onClose: () => void;
  onSaved?: (s: any) => void;
}) {
  const [form, setForm] = useState<FormState>(() => (supplier ? fromSupplier(supplier) : EMPTY));
  const [saving, setSaving] = useState(false);
  const set = (k: keyof FormState) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const isCompany = form.type === 'fournisseur' || form.type === 'agence' || form.type === 'sous_traitant';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form, rate: form.rate === '' ? null : form.rate, paymentTermsDays: form.paymentTermsDays === '' ? null : form.paymentTermsDays };
      const saved = supplier
        ? await updateSupplier({ id: supplier.id, ...payload })
        : await createSupplier(payload);
      toast.success(supplier ? 'Fournisseur modifié' : 'Fournisseur ajouté');
      onSaved?.(saved);
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
      size='lg'
      title={supplier ? `Modifier — ${supplier.name}` : 'Nouveau fournisseur'}
      footer={
        <>
          <button className='btn-secondary' onClick={onClose}>Annuler</button>
          <button form='supplier-form' type='submit' className='btn-primary' disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </>
      }
    >
      <form id='supplier-form' onSubmit={submit} className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
        <div className='sm:col-span-2'>
          <label className='label'>Type</label>
          <div className='flex flex-wrap gap-1.5'>
            {SUPPLIER_TYPES.map((t) => (
              <button
                key={t.value}
                type='button'
                onClick={() => setForm({ ...form, type: t.value })}
                className={`rounded-full px-3 py-1.5 text-xs font-medium border transition-colors ${
                  form.type === t.value ? 'bg-ink text-white border-ink' : 'bg-white text-ink border-line hover:bg-canvas-200'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className='label'>{isCompany ? 'Raison sociale *' : 'Nom complet ou entreprise *'}</label>
          <MagicInput className='input' required value={form.name} onChange={set('name')} placeholder={isCompany ? 'Ex. Studio Nord inc.' : 'Ex. Marie Tremblay'} />
        </div>
        <div>
          <label className='label'>Personne contact / signataire</label>
          <MagicInput className='input' value={form.contactName} onChange={set('contactName')} />
        </div>
        <div>
          <label className='label'>Expertise / services</label>
          <MagicInput className='input' value={form.specialty} onChange={set('specialty')} placeholder='Ex. Développement web, comptabilité…' />
        </div>
        <div>
          <label className='label'>Statut</label>
          <select className='input' value={form.status} onChange={set('status')}>
            <option value='actif'>Actif</option>
            <option value='inactif'>Inactif</option>
          </select>
        </div>

        <Section title='Coordonnées'>
          <div>
            <label className='label'>Courriel</label>
            <input type='email' className='input' value={form.email} onChange={set('email')} />
          </div>
          <div>
            <label className='label'>Téléphone</label>
            <PhoneInput className='input' value={form.phone} onChange={(next) => setForm({ ...form, phone: next })} />
          </div>
          <div className='sm:col-span-2'>
            <label className='label'>Adresse</label>
            <MagicInput className='input' value={form.address} onChange={set('address')} placeholder='123 rue Exemple' />
          </div>
          <div>
            <label className='label'>Ville</label>
            <input className='input' value={form.city} onChange={set('city')} />
          </div>
          <div className='grid grid-cols-2 gap-3'>
            <div>
              <label className='label'>Province</label>
              <input className='input' value={form.province} onChange={set('province')} />
            </div>
            <div>
              <label className='label'>Code postal</label>
              <input className='input' value={form.postalCode} onChange={set('postalCode')} />
            </div>
          </div>
          <div className='sm:col-span-2'>
            <label className='label'>Site web</label>
            <input className='input' value={form.website} onChange={set('website')} placeholder='https://' />
          </div>
        </Section>

        <Section title='Fiscalité'>
          <div>
            <label className='label'>NEQ</label>
            <input className='input' value={form.neq} onChange={set('neq')} />
          </div>
          <div className='hidden sm:block' />
          <div>
            <label className='label'>N° TPS</label>
            <input className='input' value={form.taxNumberGst} onChange={set('taxNumberGst')} placeholder='123456789 RT0001' />
          </div>
          <div>
            <label className='label'>N° TVQ</label>
            <input className='input' value={form.taxNumberQst} onChange={set('taxNumberQst')} placeholder='1234567890 TQ0001' />
          </div>
          <p className='sm:col-span-2 text-xs text-muted -mt-2'>
            Sans numéro de taxes, les factures sont saisies sans TPS ni TVQ par défaut (petit fournisseur non inscrit).
          </p>
        </Section>

        <Section title='Conditions et paiement'>
          <div>
            <label className='label'>Rémunération</label>
            <select className='input' value={form.rateType} onChange={set('rateType')}>
              {RATE_TYPES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div>
            <RateInput rateType={form.rateType} value={form.rate} onChange={(rate) => setForm({ ...form, rate })} />
            {form.rateType === 'commission_fixe' && (
              <p className='text-xs text-muted mt-1'>Le montant varie selon le type de client ? Laissez vide : le barème se définit dans l'entente.</p>
            )}
          </div>
          <div>
            <label className='label'>Délai de paiement (jours)</label>
            <input type='number' min='0' className='input' value={form.paymentTermsDays} onChange={set('paymentTermsDays')} />
          </div>
          <div>
            <label className='label'>Méthode de paiement</label>
            <select className='input' value={form.paymentMethod} onChange={set('paymentMethod')}>
              {PAYMENT_METHOD_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div className='sm:col-span-2'>
            <label className='label'>Coordonnées de paiement</label>
            <textarea className='input' rows={2} value={form.paymentDetails} onChange={set('paymentDetails')} placeholder='Courriel Interac, ou institution / transit / compte…' />
            <p className='text-xs text-muted mt-1'>Interne seulement : jamais affiché dans le portail du fournisseur.</p>
          </div>
        </Section>

        <div className='sm:col-span-2'>
          <label className='label'>Notes</label>
          <MagicTextarea className='input' rows={3} value={form.notes} onChange={set('notes')} />
        </div>
      </form>
    </Modal>
  );
}
