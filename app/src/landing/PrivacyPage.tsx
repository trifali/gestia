import { Link } from 'react-router';
import Logo from '../client/Logo';

export default function PrivacyPage() {
  return (
    <div className='min-h-screen bg-canvas text-ink'>
      <header className='border-b border-line bg-white/80 backdrop-blur sticky top-0 z-30'>
        <div className='max-w-6xl mx-auto px-6 h-16 flex items-center justify-between'>
          <Link to='/' className='flex items-center gap-2'>
            <Logo height={32} />
          </Link>
          <div className='flex items-center gap-2'>
            <Link to='/connexion' className='btn-ghost'>Connexion</Link>
            <Link to='/#contact' className='btn-primary'>Demander une démo</Link>
          </div>
        </div>
      </header>

      <div className='max-w-3xl mx-auto px-6 py-16'>
        <h1 className='text-3xl font-semibold mb-2'>Politique de confidentialité</h1>
        <p className='text-sm text-muted mb-10'>Dernière mise à jour : {new Date().toLocaleDateString('fr-CA', { year: 'numeric', month: 'long', day: 'numeric' })}</p>

        <div className='prose-like space-y-8 text-sm leading-relaxed text-ink-700'>
          <section>
            <h2 className='text-lg font-semibold text-ink mb-3'>1. Collecte de renseignements personnels</h2>
            <p>
              Gestia collecte uniquement les renseignements nécessaires au bon fonctionnement du service,
              notamment : votre adresse courriel, le nom de votre entreprise, et les données que vous
              saisissez vous-même (clients, projets, documents). Aucune donnée n'est vendue à des tiers.
            </p>
          </section>

          <section>
            <h2 className='text-lg font-semibold text-ink mb-3'>2. Utilisation des données</h2>
            <p>
              Vos données sont utilisées uniquement pour vous fournir les services Gestia : gestion des
              clients, projets, factures, paiements et communications. Nous pouvons également utiliser votre
              adresse courriel pour vous envoyer des notifications transactionnelles liées à votre compte.
            </p>
          </section>

          <section>
            <h2 className='text-lg font-semibold text-ink mb-3'>3. Hébergement et sécurité</h2>
            <p>
              Vos données sont hébergées sur des serveurs sécurisés. Nous appliquons des mesures de sécurité
              raisonnables pour protéger vos renseignements contre tout accès non autorisé, divulgation ou
              destruction.
            </p>
          </section>

          <section>
            <h2 className='text-lg font-semibold text-ink mb-3'>4. Cookies</h2>
            <p>
              Gestia utilise des témoins de connexion (cookies) strictement nécessaires au fonctionnement
              de l'authentification et de la session. Aucun cookie publicitaire ou de suivi tiers n'est utilisé.
            </p>
          </section>

          <section>
            <h2 className='text-lg font-semibold text-ink mb-3'>5. Vos droits</h2>
            <p>
              Conformément à la <em>Loi 25</em> (Loi modernisant des dispositions législatives en matière de
              protection des renseignements personnels), vous avez le droit d'accéder à vos données,
              de les corriger ou d'en demander la suppression. Pour exercer ces droits, contactez-nous à{' '}
              <a href='mailto:info@trifali.com' className='text-accent hover:underline'>
                info@trifali.com
              </a>.
            </p>
          </section>

          <section>
            <h2 className='text-lg font-semibold text-ink mb-3'>6. Modifications</h2>
            <p>
              Nous nous réservons le droit de modifier cette politique à tout moment. Les changements
              importants vous seront communiqués par courriel ou par une notification dans l'application.
            </p>
          </section>
        </div>
      </div>

      <footer className='border-t border-line bg-white mt-16'>
        <div className='max-w-6xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted'>
          <span>© {new Date().getFullYear()} Gestia · Fait au Québec</span>
          <div className='flex items-center gap-5'>
            <Link to='/confidentialite' className='hover:text-ink transition-colors'>Confidentialité</Link>
            <Link to='/conditions' className='hover:text-ink transition-colors'>Conditions</Link>
            <Link to='/contact' className='hover:text-ink transition-colors'>Contact</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
