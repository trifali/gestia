// Le jeton d'un lien de partage, quand l'écran s'affiche dans le portail public
// d'un tableau (voir app/leads/ProspectPortalPage).
//
// Il vit ici, côté client commun, parce que des composants génériques en
// dépendent : un champ « magique » n'offre pas sa correction par l'IA — facturée
// à l'entreprise et réservée aux comptes — à un visiteur sans compte.

import { createContext, useContext } from 'react';

const ShareTokenContext = createContext<string | null>(null);

export function ShareTokenProvider({ token, children }: { token: string; children: React.ReactNode }) {
  return <ShareTokenContext.Provider value={token}>{children}</ShareTokenContext.Provider>;
}

/** Le jeton du lien de partage, ou `null` dans l'application. */
export function useShareToken(): string | null {
  return useContext(ShareTokenContext);
}

/** Vrai dans le portail d'un lien de partage. */
export function useViaLink(): boolean {
  return useShareToken() !== null;
}
