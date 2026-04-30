import { Link } from 'react-router-dom';
import { VerifyEmailForm } from 'wasp/client/auth';
import { AuthPageLayout } from '../AuthPageLayout';

export function EmailVerificationPage() {
  return (
    <AuthPageLayout title='Vérification du courriel' subtitle='Confirmez votre adresse pour activer votre compte.'>
      <VerifyEmailForm />
      <div className='mt-4 text-sm text-muted text-center'>
        <Link to='/connexion' className='font-medium text-ink hover:underline'>Retour à la connexion</Link>
      </div>
    </AuthPageLayout>
  );
}
