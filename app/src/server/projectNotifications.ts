import { sendEmailWithAttachment } from './mail';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncate(str: string, max = 120): string {
  return str.length > max ? str.slice(0, max) + '…' : str;
}

export async function notifyAdminOfClientActivity({
  companyEmail,
  companyName,
  projectName,
  activityType,
  actorName,
  detail,
}: {
  companyEmail: string;
  companyName: string;
  projectName: string;
  activityType: 'note' | 'file';
  actorName?: string;
  detail: string;
}): Promise<void> {
  try {
    const typeLabel = activityType === 'note' ? 'Note laissée' : 'Fichier téléversé';
    const actor = actorName || 'votre client';
    const subject = `[${projectName}] Nouvelle activité du client`;
    const html = `
<p>Bonjour,</p>
<p>Une nouvelle activité a été enregistrée dans le projet <strong>${escapeHtml(projectName)}</strong> par <strong>${escapeHtml(actor)}</strong>.</p>
<p><strong>${typeLabel} :</strong> ${escapeHtml(truncate(detail))}</p>
<p>Connectez-vous à Gestia pour y répondre.</p>
<p>— Gestia</p>
    `.trim();

    await sendEmailWithAttachment({
      to: companyEmail,
      subject,
      text: `[${projectName}] ${typeLabel} par ${actor} : ${truncate(detail)}`,
      html,
      fromName: 'Gestia Notifications',
    });
  } catch (err) {
    console.error('[notification] Failed to send admin notification:', err);
  }
}

export async function notifyClientOfActivity({
  clientEmail,
  companyName,
  projectName,
  activityType,
  detail,
}: {
  clientEmail: string;
  companyName: string;
  projectName: string;
  activityType: 'note' | 'file' | 'task';
  detail: string;
}): Promise<void> {
  try {
    const labels: Record<string, string> = {
      note: 'Nouvelle note partagée',
      file: 'Nouveau fichier partagé',
      task: 'Tâche mise à jour',
    };
    const typeLabel = labels[activityType] || 'Mise à jour';
    const subject = `[${projectName}] ${typeLabel}`;
    const html = `
<p>Bonjour,</p>
<p>Votre projet <strong>${escapeHtml(projectName)}</strong> a été mis à jour par <strong>${escapeHtml(companyName)}</strong>.</p>
<p><strong>${typeLabel} :</strong> ${escapeHtml(truncate(detail))}</p>
<p>Consultez votre espace projet pour voir les détails.</p>
<p>— ${escapeHtml(companyName)}</p>
    `.trim();

    await sendEmailWithAttachment({
      to: clientEmail,
      subject,
      text: `[${projectName}] ${typeLabel} : ${truncate(detail)}`,
      html,
      fromName: companyName,
    });
  } catch (err) {
    console.error('[notification] Failed to send client notification:', err);
  }
}
