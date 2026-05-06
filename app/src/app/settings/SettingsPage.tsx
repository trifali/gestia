import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import {
  useQuery,
  useAction,
  getCurrentCompany,
  updateCompany,
  uploadCompanyLogo,
  removeCompanyLogo,
  updateCompanyBrand,
  updateCompanyModalities,
  getCompanyBrandAssets,
  getPriceItems,
  createPriceItem,
  updatePriceItem,
  deletePriceItem,
  getPriceCategories,
  createPriceCategory,
  deletePriceCategory,
  getGoogleCalendarStatus,
  getGoogleCalendarAuthUrl,
  disconnectGoogleCalendar,
  getDocumentTemplates,
  createDocumentTemplate,
  updateDocumentTemplate,
  deleteDocumentTemplate,
  generateTemplateContent,
} from 'wasp/client/operations';
import { useAuth } from 'wasp/client/auth';
import { PAYMENT_METHOD_OPTIONS } from '../payments/PaymentForm';
import { LuPlus, LuSearch, LuFileText, LuCopy, LuEye, LuX, LuChevronRight, LuWand } from 'react-icons/lu';
import { PageHeader, IconBtn, EditIcon, TrashIcon, useConfirm, Modal, EmptyState } from '../../client/ui';
import { MagicInput, MagicTextarea } from '../../client/magic';
import { formatCurrency } from '../../shared/format';
import { TEMPLATE_TYPES, TEMPLATE_VARIABLE_GROUPS, getTemplatePdfBase64 } from './templatePdf';
import MDEditor from '@uiw/react-md-editor';
import type { BrandAssets } from '../documents/pdf';

export default function SettingsPage() {
  const { data: user } = useAuth();
  const { data: company, isLoading } = useQuery(getCurrentCompany);
  const [tab, setTab] = useState<'entreprise' | 'marque' | 'catalogue' | 'modalites' | 'compte' | 'localisation' | 'integrations' | 'modeles'>('entreprise');

  if (isLoading) return <div className='text-muted'>Chargement…</div>;
  if (!company) return <div className='text-muted'>Aucune entreprise associée.</div>;

  const isAdmin = (user as any)?.role === 'admin' || user?.isAdmin;

  return (
    <>
      <PageHeader title='Paramètres' subtitle='Configurez votre entreprise et votre compte.' />

      <div className='flex gap-2 border-b border-line mb-6 overflow-x-auto'>
        <TabButton active={tab === 'entreprise'} onClick={() => setTab('entreprise')}>Entreprise</TabButton>
        <TabButton active={tab === 'marque'} onClick={() => setTab('marque')}>Marque</TabButton>
        <TabButton active={tab === 'catalogue'} onClick={() => setTab('catalogue')}>Catalogue</TabButton>
        <TabButton active={tab === 'modeles'} onClick={() => setTab('modeles')}>Modèles</TabButton>
        <TabButton active={tab === 'modalites'} onClick={() => setTab('modalites')}>Modalités</TabButton>
        <TabButton active={tab === 'compte'} onClick={() => setTab('compte')}>Compte</TabButton>
        <TabButton active={tab === 'localisation'} onClick={() => setTab('localisation')}>Localisation</TabButton>
        <TabButton active={tab === 'integrations'} onClick={() => setTab('integrations')}>Intégrations</TabButton>
      </div>

      {tab === 'entreprise' && <CompanyForm company={company} canEdit={!!isAdmin} />}
      {tab === 'integrations' && <IntegrationsTab />}
      {tab === 'marque' && <BrandForm company={company} canEdit={!!isAdmin} />}
      {tab === 'catalogue' && <PriceList canEdit={!!isAdmin} />}
      {tab === 'modeles' && <TemplateList canEdit={!!isAdmin} company={company} />}
      {tab === 'modalites' && <ModalitesForm company={company} canEdit={!!isAdmin} />}
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

function BrandForm({ company, canEdit }: { company: any; canEdit: boolean }) {
  const { data: assets, refetch } = useQuery(getCompanyBrandAssets);
  const [primary, setPrimary] = useState<string>(company.brandPrimaryColor || '#0E0E0E');
  const [accent, setAccent] = useState<string>(company.brandAccentColor || '#D4A24C');
  const [textColor, setTextColor] = useState<string>(company.brandTextColor || '#1A1A1A');
  const [tagline, setTagline] = useState<string>(company.brandTagline || '');
  const [signature, setSignature] = useState<string>(company.brandEmailSignature || '');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setPrimary(company.brandPrimaryColor || '#0E0E0E');
    setAccent(company.brandAccentColor || '#D4A24C');
    setTextColor(company.brandTextColor || '#1A1A1A');
    setTagline(company.brandTagline || '');
    setSignature(company.brandEmailSignature || '');
  }, [company?.id]);

  const onSave = async () => {
    if (!canEdit) return;
    setSaving(true);
    try {
      await updateCompanyBrand({
        brandPrimaryColor: primary,
        brandAccentColor: accent,
        brandTextColor: textColor,
        brandTagline: tagline,
        brandEmailSignature: signature,
      });
      toast.success('Identité visuelle enregistrée');
    } catch (err: any) {
      toast.error(err?.message || 'Une erreur est survenue');
    } finally {
      setSaving(false);
    }
  };

  const onPickFile = () => fileRef.current?.click();

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      toast.error('Image trop volumineuse (max 8 Mo)');
      return;
    }
    if (!/^image\//.test(file.type)) {
      toast.error('Veuillez sélectionner une image');
      return;
    }
    setUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      await uploadCompanyLogo({ dataUrl });
      await refetch();
      toast.success('Logo téléversé');
    } catch (err: any) {
      toast.error(err?.message || 'Échec du téléversement');
    } finally {
      setUploading(false);
    }
  };

  const onRemoveLogo = async () => {
    setUploading(true);
    try {
      await removeCompanyLogo();
      await refetch();
      toast.success('Logo retiré');
    } catch (err: any) {
      toast.error(err?.message || 'Erreur');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className='space-y-6'>
      {!canEdit && (
        <p className='text-sm text-muted bg-canvas-200 px-3 py-2 rounded-lg'>
          Seul un administrateur peut modifier ces paramètres.
        </p>
      )}

      <div className='card p-6'>
        <h3 className='font-semibold text-base mb-1'>Logo de l’entreprise</h3>
        <p className='text-sm text-muted mb-4'>
          Le logo est optimisé et converti en JPG avant d’être enregistré. Il apparaît sur les soumissions et factures PDF.
        </p>

        <div className='flex items-start gap-6'>
          <div
            className='w-40 h-40 rounded-lg border border-line flex items-center justify-center overflow-hidden'
            style={{ backgroundColor: primary }}
          >
            {assets?.logoDataUrl ? (
              <img src={assets.logoDataUrl} alt='Logo' className='max-w-full max-h-full object-contain' />
            ) : (
              <span className='text-xs' style={{ color: accent }}>Aucun logo</span>
            )}
          </div>

          <div className='flex flex-col gap-2'>
            <input
              ref={fileRef}
              type='file'
              accept='image/*'
              className='hidden'
              onChange={onFileChange}
            />
            <button
              type='button'
              className='btn-secondary'
              onClick={onPickFile}
              disabled={!canEdit || uploading}
            >
              {uploading ? 'Téléversement…' : assets?.logoDataUrl ? 'Remplacer le logo' : 'Téléverser un logo'}
            </button>
            {assets?.logoDataUrl && canEdit && (
              <button type='button' className='btn-ghost text-danger' onClick={onRemoveLogo} disabled={uploading}>
                Retirer le logo
              </button>
            )}
            <p className='text-xs text-muted max-w-xs'>
              Formats acceptés : PNG, JPG, WebP. Recommandation : fond transparent ou clair, ≤ 2 Mo.
            </p>
          </div>
        </div>
      </div>

      <div className='card p-6'>
        <h3 className='font-semibold text-base mb-1'>Couleurs de la marque</h3>
        <p className='text-sm text-muted mb-4'>
          Utilisées pour la couverture des PDF, les accents et le filigrane « brouillon ».
        </p>

        <div className='grid md:grid-cols-3 gap-4'>
          <ColorField label='Couleur principale' value={primary} onChange={setPrimary} disabled={!canEdit} hint='Fond foncé de la couverture' />
          <ColorField label='Couleur d’accent' value={accent} onChange={setAccent} disabled={!canEdit} hint='Lignes, titres, totaux' />
          <ColorField label='Couleur du texte' value={textColor} onChange={setTextColor} disabled={!canEdit} hint='Texte courant' />
        </div>

        <div className='mt-6'>
          <label className='label'>Slogan / signature (optionnel)</label>
          <MagicInput
            type='text'
            className='input'
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            placeholder='Ex. Gestion intelligente pour entreprises québécoises'
            disabled={!canEdit}
          />
        </div>

        <div className='mt-6'>
          <label className='label'>Signature de courriel</label>
          <p className='text-xs text-muted mb-2'>
            Ajoutée à la fin des courriels d'envoi de soumissions et factures.
            Laissez vide pour utiliser uniquement le nom de l'entreprise.
          </p>
          <MagicTextarea
            className='input min-h-[120px] resize-y'
            rows={5}
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
            placeholder={'Cordialement,\nMarie Tremblay\n514-555-1234\ninfo@entreprise.com'}
            disabled={!canEdit}
          />
        </div>

        {canEdit && (
          <div className='mt-6 flex items-center gap-3'>
            <button type='button' className='btn-primary' onClick={onSave} disabled={saving}>
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        )}
      </div>

      <div className='card p-6'>
        <h3 className='font-semibold text-base mb-3'>Aperçu</h3>
        <div className='rounded-lg overflow-hidden border border-line'>
          {/* Cover (primary background, white + accent) */}
          <div style={{ backgroundColor: primary }}>
            <div className='p-8'>
              {assets?.logoDataUrl && (
                <img src={assets.logoDataUrl} alt='' className='h-12 mb-6 object-contain' />
              )}
              <div className='text-xs font-bold uppercase tracking-widest mb-2' style={{ color: accent }}>
                Devis · Aperçu
              </div>
              <div className='text-3xl font-bold text-white leading-tight'>
                Proposition
                <br />
                <span style={{ color: accent }}>commerciale.</span>
              </div>
              {tagline && <div className='mt-3 italic text-sm' style={{ color: '#F5EFE1' }}>{tagline}</div>}
            </div>
          </div>
          {/* Body preview (white background, uses textColor) */}
          <div className='bg-white p-8 border-t border-line'>
            <div className='text-[10px] font-bold uppercase tracking-widest mb-1' style={{ color: accent }}>
              Détails
            </div>
            <div className='text-lg font-bold mb-2' style={{ color: textColor }}>
              Émetteur & destinataire
            </div>
            <div className='h-0.5 w-12 mb-4' style={{ backgroundColor: accent }} />
            <p className='text-sm leading-relaxed' style={{ color: textColor }}>
              Voici un aperçu du texte courant tel qu’il apparaîtra dans vos
              soumissions et factures. La <strong>couleur du texte</strong> s’applique
              aux titres de section, aux noms d’articles et aux montants.
            </p>
            <div className='mt-4 grid grid-cols-3 text-xs'>
              <div className='py-2 px-3 font-bold' style={{ backgroundColor: primary, color: '#FFFFFF' }}>
                Description
              </div>
              <div className='py-2 px-3 font-bold text-right' style={{ backgroundColor: primary, color: '#FFFFFF' }}>
                Qté
              </div>
              <div className='py-2 px-3 font-bold text-right' style={{ backgroundColor: primary, color: '#FFFFFF' }}>
                Total
              </div>
              <div className='py-2 px-3' style={{ color: textColor }}>Service exemple</div>
              <div className='py-2 px-3 text-right' style={{ color: textColor }}>1</div>
              <div className='py-2 px-3 text-right font-bold' style={{ color: textColor }}>1 250,00 $</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ColorField({
  label, value, onChange, disabled, hint,
}: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean; hint?: string }) {
  return (
    <div>
      <label className='label'>{label}</label>
      <div className='flex items-center gap-2'>
        <input
          type='color'
          className='h-10 w-12 rounded border border-line cursor-pointer disabled:cursor-not-allowed'
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
        <MagicInput
          magic={false}
          type='text'
          className='input flex-1 font-mono text-sm'
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          spellCheck={false}
          autoComplete='off'
          autoCorrect='off'
          autoCapitalize='off'
        />
      </div>
      {hint && <p className='text-xs text-muted mt-1'>{hint}</p>}
    </div>
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
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
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

  const categories = Array.from(new Set(list.map((it) => it.category).filter(Boolean))) as string[];

  const filtered = list.filter((it) => {
    const q = search.toLowerCase();
    const matchesSearch =
      !q ||
      it.name.toLowerCase().includes(q) ||
      (it.description?.toLowerCase().includes(q) ?? false) ||
      (it.code?.toLowerCase().includes(q) ?? false);
    const matchesCategory = !filterCategory || it.category === filterCategory;
    const matchesStatus =
      !filterStatus ||
      (filterStatus === 'actif' ? it.isActive : !it.isActive);
    return matchesSearch && matchesCategory && matchesStatus;
  });

  return (
    <div className='space-y-3'>
      {Dialog}
      <div className='flex justify-between items-center'>
        <p className='text-xs text-muted'>
          Définissez votre grille tarifaire — réutilisable dans les soumissions et factures.
        </p>
        {canEdit && (
          <button className='btn-primary' onClick={() => setCreating(true)}>
            <LuPlus size={16} className='mr-1.5' /> Nouvel article
          </button>
        )}
      </div>

      {list.length > 0 && (
        <div className='flex gap-2 items-center'>
          <div className='relative flex-1'>
            <LuSearch size={14} className='absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none' />
            <input
              type='text'
              placeholder='Rechercher par nom, description…'
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className='input pl-8 w-full text-sm'
            />
          </div>
          {categories.length > 0 && (
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className='input text-sm w-44 shrink-0'
            >
              <option value=''>Toutes catégories</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          )}
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className='input text-sm w-36 shrink-0'
          >
            <option value=''>Tous statuts</option>
            <option value='actif'>Actif</option>
            <option value='inactif'>Inactif</option>
          </select>
          {(search || filterCategory || filterStatus) && (
            <button
              className='btn-ghost text-sm shrink-0'
              onClick={() => { setSearch(''); setFilterCategory(''); setFilterStatus(''); }}
            >
              Réinitialiser
            </button>
          )}
        </div>
      )}

      {list.length === 0 ? (
        <EmptyState
          title='Aucun article tarifaire'
          description='Ajoutez vos services et produits avec leurs prix unitaires pour les réutiliser facilement.'
          action={canEdit ? <button className='btn-primary' onClick={() => setCreating(true)}>Ajouter un article</button> : undefined}
        />
      ) : filtered.length === 0 ? (
        <div className='text-sm text-muted text-center py-8'>Aucun article ne correspond à votre recherche.</div>
      ) : (
        <div className='card overflow-hidden'>
          <table className='w-full text-sm'>
            <thead className='bg-canvas-100 text-muted'>
              <tr>
                <th className='text-left px-3 py-2 font-medium text-xs'>Code</th>
                <th className='text-left px-3 py-2 font-medium text-xs'>Nom</th>
                <th className='text-left px-3 py-2 font-medium text-xs'>Catégorie</th>
                <th className='text-right px-3 py-2 font-medium text-xs'>Prix unitaire</th>
                <th className='text-center px-3 py-2 font-medium text-xs'>Statut</th>
                {canEdit && <th className='px-3 py-2 w-20'></th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((it) => (
                <tr key={it.id} className='border-t border-line'>
                  <td className='px-3 py-2 text-muted text-xs'>{it.code || '—'}</td>
                  <td className='px-3 py-2'>
                    <div className='font-medium text-ink text-sm'>{it.name}</div>
                    {it.description && <div className='text-xs text-muted'>{it.description}</div>}
                  </td>
                  <td className='px-3 py-2 text-muted text-xs'>{it.category || '—'}</td>
                  <td className='px-3 py-2 text-right tabular-nums text-sm'>{formatCurrency(it.unitPrice)}</td>
                  <td className='px-3 py-2 text-center'>
                    <span className={it.isActive ? 'badge-success' : 'badge-neutral'}>
                      {it.isActive ? 'Actif' : 'Inactif'}
                    </span>
                  </td>
                  {canEdit && (
                    <td className='px-3 py-2'>
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

// ─── Modalités ─────────────────────────────────────────────────────────────

function ModalitesForm({ company, canEdit }: { company: any; canEdit: boolean }) {
  const [depositRequired, setDepositRequired] = useState<boolean>(company.modalityDepositRequired ?? false);
  const [downpaymentPercent, setDownpaymentPercent] = useState<string>(
    company.modalityDownpaymentPercent != null ? String(company.modalityDownpaymentPercent) : ''
  );
  const [paymentMethods, setPaymentMethods] = useState<string[]>(() => {
    try { return JSON.parse(company.modalityPaymentMethods || '[]'); } catch { return []; }
  });
  const [paymentTermsDays, setPaymentTermsDays] = useState<string>(
    company.modalityPaymentTermsDays != null ? String(company.modalityPaymentTermsDays) : ''
  );
  const [lateFeePercent, setLateFeePercent] = useState<string>(
    company.modalityLateFeePercent != null ? String(company.modalityLateFeePercent) : ''
  );
  const [warrantyMonths, setWarrantyMonths] = useState<string>(
    company.modalityWarrantyMonths != null ? String(company.modalityWarrantyMonths) : ''
  );
  const [warrantyDetails, setWarrantyDetails] = useState<string>(company.modalityWarrantyDetails || '');
  const [cancellationPolicy, setCancellationPolicy] = useState<string>(company.modalityCancellationPolicy || '');
  const [contractTerms, setContractTerms] = useState<string>(company.modalityContractTerms || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDepositRequired(company.modalityDepositRequired ?? false);
    setDownpaymentPercent(company.modalityDownpaymentPercent != null ? String(company.modalityDownpaymentPercent) : '');
    setPaymentMethods(() => {
      try { return JSON.parse(company.modalityPaymentMethods || '[]'); } catch { return []; }
    });
    setPaymentTermsDays(company.modalityPaymentTermsDays != null ? String(company.modalityPaymentTermsDays) : '');
    setLateFeePercent(company.modalityLateFeePercent != null ? String(company.modalityLateFeePercent) : '');
    setWarrantyMonths(company.modalityWarrantyMonths != null ? String(company.modalityWarrantyMonths) : '');
    setWarrantyDetails(company.modalityWarrantyDetails || '');
    setCancellationPolicy(company.modalityCancellationPolicy || '');
    setContractTerms(company.modalityContractTerms || '');
  }, [company?.id]);

  const toggleMethod = (value: string) => {
    setPaymentMethods((prev) =>
      prev.includes(value) ? prev.filter((m) => m !== value) : [...prev, value]
    );
  };

  const onSave = async () => {
    if (!canEdit) return;
    setSaving(true);
    try {
      await updateCompanyModalities({
        modalityDepositRequired: depositRequired,
        modalityDownpaymentPercent: downpaymentPercent !== '' ? Number(downpaymentPercent) : null,
        modalityPaymentMethods: JSON.stringify(paymentMethods),
        modalityPaymentTermsDays: paymentTermsDays !== '' ? Number(paymentTermsDays) : null,
        modalityLateFeePercent: lateFeePercent !== '' ? Number(lateFeePercent) : null,
        modalityWarrantyMonths: warrantyMonths !== '' ? Number(warrantyMonths) : null,
        modalityWarrantyDetails: warrantyDetails.trim() || null,
        modalityCancellationPolicy: cancellationPolicy.trim() || null,
        modalityContractTerms: contractTerms.trim() || null,
      });
      toast.success('Modalités enregistrées');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: any) {
      toast.error(err?.message || 'Une erreur est survenue');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className='space-y-6'>
      {!canEdit && (
        <p className='text-sm text-muted bg-canvas-200 px-3 py-2 rounded-lg'>
          Seul un administrateur peut modifier ces paramètres.
        </p>
      )}

      {/* Acompte & conditions de paiement */}
      <div className='card p-6 space-y-5'>
        <div>
          <h3 className='font-semibold text-base'>Acompte &amp; conditions de paiement</h3>
          <p className='text-sm text-muted mt-0.5'>
            Définissez vos exigences d'acompte et les délais de paiement appliqués à vos devis et factures.
          </p>
        </div>

        <label className='flex items-center gap-3 text-sm cursor-pointer select-none'>
          <input
            type='checkbox'
            className='h-4 w-4'
            checked={depositRequired}
            onChange={(e) => setDepositRequired(e.target.checked)}
            disabled={!canEdit}
          />
          <span>Acompte requis avant le début des travaux</span>
        </label>

        <div className='grid md:grid-cols-3 gap-4'>
          <div>
            <label className='label'>Pourcentage d'acompte (%)</label>
            <div className='relative'>
              <input
                type='number'
                className='input pr-8'
                min='0'
                max='100'
                step='1'
                value={downpaymentPercent}
                onChange={(e) => setDownpaymentPercent(e.target.value)}
                placeholder='Ex. 25'
                disabled={!canEdit || !depositRequired}
              />
              <span className='absolute right-3 top-1/2 -translate-y-1/2 text-muted text-sm pointer-events-none'>%</span>
            </div>
          </div>
          <div>
            <div className='flex items-center gap-1.5 mb-1'>
              <label className='label mb-0'>Délai de paiement (jours nets)</label>
              <span
                className='inline-flex items-center justify-center w-4 h-4 rounded-full bg-canvas-200 text-muted text-[10px] font-bold cursor-default'
                title='Nombre de jours accordés au client pour régler la facture, dès la fin des travaux.'
              >?</span>
            </div>
            <div className='relative'>
              <input
                type='number'
                className='input pr-12'
                min='0'
                step='1'
                value={paymentTermsDays}
                onChange={(e) => setPaymentTermsDays(e.target.value)}
                placeholder='Ex. 30'
                disabled={!canEdit}
              />
              <span className='absolute right-3 top-1/2 -translate-y-1/2 text-muted text-sm pointer-events-none'>jours</span>
            </div>
          </div>
          <div>
            <div className='flex items-center gap-1.5 mb-1'>
              <label className='label mb-0'>Frais de retard (% par mois)</label>
              <span
                className='inline-flex items-center justify-center w-4 h-4 rounded-full bg-canvas-200 text-muted text-[10px] font-bold cursor-default'
                title='Taux appliqué mensuellemement sur le solde impayé après la date limite du paiement final.'
              >?</span>
            </div>
            <div className='relative'>
              <input
                type='number'
                className='input pr-8'
                min='0'
                step='0.1'
                value={lateFeePercent}
                onChange={(e) => setLateFeePercent(e.target.value)}
                placeholder='Ex. 1.5'
                disabled={!canEdit}
              />
              <span className='absolute right-3 top-1/2 -translate-y-1/2 text-muted text-sm pointer-events-none'>%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Modes de paiement acceptés */}
      <div className='card p-6 space-y-4'>
        <div>
          <h3 className='font-semibold text-base'>Modes de paiement acceptés</h3>
          <p className='text-sm text-muted mt-0.5'>
            Cochez les modes de paiement que vous acceptez. Ces informations peuvent être affichées sur vos factures.
          </p>
        </div>
        <div className='grid grid-cols-2 md:grid-cols-3 gap-3'>
          {PAYMENT_METHOD_OPTIONS.map((opt) => (
            <label key={opt.value} className='flex items-center gap-2.5 text-sm cursor-pointer select-none'>
              <input
                type='checkbox'
                className='h-4 w-4'
                checked={paymentMethods.includes(opt.value)}
                onChange={() => toggleMethod(opt.value)}
                disabled={!canEdit}
              />
              {opt.label}
            </label>
          ))}
        </div>
      </div>

      {/* Garanties */}
      <div className='card p-6 space-y-4'>
        <div>
          <h3 className='font-semibold text-base'>Garanties</h3>
          <p className='text-sm text-muted mt-0.5'>
            Définissez la durée et les conditions de vos garanties sur les travaux réalisés.
          </p>
        </div>
        <div className='grid md:grid-cols-2 gap-4'>
          <div>
            <label className='label'>Durée de garantie (mois)</label>
            <div className='relative'>
              <input
                type='number'
                className='input pr-12'
                min='0'
                step='1'
                value={warrantyMonths}
                onChange={(e) => setWarrantyMonths(e.target.value)}
                placeholder='Ex. 12'
                disabled={!canEdit}
              />
              <span className='absolute right-3 top-1/2 -translate-y-1/2 text-muted text-sm pointer-events-none'>mois</span>
            </div>
          </div>
        </div>
        <div>
          <label className='label'>Détails de la garantie</label>
          <MagicTextarea
            className='input min-h-[100px] resize-y'
            rows={3}
            value={warrantyDetails}
            onChange={(e) => setWarrantyDetails(e.target.value)}
            placeholder="Ex. La garantie couvre les défauts de main-d'œuvre et de matériaux pour une période de 12 mois à compter de la date de fin des travaux."
            disabled={!canEdit}
          />
        </div>
      </div>

      {/* Politique d'annulation */}
      <div className='card p-6 space-y-4'>
        <div>
          <h3 className='font-semibold text-base'>Politique d'annulation</h3>
          <p className='text-sm text-muted mt-0.5'>
            Décrivez les conditions d'annulation applicables à vos contrats.
          </p>
        </div>
        <MagicTextarea
          className='input min-h-[100px] resize-y'
          rows={4}
          value={cancellationPolicy}
          onChange={(e) => setCancellationPolicy(e.target.value)}
          placeholder="Ex. Toute annulation effectuée moins de 48 heures avant le début des travaux entraîne la retenue de l'acompte."
          disabled={!canEdit}
        />
      </div>

      {/* Conditions générales */}
      <div className='card p-6 space-y-4'>
        <div>
          <h3 className='font-semibold text-base'>Conditions générales</h3>
          <p className='text-sm text-muted mt-0.5'>
            Clauses additionnelles incluses dans vos soumissions et contrats.
          </p>
        </div>
        <MagicTextarea
          className='input min-h-[140px] resize-y'
          rows={6}
          value={contractTerms}
          onChange={(e) => setContractTerms(e.target.value)}
          placeholder="Ex. Les prix sont en dollars canadiens et ne comprennent pas les taxes applicables. Le client est responsable de l'obtention des permis requis…"
          disabled={!canEdit}
        />
      </div>

      {canEdit && (
        <div className='flex items-center gap-3 pb-2'>
          <button type='button' className='btn-primary' onClick={onSave} disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
          {saved && <span className='text-sm text-success'>✓ Enregistré</span>}
        </div>
      )}
    </div>
  );
}

// ─── Intégrations ──────────────────────────────────────────────────────────

function IntegrationsTab() {
  const { data: status, isLoading, refetch } = useQuery(getGoogleCalendarStatus);
  const calStatus = status as { connected: boolean; email: string | null } | undefined;
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const onConnect = async () => {
    setConnecting(true);
    try {
      const { url } = await getGoogleCalendarAuthUrl();
      window.location.href = url;
    } catch (err: any) {
      toast.error(err?.message || 'Impossible de démarrer l\'autorisation Google');
      setConnecting(false);
    }
  };

  const onDisconnect = async () => {
    if (!window.confirm('Déconnecter Google Agenda ? Les rencontres existantes resteront dans votre calendrier, mais les nouvelles ne seront plus synchronisées.')) return;
    setDisconnecting(true);
    try {
      await disconnectGoogleCalendar();
      await refetch();
      toast.success('Google Agenda déconnecté');
    } catch (err: any) {
      toast.error(err?.message || 'Erreur lors de la déconnexion');
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <div className='space-y-4 max-w-xl'>
      <div className='card p-6'>
        <div className='flex items-start gap-4'>
          {/* Google Calendar icon */}
          <div className='shrink-0 w-12 h-12 rounded-xl flex items-center justify-center bg-white border border-line shadow-sm'>
            <svg viewBox='0 0 48 48' className='w-7 h-7' aria-hidden='true'>
              <path fill='#1976d2' d='M36 36H12V12h24v24z'/>
              <path fill='#fff' d='M26 22h-4v-4h-2v4h-4v2h4v4h2v-4h4v-2z'/>
              <path fill='#fbc02d' d='M36 12l-6-6H12v6h24z'/>
              <path fill='#e53935' d='M12 12l-6 6v18l6 6h24v-6H12V12z'/>
              <path fill='#1976d2' d='M42 18l-6-6v6h6z'/>
              <path fill='#1565c0' d='M42 18h-6v18H12v6h24l6-6V18z'/>
            </svg>
          </div>
          <div className='flex-1 min-w-0'>
            <h3 className='font-semibold text-base'>Google Agenda</h3>
            <p className='text-sm text-muted mt-1'>
              Synchronisez automatiquement vos rencontres Gestia avec votre Google Agenda.
              La connexion est requise pour créer, modifier ou supprimer des rencontres.
            </p>

            {isLoading ? (
              <div className='mt-3 text-sm text-muted'>Vérification…</div>
            ) : calStatus?.connected ? (
              <div className='mt-3 space-y-2'>
                <div className='flex items-center gap-2 text-sm'>
                  <span className='inline-block w-2 h-2 rounded-full bg-success'></span>
                  <span className='text-success font-medium'>Connecté</span>
                  {calStatus.email && <span className='text-muted'>— {calStatus.email}</span>}
                </div>
                <button
                  type='button'
                  className='btn-secondary text-danger border-danger/30 hover:bg-danger/5'
                  onClick={onDisconnect}
                  disabled={disconnecting}
                >
                  {disconnecting ? 'Déconnexion…' : 'Déconnecter Google Agenda'}
                </button>
              </div>
            ) : (
              <div className='mt-3'>
                <button
                  type='button'
                  className='btn-primary'
                  onClick={onConnect}
                  disabled={connecting}
                >
                  {connecting ? 'Redirection vers Google…' : 'Connecter Google Agenda'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className='rounded-lg border border-line bg-canvas-100 px-4 py-3 text-sm text-muted'>
        <strong className='text-ink'>Note :</strong> Gestia utilise les autorisations minimales nécessaires (écriture d'événements uniquement).
        Votre compte Google n'est jamais partagé avec des tiers.
        Vous pouvez révoquer l'accès à tout moment depuis{' '}
        <a href='https://myaccount.google.com/permissions' target='_blank' rel='noreferrer' className='text-accent underline'>
          myaccount.google.com/permissions
        </a>.
      </div>
    </div>
  );
}

// ─── TemplateList ─────────────────────────────────────────────────────────────

type DocTemplate = {
  id: string;
  name: string;
  type: string;
  description: string | null;
  content: string;
  isActive: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
};

function TemplateList({ canEdit, company }: { canEdit: boolean; company: any }) {
  const { data: templates, isLoading, refetch } = useQuery(getDocumentTemplates);
  const createTmpl = useAction(createDocumentTemplate);
  const deleteTmpl = useAction(deleteDocumentTemplate);
  const [editing, setEditing] = useState<DocTemplate | null>(null);
  const [creating, setCreating] = useState(false);
  const [previewing, setPreviewing] = useState<DocTemplate | null>(null);
  const { data: brand } = useQuery(getCompanyBrandAssets);
  const { ask, Dialog } = useConfirm();

  const onDelete = async (t: DocTemplate) => {
    const ok = await ask(`Supprimer le modèle « ${t.name} » ?`);
    if (!ok) return;
    try {
      await deleteTmpl({ id: t.id });
      toast.success('Modèle supprimé');
      refetch();
    } catch (e: any) {
      toast.error(e?.message || 'Erreur');
    }
  };

  if (isLoading) return <div className='text-muted'>Chargement…</div>;
  const list = (templates || []) as DocTemplate[];

  return (
    <div className='space-y-4'>
      {Dialog}
      <div className='flex justify-between items-center'>
        <p className='text-xs text-muted'>
          Créez des modèles réutilisables (contrats, cahiers des charges, …) avec des variables dynamiques.
        </p>
        {canEdit && (
          <button className='btn-primary' onClick={() => setCreating(true)}>
            <LuPlus size={16} className='mr-1.5' /> Nouveau modèle
          </button>
        )}
      </div>

      {list.length === 0 ? (
        <EmptyState
          title='Aucun modèle'
          description='Créez votre premier modèle de document pour le réutiliser avec vos clients.'
          action={canEdit ? <button className='btn-primary' onClick={() => setCreating(true)}>Créer un modèle</button> : undefined}
        />
      ) : (
        <div className='card overflow-hidden'>
          <table className='w-full text-sm'>
            <thead className='bg-canvas-100 text-muted'>
              <tr>
                <th className='text-left px-3 py-2 font-medium text-xs'>Nom</th>
                <th className='text-left px-3 py-2 font-medium text-xs'>Type</th>
                <th className='text-center px-3 py-2 font-medium text-xs'>Statut</th>
                <th className='px-3 py-2 w-28' />
              </tr>
            </thead>
            <tbody>
              {list.map((t) => (
                <tr
                  key={t.id}
                  className='border-t border-line hover:bg-canvas-50 cursor-pointer'
                  onClick={() => setEditing(t)}
                >
                  <td className='px-3 py-2'>
                    <div className='font-medium text-ink flex items-center gap-1.5'>
                      <LuFileText size={13} className='text-muted shrink-0' />
                      {t.name}
                    </div>
                    {t.description && <div className='text-xs text-muted mt-0.5'>{t.description}</div>}
                  </td>
                  <td className='px-3 py-2 text-xs text-muted'>
                    {TEMPLATE_TYPES.find((x) => x.value === t.type)?.label ?? t.type}
                  </td>
                  <td className='px-3 py-2 text-center'>
                    <span className={t.isActive ? 'badge-success' : 'badge-neutral'}>
                      {t.isActive ? 'Actif' : 'Inactif'}
                    </span>
                  </td>
                  <td className='px-3 py-2' onClick={(e) => e.stopPropagation()}>
                      <div className='flex justify-end gap-1'>
                        <IconBtn title='Aperçu PDF' onClick={() => setPreviewing(t)}><LuEye size={14} /></IconBtn>
                        <IconBtn title='Modifier' onClick={() => setEditing(t)}><EditIcon /></IconBtn>
                        {canEdit && <IconBtn variant='danger' title='Supprimer' onClick={() => onDelete(t)}><TrashIcon /></IconBtn>}
                      </div>
                    </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(creating || editing) && (
        <TemplateEditorModal
          initial={editing}
          canEdit={canEdit}
          company={company}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); refetch(); }}
        />
      )}
      {previewing && (
        <TemplatePdfPreviewModal
          template={previewing}
          brand={(brand as BrandAssets) ?? null}
          companyName={company?.name ?? ''}
          onClose={() => setPreviewing(null)}
        />
      )}
    </div>
  );
}

// ─── TemplatePdfPreviewModal ──────────────────────────────────────────────────

function TemplatePdfPreviewModal({
  template,
  brand,
  companyName,
  onClose,
}: {
  template: DocTemplate;
  brand: BrandAssets;
  companyName: string;
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let blobUrl: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        const b64 = await getTemplatePdfBase64(template, brand, companyName);
        if (cancelled) return;
        const bytes = atob(b64);
        const arr = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
        blobUrl = URL.createObjectURL(new Blob([arr], { type: 'application/pdf' }));
        setUrl(blobUrl);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Erreur de génération');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [template, brand, companyName]);

  return createPortal(
    <div className='fixed inset-0 bg-ink/50 backdrop-blur-sm z-50 flex items-center justify-center p-4'>
      <div className='bg-white rounded-2xl shadow-2xl flex flex-col w-full max-w-4xl h-[90vh] overflow-hidden'>
        <div className='shrink-0 px-5 py-3 border-b border-line flex items-center justify-between'>
          <div className='flex items-center gap-2'>
            <LuEye size={16} className='text-muted' />
            <span className='font-semibold'>{template.name}</span>
            <span className='text-xs text-muted'>— Aperçu PDF</span>
          </div>
          <button onClick={onClose} className='text-muted hover:text-ink'><LuX size={18} /></button>
        </div>
        <div className='flex-1 min-h-0 relative'>
          {loading && (
            <div className='absolute inset-0 flex items-center justify-center text-sm text-muted'>
              Génération du PDF…
            </div>
          )}
          {error && (
            <div className='absolute inset-0 flex items-center justify-center text-sm text-red-500'>
              {error}
            </div>
          )}
          {url && <iframe src={url} className='w-full h-full' title='Aperçu PDF' />}
        </div>
        <div className='shrink-0 px-5 py-3 border-t border-line flex justify-end bg-canvas-50'>
          <button className='btn-secondary' onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── TemplateEditorModal ──────────────────────────────────────────────────────

const DEFAULT_CONTENT = `# Titre du document

Bonjour **{{client.name}}**,

Ce document a été préparé le {{date}} par {{company.name}}.

---

## 1. Objet

Décrivez ici l'objet du document.

## 2. Conditions

- Condition 1
- Condition 2
- Condition 3

## 3. Signatures

| Partie | Nom | Date | Signature |
|--------|-----|------|-----------|
| Prestataire | {{company.name}} | {{date}} | |
| Client | {{client.name}} | {{date_signed}} | |
`;

function TemplateEditorModal({
  initial,
  canEdit,
  company,
  onClose,
  onSaved,
}: {
  initial: DocTemplate | null;
  canEdit: boolean;
  company: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = !initial;
  const createTmpl = useAction(createDocumentTemplate);
  const updateTmpl = useAction(updateDocumentTemplate);
  const { data: brand } = useQuery(getCompanyBrandAssets);

  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState(initial?.type ?? 'contract');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [content, setContent] = useState(initial?.content ?? DEFAULT_CONTENT);
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const generateContent = useAction(generateTemplateContent);

  const handleGenerate = async () => {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    try {
      const hasContent = content.trim().length > 0;
      const res = await generateContent({ description: aiPrompt.trim(), type, currentContent: hasContent ? content : undefined }) as { markdown: string };
      setContent(res.markdown);
      setAiOpen(false);
      setAiPrompt('');
      toast.success(hasContent ? 'Document mis à jour !' : 'Contenu généré !');
    } catch (e: any) {
      toast.error(e?.message || 'Erreur de génération IA');
    } finally {
      setAiLoading(false);
    }
  };

  const mdEditorRef = useRef<{ textarea?: HTMLTextAreaElement }>(null);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);

  const insertVariable = useCallback((key: string) => {
    const el = mdEditorRef.current?.textarea;
    if (!el) {
      setContent((c) => c + key);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const newContent = content.slice(0, start) + key + content.slice(end);
    setContent(newContent);
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + key.length, start + key.length);
    }, 0);
  }, [content]);

  const handlePreview = async () => {
    if (previewing) return;
    setPreviewing(true);
    try {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      const b64 = await getTemplatePdfBase64(
        { name: name || 'Modèle', type, description, content },
        (brand as BrandAssets) ?? null,
        company?.name ?? 'Mon Entreprise',
      );
      const bytes = atob(b64);
      const arr = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
      const blob = new Blob([arr], { type: 'application/pdf' });
      setPreviewUrl(URL.createObjectURL(blob));
    } catch (e: any) {
      toast.error(e?.message || 'Erreur lors de la génération du PDF');
    } finally {
      setPreviewing(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) { toast.error('Nom requis'); return; }
    setSaving(true);
    try {
      if (isNew) {
        await createTmpl({ name, type, description, content, isActive });
        toast.success('Modèle créé');
      } else {
        await updateTmpl({ id: initial!.id, name, type, description, content, isActive });
        toast.success('Modèle sauvegardé');
      }
      onSaved();
    } catch (e: any) {
      toast.error(e?.message || 'Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className='fixed inset-0 bg-ink/40 backdrop-blur-sm z-40 flex items-center justify-center p-4'>
      <div
        className='bg-white rounded-2xl shadow-2xl flex flex-col w-full max-w-6xl max-h-[92vh] overflow-hidden'
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className='shrink-0 px-5 py-3 border-b border-line flex items-center gap-3'>
          <LuFileText size={16} className='text-muted shrink-0' />
          <input
            className='flex-1 font-semibold text-lg bg-transparent outline-none placeholder:text-muted/50'
            placeholder='Nom du modèle…'
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!canEdit}
          />
          <div className='flex items-center gap-2 shrink-0'>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className='input text-sm py-1 h-8'
              disabled={!canEdit}
            >
              {TEMPLATE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <label className='flex items-center gap-1.5 text-xs text-muted cursor-pointer select-none'>
              <input
                type='checkbox'
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className='checkbox checkbox-sm'
                disabled={!canEdit}
              />
              Actif
            </label>
            <button onClick={onClose} className='text-muted hover:text-ink p-1' aria-label='Fermer'>
              <LuX size={18} />
            </button>
          </div>
        </div>

        {/* Body: editor + variables + preview */}
        <div className='flex flex-1 min-h-0 overflow-hidden'>
          {/* Editor panel */}
          <div className='flex flex-col flex-1 min-w-0 border-r border-line'>
            <div className='px-4 py-2 border-b border-line'>
              <input
                className='w-full text-xs text-muted bg-transparent outline-none placeholder:text-muted/40'
                placeholder='Description courte (optionnel)…'
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={!canEdit}
              />
            </div>
            <div className='flex-1 min-h-0 overflow-auto relative' data-color-mode='light'>
              <MDEditor
                ref={mdEditorRef as any}
                value={content}
                onChange={(v) => setContent(v ?? '')}
                preview='edit'
                hideToolbar={false}
                height='100%'
                visibleDragbar={false}
                style={{ height: '100%', borderRadius: 0, border: 'none', boxShadow: 'none' }}
                textareaProps={{ placeholder: 'Rédigez votre modèle en Markdown…', spellCheck: false, disabled: !canEdit }}
              />
              {/* AI generation button */}
              <button
                onClick={() => setAiOpen((v) => !v)}
                title='Générer avec l’IA'
                className='absolute bottom-3 right-3 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500 text-white text-xs font-semibold shadow-lg hover:bg-amber-600 transition-colors'
              >
                <LuWand size={13} />
                IA
              </button>
              {/* AI popover */}
              {aiOpen && (() => {
                const hasContent = content.trim().length > 0;
                return (
                <div className='absolute bottom-12 right-3 z-20 w-80 bg-white rounded-xl shadow-2xl border border-line p-4 flex flex-col gap-3'>
                  <div className='flex items-center justify-between'>
                    <div className='flex items-center gap-1.5'>
                      <LuWand size={14} className='text-amber-500' />
                      <p className='text-sm font-semibold'>{hasContent ? 'Modifier avec l’IA' : 'Générer avec l’IA'}</p>
                    </div>
                    <button onClick={() => setAiOpen(false)} className='text-muted hover:text-ink'><LuX size={14} /></button>
                  </div>
                  <p className='text-xs text-muted'>
                    {hasContent
                      ? 'Décrivez la modification souhaitée. L’IA conservera le reste du document intact.'
                      : 'Décrivez le document souhaité. L’IA utilisera les variables dynamiques et les modalités de votre entreprise.'}
                  </p>
                  <textarea
                    className='border border-line rounded-lg p-2.5 text-sm resize-none h-24 outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400'
                    placeholder={hasContent
                      ? `Ex : Ajoute une section sur la propriété intellectuelle… / Modifie la clause de paiement pour ajouter les taxes…`
                      : `Ex : Contrat de maintenance mensuelle pour site WordPress, 6 mois, avec clause de renouvellement automatique…`}
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleGenerate(); }}
                    autoFocus
                  />
                  <p className='text-xs text-muted/70'>Type actif : <span className='font-medium text-ink'>{TEMPLATE_TYPES.find(t => t.value === type)?.label ?? type}</span></p>
                  <div className='flex justify-end gap-2'>
                    <button className='btn-ghost text-xs' onClick={() => setAiOpen(false)}>Annuler</button>
                    <button
                      className='flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-semibold hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
                      onClick={handleGenerate}
                      disabled={aiLoading || !aiPrompt.trim()}
                    >
                      {aiLoading ? (
                        <><span className='animate-spin inline-block w-3 h-3 border-2 border-white/40 border-t-white rounded-full' /> {hasContent ? 'Modification…' : 'Génération…'}</>
                      ) : (
                        <><LuWand size={12} /> {hasContent ? 'Modifier' : 'Générer'}</>
                      )}
                    </button>
                  </div>
                </div>
                );
              })()}
            </div>
          </div>

          {/* Variables sidebar */}
          <div className='w-60 shrink-0 flex flex-col overflow-y-auto border-r border-line bg-canvas-50'>
            <div className='px-3 py-2.5 border-b border-line'>
              <p className='text-xs font-semibold text-muted uppercase tracking-wide'>Variables</p>
              <p className='text-xs text-muted mt-0.5'>Cliquez pour insérer</p>
            </div>
            <div className='flex-1 overflow-y-auto py-1'>
              {TEMPLATE_VARIABLE_GROUPS.map((group) => (
                <div key={group.group} className='mb-1'>
                  <p className='px-3 py-1.5 text-xs font-medium text-muted uppercase tracking-wide'>{group.group}</p>
                  {group.vars.map((v) => (
                    <button
                      key={v.key}
                      onClick={() => insertVariable(v.key)}
                      disabled={!canEdit}
                      title={`Exemple : ${v.sample}`}
                      className='w-full flex items-center justify-between px-3 py-1 text-left hover:bg-canvas-100 disabled:opacity-50 disabled:cursor-not-allowed group'
                    >
                      <span className='text-xs text-ink truncate'>{v.label}</span>
                      <LuCopy size={10} className='text-muted opacity-0 group-hover:opacity-100 shrink-0 ml-1' />
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* PDF preview panel — wider split pane */}
          {previewUrl && (
            <div className='w-[45%] shrink-0 flex flex-col border-l border-line bg-canvas-50'>
              <div className='px-3 py-2.5 border-b border-line flex items-center justify-between'>
                <p className='text-xs font-semibold text-muted'>Aperçu PDF</p>
                <button onClick={() => { URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }} className='text-muted hover:text-ink'>
                  <LuX size={14} />
                </button>
              </div>
              <iframe src={previewUrl} className='flex-1 w-full' title='Aperçu PDF' />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className='shrink-0 px-5 py-3 border-t border-line flex justify-between items-center bg-canvas-50'>
          <p className='text-xs text-muted'>
            Syntaxe Markdown supportée · Les <span className='text-amber-600 font-medium'>{'{{variables}}'}</span> sont surlignées dans l'aperçu
          </p>
          <div className='flex gap-2'>
            <button className='btn-ghost' onClick={onClose}>Annuler</button>
            <button
              className='btn-secondary flex items-center gap-1.5'
              onClick={handlePreview}
              disabled={previewing}
            >
              <LuEye size={14} />
              {previewing ? 'Génération…' : 'Aperçu PDF'}
            </button>
            {canEdit && (
              <button className='btn-primary' onClick={handleSave} disabled={saving}>
                {saving ? 'Sauvegarde…' : isNew ? 'Créer' : 'Sauvegarder'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

