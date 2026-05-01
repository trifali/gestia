import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <div className='min-h-screen flex flex-col items-center justify-center px-6 text-center'>
      <div className='text-7xl font-bold text-ink'>404</div>
      <h1 className='mt-4 text-2xl font-semibold'>Page introuvable</h1>
      <p className='mt-2 text-muted max-w-md'>La page que vous recherchez n'existe pas ou a été déplacée.</p>
      <Link to='/' className='btn-primary mt-6'>Retour à l'accueil</Link>
    </div>
  );
}
