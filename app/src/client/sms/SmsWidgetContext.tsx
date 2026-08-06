// État de navigation de la messagerie flottante.
//
// Il vit dans un contexte plutôt que dans SmsWidget pour deux raisons : ouvrir
// directement sur une conversation devient atomique (pas d'éclair de liste avant
// le fil), et n'importe quel écran peut y renvoyer — le toast d'AppLayout
// aujourd'hui, une action « ouvrir dans la messagerie » sur une carte de
// prospect demain. Un émetteur d'événements ferait la moitié du travail : il ne
// sait pas répondre à « la messagerie est-elle seulement active ? ».

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type SmsWidgetView = 'list' | 'thread' | 'new';

export type SmsWidgetApi = {
  open: boolean;
  view: SmsWidgetView;
  activeIdentifier: string | null;
  /** Numéro pré-rempli du formulaire « nouveau message ». */
  draftTo: string;
  openWidget: (target?: { identifier?: string; phone?: string }) => void;
  openThread: (identifier: string) => void;
  startNew: (prefill?: { phone?: string }) => void;
  goBack: () => void;
  close: () => void;
  toggle: () => void;
};

const SmsWidgetContext = createContext<SmsWidgetApi | null>(null);

export function SmsWidgetProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<SmsWidgetView>('list');
  const [activeIdentifier, setActiveIdentifier] = useState<string | null>(null);
  const [draftTo, setDraftTo] = useState('');

  const openThread = useCallback((identifier: string) => {
    setActiveIdentifier(identifier);
    setView('thread');
    setOpen(true);
  }, []);

  const startNew = useCallback((prefill?: { phone?: string }) => {
    setDraftTo(prefill?.phone ?? '');
    setActiveIdentifier(null);
    setView('new');
    setOpen(true);
  }, []);

  const openWidget = useCallback((target?: { identifier?: string; phone?: string }) => {
    if (target?.identifier) { openThread(target.identifier); return; }
    if (target?.phone) { startNew({ phone: target.phone }); return; }
    setOpen(true);
  }, [openThread, startNew]);

  const goBack = useCallback(() => {
    setActiveIdentifier(null);
    setView('list');
  }, []);

  // Fermer ne remet pas sur la liste : rouvrir doit rendre l'écran quitté.
  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen(o => !o), []);

  const value = useMemo<SmsWidgetApi>(
    () => ({ open, view, activeIdentifier, draftTo, openWidget, openThread, startNew, goBack, close, toggle }),
    [open, view, activeIdentifier, draftTo, openWidget, openThread, startNew, goBack, close, toggle],
  );

  // `children` est un élément créé par le parent : son identité ne change pas
  // quand cet état bouge, donc React court-circuite ce sous-arbre. Ouvrir la
  // messagerie ne re-rend pas la page.
  return <SmsWidgetContext.Provider value={value}>{children}</SmsWidgetContext.Provider>;
}

export function useSmsWidget(): SmsWidgetApi {
  const ctx = useContext(SmsWidgetContext);
  if (!ctx) throw new Error('useSmsWidget doit être utilisé sous <SmsWidgetProvider>');
  return ctx;
}
