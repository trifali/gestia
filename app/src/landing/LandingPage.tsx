import { Link } from 'react-router-dom';
import { useAuth } from 'wasp/client/auth';

const FEATURES = [
  { title: 'Clients', desc: 'Centralisez vos contacts, prospects et clients actifs en un seul endroit.' },
  { title: 'Projets', desc: 'Suivez l\'avancement, les échéances et le budget de chaque mandat.' },
  { title: 'Soumissions', desc: 'Préparez des soumissions claires avec calculs automatiques de TPS et TVQ.' },
  { title: 'Factures', desc: 'Facturez en CAD, suivez les statuts et envoyez des rappels en français.' },
  { title: 'Paiements', desc: 'Enregistrez les paiements reçus et gardez un œil sur les soldes impayés.' },
  { title: 'Rencontres', desc: 'Planifiez vos rencontres avec clients et collaborateurs.' },
  { title: 'Automatisations', desc: 'Réduisez le travail répétitif grâce à des règles intelligentes.' },
  { title: 'Multi-utilisateurs', desc: 'Donnez accès à votre équipe avec des rôles administrateur et client.' },
];

export default function LandingPage() {
  const { data: user } = useAuth();
  const ctaTo = user ? '/tableau-de-bord' : '/inscription';

  return (
    <div className='min-h-screen bg-canvas text-ink'>
      <header className='border-b border-line bg-white/70 backdrop-blur sticky top-0 z-30'>
        <div className='max-w-6xl mx-auto px-6 h-16 flex items-center justify-between'>
          <Link to='/' className='flex items-center gap-2'>
            <span className='inline-flex w-8 h-8 rounded-lg bg-ink text-white items-center justify-center font-bold'>G</span>
            <span className='font-semibold'>Gestia</span>
          </Link>
          <nav className='hidden md:flex items-center gap-6 text-sm'>
            <a href='#fonctionnalites' className='text-muted hover:text-ink'>Fonctionnalités</a>
            <a href='#quebec' className='text-muted hover:text-ink'>Pour le Québec</a>
            <a href='#tarifs' className='text-muted hover:text-ink'>Tarifs</a>
          </nav>
          <div className='flex items-center gap-2'>
            {user ? (
              <Link to='/tableau-de-bord' className='btn-primary'>Mon tableau de bord</Link>
            ) : (
              <>
                <Link to='/connexion' className='btn-ghost'>Connexion</Link>
                <Link to='/inscription' className='btn-primary'>Commencer</Link>
              </>
            )}
          </div>
        </div>
      </header>

      <section className='max-w-6xl mx-auto px-6 pt-20 pb-16 text-center'>
        <span className='inline-block px-3 py-1 rounded-full bg-accent-50 text-accent-700 text-xs font-medium'>
          Conçu au Québec · 100% en français
        </span>
        <h1 className='mt-6 text-4xl md:text-6xl font-semibold tracking-tight leading-[1.05]'>
          La gestion de votre entreprise,<br />
          <span className='text-accent'>simple et intelligente.</span>
        </h1>
        <p className='mt-6 text-lg text-muted max-w-2xl mx-auto'>
          Gestia regroupe vos clients, projets, soumissions, factures et paiements dans une seule plateforme pensée pour les entreprises québécoises.
        </p>
        <div className='mt-8 flex items-center justify-center gap-3'>
          <Link to={ctaTo} className='btn-accent text-base px-5 py-3'>Commencer gratuitement</Link>
          <a href='#fonctionnalites' className='btn-secondary text-base px-5 py-3'>Voir les fonctionnalités</a>
        </div>
        <p className='mt-4 text-xs text-muted'>Aucune carte de crédit requise · TPS et TVQ calculées automatiquement</p>
      </section>

      <section id='fonctionnalites' className='max-w-6xl mx-auto px-6 py-20'>
        <div className='text-center mb-12'>
          <h2 className='text-3xl font-semibold'>Tout ce qu'il vous faut pour bien gérer</h2>
          <p className='mt-3 text-muted max-w-2xl mx-auto'>Une suite complète, sans dispersion, en français.</p>
        </div>
        <div className='grid md:grid-cols-2 lg:grid-cols-4 gap-4'>
          {FEATURES.map((f) => (
            <div key={f.title} className='card p-5'>
              <div className='w-9 h-9 rounded-lg bg-accent-50 text-accent-700 flex items-center justify-center font-semibold'>•</div>
              <h3 className='mt-4 font-semibold'>{f.title}</h3>
              <p className='mt-1 text-sm text-muted'>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section id='quebec' className='bg-ink text-white'>
        <div className='max-w-6xl mx-auto px-6 py-20 grid md:grid-cols-2 gap-10 items-center'>
          <div>
            <h2 className='text-3xl font-semibold'>Pensé pour le Québec</h2>
            <p className='mt-4 text-white/70'>
              Devise canadienne, formats de date québécois, calculs de TPS (5 %) et TVQ (9,975 %) intégrés, terminologie locale (soumissions, NEQ, etc.). Tout est prêt dès la première connexion.
            </p>
            <ul className='mt-6 space-y-2 text-white/80 text-sm'>
              <li>• Devise CAD ($) avec format québécois</li>
              <li>• Dates : 30 avril 2026 · Heures : 13 h 30</li>
              <li>• Nombres : 1 234,56</li>
              <li>• Multi-entreprises et multi-utilisateurs</li>
            </ul>
          </div>
          <div className='card bg-white text-ink p-6'>
            <div className='text-xs text-muted'>Aperçu d'une facture</div>
            <div className='mt-1 text-lg font-semibold'>F-2026-0042</div>
            <div className='text-sm text-muted'>Émise le 30 avril 2026</div>
            <div className='mt-4 space-y-2 text-sm'>
              <div className='flex justify-between'><span>Sous-total</span><span>1 250,00 $</span></div>
              <div className='flex justify-between'><span>TPS (5 %)</span><span>62,50 $</span></div>
              <div className='flex justify-between'><span>TVQ (9,975 %)</span><span>124,69 $</span></div>
              <div className='flex justify-between font-semibold border-t border-line pt-2 mt-2'><span>Total</span><span>1 437,19 $</span></div>
            </div>
          </div>
        </div>
      </section>

      <section id='tarifs' className='max-w-6xl mx-auto px-6 py-20 text-center'>
        <h2 className='text-3xl font-semibold'>Commencez dès aujourd'hui</h2>
        <p className='mt-3 text-muted'>Inscription en moins de deux minutes. Annulez quand vous voulez.</p>
        <div className='mt-8'>
          <Link to={ctaTo} className='btn-accent text-base px-6 py-3'>Créer mon compte</Link>
        </div>
      </section>

      <footer className='border-t border-line bg-white'>
        <div className='max-w-6xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted'>
          <span>© {new Date().getFullYear()} Gestia · Fait au Québec</span>
          <div className='flex items-center gap-4'>
            <a href='#' className='hover:text-ink'>Confidentialité</a>
            <a href='#' className='hover:text-ink'>Conditions</a>
            <a href='#' className='hover:text-ink'>Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
