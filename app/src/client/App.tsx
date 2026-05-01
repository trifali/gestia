import './Main.css';
import { Outlet, useLocation } from 'react-router';
import { useAuth } from 'wasp/client/auth';
import { Toaster } from 'react-hot-toast';
import AppLayout from './AppLayout';

// Le routeur est généré par Wasp et ne nous permet pas d'activer les `future`
// flags de react-router v6. On masque les avertissements de dépréciation v7
// puisque l'API publique de Wasp n'expose pas ces options.
if (typeof window !== 'undefined' && !(window as any).__waspRRWarnPatched) {
  (window as any).__waspRRWarnPatched = true;
  const originalWarn = console.warn;
  console.warn = (...args: any[]) => {
    const msg = typeof args[0] === 'string' ? args[0] : '';
    if (msg.includes('React Router Future Flag Warning')) return;
    originalWarn.apply(console, args);
  };
}

const PUBLIC_PATHS = new Set([
  '/',
  '/connexion',
  '/inscription',
  '/mot-de-passe-oublie',
  '/reinitialiser-mot-de-passe',
  '/verification-courriel',
]);

export default function App() {
  const location = useLocation();
  const { data: user, isLoading } = useAuth();

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
