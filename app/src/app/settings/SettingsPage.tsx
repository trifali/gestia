import { useState, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import {
  useQuery,
  getCurrentCompany,
  updateCompany,
  getPriceItems,
  createPriceItem,
  updatePriceItem,
  deletePriceItem,
  getPriceCategories,
  createPriceCategory,
  deletePriceCategory,
} from 'wasp/client/operations';
import { useAuth } from 'wasp/client/auth';
import { LuPlus } from 'react-icons/lu';
import { PageHeader, IconBtn, EditIcon, TrashIcon, useConfirm, Modal, EmptyState } from '../../client/ui';
import { MagicInput, MagicTextarea } from '../../client/magic';
import { formatCurrency } from '../../shared/format';

export default function SettingsPage() {
  const { data: user } = useAuth();
  const { data: company, isLoading } = useQuery(getCurrentCompany);
  const [tab, setTab] = useState<'entreprise' | 'catalogue' | 'compte' | 'localisation'>('entreprise');

  if (isLoading) return <div className='text-muted'>Chargement…</div>;
  if (!company) return <div className='text-muted'>Aucune entreprise associée.</div>;

  const isAdmin = (user as any)?.role === 'admin' || user?.isAdmin;

  return (
    <>
      <PageHeader title='Paramètres' subtitle='Configurez votre entreprise et votre compte.' />

      <div className='flex gap-2 border-b border-line mb-6'>
        <TabButton active={tab === 'entreprise'} onClick={() => setTab('entreprise')}>Entreprise</TabButton>
        <TabButton active={tab === 'catalogue'} onClick={() => setTab('catalogue')}>Catalogue</TabButton>
        <TabButton active={tab === 'compte'} onClick={() => setTab('compte')}>Compte</TabButton>
        <TabButton active={tab === 'localisation'} onClick={() => setTab('localisation')}>Localisation</TabButton>
      </div>

      {tab === 'entreprise' && <CompanyForm company={company} canEdit={!!isAdmin} />}
      {tab === 'catalogue' && <PriceList canEdit={!!isAdmin} />}
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

  // Ne réinitialise le formulaire que lorsque l'entreprise change vraiment
  // (changement d'id), pas à chaque refetch (ex. retour sur l'onglet du
  // navigateur) — sinon les saisies en cours seraient écrasées.
  useEffect(() => { setForm(company); }, [company?.id]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;
    setSaving(true);
    try {
      const { id, createdAt, updatedAt, _userRole, ...rest } = form;
      await updateCompany(rest);
      toast.success('Entreprise enregistrée');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: any) {
      toast.error(err?.message || 'Une erreur est survenue');
    } finally {
      setSaving(false);
    }
  };

  const field = (label: string, k: string, type: string = 'text', wrapClass?: string) => (
    <div className={wrapClass}>
      <label className='label'>{label}</label>
      <MagicInput
        type={type}
        className='input'
        value={form[k] ?? ''}
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
        {field('Nom commercial', 'name')}
        {field('Raison sociale', 'legalName')}
        {field('Courriel', 'email', 'email')}
        {field('Téléphone', 'phone')}
        {field('Adresse', 'address', 'text', 'md:col-span-2')}
        {field('Ville', 'city')}
        {field('Province', 'province')}
        {field('Code postal', 'postalCode')}
        {field('Pays', 'country')}
        {field('Site web', 'website')}
        {field('NEQ', 'neq')}
        {field('Numéro TPS', 'taxNumberGst')}
        {field('Numéro TVQ', 'taxNumberQst')}
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

// ─── Tarifs ────────────────────────────────────────────────────────────────

type PriceItem = {
  id: string;
  code: string | null;
  name: string;
  description: string | null;
  category: string | null;
  unit: string;
  unitPrice: number;
  isActive: boolean;
};

type PriceForm = {
  code: string;
  name: string;
  description: string;
  category: string;
  unitPrice: string;
  isActive: boolean;
};

const emptyPriceForm: PriceForm = {
  code: '',
  name: '',
  description: '',
  category: '',
  unitPrice: '0',
  isActive: true,
};

function PriceList({ canEdit }: { canEdit: boolean }) {
  const { data: items, isLoading, refetch } = useQuery(getPriceItems);
  const [editing, setEditing] = useState<PriceItem | null>(null);
  const [creating, setCreating] = useState(false);
  const { ask, Dialog } = useConfirm();

  const onDelete = async (item: PriceItem) => {
    const ok = await ask(`Supprimer « ${item.name} » de la grille tarifaire ?`);
    if (!ok) return;
    try {
      await deletePriceItem({ id: item.id });
      toast.success('Article supprimé');
      refetch();
    } catch (e: any) {
      toast.error(e?.message || 'Erreur lors de la suppression');
    }
  };

  if (isLoading) return <div className='text-muted'>Chargement…</div>;

  const list = (items || []) as PriceItem[];

  return (
    <div className='space-y-4'>
      {Dialog}
      <div className='flex justify-between items-center'>
        <p className='text-sm text-muted'>
          Définissez votre grille tarifaire — réutilisable dans les soumissions et factures.
        </p>
        {canEdit && (
          <button className='btn-primary' onClick={() => setCreating(true)}>
            <LuPlus size={16} className='mr-1.5' /> Nouvel article
          </button>
        )}
      </div>

      {list.length === 0 ? (
        <EmptyState
          title='Aucun article tarifaire'
          description='Ajoutez vos services et produits avec leurs prix unitaires pour les réutiliser facilement.'
          action={canEdit ? <button className='btn-primary' onClick={() => setCreating(true)}>Ajouter un article</button> : undefined}
        />
      ) : (
        <div className='card overflow-hidden'>
          <table className='w-full text-sm'>
            <thead className='bg-canvas-100 text-muted'>
              <tr>
                <th className='text-left px-4 py-3 font-medium'>Code</th>
                <th className='text-left px-4 py-3 font-medium'>Nom</th>
                <th className='text-left px-4 py-3 font-medium'>Catégorie</th>
                <th className='text-right px-4 py-3 font-medium'>Prix unitaire</th>
                <th className='text-center px-4 py-3 font-medium'>Statut</th>
                {canEdit && <th className='px-4 py-3 w-24'></th>}
              </tr>
            </thead>
            <tbody>
              {list.map((it) => (
                <tr key={it.id} className='border-t border-line'>
                  <td className='px-4 py-3 text-muted'>{it.code || '—'}</td>
                  <td className='px-4 py-3'>
                    <div className='font-medium text-ink'>{it.name}</div>
                    {it.description && <div className='text-xs text-muted mt-0.5'>{it.description}</div>}
                  </td>
                  <td className='px-4 py-3 text-muted'>{it.category || '—'}</td>
                  <td className='px-4 py-3 text-right tabular-nums'>{formatCurrency(it.unitPrice)}</td>
                  <td className='px-4 py-3 text-center'>
                    <span className={it.isActive ? 'badge-success' : 'badge-neutral'}>
                      {it.isActive ? 'Actif' : 'Inactif'}
                    </span>
                  </td>
                  {canEdit && (
                    <td className='px-4 py-3'>
                      <div className='flex justify-end gap-1'>
                        <IconBtn title='Modifier' onClick={() => setEditing(it)}><EditIcon /></IconBtn>
                        <IconBtn variant='danger' title='Supprimer' onClick={() => onDelete(it)}><TrashIcon /></IconBtn>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(creating || editing) && (
        <PriceFormModal
          initial={editing}
          canEdit={canEdit}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); refetch(); }}
        />
      )}
    </div>
  );
}

function PriceFormModal({
  initial,
  onClose,
  onSaved,
  canEdit,
}: {
  initial: PriceItem | null;
  onClose: () => void;
  onSaved: () => void;
  canEdit: boolean;
}) {
  const { data: rawCategories } = useQuery(getPriceCategories);
  const categories = (rawCategories || []) as Array<{ id: string; name: string }>;
  const [form, setForm] = useState<PriceForm>(
    initial
      ? {
          code: initial.code || '',
          name: initial.name,
          description: initial.description || '',
          category: initial.category || '',
          unitPrice: String(initial.unitPrice),
          isActive: initial.isActive,
        }
      : emptyPriceForm,
  );
  const [saving, setSaving] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        code: form.code.trim() || null,
        name: form.name.trim(),
        description: form.description.trim() || null,
        category: form.category.trim() || null,
        unit: 'unite',
        unitPrice: Number(form.unitPrice),
        isActive: form.isActive,
      };
      if (initial) {
        await updatePriceItem({ id: initial.id, ...payload });
        toast.success('Article modifié');
      } else {
        await createPriceItem(payload);
        toast.success('Article créé');
      }
      onSaved();
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
      title={initial ? 'Modifier l\u2019article' : 'Nouvel article tarifaire'}
      footer={
        <>
          <button className='btn-secondary' onClick={onClose} disabled={saving}>Annuler</button>
          <button className='btn-primary' onClick={onSubmit} disabled={saving || !form.name.trim()}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </>
      }
    >
      <form onSubmit={onSubmit} className='space-y-4'>
        <div className='grid grid-cols-2 gap-4'>
          <div>
            <label className='label'>Code</label>
            <input
              className='input disabled:opacity-50 disabled:cursor-not-allowed'
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              placeholder='SERV-001'
              disabled={!!initial}
            />
          </div>
          <div>
            <label className='label'>Catégorie</label>
            <CategoryCombobox
              value={form.category}
              onChange={(v) => setForm({ ...form, category: v })}
              categories={categories}
              canManage={canEdit}
            />
          </div>
        </div>

        <div>
          <label className='label'>Nom *</label>
          <MagicInput
            className='input'
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </div>

        <div>
          <label className='label'>Description</label>
          <MagicTextarea
            className='input'
            rows={2}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>

        <div>
          <label className='label'>Prix unitaire (CAD) *</label>
          <input
            className='input'
            type='number'
            min='0'
            step='0.01'
            value={form.unitPrice}
            onChange={(e) => setForm({ ...form, unitPrice: e.target.value })}
            required
          />
        </div>

        <label className='flex items-center gap-2 text-sm'>
          <input
            type='checkbox'
            checked={form.isActive}
            onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
          />
          Article actif (disponible dans les soumissions et factures)
        </label>
      </form>
    </Modal>
  );
}

function CategoryCombobox({
  value,
  onChange,
  categories,
  canManage,
}: {
  value: string;
  onChange: (v: string) => void;
  categories: Array<{ id: string; name: string }>;
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const trimmed = value.trim().toLowerCase();
  const filtered = trimmed
    ? categories.filter((c) => c.name.toLowerCase().includes(trimmed))
    : categories;
  const isNew =
    value.trim() !== '' &&
    !categories.some((c) => c.name.toLowerCase() === value.trim().toLowerCase());

  const select = (name: string) => {
    onChange(name);
    setOpen(false);
  };

  const handleAdd = async () => {
    if (!value.trim() || !isNew || busyId === 'new') return;
    setBusyId('new');
    try {
      const cat = await createPriceCategory({ name: value.trim() });
      onChange((cat as any).name);
      toast.success('Catégorie créée');
      setOpen(false);
    } catch (e: any) {
      toast.error(e?.message || 'Erreur');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: string, name: string) => {
    e.preventDefault();
    e.stopPropagation();
    setBusyId(id);
    try {
      await deletePriceCategory({ id });
      if (value.toLowerCase() === name.toLowerCase()) onChange('');
      toast.success('Catégorie supprimée');
    } catch (err: any) {
      toast.error(err?.message || 'Erreur');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className='relative'>
      <input
        className='input'
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        placeholder='Sélectionner ou créer…'
        autoComplete='off'
      />
      {open && (
        <div className='absolute z-50 top-full mt-1 left-0 right-0 bg-white border border-line rounded-xl shadow-lg max-h-52 overflow-y-auto'>
          {filtered.map((c) => (
            <div
              key={c.id}
              className='flex items-center justify-between px-3 py-2 hover:bg-canvas-100 cursor-pointer text-sm group'
              onMouseDown={(e) => { e.preventDefault(); select(c.name); }}
            >
              <span>{c.name}</span>
              {canManage && (
                <button
                  type='button'
                  className='opacity-0 group-hover:opacity-100 text-muted hover:text-danger ml-2 leading-none text-base'
                  onMouseDown={(e) => handleDelete(e, c.id, c.name)}
                  disabled={busyId === c.id}
                  title='Supprimer la catégorie'
                >
                  ×
                </button>
              )}
            </div>
          ))}
          {isNew && (
            <div
              className='px-3 py-2 hover:bg-canvas-100 cursor-pointer text-sm text-accent font-medium border-t border-line'
              onMouseDown={(e) => { e.preventDefault(); handleAdd(); }}
            >
              {busyId === 'new' ? 'Création…' : `+ Créer « ${value.trim()} »`}
            </div>
          )}
          {filtered.length === 0 && !isNew && (
            <div className='px-3 py-2 text-sm text-muted italic'>Aucune catégorie disponible</div>
          )}
        </div>
      )}
    </div>
  );
}
