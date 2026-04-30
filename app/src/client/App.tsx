import './Main.css';
import { Outlet, useLocation } from 'react-router-dom';
import { useAuth } from 'wasp/client/auth';
import AppLayout from './AppLayout';

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
