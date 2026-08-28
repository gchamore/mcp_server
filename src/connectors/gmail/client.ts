import { HttpClient } from '../../core/http-client.js';

/**
 * Client de l'API Gmail v1.
 *
 * Le jeton d'accès change à chaque rafraîchissement : il est donc passé au
 * constructeur et non figé dans une configuration de connecteur.
 */

export interface GmailProfile {
  emailAddress?: string;
  messagesTotal?: number;
  threadsTotal?: number;
}

export interface GmailLabel {
  id: string;
  name: string;
  type?: string;
  messagesTotal?: number;
  messagesUnread?: number;
}

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailPart {
  mimeType?: string;
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
}

export interface GmailMessage {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart & { headers?: GmailHeader[] };
}

/** Vue simplifiée d'un message, prête à être rendue pour le modèle. */
export interface GmailMessageSummary {
  id: string;
  threadId: string | undefined;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
  unread: boolean;
  body?: string;
}

export class GmailClient {
  private readonly http: HttpClient;
  private readonly signal: AbortSignal | undefined;

  constructor(accessToken: string, signal?: AbortSignal) {
    this.http = new HttpClient({
      baseUrl: 'https://gmail.googleapis.com/gmail/v1/users/me',
      serviceName: 'Gmail',
      headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'mcp-wesype/2.0' },
      timeoutMs: 20_000,
    });
    this.signal = signal;
  }

  private options() {
    return this.signal ? { signal: this.signal } : {};
  }

  getProfile(): Promise<GmailProfile> {
    return this.http.get<GmailProfile>('/profile', this.options());
  }

  async listLabels(): Promise<GmailLabel[]> {
    const payload = await this.http.get<{ labels?: GmailLabel[] }>('/labels', this.options());
    return payload.labels ?? [];
  }

  /**
   * Gmail renvoie d'abord une liste d'identifiants : il faut ensuite un appel
   * par message. On borne donc `maxResults` et on parallélise.
   */
  async listMessages(params: {
    query?: string;
    maxResults: number;
    labelIds?: string[];
  }): Promise<GmailMessageSummary[]> {
    const list = await this.http.get<{ messages?: { id: string }[] }>('/messages', {
      ...this.options(),
      query: {
        q: params.query,
        maxResults: params.maxResults,
        ...(params.labelIds?.length ? { labelIds: params.labelIds.join(',') } : {}),
      },
    });

    const ids = (list.messages ?? []).map((message) => message.id);
    const messages = await Promise.all(ids.map((id) => this.getMessage(id, 'metadata')));
    return messages;
  }

  async getMessage(id: string, format: 'metadata' | 'full' = 'full'): Promise<GmailMessageSummary> {
    const message = await this.http.get<GmailMessage>(`/messages/${encodeURIComponent(id)}`, {
      ...this.options(),
      query: {
        format,
        ...(format === 'metadata' ? { metadataHeaders: 'From,To,Subject,Date' } : {}),
      },
    });

    return summarize(message, format === 'full');
  }

  async sendMessage(input: {
    to: string;
    subject: string;
    body: string;
    cc?: string;
    replyToMessageId?: string;
    threadId?: string;
  }): Promise<{ id?: string; threadId?: string }> {
    const headers = [
      `To: ${input.to}`,
      ...(input.cc ? [`Cc: ${input.cc}`] : []),
      `Subject: ${encodeHeader(input.subject)}`,
      ...(input.replyToMessageId ? [`In-Reply-To: ${input.replyToMessageId}`] : []),
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset="UTF-8"',
    ];

    const raw = Buffer.from(`${headers.join('\r\n')}\r\n\r\n${input.body}`, 'utf8').toString(
      'base64url',
    );

    return this.http.post<{ id?: string; threadId?: string }>(
      '/messages/send',
      { raw, ...(input.threadId ? { threadId: input.threadId } : {}) },
      this.options(),
    );
  }
}

/** Les en-têtes non-ASCII doivent être encodés (RFC 2047). */
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function header(message: GmailMessage, name: string): string {
  const found = message.payload?.headers?.find(
    (entry) => entry.name.toLowerCase() === name.toLowerCase(),
  );
  return found?.value ?? '';
}

function summarize(message: GmailMessage, includeBody: boolean): GmailMessageSummary {
  return {
    id: message.id,
    threadId: message.threadId,
    from: header(message, 'From'),
    to: header(message, 'To'),
    subject: header(message, 'Subject'),
    date: header(message, 'Date'),
    snippet: decodeEntities(message.snippet ?? ''),
    unread: message.labelIds?.includes('UNREAD') ?? false,
    ...(includeBody ? { body: extractPlainText(message.payload) } : {}),
  };
}

/** Gmail encode le corps en base64url, éventuellement dans des parties imbriquées. */
function extractPlainText(part: GmailPart | undefined, depth = 0): string {
  if (!part || depth > 6) return '';

  if (part.mimeType === 'text/plain' && part.body?.data) {
    return Buffer.from(part.body.data, 'base64url').toString('utf8');
  }

  for (const child of part.parts ?? []) {
    const found = extractPlainText(child, depth + 1);
    if (found) return found;
  }

  // Repli sur le HTML, débarrassé de ses balises : mieux que rien pour le modèle.
  if (part.mimeType === 'text/html' && part.body?.data) {
    return Buffer.from(part.body.data, 'base64url')
      .toString('utf8')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return '';
}

function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}
