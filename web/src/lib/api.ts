import type {
  AdminOverview,
  AdminUser,
  AuthProviders,
  Category,
  Connection,
  Connector,
  ConsentView,
  Endpoint,
  McpClient,
  UsageStats,
  User,
} from './types';

/**
 * URL de raccordement d'un compte tiers (OAuth « couche B »).
 *
 * Volontairement une navigation complète et non un `fetch` : le parcours passe
 * par le site du fournisseur, il faut donc quitter l'application.
 */
export function connectorOAuthUrl(
  connectorId: string,
  options: { label?: string; returnTo: string },
) {
  const params = new URLSearchParams({ returnTo: options.returnTo });
  if (options.label) params.set('label', options.label);
  return `/api/connections/oauth/${connectorId}/start?${params.toString()}`;
}

/**
 * Client HTTP de l'API.
 *
 * L'authentification repose sur un cookie httpOnly posé par le serveur : il n'y
 * a donc aucun jeton à stocker côté JavaScript (l'ancienne version le mettait
 * dans `localStorage`, accessible à n'importe quel script injecté).
 * `credentials: 'include'` suffit.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** Erreurs par champ renvoyées par la validation zod du serveur. */
  readonly fields: Record<string, string>;

  constructor(status: number, code: string, message: string, fields: Record<string, string> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }

  get isUnauthenticated() {
    return this.status === 401;
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`/api${path}`, {
      method: options.method ?? 'GET',
      credentials: 'include',
      headers: options.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal ?? null,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError(0, 'NETWORK_ERROR', 'Serveur injoignable. Vérifiez votre connexion.');
  }

  if (response.status === 204) return undefined as T;

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string; details?: unknown } })
      ?.error;

    throw new ApiError(
      response.status,
      error?.code ?? 'UNKNOWN',
      error?.message ?? `Erreur ${response.status}`,
      isFieldMap(error?.details) ? error.details : {},
    );
  }

  return payload as T;
}

function isFieldMap(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === 'string')
  );
}

export const api = {
  auth: {
    providers: () => request<AuthProviders>('/auth/providers'),
    me: () => request<{ user: User }>('/auth/me'),
    login: (body: { email: string; password: string }) =>
      request<{ user: User }>('/auth/login', { method: 'POST', body }),
    register: (body: { email: string; password: string; firstName?: string; lastName?: string }) =>
      request<{ user: User }>('/auth/register', { method: 'POST', body }),
    logout: () => request<void>('/auth/logout', { method: 'POST' }),
    forgotPassword: (email: string) =>
      request<{ message: string }>('/auth/password/forgot', { method: 'POST', body: { email } }),
    verifyResetToken: (token: string) =>
      request<{ valid: boolean }>(`/auth/password/verify?token=${encodeURIComponent(token)}`),
    resetPassword: (body: { token: string; password: string }) =>
      request<{ message: string }>('/auth/password/reset', { method: 'POST', body }),
    changePassword: (body: { currentPassword: string; newPassword: string }) =>
      request<{ message: string }>('/auth/password/change', { method: 'POST', body }),
    revokeAllSessions: () =>
      request<{ revoked: number }>('/auth/sessions/revoke-all', { method: 'POST' }),
    deleteAccount: () => request<void>('/auth/account', { method: 'DELETE' }),
  },

  catalog: {
    list: (params: { q?: string; category?: string } = {}) => {
      const search = new URLSearchParams();
      if (params.q) search.set('q', params.q);
      if (params.category && params.category !== 'all') search.set('category', params.category);
      const suffix = search.size > 0 ? `?${search.toString()}` : '';
      return request<{ connectors: Connector[]; categories: Category[]; total: number }>(
        `/connectors${suffix}`,
      );
    },
    get: (connectorId: string) => request<{ connector: Connector }>(`/connectors/${connectorId}`),
  },

  connections: {
    list: () => request<{ connections: Connection[] }>('/connections'),
    get: (id: string) => request<{ connection: Connection }>(`/connections/${id}`),
    create: (body: { connectorId: string; label: string; credentials: Record<string, string> }) =>
      request<{ connection: Connection; endpointUrl: string }>('/connections', {
        method: 'POST',
        body,
      }),
    update: (id: string, body: { label?: string; credentials?: Record<string, string> }) =>
      request<{ connection: Connection }>(`/connections/${id}`, { method: 'PATCH', body }),
    verify: (id: string) =>
      request<{ connection: Connection }>(`/connections/${id}/verify`, { method: 'POST' }),
    remove: (id: string) => request<void>(`/connections/${id}`, { method: 'DELETE' }),

    addEndpoint: (id: string, name: string) =>
      request<{ endpoint: Endpoint; url: string }>(`/connections/${id}/endpoints`, {
        method: 'POST',
        body: { name },
      }),
    revealEndpoint: (id: string, endpointId: string) =>
      request<{ url: string }>(`/connections/${id}/endpoints/${endpointId}/reveal`, {
        method: 'POST',
      }),
    removeEndpoint: (id: string, endpointId: string) =>
      request<void>(`/connections/${id}/endpoints/${endpointId}`, { method: 'DELETE' }),
  },

  oauth: {
    /** Détail d'une demande d'autorisation émise par un client IA. */
    authorization: (demande: string, connectorId?: string) => {
      const params = new URLSearchParams({ demande });
      if (connectorId) params.set('connectorId', connectorId);
      return request<ConsentView>(`/oauth/authorization?${params.toString()}`);
    },
    approve: (body: { demande: string; connectionId?: string; connectorId?: string }) =>
      request<{ redirectTo: string }>('/oauth/authorization/approve', { method: 'POST', body }),
    deny: (demande: string) =>
      request<{ redirectTo: string }>('/oauth/authorization/deny', {
        method: 'POST',
        body: { demande },
      }),
  },

  admin: {
    overview: () => request<AdminOverview>('/admin/overview'),
    users: (params: { page?: number; q?: string } = {}) => {
      const search = new URLSearchParams();
      if (params.page) search.set('page', String(params.page));
      if (params.q) search.set('q', params.q);
      const suffix = search.size > 0 ? `?${search.toString()}` : '';
      return request<{
        users: AdminUser[];
        page: number;
        perPage: number;
        total: number;
        pages: number;
      }>(`/admin/users${suffix}`);
    },
    updateUser: (id: string, body: { role?: 'USER' | 'ADMIN'; isActive?: boolean }) =>
      request<{ user: Pick<AdminUser, 'id' | 'email' | 'role' | 'isActive'> }>(
        `/admin/users/${id}`,
        { method: 'PATCH', body },
      ),
    usage: (days = 7) => request<UsageStats>(`/admin/usage?days=${days}`),

    mcpClients: () =>
      request<{ clients: McpClient[]; dustRedirectUris: string[] }>('/admin/mcp-clients'),
    createMcpClient: (body: { name: string; redirectUris: string[] }) =>
      request<{
        clientId: string;
        clientSecret: string;
        authorizationEndpoint: string;
        tokenEndpoint: string;
        scopes: string;
      }>('/admin/mcp-clients', { method: 'POST', body }),
    deleteMcpClient: (id: string) =>
      request<void>(`/admin/mcp-clients/${id}`, { method: 'DELETE' }),
    purgeMcpClients: () =>
      request<{ removed: number }>('/admin/mcp-clients/purge', { method: 'POST' }),
  },
};
