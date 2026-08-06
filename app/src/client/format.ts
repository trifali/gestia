// Formatage de dates partagé par tout le client.
//
// Vit ici plutôt que dans le module prospection parce que le widget de
// messagerie, monté dans le shell, en a besoin — et que `leads.shared.tsx`
// importe Syncfusion Kanban au niveau module, qu'on ne veut pas tirer sur
// chaque page de l'application.

const MONTREAL = 'America/Toronto';

export function formatMontrealTime(date: string | Date): string {
  return new Intl.DateTimeFormat('fr-CA', {
    timeZone: MONTREAL,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date));
}

const HOUR_ONLY = new Intl.DateTimeFormat('fr-CA', {
  timeZone: MONTREAL,
  hour: '2-digit',
  minute: '2-digit',
});
const DAY_MONTH = new Intl.DateTimeFormat('fr-CA', {
  timeZone: MONTREAL,
  day: 'numeric',
  month: 'short',
});

/**
 * Horodatage court d'une liste de conversations : « à l'instant », « 12 min »,
 * « 14:32 », « hier », « 3 août ». Assez précis pour trier du regard, assez
 * court pour tenir à droite d'un nom.
 */
export function formatRelativeShort(date: string | Date): string {
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);

  if (diffMin < 1) return "à l'instant";
  if (diffMin < 60) return `${diffMin} min`;

  // Comparaison sur la journée civile de Montréal, pas sur 24 h glissantes :
  // un message de 23 h consulté à 1 h du matin doit dire « hier ».
  const dayKey = (x: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: MONTREAL, dateStyle: 'short' }).format(x);
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getTime() - 86_400_000));
  const key = dayKey(d);

  if (key === today) return HOUR_ONLY.format(d);
  if (key === yesterday) return 'hier';
  return DAY_MONTH.format(d);
}
