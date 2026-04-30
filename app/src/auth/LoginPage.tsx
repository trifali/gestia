import { Link } from 'react-router-dom';
import { LoginForm } from 'wasp/client/auth';
import { AuthPageLayout } from './AuthPageLayout';

export default function LoginPage() {
  return (
    <AuthPageLayout title='Bienvenue de retour' subtitle='Connectez-vous à votre espace Gestia'>
      <LoginForm />
      <div className='mt-4 text-sm text-muted text-center'>
        <Link to='/mot-de-passe-oublie' className='hover:text-ink underline-offset-2 hover:underline'>Mot de passe oublié ?</Link>
      </div>
      <div className='mt-2 text-sm text-muted text-center'>
        Pas encore de compte ?{' '}
        <Link to='/inscription' className='font-medium text-ink hover:underline'>Créer un compte</Link>
      </div>
    </AuthPageLayout>
  );
}
