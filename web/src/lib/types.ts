/**
 * Types de l'API, réexportés depuis le contrat partagé.
 *
 * Ce fichier contenait auparavant une copie manuelle des projections du
 * serveur. Rien ne garantissait qu'elle reste fidèle : une désynchronisation ne
 * se manifestait qu'à l'exécution, sous la forme d'un champ `undefined` là où
 * l'interface en attendait un — et le typage, parfaitement satisfait des deux
 * côtés, ne pouvait rien signaler.
 *
 * La définition vit désormais dans `src/shared/api-types.ts`. On la réexporte
 * ici pour que les imports de l'interface restent inchangés, et que ce point
 * d'entrée continue de dire où trouver les types de l'API.
 *
 * L'import est déclaré `type` : il est effacé à la transformation, et aucun
 * fichier du serveur ne se retrouve dans le bundle du navigateur.
 */
export type {
  AdminOverview,
  AdminUser,
  AuthProvider,
  AuthProviders,
  Category,
  Connection,
  ConnectionStatus,
  Connector,
  ConnectorAuth,
  ConnectorStatus,
  ConnectorTool,
  ConsentView,
  CredentialField,
  CredentialFieldType,
  CredentialPreview,
  Endpoint,
  McpClient,
  Role,
  UsageStats,
  User,
} from '../../../src/shared/api-types';
