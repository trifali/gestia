// SMS à un client depuis une carte de suivi.
//
// Calqué sur le SMS de prospection (LeadSearchPage → ProspectSmsModal) : on
// écrit en haut, la conversation se lit en dessous, et une réponse arrivée
// pendant la lecture éteint sa pastille. Ce qui n'est pas repris est ce qui
// n'existe que pour la prospection — modèles et rédaction IA appartiennent à un
// tableau de prospection, pas à une fiche client.

import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { LuClock, LuLoader, LuMessageSquare } from 'react-icons/lu';
import {
  useQuery,
  // @ts-ignore -- généré par Wasp au prochain redémarrage
  getClientSmsThread,
  // @ts-ignore -- généré par Wasp au prochain redémarrage
  sendClientSms,
  // @ts-ignore -- généré par Wasp au prochain redémarrage
  getLeadSmsLogs,
  // @ts-ignore -- généré par Wasp au prochain redémarrage
  markLeadSmsRead,
  getCurrentCompany,
} from 'wasp/client/operations';
import { Modal } from '../../client/ui';
import { MagicTextarea } from '../../client/magic';
import { SmsCostHint } from '../../client/sms/SmsCostHint';
import { SmsMessageList } from '../../client/sms/SmsMessageList';
import { toGsm7 } from '../../client/sms/smsText';
import { toE164 } from '../../shared/phone';
import { useSmsCapability } from '../../client/capabilities';
import { SMS_THREAD_POLL_MS } from '../../client/polling';

export function SendClientSmsModal({
  clientId,
  clientName,
  clientPhone,
  onClose,
}: {
  clientId: string;
  clientName: string;
  clientPhone: string | null;
  onClose: () => void;
}) {
  const { data: company } = useQuery(getCurrentCompany);
  const { canSend: smsCanSend, reason: smsReason } = useSmsCapability();

  const [to, setTo] = useState<string>(clientPhone ?? '');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  // Le fil est résolu côté serveur, sur le numéro réellement visé : écrire au
  // numéro d'un client qui est aussi un prospect doit rejoindre la conversation
  // existante plutôt que d'en ouvrir une seconde.
  //
  // Normalisé avant d'être passé en argument : sans cela, chaque frappe dans le
  // champ « À » serait une clé de requête distincte, donc un aller-retour de
  // plus. Un numéro incomplet ne vaut rien de toute façon — la fiche reprend la
  // main jusqu'à ce qu'il soit composable.
  const typedPhone = toE164(to) ?? null;
  const { data: thread, refetch: refetchThread } = useQuery(
    // @ts-ignore -- généré par Wasp au prochain redémarrage
    getClientSmsThread,
    { clientId, phone: typedPhone },
  );
  const identifier = (thread as any)?.identifier ?? null;

  const { data: logs = [], refetch: refetchLogs } = useQuery(
    // @ts-ignore -- généré par Wasp au prochain redémarrage
    getLeadSmsLogs,
    { identifier: identifier ?? '' },
    {
      enabled: !!identifier,
      // Un fil ouvert se rafraîchit seul, pour qu'une réponse apparaisse pendant
      // qu'on le lit.
      refetchInterval: SMS_THREAD_POLL_MS,
      refetchOnWindowFocus: true,
    },
  );

  // Avoir le fil ouvert vaut lecture. Piloté par les messages et non par le
  // montage, pour qu'une réponse arrivant pendant la lecture soit marquée elle
  // aussi au lieu de laisser une pastille périmée derrière soi.
  const markingRead = useRef(false);
  const unreadInThread = (logs as any[]).some(
    (l: any) => l.direction === 'inbound' && !l.readAt,
  );
  useEffect(() => {
    if (!identifier || !unreadInThread || markingRead.current) return;
    markingRead.current = true;
    (markLeadSmsRead as any)({ identifier })
      .then(() => refetchLogs())
      .finally(() => { markingRead.current = false; });
  }, [identifier, unreadInThread]);

  async function handleSend() {
    if (!to.trim()) { toast.error('Numéro requis'); return; }
    if (!text.trim()) { toast.error('Message requis'); return; }
    setSending(true);
    try {
      await (sendClientSms as any)({ clientId, to: to.trim(), body: text });
      toast.success('SMS envoyé');
      // La conversation reste ouverte : le message part, apparaît dans le fil
      // ci-dessous et le champ est prêt pour le suivant.
      setText('');
      await refetchThread();
      refetchLogs();
    } catch (err: any) {
      toast.error(err?.message || "Erreur lors de l'envoi");
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Envoyer un SMS à ${clientName}`}
      footer={
        <>
          <div className='flex-1' />
          <button className='btn-secondary' onClick={onClose} disabled={sending}>
            Fermer
          </button>
          <button
            className='btn-primary gap-1.5 flex items-center'
            onClick={handleSend}
            disabled={sending || !smsCanSend}
            title={!smsCanSend ? (smsReason ?? '') : undefined}
          >
            {sending ? <LuLoader size={14} className='animate-spin' /> : <LuMessageSquare size={14} />}
            {sending ? 'Envoi…' : 'Envoyer'}
          </button>
        </>
      }
    >
      <div className='space-y-4'>
        {!smsCanSend && (
          <div className='text-xs bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-amber-700'>
            {smsReason}
          </div>
        )}

        {!clientPhone && (
          <div className='text-xs bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-amber-700'>
            Aucun téléphone sur la fiche de ce client. Vous pouvez en saisir un manuellement.
          </div>
        )}

        <div>
          <label className='label'>À (numéro)</label>
          <input
            type='tel'
            className='input'
            value={to}
            onChange={e => setTo(e.target.value)}
            placeholder='(514) 555-0100'
          />
          <span className='text-xs text-muted mt-1 block'>
            Les numéros à 10 chiffres sont envoyés en +1 (Amérique du Nord).
          </span>
        </div>

        <div>
          <label className='label'>Message</label>
          <MagicTextarea
            className='input min-h-[120px] resize-y'
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={`Bonjour, ici ${(company as any)?.name ?? 'notre entreprise'}…`}
          />
          <div className='text-xs text-muted mt-1 flex items-center gap-1.5'>
            <SmsCostHint text={text} onSimplify={() => setText(toGsm7(text))} />
          </div>
        </div>

        {(logs as any[]).length > 0 && (
          <div className='border-t border-line pt-3'>
            <div className='text-xs font-medium text-muted mb-2 flex items-center gap-1.5'>
              <LuClock size={13} />
              Conversation ({(logs as any[]).length})
            </div>
            <SmsMessageList logs={logs as any[]} className='max-h-[280px]' />
          </div>
        )}
      </div>
    </Modal>
  );
}
