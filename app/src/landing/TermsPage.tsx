import { Link } from 'react-router';
import Logo from '../client/Logo';

export default function TermsPage() {
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
        <h1 className='text-3xl font-semibold mb-2'>Conditions d'utilisation</h1>
        <p className='text-sm text-muted mb-10'>Dernière mise à jour : {new Date().toLocaleDateString('fr-CA', { year: 'numeric', month: 'long', day: 'numeric' })}</p>

        <div className='space-y-8 text-sm leading-relaxed text-ink-700'>
          <section>
            <h2 className='text-lg font-semibold text-ink mb-3'>1. Acceptation des conditions</h2>
            <p>
              En créant un compte ou en utilisant Gestia, vous acceptez les présentes conditions
              d'utilisation. Si vous n'acceptez pas ces conditions, veuillez ne pas utiliser le service.
            </p>
          </section>

          <section>
            <h2 className='text-lg font-semibold text-ink mb-3'>2. Description du service</h2>
            <p>
              Gestia est une plateforme de gestion d'entreprise destinée aux professionnels et entreprises
              québécoises. Le service comprend la gestion de clients, projets, soumissions, factures,
              paiements, rencontres et prospection.
            </p>
          </section>

          <section>
            <h2 className='text-lg font-semibold text-ink mb-3'>3. Tarification</h2>
            <p>
              Le service Gestia est offert au tarif de <strong>169,99 $ CAD par mois</strong> par entreprise.
              Ce tarif inclut l'accès à toutes les fonctionnalités, les mises à jour et le support.
              Les taxes applicables (TPS et TVQ) s'ajoutent au montant mensuel. L'abonnement est renouvelé
              automatiquement chaque mois et peut être annulé à tout moment.
            </p>
          </section>

          <section>
            <h2 className='text-lg font-semibold text-ink mb-3'>4. Responsabilités de l'utilisateur</h2>
            <p>
              Vous êtes responsable de la confidentialité de votre mot de passe et de l'exactitude des
              données que vous saisissez. Gestia ne peut être tenu responsable des pertes découlant d'une
              utilisation non autorisée de votre compte.
            </p>
          </section>

          <section>
            <h2 className='text-lg font-semibold text-ink mb-3'>5. Propriété intellectuelle</h2>
            <p>
              Le logiciel Gestia, ses interfaces, son code et sa marque sont la propriété exclusive de
              leurs auteurs. Vous conservez la propriété de toutes les données que vous saisissez dans
              l'application.
            </p>
          </section>

          <section>
            <h2 className='text-lg font-semibold text-ink mb-3'>6. Limitation de responsabilité</h2>
            <p>
              Gestia est fourni "tel quel". Nous ne garantissons pas une disponibilité ininterrompue
              du service. Notre responsabilité est limitée au montant des frais payés au cours des
              trois (3) derniers mois.
            </p>
          </section>

          <section>
            <h2 className='text-lg font-semibold text-ink mb-3'>7. Droit applicable</h2>
            <p>
              Les présentes conditions sont régies par les lois de la province de Québec et les lois
              fédérales canadiennes applicables. Tout litige sera soumis à la juridiction exclusive
              des tribunaux du Québec.
            </p>
          </section>

          <section>
            <h2 className='text-lg font-semibold text-ink mb-3'>8. Contact</h2>
            <p>
              Pour toute question relative aux présentes conditions, contactez-nous à{' '}
              <a href='mailto:info@trifali.com' className='text-accent hover:underline'>
                info@trifali.com
              </a>.
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
