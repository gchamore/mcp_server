/**
 * ===========================================================================
 *  Le hub — une URL, tous les services cochés
 * ===========================================================================
 *
 * `/mcp/hub` est un point d'accès MCP qui agrège plusieurs connexions d'un même
 * utilisateur : au consentement, il coche les services qu'il veut exposer, et
 * le jeton émis porte cet ensemble. Une URL à coller dans Dust au lieu d'une
 * par service, un seul parcours d'autorisation.
 *
 * C'est aussi la réponse à « quelle valeur au-dessus des MCP officiels des
 * éditeurs ? » : l'agrégation. Aucun éditeur n'exposera les outils de ses
 * concurrents derrière une seule URL.
 *
 * Choix de conception :
 *
 *  • les outils sont préfixés par l'identifiant du connecteur
 *    (`gmail_list_messages`) — sans quoi deux services exposant `get_account`
 *    se percuteraient ;
 *  • le jeton porte des `connectionIds` (pluriel) là où un connecteur simple
 *    porte un `connectionId` — les deux chemins coexistent, aucun ne change
 *    l'autre ;
 *  • une connexion supprimée après coup est simplement omise du hub : le jeton
 *    reste valide pour le reste, et ne casse que s'il ne reste rien.
 */

/** Identifiant réservé du hub dans l'espace des URL `/mcp/:id`. */
export const HUB_ID = 'hub';

/** Le hub apparaît dans le catalogue et la découverte sous ce nom. */
export const HUB_NAME = 'Hub Toolink';

export function isHubResource(connectorId: string | null | undefined): boolean {
  return connectorId === HUB_ID;
}
