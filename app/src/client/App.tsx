import './Main.css';
import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router';
import { useAuth } from 'wasp/client/auth';
import { Toaster } from 'react-hot-toast';
import AppLayout from './AppLayout';

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

function ToastProvider() {
  return (
    <Toaster
      position='bottom-right'
      toastOptions={{
        duration: 4000,
        style: { fontSize: '0.875rem' },
        success: { iconTheme: { primary: '#16a34a', secondary: '#fff' } },
        error: { iconTheme: { primary: '#dc2626', secondary: '#fff' } },
      }}
    />
  );
}

export { ToastProvider };
