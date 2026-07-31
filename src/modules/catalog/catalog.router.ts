import { Router } from 'express';
import { z } from 'zod';
import { listConnectors, requireConnector, toSummary } from '../../connectors/registry.js';
import { getParams, getQuery, validate } from '../../middleware/validate.js';

/**
 * Catalogue public des connecteurs. C'est la source unique qui alimente le
 * front : la grille, les filtres, la page de détail et le formulaire
 * d'identifiants sont tous générés à partir de cette réponse.
 *
 * Ajouter un connecteur ne demande donc aucune modification du front.
 */

export const catalogRouter: Router = Router();

const querySchema = z.object({
  q: z.string().trim().max(80).optional(),
  category: z.string().trim().max(40).optional(),
});

catalogRouter.get('/', validate({ query: querySchema }), (req, res) => {
  const { q, category } = getQuery<z.infer<typeof querySchema>>(req);

  let connectors = listConnectors().map(toSummary);

  if (category && category !== 'all') {
    connectors = connectors.filter((connector) => connector.category === category);
  }

  if (q) {
    const needle = normalize(q);
    connectors = connectors.filter((connector) =>
      normalize(
        `${connector.name} ${connector.tagline} ${connector.description} ${connector.tools
          .map((tool) => tool.title)
          .join(' ')}`,
      ).includes(needle),
    );
  }

  const categories = countCategories();

  res.json({ connectors, categories, total: connectors.length });
});

catalogRouter.get(
  '/:connectorId',
  validate({ params: z.object({ connectorId: z.string().min(1).max(40) }) }),
  (req, res) => {
    const { connectorId } = getParams<{ connectorId: string }>(req);
    res.json({ connector: toSummary(requireConnector(connectorId)) });
  },
);

/** Retire accents et casse : « Facturation » trouve « facturation ». */
function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

const CATEGORY_LABELS: Record<string, string> = {
  crm: 'CRM & ventes',
  finance: 'Finance',
  productivity: 'Productivité',
  marketing: 'Marketing',
  support: 'Support client',
  developer: 'Développement',
  other: 'Autres',
};

function countCategories() {
  const counts = new Map<string, number>();
  for (const connector of listConnectors()) {
    counts.set(connector.category, (counts.get(connector.category) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([id, count]) => ({ id, label: CATEGORY_LABELS[id] ?? id, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'fr'));
}
