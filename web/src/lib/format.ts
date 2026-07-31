/** Helpers d'affichage partagés par les écrans. */

const relative = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
const absolute = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' });
const absoluteWithTime = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600_000],
  ['month', 30 * 24 * 3600_000],
  ['day', 24 * 3600_000],
  ['hour', 3600_000],
  ['minute', 60_000],
];

/** « il y a 3 jours », « à l'instant »… Renvoie « jamais » si la date est nulle. */
export function timeAgo(value: string | null | undefined): string {
  if (!value) return 'jamais';

  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return '—';

  const delta = timestamp - Date.now();
  for (const [unit, ms] of UNITS) {
    if (Math.abs(delta) >= ms) return relative.format(Math.round(delta / ms), unit);
  }
  return "à l'instant";
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : absolute.format(parsed);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : absoluteWithTime.format(parsed);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('fr-FR').format(value);
}

export function formatPercent(value: number): string {
  return new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 1 }).format(
    value,
  );
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatNumber(count)} ${count > 1 ? plural : singular}`;
}

export function initials(firstName?: string | null, lastName?: string | null, email?: string) {
  const first = firstName?.[0] ?? '';
  const last = lastName?.[0] ?? '';
  if (first || last) return `${first}${last}`.toUpperCase();
  return (email?.[0] ?? '?').toUpperCase();
}

export function displayName(user: {
  firstName: string | null;
  lastName: string | null;
  email: string;
}): string {
  const full = [user.firstName, user.lastName].filter(Boolean).join(' ');
  return full || user.email;
}
