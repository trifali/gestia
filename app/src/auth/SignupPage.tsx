import { Link } from 'react-router-dom';
import { SignupForm } from 'wasp/client/auth';
import { AuthPageLayout } from './AuthPageLayout';

export function Signup() {
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
