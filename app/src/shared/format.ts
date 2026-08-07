// Localisation Québec (fr-CA)
// - Devise CAD
// - Date: 30 avril 2026
// - Nombre: 1 234,56
// - Heure: 13 h 30

export function formatCurrency(amount: number | null | undefined): string {
  const n = typeof amount === 'number' ? amount : 0;
  return new Intl.NumberFormat('fr-CA', {
    style: 'currency',
    currency: 'CAD',
    currencyDisplay: 'symbol',
  }).format(n);
}

export function formatNumber(n: number | null | undefined, fractionDigits = 2): string {
  return new Intl.NumberFormat('fr-CA', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(typeof n === 'number' ? n : 0);
}

const MONTREAL = 'America/Toronto';

/**
 * Horodatage explicitement à l'heure de Montréal.
 *
 * Les `formatDate` / `formatTime` ci-dessous lisent l'heure *locale* du système,
 * ce qui convient dans un navigateur québécois mais donne l'heure UTC sur le
 * serveur. Tout ce qui est daté côté serveur — l'en-tête d'une note écrite par
 * un appel entrant, par exemple — doit passer par ici.
 */
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

const MONTHS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(date.getTime())) return '—';
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export function formatTime(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(date.getTime())) return '—';
  const h = date.getHours();
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h} h ${m}`;
}

export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return '—';
  return `${formatDate(d)} à ${formatTime(d)}`;
}

export function formatDateForInput(d: Date | string | null | undefined): string {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

export function formatDateTimeForInput(d: Date | string | null | undefined): string {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
