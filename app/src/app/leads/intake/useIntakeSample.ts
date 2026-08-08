// L'unique porte d'entrée sur `getLatestIntakeSample`.
//
// Même raison d'être que `useSmsAlerts` : React Query dédoublonne sur
// `[route, arguments]`, donc deux composants qui appellent la même requête avec
// des arguments *de forme différente* — `{ searchId }` d'un côté,
// `{ searchId, eventId: undefined }` de l'autre — créent deux entrées de cache
// et deux requêtes parallèles. C'est exactement ce qui s'est produit ici, et
// avec un battement par-dessus, cela suffisait à épuiser le pool de connexions.
//
// Ce hook rend la divergence impossible : une seule forme d'arguments, un seul
// `refetchInterval`.

import { getLatestIntakeSample, useQuery } from 'wasp/client/operations';
import { INTAKE_LISTEN_POLL_MS } from '../../../client/polling';

export function useIntakeSample(
  searchId: string,
  opts: { eventId?: string; listening?: boolean } = {},
) {
  const { data, refetch, isLoading } = useQuery(
    getLatestIntakeSample,
    // Toujours les deux clés, toujours dans cet ordre : c'est la forme
    // d'arguments qui fait la clé de cache.
    { searchId, eventId: opts.eventId },
    {
      refetchInterval: opts.listening ? INTAKE_LISTEN_POLL_MS : false,
      // Un appel arrivé pendant que l'onglet était en arrière-plan doit être là
      // au retour, sans attendre le prochain battement.
      refetchOnWindowFocus: true,
    },
  );
  return { sample: data ?? null, refetch, isLoading };
}
