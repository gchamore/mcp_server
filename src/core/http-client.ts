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
      throw upstreamError(
        await describeFailure(this.serviceName, response, this.secretValues(headers)),
        undefined,
      );
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

  /**
   * Valeurs d'en-tête à ne jamais répéter dans un message d'erreur.
   *
   * On ne devine pas ce qui est secret : on prend les en-têtes d'authentification
   * usuels, tels qu'ils partent effectivement pour cette requête.
   */
  private secretValues(headers: Record<string, string>): string[] {
    const sensitive = ['authorization', 'api-key', 'x-api-key', 'apikey', 'access-token'];

    return Object.entries(headers)
      .filter(([name]) => sensitive.includes(name.toLowerCase()))
      .flatMap(([, value]) => {
        // `Bearer xxx` : la valeur seule compte autant que l'en-tête entier.
        const parts = value.split(' ');
        return parts.length > 1 ? [value, parts[parts.length - 1] as string] : [value];
      })
      .filter(Boolean);
  }

  get<T>(path: string, options: Omit<RequestOptions, 'path' | 'method' | 'body'> = {}) {
    return this.request<T>({ ...options, path, method: 'GET' });
  }

  post<T>(path: string, body: unknown, options: Omit<RequestOptions, 'path' | 'method'> = {}) {
    return this.request<T>({ ...options, path, method: 'POST', body });
  }
}

async function describeFailure(
  serviceName: string,
  response: Response,
  secrets: string[],
): Promise<string> {
  const hint = await readErrorHint(response, secrets);

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

/**
 * Champs par lesquels les API décrivent une erreur. La liste est courte et
 * fermée : tout le reste du corps est ignoré.
 */
const MESSAGE_FIELDS = ['message', 'error_description', 'error', 'detail', 'title'] as const;

/**
 * Extrait une indication exploitable du corps d'erreur.
 *
 * La version précédente recopiait les 200 premiers caractères du corps brut,
 * qui repart ensuite vers le modèle. Or un service qui échoue renvoie parfois
 * la requête qui a échoué — en-têtes compris. Le commentaire de
 * `mcp/server-factory.ts` affirmait pourtant que ces messages « ne remontent
 * que des messages construits par nos soins » : c'était faux, et une
 * affirmation fausse dans un commentaire de sécurité est pire qu'un commentaire
 * absent, parce qu'elle dispense le lecteur de vérifier.
 *
 * Deux garde-fous désormais :
 *
 *  1. seuls des champs de message reconnus sont lus, jamais le corps entier —
 *     un service qui renvoie autre chose ne produit simplement aucune
 *     indication ;
 *  2. les valeurs d'authentification que ce client envoie lui-même sont
 *     retirées de ce qu'il restitue. Il les connaît : il est le mieux placé
 *     pour refuser de les répéter.
 */
async function readErrorHint(response: Response, secrets: string[]): Promise<string> {
  try {
    const text = (await response.text()).trim();
    if (!text) return '';

    let message: string | undefined;
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === 'object') {
        const record = parsed as Record<string, unknown>;
        for (const field of MESSAGE_FIELDS) {
          const value = record[field];
          if (typeof value === 'string' && value.trim()) {
            message = value.trim();
            break;
          }
        }
      }
    } catch {
      // Corps non-JSON : rien de structuré à extraire, donc rien à restituer.
      return '';
    }

    if (!message) return '';
    return ` ${redact(message, secrets).slice(0, 160)}`;
  } catch {
    return '';
  }
}

/** Retire d'un texte toute occurrence des secrets envoyés par ce client. */
function redact(text: string, secrets: string[]): string {
  return secrets.reduce(
    (acc, secret) => (secret.length >= 8 ? acc.split(secret).join('[masqué]') : acc),
    text,
  );
}
