import { Link } from 'react-router';
import { SignupForm } from 'wasp/client/auth';
import { useQuery } from 'wasp/client/operations';
import { getAppConfig } from 'wasp/client/operations';
import { AuthPageLayout } from './AuthPageLayout';

export function Signup() {
  const { data: config, isLoading } = useQuery(getAppConfig);

  if (isLoading) {
    return (
      <AuthPageLayout title='Créer votre compte' subtitle='Commencez gratuitement avec Gestia'>
        <div className='h-24 flex items-center justify-center text-muted text-sm'>Chargement…</div>
      </AuthPageLayout>
    );
  }

  if (config?.signupDisabled) {
    return (
      <AuthPageLayout title='Inscriptions fermées' subtitle='Gestia'>
        <div className='rounded-lg border border-amber-200 bg-amber-50 px-6 py-8 text-center'>
          <p className='text-2xl mb-3'>🔒</p>
          <p className='font-semibold text-amber-800 mb-2'>Les nouvelles inscriptions sont temporairement fermées.</p>
          <p className='text-sm text-amber-700'>Vous possédez déjà un compte ?{' '}
            <Link to='/connexion' className='font-medium underline hover:text-amber-900'>Se connecter</Link>
          </p>
        </div>
      </AuthPageLayout>
    );
  }

  return (
    <AuthPageLayout title='Créer votre compte' subtitle='Commencez gratuitement avec Gestia'>
      <SignupForm />
      <div className='mt-4 text-sm text-muted text-center'>
        Vous avez déjà un compte ?{' '}
        <Link to='/connexion' className='font-medium text-ink hover:underline'>Se connecter</Link>
      </div>
    </AuthPageLayout>
  );
}
