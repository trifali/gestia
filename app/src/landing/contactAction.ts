import { HttpError } from 'wasp/server';
import { sendEmailWithAttachment } from '../server/mail';

type ContactFormArgs = {
  name: string;
  email: string;
  company?: string;
  message: string;
};

export const sendContactEmail = async (
  args: ContactFormArgs,
  _context: any,
): Promise<{ ok: true }> => {
  const name = args.name?.trim();
  const email = args.email?.trim();
  const message = args.message?.trim();

  if (!name) throw new HttpError(400, 'Le nom est requis.');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, 'Adresse courriel invalide.');
  }
  if (!message) throw new HttpError(400, 'Le message est requis.');

  const company = args.company?.trim() || '';
  const subject = `[Gestia] Nouveau message de ${name}${company ? ` — ${company}` : ''}`;

  const text = [
    `Nom : ${name}`,
    company ? `Entreprise : ${company}` : null,
    `Courriel : ${email}`,
    '',
    'Message :',
    message,
  ]
    .filter((l) => l !== null)
    .join('\n');

  const html = `
    <div style="font-family: Arial, sans-serif; font-size: 14px; color: #1a1a1a; max-width: 600px;">
      <h2 style="color: #FF6A3D; margin-bottom: 4px;">Nouveau message via Gestia</h2>
      <hr style="border: none; border-top: 1px solid #e5e5e0; margin-bottom: 16px;" />
      <p><strong>Nom :</strong> ${name}</p>
      ${company ? `<p><strong>Entreprise :</strong> ${company}</p>` : ''}
      <p><strong>Courriel :</strong> <a href="mailto:${email}">${email}</a></p>
      <hr style="border: none; border-top: 1px solid #e5e5e0; margin: 16px 0;" />
      <p style="white-space: pre-wrap;">${message
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br/>')}</p>
    </div>
  `;

  await sendEmailWithAttachment({
    to: 'info@trifali.com',
    replyTo: email,
    subject,
    text,
    html,
    fromName: 'Gestia — Formulaire de contact',
  });

  return { ok: true };
};
