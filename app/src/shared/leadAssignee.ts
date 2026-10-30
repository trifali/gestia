// ─── Responsable d'une carte de prospect ─────────────────────────────────────
//
// Qui s'occupe de quelle carte. Sur un lien de partage, les personnes n'ont pas
// de compte : elles se présentent par un surnom, retenu par leur navigateur.
// Depuis l'application, c'est le nom de l'entreprise. Dans les deux cas, ce qui
// est enregistré est le nom, et deux noms sont la même personne quand ils ne
// diffèrent que par la casse ou les espaces — « marie » et « Marie » ne doivent
// pas faire deux colonnes de filtre ni deux couleurs.
//
// Source unique pour le serveur (validation) et l'écran (comparaison).

export const MAX_ASSIGNEE_CHARS = 40;

/** Le nom tel qu'il sera enregistré, ou `null` s'il n'en reste rien. */
export function normalizeAssigneeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_ASSIGNEE_CHARS).trim();
  return name || null;
}

/** La clé de comparaison d'un nom. */
export function assigneeKey(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toLocaleLowerCase('fr-CA');
}

export function sameAssignee(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && assigneeKey(a) === assigneeKey(b);
}
