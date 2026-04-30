import { ForgotPasswordForm } from 'wasp/client/auth';
import { AuthPageLayout } from '../AuthPageLayout';

export function RequestPasswordResetPage() {
  return (
    <AuthPageLayout title='Mot de passe oublié' subtitle='Nous vous enverrons un lien de réinitialisation par courriel.'>
      <ForgotPasswordForm />
    </AuthPageLayout>
  );
}
