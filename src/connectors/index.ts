import axonaut from './axonaut/index.js';
import brevo from './brevo/index.js';
import gmail from './gmail/index.js';
import type { AnyConnector } from './types.js';

/**
 * =========================================================================
 *  Catalogue des connecteurs — LA SEULE LIGNE À AJOUTER POUR UN NOUVEAU MCP
 * =========================================================================
 *
 * Pour brancher un connecteur : créer `src/connectors/<id>/index.ts`, puis
 * l'importer et l'ajouter au tableau ci-dessous. C'est tout : le catalogue, le
 * formulaire d'identifiants, le serveur MCP et l'administration s'en déduisent.
 *
 * Pourquoi une liste explicite plutôt qu'un scan du dossier ? Parce qu'un
 * `import()` calculé casse dès qu'un outil analyse le code statiquement (Vite,
 * Vitest, tout empaqueteur). Ici les imports sont statiques, donc vérifiés par
 * TypeScript et compatibles partout — et le test `connectors.test.ts` échoue si
 * un dossier présent sur le disque a été oublié dans cette liste.
 */
export const connectors: AnyConnector[] = [axonaut, brevo, gmail];
