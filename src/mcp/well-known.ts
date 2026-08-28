import { Router } from 'express';
import { getConnector, listConnectors } from '../connectors/registry.js';
import { env } from '../core/env.js';
import { MCP_SCOPE } from '../modules/oauth/provider.js';

/**
 * Métadonnées de ressource protégée (RFC 9728).
 *
 * C'est le premier maillon de la découverte automatique : le client IA reçoit
 * un 401 avec `WWW-Authenticate: … resource_metadata="…"`, va lire ce document,
 * y trouve l'adresse de notre serveur d'autorisation, et déroule le reste tout
 * seul. Une réponse par connecteur, car chaque URL MCP est une ressource
 * distincte au sens de la RFC 8707.
 */
export const wellKnownRouter: Router = Router();

wellKnownRouter.get('/oauth-protected-resource/mcp/:connectorId', (req, res) => {
  const connectorId = req.params.connectorId as string;
  const connector = getConnector(connectorId);

  if (!connector) {
    res.status(404).json({ error: 'not_found', error_description: 'Connecteur inconnu.' });
    return;
  }

  res.json({
    resource: `${env.baseUrl}/mcp/${connector.id}`,
    authorization_servers: [env.baseUrl],
    scopes_supported: [MCP_SCOPE],
    resource_name: `${connector.name} — Toolink`,
    resource_documentation: `${env.baseUrl}/catalogue/${connector.id}`,
    bearer_methods_supported: ['header'],
  });
});

/** Variante sans connecteur : utile pour les clients qui sondent la racine. */
wellKnownRouter.get('/oauth-protected-resource', (_req, res) => {
  res.json({
    resource: `${env.baseUrl}/mcp`,
    authorization_servers: [env.baseUrl],
    scopes_supported: [MCP_SCOPE],
    resource_name: 'Toolink',
    resource_documentation: `${env.baseUrl}/catalogue`,
    bearer_methods_supported: ['header'],
    // Indice utile au débogage : la liste des ressources réellement exposées.
    mcp_resources: listConnectors().map((connector) => `${env.baseUrl}/mcp/${connector.id}`),
  });
});
