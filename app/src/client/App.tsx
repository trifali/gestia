import './Main.css';
import { Outlet, useLocation } from 'react-router-dom';
import { useAuth } from 'wasp/client/auth';
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

  if (isPublic) {
    return <Outlet />;
  }

  if (isLoading) {
    return (
      <div className='min-h-screen flex items-center justify-center text-muted'>
        Chargement…
      </div>
    );
  }

  if (!user) {
    return <Outlet />;
  }

  return (
    <AppLayout user={user}>
      <Outlet />
    </AppLayout>
  );
}
