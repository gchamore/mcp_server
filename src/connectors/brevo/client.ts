import { HttpClient } from '../../core/http-client.js';

/** Client de l'API Brevo v3 (ex-Sendinblue) : marketing et e-mail transactionnel. */

export interface BrevoAccount {
  email?: string;
  companyName?: string;
  firstName?: string;
  lastName?: string;
  plan?: { type?: string; credits?: number }[];
}

export interface BrevoContact {
  id: number;
  email: string;
  emailBlacklisted?: boolean;
  smsBlacklisted?: boolean;
  createdAt?: string;
  listIds?: number[];
  attributes?: Record<string, unknown>;
}

export interface BrevoList {
  id: number;
  name: string;
  totalSubscribers?: number;
  totalBlacklisted?: number;
  folderId?: number;
}

export interface BrevoCampaign {
  id: number;
  name: string;
  subject?: string;
  status?: string;
  type?: string;
  scheduledAt?: string;
  statistics?: { globalStats?: { sent?: number; delivered?: number; uniqueClicks?: number } };
}

export class BrevoClient {
  private readonly http: HttpClient;
  private readonly signal: AbortSignal | undefined;

  constructor(apiKey: string, signal?: AbortSignal) {
    this.http = new HttpClient({
      baseUrl: 'https://api.brevo.com/v3',
      serviceName: 'Brevo',
      headers: { 'api-key': apiKey, 'User-Agent': 'mcp-wesype/2.0' },
    });
    this.signal = signal;
  }

  private options() {
    return this.signal ? { signal: this.signal } : {};
  }

  getAccount(): Promise<BrevoAccount> {
    return this.http.get<BrevoAccount>('/account', this.options());
  }

  async listContacts(params: { limit?: number; offset?: number; listId?: number } = {}) {
    const path = params.listId ? `/contacts/lists/${params.listId}/contacts` : '/contacts';
    const payload = await this.http.get<{ contacts?: BrevoContact[]; count?: number }>(path, {
      ...this.options(),
      query: { limit: params.limit ?? 25, offset: params.offset ?? 0 },
    });
    return { contacts: payload.contacts ?? [], total: payload.count ?? 0 };
  }

  getContact(identifier: string): Promise<BrevoContact> {
    return this.http.get<BrevoContact>(
      `/contacts/${encodeURIComponent(identifier)}`,
      this.options(),
    );
  }

  createContact(input: {
    email: string;
    attributes?: Record<string, unknown>;
    listIds?: number[];
    updateEnabled?: boolean;
  }): Promise<{ id?: number }> {
    return this.http.post<{ id?: number }>('/contacts', input, this.options());
  }

  async listLists(params: { limit?: number; offset?: number } = {}) {
    const payload = await this.http.get<{ lists?: BrevoList[]; count?: number }>(
      '/contacts/lists',
      {
        ...this.options(),
        query: { limit: params.limit ?? 25, offset: params.offset ?? 0 },
      },
    );
    return { lists: payload.lists ?? [], total: payload.count ?? 0 };
  }

  async listCampaigns(params: { limit?: number; offset?: number; status?: string } = {}) {
    const payload = await this.http.get<{ campaigns?: BrevoCampaign[]; count?: number }>(
      '/emailCampaigns',
      {
        ...this.options(),
        query: { limit: params.limit ?? 20, offset: params.offset ?? 0, status: params.status },
      },
    );
    return { campaigns: payload.campaigns ?? [], total: payload.count ?? 0 };
  }

  sendTransactionalEmail(input: {
    sender: { email: string; name?: string };
    to: { email: string; name?: string }[];
    subject: string;
    htmlContent: string;
  }): Promise<{ messageId?: string }> {
    return this.http.post<{ messageId?: string }>('/smtp/email', input, this.options());
  }
}
