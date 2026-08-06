import './Main.css';
import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router';
import { useAuth, logout } from 'wasp/client/auth';
import { Toaster } from 'react-hot-toast';
import AppLayout from './AppLayout';
import { LuBan } from 'react-icons/lu';

// Le routeur est généré par Wasp et ne nous permet pas d'activer les `future`
// flags de react-router v6. On masque les avertissements de dépréciation v7
// puisque l'API publique de Wasp n'expose pas ces options.

const PUBLIC_PATHS = new Set([
  '/',
  '/connexion',
  '/inscription',
  '/mot-de-passe-oublie',
  '/reinitialiser-mot-de-passe',
  '/verification-courriel',
  '/confidentialite',
  '/conditions',
  '/contact',
]);

export default function App() {
  const location = useLocation();
  const { data: user, isLoading } = useAuth();

  // Register Syncfusion license on client only (avoids SSR CJS interop issues)
  useEffect(() => {
    import('@syncfusion/ej2-base').then((m: any) => {
      const fn = m.registerLicense ?? m.default?.registerLicense;
      fn?.('Ngo9BigBOggjHTQxAR8/V1JHaF5cWWdCf1FpRmJGdld5fUVHYVZUTXxaS00DNHVRdkdlWXpedXRcRGFZUkZ3WkZWYEo=');
    });

    // Suppress React Router v6→v7 deprecation warnings (Wasp doesn't expose future flags)
    if (!(window as any).__waspRRWarnPatched) {
      (window as any).__waspRRWarnPatched = true;
      const originalWarn = console.warn;
      console.warn = (...args: any[]) => {
        const msg = typeof args[0] === 'string' ? args[0] : '';
        if (msg.includes('React Router Future Flag Warning')) return;
        originalWarn.apply(console, args);
      };
    }
  }, []);

  const isPublic = PUBLIC_PATHS.has(location.pathname);

  const toaster = (
    <Toaster
      position='bottom-right'
      // La bulle de messagerie occupe ce coin : la voie des toasts remonte
      // au-dessus d'elle, puis au-dessus du panneau quand il est ouvert. La
      // variable est posée par SmsWidget et définie dans Main.css ; sa valeur par
      // défaut garde le comportement d'origine là où il n'y a pas de widget.
      containerStyle={{ bottom: 'var(--gestia-toast-bottom, 20px)', right: 20 }}
      toastOptions={{
        duration: 4000,
        style: { fontSize: '0.875rem' },
        success: { iconTheme: { primary: '#16a34a', secondary: '#fff' } },
        error: { iconTheme: { primary: '#dc2626', secondary: '#fff' } },
      }}
    />
  );

  if (isPublic) {
    return <>{toaster}<Outlet /></>;
  }

  if (isLoading) {
    return (
      <div className='min-h-screen flex items-center justify-center text-muted'>
        Chargement…
      </div>
    );
  }

  if (!user) {
    return <>{toaster}<Outlet /></>;
  }

  // Project detail and client portal pages render without the sidebar
  const isFullPage = /^\/projets\/[^/]+/.test(location.pathname) || /^\/portail\//.test(location.pathname);

  // Cancelled users are blocked from all protected pages
  if ((user as any).status === 'cancelled' && !isFullPage) {
    return (
      <>
        {toaster}
        <div className='min-h-screen bg-canvas flex items-center justify-center px-4'>
          <div className='max-w-md w-full text-center'>
            <div className='w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-6'>
              <LuBan size={28} className='text-red-600' />
            </div>
            <h1 className='text-2xl font-bold text-ink mb-3'>Compte suspendu</h1>
            <p className='text-muted mb-6 leading-relaxed'>
              Votre accès à la plateforme a été suspendu. Pour rétablir votre compte, veuillez effectuer votre paiement et contacter notre équipe.
            </p>
            <div className='flex flex-col gap-3 items-center'>
              <p className='text-sm text-muted'>
                Contactez-nous :{' '}
                <a href='mailto:info@trifali.com' className='text-accent hover:underline'>
                  info@trifali.com
                </a>
              </p>
              <button onClick={() => logout()} className='btn-ghost text-sm text-muted'>
                Se déconnecter
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  if (isFullPage) {
    return <>{toaster}<div className='min-h-screen bg-canvas'><Outlet /></div></>;
  }

  return (
    <>
      {toaster}
      <AppLayout user={user}>
        <Outlet />
      </AppLayout>
    </>
  );
}
