import type { ConnectorCategory } from './types.js';

/**
 * ===========================================================================
 *  MCP officiels référencés — la seconde nature du catalogue
 * ===========================================================================
 *
 * Deux natures d'entrées cohabitent désormais :
 *
 *  • les **connecteurs Toolink** — notre moteur enveloppe l'API du service :
 *    chiffrement, révocation, traçabilité, hub. C'est la valeur du produit,
 *    et le seul choix pour la longue traîne sans MCP officiel ;
 *  • les **MCP officiels** — l'éditeur héberge son propre serveur. Ré-envelopper
 *    Stripe quand Stripe maintient `mcp.stripe.com` serait un combat perdu :
 *    version en retard, saut de confiance en plus, maintenance sans fin. On
 *    référence, on n'imite pas.
 *
 * Un même service peut exister sous les deux natures — un connecteur Toolink
 * `stripe` ET la fiche officielle — pour laisser le choix : la version Toolink
 * passe par le hub et nos garanties, l'officielle se branche en direct.
 *
 * L'utilisateur colle l'URL officielle directement dans son client IA : la
 * connexion ne passe PAS par Toolink — ni ses identifiants, ni ses appels. La
 * sélection fine d'outils y dépend du client IA, pas de nous ; c'est dit sur
 * la fiche, sans prétendre le contraire.
 *
 * Chaque URL est vérifiée contre la documentation de l'éditeur au moment de
 * l'ajout — jamais écrite de mémoire : une URL de MCP fausse envoie
 * l'utilisateur autoriser n'importe quoi.
 */

export interface HostedMcp {
  /** Slug stable, même espace de noms que les connecteurs : pas de collision. */
  id: string;
  name: string;
  tagline: string;
  category: ConnectorCategory;
  /** URL du serveur MCP hébergé par l'éditeur — à coller telle quelle. */
  url: string;
  /** Documentation officielle du serveur, pour vérifier et pour aller plus loin. */
  docsUrl: string;
  icon: string;
  /** Ce que l'éditeur accepte pour s'authentifier. */
  auth: 'oauth' | 'oauth_ou_cle_api';
}

export const hostedMcps: HostedMcp[] = [
  {
    id: 'notion-officiel',
    name: 'Notion',
    tagline: 'Pages, bases de données et recherche, par le serveur officiel de Notion.',
    category: 'productivity',
    url: 'https://mcp.notion.com/mcp',
    docsUrl: 'https://developers.notion.com/docs/get-started-with-mcp',
    icon: 'https://www.notion.so/images/favicon.ico',
    auth: 'oauth',
  },
  {
    id: 'stripe-officiel',
    name: 'Stripe',
    tagline: 'Paiements, factures et abonnements, par le serveur officiel de Stripe.',
    category: 'finance',
    url: 'https://mcp.stripe.com',
    docsUrl: 'https://docs.stripe.com/mcp',
    icon: 'https://stripe.com/favicon.ico',
    auth: 'oauth_ou_cle_api',
  },
  {
    id: 'linear-officiel',
    name: 'Linear',
    tagline: 'Tickets, projets et cycles, par le serveur officiel de Linear.',
    category: 'productivity',
    url: 'https://mcp.linear.app/mcp',
    docsUrl: 'https://linear.app/docs/mcp',
    icon: 'https://linear.app/favicon.ico',
    auth: 'oauth',
  },
  {
    id: 'github-officiel',
    name: 'GitHub',
    tagline: 'Dépôts, issues et pull requests, par le serveur officiel de GitHub.',
    category: 'productivity',
    url: 'https://api.githubcopilot.com/mcp/',
    docsUrl: 'https://docs.github.com/en/copilot/customizing-copilot/using-model-context-protocol/using-the-github-mcp-server',
    icon: 'https://github.com/favicon.ico',
    auth: 'oauth',
  },
];
