// Le rendu d'un fil SMS, partagé par la fiche prospect et la messagerie
// flottante. Les deux doivent se ressembler à l'identique : c'est la même
// conversation vue depuis deux écrans.

import { formatMontrealTime } from '../format';

// Delivery state reported by Telnyx via webhook. 'queued' is our own optimistic
// value written at send time, before the first receipt arrives.
export const SMS_STATUS_LABELS: Record<string, { label: string; className: string }> = {
  queued: { label: 'en attente', className: 'text-muted' },
  sending: { label: 'envoi…', className: 'text-muted' },
  sent: { label: 'envoyé', className: 'text-muted' },
  delivered: { label: 'livré', className: 'text-success' },
  sending_failed: { label: 'échec envoi', className: 'text-danger' },
  delivery_failed: { label: 'non livré', className: 'text-danger' },
  delivery_unconfirmed: { label: 'non confirmé', className: 'text-amber-600' },
  undelivered: { label: 'non livré', className: 'text-danger' },
  expired: { label: 'expiré', className: 'text-danger' },
};

export function SmsStatusBadge({ status, errorCode }: { status?: string | null; errorCode?: string | null }) {
  if (!status) return null;
  const meta = SMS_STATUS_LABELS[status] ?? { label: status, className: 'text-muted' };
  return (
    <span className={meta.className} title={errorCode ? `Code Telnyx ${errorCode}` : undefined}>
      · {meta.label}
    </span>
  );
}

/**
 * `className` sert à donner sa propre boîte de défilement à la liste (la fiche
 * prospect la borne à 280 px) ; sans lui, c'est le conteneur parent qui défile,
 * ce dont la messagerie a besoin.
 */
export function SmsMessageList({ logs, className }: { logs: any[]; className?: string }) {
  return (
    <div className={`space-y-1.5 pr-1${className ? ` ${className} overflow-y-auto` : ''}`}>
      {logs.map((log: any) => {
        const inbound = log.direction === 'inbound';
        return (
          <div
            key={log.id}
            className={`rounded-md px-2.5 py-2 border ${
              inbound ? 'border-accent-100 bg-accent-50 mr-6' : 'border-line ml-6'
            }`}
          >
            <div className='flex items-center gap-2 text-xs text-muted'>
              <span className='sr-only'>{inbound ? 'Reçu' : 'Envoyé'} — </span>
              <span className='font-medium text-ink truncate'>
                {inbound ? `Réponse — ${log.fromNumber}` : log.to}
              </span>
              {!inbound && <SmsStatusBadge status={log.status} errorCode={log.errorCode} />}
              <span className='ml-auto shrink-0'>{formatMontrealTime(log.createdAt)}</span>
            </div>
            <div className='text-xs whitespace-pre-wrap mt-1'>{log.body}</div>
          </div>
        );
      })}
    </div>
  );
}
