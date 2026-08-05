import { sendEmailWithAttachment, companySmtp } from '../mail';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const sendProjectNotifications = async (_args: unknown, context: any) => {
  // Find all pending notification entries
  const pending = await context.entities.ActivityLog.findMany({
    where: {
      notificationRecipient: { not: null },
      notifiedAt: null,
      projectId: { not: null },
    },
    include: {
      project: {
        include: {
          company: true,
          client: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  if (pending.length === 0) return;

  // Group by projectId:recipientType
  const groups = new Map<string, typeof pending>();
  for (const entry of pending) {
    const key = `${entry.projectId}:${entry.notificationRecipient}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(entry);
  }

  const sentIds: string[] = [];

  for (const [key, entries] of groups) {
    const recipientType = key.split(':')[1] as 'admin' | 'client';
    const proj = entries[0]?.project;
    if (!proj) continue;

    try {
      let toEmail: string | null = null;
      let fromName: string;
      let greeting: string;

      if (recipientType === 'admin') {
        toEmail = proj.company?.email ?? null;
        fromName = 'Gestia Notifications';
        greeting = `Voici les activités récentes du client dans le projet <strong>${escapeHtml(proj.name)}</strong> :`;
      } else {
        toEmail = proj.client?.email ?? null;
        fromName = proj.company?.name || 'Votre prestataire';
        greeting = `Voici les récentes mises à jour de votre projet <strong>${escapeHtml(proj.name)}</strong> par <strong>${escapeHtml(fromName)}</strong> :`;
      }

      if (!toEmail) continue;

      const count = entries.length;
      const subject =
        recipientType === 'admin'
          ? `[${proj.name}] ${count} nouvelle${count > 1 ? 's' : ''} activité${count > 1 ? 's' : ''} du client`
          : `[${proj.name}] ${count} mise${count > 1 ? 's' : ''} à jour de votre projet`;

      const lines = entries
        .map((e: any) => {
          const time = new Date(e.createdAt).toLocaleString('fr-CA', {
            hour: '2-digit',
            minute: '2-digit',
            day: 'numeric',
            month: 'short',
          });
          return `<li><span style="color:#888">${time}</span> — ${escapeHtml(e.message)}</li>`;
        })
        .join('\n');

      const cta =
        recipientType === 'client'
          ? `<p>Consultez votre espace projet pour voir les détails.</p>`
          : `<p>Connectez-vous à Gestia pour y répondre.</p>`;

      const html = `<p>Bonjour,</p><p>${greeting}</p><ul style="padding-left:1.2em">${lines}</ul>${cta}<p>— ${escapeHtml(fromName)}</p>`;
      const text = entries.map((e: any) => `• ${e.message}`).join('\n');

      const smtp = companySmtp(proj.company);
      if (!smtp) {
        console.error(`[cron] sendProjectNotifications: aucune configuration SMTP pour ${proj.company?.name ?? 'entreprise inconnue'}`);
        continue; // leave unnotified so a later run retries once SMTP is set up
      }

      await sendEmailWithAttachment({
        smtp,
        to: toEmail,
        subject,
        text,
        html,
        // The admin digest is internal: it keeps the "Gestia Notifications" name
        // and needs no copy. The client one goes out under the company's own
        // configured sender, answers to the company inbox, and is copied there
        // when that option is on.
        ...(recipientType === 'admin' ? { fromName } : { clientFacing: true as const }),
      });
      sentIds.push(...entries.map((e: any) => e.id));
    } catch (err) {
      console.error(`[cron] sendProjectNotifications failed for group ${key}:`, err);
    }
  }

  // Mark as notified
  if (sentIds.length > 0) {
    await context.entities.ActivityLog.updateMany({
      where: { id: { in: sentIds } },
      data: { notifiedAt: new Date() },
    });
  }

  console.log(`[cron] sendProjectNotifications: ${sentIds.length} entries notified across ${groups.size} groups`);
};
