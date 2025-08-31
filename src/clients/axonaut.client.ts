import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';

export interface AxonautContact {
  id: number;
  name: string;
  email?: string;
  phone?: string;
  company?: {
    id: number;
    name: string;
  };
}

export interface AxonautCompany {
  id: number;
  name: string;
  email?: string;
  currency?: string;
  is_customer?: boolean;
  is_prospect?: boolean;
  comments?: string;
}

export interface AxonautProject {
  id: number;
  name: string;
  description?: string;
  status?: string;
  company?: {
    id: number;
    name: string;
  };
}

export interface AxonautInvoice {
  id: number;
  number?: string;
  date?: string;
  creation_date?: string;
  amount?: number;
  total_amount?: number;
  pre_tax_amount?: number;
  status?: string;
  company?: {
    id: number;
    name: string;
    email?: string;
  };
  invoice_lines?: Array<{
    id: number;
    product_name?: string;
    description?: string;
    quantity?: number;
    unit_price?: number;
    total_pre_tax_amount?: number;
  }>;
}

export interface AxonautApiResponse<T> {
  data?: T[];
  meta?: {
    current_page: number;
    total_pages: number;
    total_count: number;
  };
}

export class AxonautClient {
  private client: AxiosInstance;
  private baseUrl: string;
  private apiKey: string;

  constructor(apiKey: string, baseUrl: string = 'https://axonaut.com') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    
    this.client = axios.create({
      baseURL: `${this.baseUrl}/api/v2`,
      headers: {
        'userApiKey': apiKey,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'MCP-Axonaut-Client/1.0.0'
      },
      timeout: 10000,  // Même timeout que le test réussi
      validateStatus: function (status) {
        return status >= 200 && status < 300; // Statuts valides
      }
    });

    // Intercepteur pour les logs
    this.client.interceptors.request.use(
      (config) => {
        console.log(`🔗 [AxonautClient] Requête: ${config.method?.toUpperCase()} ${config.baseURL}${config.url}`);
        console.log(`🔗 [AxonautClient] Headers complets:`, JSON.stringify(config.headers, null, 2));
        console.log(`🔗 [AxonautClient] Timeout:`, config.timeout);
        return config;
      },
      (error) => {
        console.error('❌ [AxonautClient] Request Error:', error);
        return Promise.reject(error);
      }
    );

    this.client.interceptors.response.use(
      (response) => {
        console.log(`✅ Axonaut API: ${response.status} ${response.config.url}`);
        return response;
      },
      (error) => {
        const url = error.config?.url || 'unknown';
        const status = error.response?.status || 'unknown';
        console.error(`❌ Axonaut API Error: ${status} ${url}`);
        
        if (error.response?.data) {
          console.error('Error details:', error.response.data);
        }
        
        return Promise.reject(error);
      }
    );
  }

  /**
   * Test de connexion à l'API Axonaut
   */
  async testConnection(): Promise<{ success: boolean; message: string; data?: any }> {
    try {
      console.log('🔍 [AxonautClient] Test de connexion...');
      console.log('🔑 [AxonautClient] API Key reçue:', this.apiKey ? `${this.apiKey.substring(0, 10)}...` : 'VIDE');
      console.log('🌐 [AxonautClient] Base URL:', this.client.defaults.baseURL);
      console.log('📋 [AxonautClient] Headers:', JSON.stringify(this.client.defaults.headers, null, 2));
      
      const response = await this.client.get('/me');
      
      console.log('✅ [AxonautClient] Connexion réussie:', response.status);
      console.log('📊 [AxonautClient] Données reçues:', JSON.stringify(response.data, null, 2));
      
      return {
        success: true,
        message: 'Connexion à Axonaut réussie',
        data: response.data
      };
    } catch (error: any) {
      console.error('❌ [AxonautClient] Erreur de connexion:', error.message);
      console.error('📄 [AxonautClient] Status:', error.response?.status);
      console.error('📄 [AxonautClient] Status Text:', error.response?.statusText);
      console.error('📄 [AxonautClient] Response Data:', JSON.stringify(error.response?.data, null, 2));
      console.error('📄 [AxonautClient] Request Headers:', JSON.stringify(error.config?.headers, null, 2));
      console.error('📄 [AxonautClient] Request URL:', error.config?.url);
      
      return {
        success: false,
        message: `Erreur de connexion: ${error.response?.status || error.message}`,
        data: error.response?.data
      };
    }
  }

  /**
   * Récupérer les entreprises
   */
  async getCompanies(params?: {
    limit?: number;
    page?: number;
    search?: string;
  }): Promise<AxonautCompany[]> {
    try {
      const queryParams = new URLSearchParams();
      if (params?.limit) queryParams.append('limit', params.limit.toString());
      if (params?.page) queryParams.append('page', params.page.toString());
      if (params?.search) queryParams.append('search', params.search);

      const url = `/companies${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
      const response = await this.client.get<AxonautApiResponse<AxonautCompany>>(url);
      
      return Array.isArray(response.data) ? response.data : (response.data.data || []);
    } catch (error: any) {
      throw new Error(`Erreur lors de la récupération des entreprises: ${error.message}`);
    }
  }

  /**
   * Créer une nouvelle entreprise
   */
  async createCompany(companyData: {
    name: string;
    currency?: string;
    comments?: string;
    is_customer?: boolean;
    is_prospect?: boolean;
    email?: string;
  }): Promise<AxonautCompany> {
    try {
      const response = await this.client.post<AxonautCompany>('/companies', companyData);
      return response.data;
    } catch (error: any) {
      throw new Error(`Erreur lors de la création de l'entreprise: ${error.message}`);
    }
  }

  /**
   * Récupérer une entreprise spécifique
   */
  async getCompany(companyId: number): Promise<AxonautCompany> {
    try {
      const response = await this.client.get<AxonautCompany>(`/companies/${companyId}`);
      return response.data;
    } catch (error: any) {
      throw new Error(`Erreur lors de la récupération de l'entreprise: ${error.message}`);
    }
  }

  /**
   * Récupérer les projets
   */
  async getProjects(params?: {
    limit?: number;
    page?: number;
  }): Promise<AxonautProject[]> {
    try {
      const queryParams = new URLSearchParams();
      if (params?.limit) queryParams.append('limit', params.limit.toString());
      if (params?.page) queryParams.append('page', params.page.toString());

      const url = `/projects${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
      const response = await this.client.get<AxonautApiResponse<AxonautProject>>(url);
      
      return Array.isArray(response.data) ? response.data : (response.data.data || []);
    } catch (error: any) {
      throw new Error(`Erreur lors de la récupération des projets: ${error.message}`);
    }
  }

  /**
   * Créer un nouveau projet
   */
  async createProject(projectData: {
    name: string;
    description?: string;
    company_id?: number;
  }): Promise<AxonautProject> {
    try {
      const response = await this.client.post<AxonautProject>('/projects', projectData);
      return response.data;
    } catch (error: any) {
      throw new Error(`Erreur lors de la création du projet: ${error.message}`);
    }
  }

  /**
   * Récupérer les factures
   */
  async getInvoices(params?: {
    limit?: number;
    page?: number;
    status?: string;
    company_id?: number;
  }): Promise<AxonautInvoice[]> {
    try {
      const queryParams = new URLSearchParams();
      if (params?.limit) queryParams.append('limit', params.limit.toString());
      if (params?.page) queryParams.append('page', params.page.toString());
      if (params?.status) queryParams.append('status', params.status);
      if (params?.company_id) queryParams.append('company_id', params.company_id.toString());

      const url = `/invoices${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
      const response = await this.client.get<AxonautApiResponse<AxonautInvoice>>(url);
      
      return Array.isArray(response.data) ? response.data : (response.data.data || []);
    } catch (error: any) {
      throw new Error(`Erreur lors de la récupération des factures: ${error.message}`);
    }
  }

  /**
   * Récupérer une facture spécifique
   */
  async getInvoice(invoiceId: number): Promise<AxonautInvoice> {
    try {
      const response = await this.client.get<AxonautInvoice>(`/invoices/${invoiceId}`);
      return response.data;
    } catch (error: any) {
      throw new Error(`Erreur lors de la récupération de la facture: ${error.message}`);
    }
  }

  /**
   * Créer une nouvelle facture
   */
  async createInvoice(invoiceData: {
    company_id: number;
    date?: string;
    invoice_lines: Array<{
      product_name?: string;
      description?: string;
      quantity: number;
      unit_price: number;
    }>;
  }): Promise<AxonautInvoice> {
    try {
      const response = await this.client.post<AxonautInvoice>('/invoices', invoiceData);
      return response.data;
    } catch (error: any) {
      throw new Error(`Erreur lors de la création de la facture: ${error.message}`);
    }
  }

  /**
   * Récupérer les employés d'une entreprise
   */
  async getEmployees(companyId?: number, params?: {
    limit?: number;
    page?: number;
  }): Promise<AxonautContact[]> {
    try {
      const queryParams = new URLSearchParams();
      if (params?.limit) queryParams.append('limit', params.limit.toString());
      if (params?.page) queryParams.append('page', params.page.toString());

      let url;
      if (companyId) {
        url = `/companies/${companyId}/employees${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
      } else {
        url = `/employees${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
      }

      const response = await this.client.get<AxonautApiResponse<AxonautContact>>(url);
      
      return Array.isArray(response.data) ? response.data : (response.data.data || []);
    } catch (error: any) {
      throw new Error(`Erreur lors de la récupération des employés: ${error.message}`);
    }
  }

  /**
   * Créer un nouvel employé
   */
  async createEmployee(employeeData: {
    first_name: string;
    last_name: string;
    email?: string;
    phone?: string;
    company_id?: number;
  }): Promise<AxonautContact> {
    try {
      const response = await this.client.post<AxonautContact>('/employees', employeeData);
      return response.data;
    } catch (error: any) {
      throw new Error(`Erreur lors de la création de l'employé: ${error.message}`);
    }
  }

  /**
   * Créer un contact/employé
   */
  async createContact(contactData: {
    name: string;
    email?: string;
    phone?: string;
    company_id?: number;
  }): Promise<AxonautContact> {
    try {
      const response = await this.client.post<AxonautContact>('/employees', contactData);
      return response.data;
    } catch (error: any) {
      throw new Error(`Erreur lors de la création du contact: ${error.message}`);
    }
  }

  /**
   * Récupérer les informations du compte
   */
  async getAccountInfo(): Promise<any> {
    try {
      const response = await this.client.get('/me');
      return response.data;
    } catch (error: any) {
      throw new Error(`Erreur lors de la récupération des informations du compte: ${error.message}`);
    }
  }

  /**
   * Récupérer les utilisateurs du compte
   */
  async getUsers(): Promise<any[]> {
    try {
      const response = await this.client.get<AxonautApiResponse<any>>('/users');
      return Array.isArray(response.data) ? response.data : (response.data.data || []);
    } catch (error: any) {
      throw new Error(`Erreur lors de la récupération des utilisateurs: ${error.message}`);
    }
  }
}
