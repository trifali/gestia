import { Link } from 'react-router-dom';
import { ResetPasswordForm } from 'wasp/client/auth';
import { AuthPageLayout } from '../AuthPageLayout';

export function PasswordResetPage() {
  return (
    <AuthPageLayout title='Nouveau mot de passe' subtitle='Choisissez un nouveau mot de passe sécurisé.'>
      <ResetPasswordForm />
      <div className='mt-4 text-sm text-muted text-center'>
        <Link to='/connexion' className='font-medium text-ink hover:underline'>Retour à la connexion</Link>
      </div>
    </AuthPageLayout>
  );
}
