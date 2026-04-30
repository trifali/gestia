import { type GetVerificationEmailContentFn, type GetPasswordResetEmailContentFn } from 'wasp/server/auth';

export const getVerificationEmailContent: GetVerificationEmailContentFn = ({ verificationLink }) => ({
  subject: 'Vérifiez votre adresse courriel',
  text: `Bonjour,\n\nMerci de vous être inscrit à Gestia. Pour vérifier votre adresse courriel, cliquez sur le lien suivant :\n${verificationLink}\n\nMerci,\nL'équipe Gestia`,
  html: `
    <p>Bonjour,</p>
    <p>Merci de vous être inscrit à <strong>Gestia</strong>. Veuillez confirmer votre adresse courriel en cliquant sur le bouton ci-dessous :</p>
    <p><a href="${verificationLink}" style="display:inline-block;padding:10px 16px;background:#0A0A0B;color:#fff;text-decoration:none;border-radius:8px">Vérifier mon courriel</a></p>
    <p>Merci,<br/>L'équipe Gestia</p>
  `,
});

export const getPasswordResetEmailContent: GetPasswordResetEmailContentFn = ({ passwordResetLink }) => ({
  subject: 'Réinitialisation de votre mot de passe',
  text: `Bonjour,\n\nVous avez demandé la réinitialisation de votre mot de passe Gestia. Cliquez sur le lien suivant :\n${passwordResetLink}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce courriel.\n\nL'équipe Gestia`,
  html: `
    <p>Bonjour,</p>
    <p>Vous avez demandé la réinitialisation de votre mot de passe <strong>Gestia</strong>. Cliquez sur le bouton ci-dessous :</p>
    <p><a href="${passwordResetLink}" style="display:inline-block;padding:10px 16px;background:#0A0A0B;color:#fff;text-decoration:none;border-radius:8px">Réinitialiser mon mot de passe</a></p>
    <p>Si vous n'êtes pas à l'origine de cette demande, ignorez simplement ce courriel.</p>
    <p>L'équipe Gestia</p>
  `,
});
