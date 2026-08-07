// Formulaire de recherche Google Maps — la branche « Recherche Google Maps » de
// l'assistant « Nouveau tableau », et la vue en lecture seule des critères d'un
// tableau existant.
//
// Extrait de `LeadSearchPage.tsx` sans être réécrit : l'assistant a besoin de ce
// formulaire, et le faire importer depuis la page qui l'affiche aurait créé un
// cycle. Le comportement est inchangé.

import { useState } from 'react';
import toast from 'react-hot-toast';
import { LuLoader, LuSearch } from 'react-icons/lu';
import { searchLeads } from 'wasp/client/operations';

const PROVINCES = ['QC', 'ON', 'BC', 'AB', 'MB', 'SK', 'NS', 'NB', 'NL', 'PE', 'YT', 'NT', 'NU'];

const BUSINESS_TYPE_SUGGESTIONS = [
  'Agence web', 'Agence marketing', 'Agence de communication',
  'Plombier', 'Électricien', 'Menuisier', 'Peintre', 'Entrepreneur général',
  'Architecte', 'Designer intérieur',
  'Restaurant', 'Café', 'Boulangerie', 'Traiteur',
  'Avocat', 'Notaire', 'Comptable', 'Fiscaliste',
  'Médecin', 'Dentiste', 'Physiothérapeute', 'Chiropraticien',
  'Salon de coiffure', 'Salon de beauté', 'Spa',
  'Photographe', 'Vidéaste', 'Studio photo',
  'Mécanicien auto', 'Carrossier',
  'École privée', 'Centre de formation', 'Tuteur',
  'Gym', 'Centre de conditionnement physique', 'Studio yoga',
  'Nettoyage commercial', 'Service de ménage',
  'Fleuriste', 'Boutique cadeaux', 'Librairie',
  'Hôtel', 'Auberge', 'Chalet à louer',
  'Clinique vétérinaire',
  'Garderie', 'CPE',
];

export const RADIUS_OPTIONS = [
  { value: 5000, label: '5 km' },
  { value: 10000, label: '10 km' },
  { value: 25000, label: '25 km' },
  { value: 50000, label: '50 km' },
];

const RATING_OPTIONS = [
  { value: 0, label: 'Aucune restriction' },
  { value: 3, label: '3+ étoiles' },
  { value: 4, label: '4+ étoiles' },
  { value: 4.5, label: '4.5+ étoiles' },
];

const MAX_RESULTS_OPTIONS = [
  { value: 10, label: '10 résultats' },
  { value: 20, label: '20 résultats' },
  { value: 40, label: '40 résultats (plus lent)' },
];

// ─── Default form state ───────────────────────────────────────────────────────

export function defaultForm() {
  return {
    title: '',
    description: '',
    purpose: '',
    businessType: '',
    city: '',
    province: 'QC',
    radius: 10000,
    minRating: 0,
    requireWebsite: false,
    maxResults: 20,
    language: 'fr',
  };
}

// ─── New search form ──────────────────────────────────────────────────────────

export function SearchForm({ onClose, onDone, initialValues, readOnly, footerExtra }: { onClose: () => void; onDone: (id: string) => void; initialValues?: Partial<ReturnType<typeof defaultForm>>; readOnly?: boolean; footerExtra?: React.ReactNode }) {
  const [form, setForm] = useState(() => ({ ...defaultForm(), ...initialValues }));
  const [loading, setLoading] = useState(false);

  function set(field: string, value: any) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.businessType.trim()) return toast.error('Type d\'entreprise requis');
    if (!form.city.trim()) return toast.error('Ville requise');
    setLoading(true);
    try {
      // @ts-ignore -- purpose added, Wasp will regen types on restart
      const result = await searchLeads({
        title: form.title || `${form.businessType} — ${form.city}`,
        description: form.description || undefined,
        // @ts-ignore
        purpose: form.purpose || undefined,
        filters: {
          businessType: form.businessType,
          city: form.city,
          province: form.province,
          radius: form.radius,
          minRating: form.minRating,
          requireWebsite: form.requireWebsite,
          maxResults: form.maxResults,
          language: form.language,
        },
      });
      toast.success(`${result.leads?.length ?? 0} prospect(s) trouvé(s)`);
      onDone(result.id);
    } catch (err: any) {
      const msg = err?.message ?? 'Erreur lors de la recherche';
      if (msg.includes('GOOGLE_PLACES_API_KEY')) {
        toast.error('Clé API Google Places manquante. Ajoutez GOOGLE_PLACES_API_KEY dans .env.server.', { duration: 6000 });
      } else {
        toast.error(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className='space-y-5'>
      {!readOnly && (
        <p className='text-sm text-muted'>
          Décrivez le type d'entreprise que vous cherchez, choisissez la zone géographique et
          lancez la prospection. Gestia extraira les coordonnées depuis Google Maps.
        </p>
      )}

      {/* Title */}
      <div>
        <label className='label'>Nom de la recherche</label>
        <input
          className='input'
          placeholder='Ex : Plombiers Montréal — Mai 2026'
          value={form.title}
          onChange={e => set('title', e.target.value)}
          disabled={readOnly}
        />
        {!readOnly && <p className='text-xs text-muted mt-1'>Laissez vide pour générer automatiquement.</p>}
      </div>

      {!readOnly && (
        <div>
          <label className='label'>Objectif de la prospection <span className='text-muted font-normal'>(optionnel)</span></label>
          <input
            className='input'
            placeholder='Ex : proposer une refonte de site web, offrir un audit SEO gratuit…'
            value={form.purpose}
            onChange={e => set('purpose', e.target.value)}
          />
          <p className='text-xs text-muted mt-1'>L’IA utilisera cet objectif pour rédiger les courriels de tous les prospects de cette recherche.</p>
        </div>
      )}

      <hr className='border-line' />

      {/* Business type */}
      <div>
        <label className='label required'>Type d'entreprise / secteur</label>
        <input
          className='input'
          list='biz-types'
          placeholder='Ex : Agence web, Plombier, Restaurant…'
          value={form.businessType}
          onChange={e => set('businessType', e.target.value)}
          required={!readOnly}
          disabled={readOnly}
        />
        {!readOnly && (
          <>
            <datalist id='biz-types'>
              {BUSINESS_TYPE_SUGGESTIONS.map(s => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <p className='text-xs text-muted mt-1'>
              Soyez précis : "Agence web React" donne de meilleurs résultats que "agence".
            </p>
          </>
        )}
      </div>

      {/* Location */}
      <div className='grid grid-cols-2 gap-3'>
        <div>
          <label className='label required'>Ville</label>
          <input
            className='input'
            placeholder='Ex : Montréal, Québec, Laval'
            value={form.city}
            onChange={e => set('city', e.target.value)}
            required={!readOnly}
            disabled={readOnly}
          />
        </div>
        <div>
          <label className='label'>Province</label>
          <select className='input' value={form.province} onChange={e => set('province', e.target.value)} disabled={readOnly}>
            {PROVINCES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>

      {/* Radius + Rating */}
      <div className='grid grid-cols-2 gap-3'>
        <div>
          <label className='label'>Rayon de recherche</label>
          <select className='input' value={form.radius} onChange={e => set('radius', Number(e.target.value))} disabled={readOnly}>
            {RADIUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className='label'>Note Google minimale</label>
          <select className='input' value={form.minRating} onChange={e => set('minRating', Number(e.target.value))} disabled={readOnly}>
            {RATING_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      {/* Max results + language */}
      <div className='grid grid-cols-2 gap-3'>
        <div>
          <label className='label'>Nombre de résultats</label>
          <select className='input' value={form.maxResults} onChange={e => set('maxResults', Number(e.target.value))} disabled={readOnly}>
            {MAX_RESULTS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className='label'>Langue des résultats</label>
          <select className='input' value={form.language} onChange={e => set('language', e.target.value)} disabled={readOnly}>
            <option value='fr'>Français</option>
            <option value='en'>Anglais</option>
          </select>
        </div>
      </div>

      {/* Toggles */}
      <label className={`flex items-center gap-3 select-none ${readOnly ? 'cursor-default opacity-70' : 'cursor-pointer'}`}>
        <input
          type='checkbox'
          className='w-4 h-4 rounded accent-accent-600'
          checked={form.requireWebsite}
          onChange={e => set('requireWebsite', e.target.checked)}
          disabled={readOnly}
        />
        <span className='text-sm'>Exiger un site web (filtre les entreprises sans site)</span>
      </label>

      {!readOnly && (
        <div className='bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800'>
          <p className='font-medium mb-1'>Ce que Gestia va extraire :</p>
          <ul className='space-y-0.5 text-blue-700 text-xs list-disc list-inside'>
            <li>Nom, adresse, ville, code postal</li>
            <li>Numéro de téléphone (si disponible sur Google)</li>
            <li>Site web + tentative d'extraction du courriel</li>
            <li>Note Google et nombre d'avis</li>
            <li>Lien Google Maps</li>
          </ul>
        </div>
      )}

      {loading && (
        <div className='flex items-center gap-3 text-sm text-accent-700 bg-accent-50 border border-accent-200 rounded-xl p-4'>
          <LuLoader size={18} className='animate-spin shrink-0' />
          <span>Recherche en cours… cela peut prendre jusqu'à 30 secondes selon le nombre de résultats.</span>
        </div>
      )}

      <div className='flex justify-end items-center gap-2 pt-2'>
        {footerExtra}
        <button type='button' className='btn-secondary' onClick={onClose} disabled={loading}>
          {readOnly ? 'Fermer' : 'Annuler'}
        </button>
        {!readOnly && (
          <button type='submit' className='btn-primary gap-2' disabled={loading}>
            {loading ? <LuLoader size={16} className='animate-spin' /> : <LuSearch size={16} />}
            Lancer la prospection
          </button>
        )}
      </div>
    </form>
  );
}
