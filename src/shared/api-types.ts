/**
 * ===========================================================================
 *  Contrat de l'API — source unique
 * ===========================================================================
 *
 * Ces types décrivent ce que l'API REST renvoie. Ils étaient recopiés à la main
 * dans `web/src/lib/types.ts` : rien ne garantissait qu'ils correspondent au
 * serveur, et une désynchronisation ne se voyait qu'à l'exécution, sous la
 * forme d'un champ `undefined` là où l'interface en attendait un.
 *
 * Le fichier vit désormais côté serveur et le navigateur le réexporte. La
 * copie disparaît : il n'y a plus qu'une définition à modifier, et les deux
 * compilations la voient.
 *
 * ---------------------------------------------------------------------------
 * Deux règles à respecter en le modifiant
 * ---------------------------------------------------------------------------
 *
 *  1. **Aucun import.** Ce fichier est compilé par le navigateur, qui ne
 *     dispose ni des types Node ni de ceux de Prisma. Une seule dépendance
 *     suffirait à casser la compilation de l'interface.
 *  2. **Rien qui produise du code.** Uniquement des `type` et des `interface` :
 *     l'import est effacé à la transformation, le fichier ne part donc jamais
 *     dans le bundle.
 */

export type Role = 'USER' | 'ADMIN';
export type AuthProvider = 'LOCAL' | 'GOOGLE';
export type ConnectionStatus = 'PENDING' | 'ACTIVE' | 'ERROR';
export type ConnectorStatus = 'stable' | 'beta' | 'coming-soon';
export type CredentialFieldType = 'text' | 'password' | 'url' | 'email' | 'select';

export interface User {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  role: Role;
  provider: AuthProvider;
  hasPassword: boolean;
  createdAt: string;
}

export interface CredentialField {
  key: string;
  label: string;
  type: CredentialFieldType;
  required?: boolean;
  placeholder?: string;
  help?: string;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  defaultValue?: string;
  options?: { value: string; label: string }[];
}

export interface ConnectorAuth {
  type: 'api_key' | 'basic' | 'bearer' | 'oauth2';
  /** Vide pour un connecteur OAuth : l'utilisateur ne saisit rien. */
  fields: CredentialField[];
  docsUrl?: string;
  instructions?: string;
  /** Scopes demandés au service tiers, affichés avant consentement. */
  scopes?: string[];
}

export interface ConnectorTool {
  name: string;
  title: string;
  description: string;
  readOnly: boolean;
}

export interface Connector {
  id: string;
  name: string;
  tagline: string;
  description: string;
  category: string;
  status: ConnectorStatus;
  icon: string;
  accentColor: string;
  docsUrl?: string;
  auth: ConnectorAuth;
  /** false si l'application OAuth du service n'est pas configurée sur ce serveur. */
  available: boolean;
  unavailableReason?: string;
  /** URL publique à coller dans un client IA. */
  mcpUrl: string;
  tools: ConnectorTool[];
  toolCount: number;
}

/** Ce que l'écran de consentement doit afficher. */
export interface ConsentView {
  client: { name: string; clientId: string };
  /** true pour /mcp/hub : sélecteur multi-services avec cochage des outils. */
  hub: boolean;
  /** Nul si le client IA n'a pas transmis d'indicateur de ressource. */
  connector: Connector | null;
  /** Renseigné uniquement lorsque `connector` est nul. */
  selectableConnectors: { id: string; name: string; tagline: string; icon: string }[];
  connections: {
    id: string;
    label: string;
    accountLabel: string | null;
    status: string;
    connectorId?: string;
    connectorName?: string;
    connectorIcon?: string;
    tools?: { name: string; title: string; readOnly: boolean }[];
  }[];
  requiresConnectorOAuth: boolean;
  connectorAvailable: boolean;
  scopes: string[];
}

export interface Category {
  id: string;
  label: string;
  count: number;
}

export interface Endpoint {
  id: string;
  name: string;
  tokenHint: string;
  callCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  revoked: boolean;
}

export interface CredentialPreview {
  key: string;
  label: string;
  filled: boolean;
  preview: string;
}

export interface Connection {
  id: string;
  connectorId: string;
  label: string;
  status: ConnectionStatus;
  statusMessage: string | null;
  accountLabel: string | null;
  lastVerifiedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  credentials: CredentialPreview[];
  endpoints: Endpoint[];
  connector: Connector;
}

export interface AuthProviders {
  password: boolean;
  google: boolean;
  passwordReset: boolean;
}

export interface AdminOverview {
  period: { days: number; since: string };
  totals: {
    users: number;
    activeUsers: number;
    connections: number;
    endpoints: number;
    connectors: number;
  };
  calls: { total: number; failed: number; successRate: number };
  connectors: { id: string; name: string; tools: number; status: string; calls: number }[];
  recentActivity: {
    id: string;
    action: string;
    createdAt: string;
    targetType: string | null;
    user: { email: string } | null;
  }[];
}

export interface AdminUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: Role;
  provider: AuthProvider;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  _count: { connections: number };
}

export interface McpClient {
  id: string;
  clientId: string;
  name: string;
  isStatic: boolean;
  redirectUris: string[];
  lastUsedAt: string | null;
  createdAt: string;
  _count: { tokens: number };
  accesses: { connectorId: string; owner: { email: string } }[];
}

export interface UsageStats {
  days: number;
  since: string;
  tools: {
    connectorId: string;
    toolName: string;
    calls: number;
    failures: number;
    avgMs: number;
  }[];
}
