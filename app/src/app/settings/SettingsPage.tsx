import { useState, useEffect } from 'react';
import { useQuery, getCurrentCompany, updateCompany } from 'wasp/client/operations';
import { useAuth } from 'wasp/client/auth';
import { PageHeader } from '../../client/ui';

export default function SettingsPage() {
  const { data: user } = useAuth();
  const { data: company, isLoading } = useQuery(getCurrentCompany);
  const [tab, setTab] = useState<'entreprise' | 'compte' | 'localisation'>('entreprise');

  if (isLoading) return <div className='text-muted'>Chargement…</div>;
  if (!company) return <div className='text-muted'>Aucune entreprise associée.</div>;

  const isAdmin = (user as any)?.role === 'admin' || user?.isAdmin;

  return (
    <>
      <PageHeader title='Paramètres' subtitle='Configurez votre entreprise et votre compte.' />

      <div className='flex gap-2 border-b border-line mb-6'>
        <TabButton active={tab === 'entreprise'} onClick={() => setTab('entreprise')}>Entreprise</TabButton>
        <TabButton active={tab === 'compte'} onClick={() => setTab('compte')}>Compte</TabButton>
        <TabButton active={tab === 'localisation'} onClick={() => setTab('localisation')}>Localisation</TabButton>
      </div>

      {tab === 'entreprise' && <CompanyForm company={company} canEdit={!!isAdmin} />}
      {tab === 'compte' && <AccountInfo user={user} role={(user as any)?.role || 'client'} />}
      {tab === 'localisation' && <LocalizationInfo />}
    </>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

function CompanyForm({ company, canEdit }: { company: any; canEdit: boolean }) {
  const [form, setForm] = useState(company);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { setForm(company); }, [company]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;
    setSaving(true);
    try {
      const { id, createdAt, updatedAt, _userRole, ...rest } = form;
      await updateCompany(rest);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: any) {
      alert(err?.message || 'Erreur');
    } finally {
      setSaving(false);
    }
  };

  const Field = ({ label, value, k, type = 'text' }: { label: string; value: any; k: string; type?: string }) => (
    <div>
      <label className='label'>{label}</label>
      <input
        type={type}
        className='input'
        value={value || ''}
        onChange={(e) => setForm({ ...form, [k]: e.target.value })}
        disabled={!canEdit}
      />
    </div>
  );

  return (
    <form onSubmit={onSubmit} className='card p-6'>
      {!canEdit && (
        <p className='mb-4 text-sm text-muted bg-canvas-200 px-3 py-2 rounded-lg'>
          Seul un administrateur peut modifier ces paramètres.
        </p>
      )}
      <div className='grid md:grid-cols-2 gap-4'>
        <Field label='Nom commercial' value={form.name} k='name' />
        <Field label='Raison sociale' value={form.legalName} k='legalName' />
        <Field label='Courriel' value={form.email} k='email' type='email' />
        <Field label='Téléphone' value={form.phone} k='phone' />
        <div className='md:col-span-2'>
          <Field label='Adresse' value={form.address} k='address' />
        </div>
        <Field label='Ville' value={form.city} k='city' />
        <Field label='Province' value={form.province} k='province' />
        <Field label='Code postal' value={form.postalCode} k='postalCode' />
        <Field label='Pays' value={form.country} k='country' />
        <Field label='Site web' value={form.website} k='website' />
        <Field label='NEQ' value={form.neq} k='neq' />
        <Field label='Numéro TPS' value={form.taxNumberGst} k='taxNumberGst' />
        <Field label='Numéro TVQ' value={form.taxNumberQst} k='taxNumberQst' />
      </div>

      {canEdit && (
        <div className='mt-6 flex items-center gap-3'>
          <button type='submit' className='btn-primary' disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
          {saved && <span className='text-sm text-success'>✓ Enregistré</span>}
        </div>
      )}
    </form>
  );
}

function AccountInfo({ user, role }: { user: any; role: string }) {
  return (
    <div className='card p-6 space-y-4'>
      <div>
        <div className='label'>Adresse courriel</div>
        <div className='text-ink'>{user?.email || '—'}</div>
      </div>
      <div>
        <div className='label'>Rôle</div>
        <span className={role === 'admin' ? 'badge-accent' : 'badge-info'}>
          {role === 'admin' ? 'Administrateur' : 'Client'}
        </span>
      </div>
      <p className='text-sm text-muted'>
        Pour modifier votre mot de passe, déconnectez-vous puis utilisez « Mot de passe oublié » à la page de connexion.
      </p>
    </div>
  );
}

function LocalizationInfo() {
  return (
    <div className='card p-6 space-y-3 text-sm'>
      <h3 className='font-semibold text-base'>Localisation québécoise</h3>
      <p className='text-muted'>Gestia est entièrement configuré pour le Québec. Ces paramètres ne peuvent pas être modifiés.</p>
      <ul className='space-y-2 mt-2'>
        <li className='flex justify-between border-b border-line pb-2'><span className='text-muted'>Langue</span><span>Français (Québec)</span></li>
        <li className='flex justify-between border-b border-line pb-2'><span className='text-muted'>Devise</span><span>Dollar canadien (CAD $)</span></li>
        <li className='flex justify-between border-b border-line pb-2'><span className='text-muted'>Format de date</span><span>30 avril 2026</span></li>
        <li className='flex justify-between border-b border-line pb-2'><span className='text-muted'>Format d'heure</span><span>13 h 30</span></li>
        <li className='flex justify-between border-b border-line pb-2'><span className='text-muted'>Format de nombre</span><span>1 234,56</span></li>
        <li className='flex justify-between border-b border-line pb-2'><span className='text-muted'>TPS</span><span>5 %</span></li>
        <li className='flex justify-between'><span className='text-muted'>TVQ</span><span>9,975 %</span></li>
      </ul>
    </div>
  );
}
