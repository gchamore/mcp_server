/**
 * Aides de formatage partagées par les connecteurs.
 *
 * Les outils MCP renvoient du texte lu par un modèle : on vise du Markdown
 * compact et régulier plutôt que des tirades décorées d'émojis, qui coûtent des
 * tokens sans rien apporter à la compréhension.
 */

export function money(amount: number | null | undefined, currency = 'EUR'): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '—';
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function date(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString().slice(0, 10);
}

export function text(value: string | null | undefined, fallback = '—'): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

/** Retourne uniquement les paires renseignées, sous forme « clé : valeur ». */
export function fields(entries: Record<string, string | number | null | undefined>): string {
  return Object.entries(entries)
    .filter(([, value]) => value !== null && value !== undefined && value !== '' && value !== '—')
    .map(([key, value]) => `${key} : ${value}`)
    .join(' · ');
}

/**
 * Rend une liste paginée avec un en-tête cohérent et une invite explicite pour
 * la page suivante — sans cela, les modèles concluent souvent à tort qu'ils ont
 * tout vu après la première page.
 */
export function renderList<T>(options: {
  title: string;
  items: T[];
  page?: number;
  emptyMessage: string;
  render: (item: T, index: number) => string;
}): string {
  const { title, items, page, emptyMessage, render } = options;

  if (items.length === 0) {
    return page && page > 1 ? `${emptyMessage} (page ${page}).` : emptyMessage;
  }

  const header =
    page && page > 1
      ? `**${title}** — page ${page}, ${items.length} résultat(s)`
      : `**${title}** — ${items.length} résultat(s)`;

  const body = items.map((item, index) => render(item, index)).join('\n');
  const more =
    items.length >= 20
      ? `\n\nD'autres résultats existent probablement : rappeler l'outil avec page = ${(page ?? 1) + 1}.`
      : '';

  return `${header}\n\n${body}${more}`;
}
