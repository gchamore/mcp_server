/**
 * Types partagés avec l'API.
 *
 * Ils reflètent les projections publiques du serveur (`ConnectorSummary`,
 * `ConnectionView`, `PublicUser`). Le front n'a aucune connaissance codée en
 * dur d'un connecteur particulier : tout arrive par `/api/connectors`.
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

export type McpAccessMode = 'INDIVIDUAL' | 'SHARED';

/** Ce que l'écran de consentement doit afficher. */
export interface ConsentView {
  client: { name: string; clientId: string };
  /** Nul si le client IA n'a pas transmis d'indicateur de ressource. */
  connector: Connector | null;
  /** Renseigné uniquement lorsque `connector` est nul. */
  selectableConnectors: { id: string; name: string; tagline: string; icon: string }[];
  establishedMode: McpAccessMode | null;
  isOwner: boolean;
  connections: { id: string; label: string; accountLabel: string | null; status: string }[];
  sharedConnection: { id: string; label: string; accountLabel: string | null } | null;
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
  accesses: { connectorId: string; mode: McpAccessMode; owner: { email: string } }[];
}

export interface UsageStats {
  days: number;
  since: string;
  tools: { connectorId: string; toolName: string; calls: number; failures: number; avgMs: number }[];
}
