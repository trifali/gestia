// Signale une réponse SMS entrante depuis n'importe quelle page.
//
// Vit ici plutôt que dans AppLayout parce que c'est AppLayout qui rend le
// fournisseur de contexte : un composant ne peut pas consommer un contexte qu'il
// fournit lui-même. Séparation utile au passage — AppLayout ne garde que la
// pastille de la barre latérale.

import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import toast from 'react-hot-toast';
import { useQuery, getCurrentCompany } from 'wasp/client/operations';
import { useSmsAlerts } from './useSmsAlerts';
import { useSmsWidget } from './SmsWidgetContext';
import { useSmsInbox } from '../capabilities';

export function SmsReplyToaster() {
  const { data: company } = useQuery(getCurrentCompany);
  const { total, loaded } = useSmsAlerts({ enabled: !!company });
  const { inboxEnabled } = useSmsInbox();
  const { open, openWidget } = useSmsWidget();
  const navigate = useNavigate();

  // Lu dans une ref : basculer la messagerie ne doit pas relancer l'effet et
  // rejouer le calcul d'écart.
  const openRef = useRef(open);
  openRef.current = open;

  const prev = useRef<number | null>(null);
  useEffect(() => {
    if (!loaded) return;
    const before = prev.current;
    // Affecté avant toute sortie anticipée : une référence périmée provoquerait
    // une rafale de toasts au chargement suivant.
    prev.current = total;
    if (before === null || total <= before) return;
    if (openRef.current) return; // le panneau est ouvert : le message est déjà là

    const added = total - before;
    toast(
      t => (
        <button
          className='text-left'
          onClick={() => {
            toast.dismiss(t.id);
            // Sans messagerie, la prospection reste le seul écran qui montre
            // quelque chose — et elle ne montre que les fils rattachés.
            if (inboxEnabled) openWidget();
            else navigate('/prospection');
          }}
        >
          <span className='font-medium'>
            {added} nouvelle{added > 1 ? 's' : ''} réponse{added > 1 ? 's' : ''} SMS
          </span>
          <span className='block text-xs text-muted'>
            {inboxEnabled ? 'Cliquez pour ouvrir la messagerie' : 'Voir dans la prospection'}
          </span>
        </button>
      ),
      { icon: '💬', duration: 8000 },
    );
  }, [loaded, total, openWidget, inboxEnabled, navigate]);

  return null;
}
