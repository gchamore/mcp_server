import { HttpClient } from '../../core/http-client.js';

/**
 * Client de l'API Axonaut v2.
 *
 * Particularité de l'API : la pagination passe par `?page=N` et renvoie soit un
 * tableau brut, soit un objet `{ data: [...] }` selon l'endpoint. `unwrap()`
 * absorbe les deux formes pour que les outils n'aient jamais à s'en soucier.
 */

export interface AxonautCompany {
  id: number;
  name: string;
  email?: string | null;
  phone_number?: string | null;
  currency?: string | null;
  is_customer?: boolean;
  is_prospect?: boolean;
  is_supplier?: boolean;
  comments?: string | null;
  address_street?: string | null;
  address_city?: string | null;
  address_zip_code?: string | null;
}

export interface AxonautEmployee {
  id: number;
  firstname?: string | null;
  lastname?: string | null;
  email?: string | null;
  cellphone_number?: string | null;
  phone_number?: string | null;
  job?: string | null;
  company_id?: number | null;
  company_name?: string | null;
}

export interface AxonautInvoiceLine {
  id?: number;
  product_name?: string | null;
  description?: string | null;
  quantity?: number | null;
  price?: number | null;
  pre_tax_amount?: number | null;
}

export interface AxonautInvoice {
  id: number;
  number?: string | null;
  date?: string | null;
  due_date?: string | null;
  pre_tax_amount?: number | null;
  total_amount?: number | null;
  currency?: string | null;
  is_paid?: boolean;
  company_id?: number | null;
  company_name?: string | null;
  invoice_lines?: AxonautInvoiceLine[];
}

export interface AxonautQuotation {
  id: number;
  number?: string | null;
  title?: string | null;
  date?: string | null;
  pre_tax_amount?: number | null;
  total_amount?: number | null;
  status?: string | null;
  company_name?: string | null;
}

export interface AxonautProject {
  id: number;
  name: string;
  description?: string | null;
  status?: string | null;
  company_id?: number | null;
  company_name?: string | null;
}

export interface AxonautExpense {
  id: number;
  title?: string | null;
  date?: string | null;
  pre_tax_amount?: number | null;
  total_amount?: number | null;
  supplier_name?: string | null;
}

export interface AxonautAccount {
  company_name?: string | null;
  name?: string | null;
  email?: string | null;
}

type Paginated<T> = T[] | { data?: T[] };

function unwrap<T>(payload: Paginated<T> | null | undefined): T[] {
  if (Array.isArray(payload)) return payload;
  return payload?.data ?? [];
}

export class AxonautClient {
  private readonly http: HttpClient;

  constructor(apiKey: string, signal?: AbortSignal) {
    this.http = new HttpClient({
      baseUrl: 'https://axonaut.com/api/v2',
      serviceName: 'Axonaut',
      headers: { userApiKey: apiKey, 'User-Agent': 'mcp-wesype/2.0' },
      timeoutMs: 20_000,
    });
    this.signal = signal;
  }

  private readonly signal: AbortSignal | undefined;

  private options() {
    return this.signal ? { signal: this.signal } : {};
  }

  getAccount(): Promise<AxonautAccount> {
    return this.http.get<AxonautAccount>('/me', this.options());
  }

  async listCompanies(params: { page?: number; search?: string } = {}): Promise<AxonautCompany[]> {
    const payload = await this.http.get<Paginated<AxonautCompany>>('/companies', {
      ...this.options(),
      query: { page: params.page ?? 1, name: params.search },
    });
    return unwrap(payload);
  }

  getCompany(companyId: number): Promise<AxonautCompany> {
    return this.http.get<AxonautCompany>(`/companies/${companyId}`, this.options());
  }

  createCompany(input: {
    name: string;
    email?: string;
    currency?: string;
    comments?: string;
    is_customer?: boolean;
    is_prospect?: boolean;
  }): Promise<AxonautCompany> {
    return this.http.post<AxonautCompany>('/companies', input, this.options());
  }

  async listEmployees(
    params: { page?: number; companyId?: number } = {},
  ): Promise<AxonautEmployee[]> {
    const path = params.companyId ? `/companies/${params.companyId}/employees` : '/employees';
    const payload = await this.http.get<Paginated<AxonautEmployee>>(path, {
      ...this.options(),
      query: { page: params.page ?? 1 },
    });
    return unwrap(payload);
  }

  createEmployee(input: {
    firstname: string;
    lastname: string;
    email?: string;
    cellphone_number?: string;
    job?: string;
    company_id?: number;
  }): Promise<AxonautEmployee> {
    return this.http.post<AxonautEmployee>('/employees', input, this.options());
  }

  async listInvoices(
    params: { page?: number; companyId?: number; isPaid?: boolean } = {},
  ): Promise<AxonautInvoice[]> {
    const payload = await this.http.get<Paginated<AxonautInvoice>>('/invoices', {
      ...this.options(),
      query: {
        page: params.page ?? 1,
        company_id: params.companyId,
        is_paid: params.isPaid,
      },
    });
    return unwrap(payload);
  }

  getInvoice(invoiceId: number): Promise<AxonautInvoice> {
    return this.http.get<AxonautInvoice>(`/invoices/${invoiceId}`, this.options());
  }

  async listQuotations(params: { page?: number } = {}): Promise<AxonautQuotation[]> {
    const payload = await this.http.get<Paginated<AxonautQuotation>>('/quotations', {
      ...this.options(),
      query: { page: params.page ?? 1 },
    });
    return unwrap(payload);
  }

  async listProjects(params: { page?: number } = {}): Promise<AxonautProject[]> {
    const payload = await this.http.get<Paginated<AxonautProject>>('/projects', {
      ...this.options(),
      query: { page: params.page ?? 1 },
    });
    return unwrap(payload);
  }

  async listExpenses(params: { page?: number } = {}): Promise<AxonautExpense[]> {
    const payload = await this.http.get<Paginated<AxonautExpense>>('/expenses', {
      ...this.options(),
      query: { page: params.page ?? 1 },
    });
    return unwrap(payload);
  }
}
