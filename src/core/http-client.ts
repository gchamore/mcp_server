import { upstreamError } from './errors.js';

/**
 * Petit client HTTP partagé par les connecteurs. Volontairement minimal :
 * `fetch` natif (Node 20+), un délai maximal, et une traduction des erreurs
 * distantes en messages exploitables par le modèle et par l'utilisateur.
 *
 * Aucun log d'en-têtes ni de corps : les connecteurs transportent des clés API.
 */

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export class HttpClient {
  private readonly baseUrl: string;
  private readonly defaultHeaders: Record<string, string>;
  private readonly serviceName: string;
  private readonly defaultTimeoutMs: number;

  constructor(options: {
    baseUrl: string;
    serviceName: string;
    headers?: Record<string, string>;
    timeoutMs?: number;
  }) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.serviceName = options.serviceName;
    this.defaultHeaders = { Accept: 'application/json', ...options.headers };
    this.defaultTimeoutMs = options.timeoutMs ?? 15_000;
  }

  async request<T>(options: RequestOptions): Promise<T> {
    const url = new URL(`${this.baseUrl}${options.path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }

    const timeout = AbortSignal.timeout(options.timeoutMs ?? this.defaultTimeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

    const headers: Record<string, string> = { ...this.defaultHeaders, ...options.headers };
    let payload: string | undefined;
    if (options.body !== undefined) {
      payload = JSON.stringify(options.body);
      headers['Content-Type'] = 'application/json';
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method ?? 'GET',
        headers,
        body: payload,
        signal,
      });
    } catch (cause) {
      if (cause instanceof Error && cause.name === 'TimeoutError') {
        throw upstreamError(`${this.serviceName} n'a pas répondu dans le délai imparti.`, cause);
      }
      if (cause instanceof Error && cause.name === 'AbortError') {
        throw upstreamError(`Requête ${this.serviceName} annulée.`, cause);
      }
      throw upstreamError(`Impossible de joindre ${this.serviceName}.`, cause);
    }

    if (!response.ok) {
      throw upstreamError(await describeFailure(this.serviceName, response), undefined);
    }

    if (response.status === 204) return undefined as T;

    const text = await response.text();
    if (text.length === 0) return undefined as T;

    try {
      return JSON.parse(text) as T;
    } catch (cause) {
      throw upstreamError(`Réponse ${this.serviceName} illisible (JSON invalide).`, cause);
    }
  }

  get<T>(path: string, options: Omit<RequestOptions, 'path' | 'method' | 'body'> = {}) {
    return this.request<T>({ ...options, path, method: 'GET' });
  }

  post<T>(path: string, body: unknown, options: Omit<RequestOptions, 'path' | 'method'> = {}) {
    return this.request<T>({ ...options, path, method: 'POST', body });
  }
}

async function describeFailure(serviceName: string, response: Response): Promise<string> {
  const hint = await readErrorHint(response);

  switch (response.status) {
    case 401:
    case 403:
      return `${serviceName} a refusé les identifiants (${response.status}). Vérifiez la clé API dans les paramètres de la connexion.`;
    case 404:
      return `${serviceName} : ressource introuvable (404).${hint}`;
    case 429:
      return `${serviceName} applique une limite de débit (429). Réessayez dans un instant.`;
    default:
      return response.status >= 500
        ? `${serviceName} rencontre un incident (${response.status}). Réessayez plus tard.`
        : `${serviceName} a renvoyé une erreur ${response.status}.${hint}`;
  }
}

/** Extrait un extrait court du corps d'erreur, borné pour ne rien déverser. */
async function readErrorHint(response: Response): Promise<string> {
  try {
    const text = (await response.text()).trim();
    if (!text) return '';
    return ` ${text.slice(0, 200)}`;
  } catch {
    return '';
  }
}
