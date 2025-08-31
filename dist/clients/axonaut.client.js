import axios from 'axios';
export class AxonautClient {
    constructor(apiKey, baseUrl = 'https://axonaut.com') {
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
            timeout: 10000,
            validateStatus: function (status) {
                return status >= 200 && status < 300;
            }
        });
        this.client.interceptors.request.use((config) => {
            console.log(`🔗 [AxonautClient] Requête: ${config.method?.toUpperCase()} ${config.baseURL}${config.url}`);
            console.log(`🔗 [AxonautClient] Headers complets:`, JSON.stringify(config.headers, null, 2));
            console.log(`🔗 [AxonautClient] Timeout:`, config.timeout);
            return config;
        }, (error) => {
            console.error('❌ [AxonautClient] Request Error:', error);
            return Promise.reject(error);
        });
        this.client.interceptors.response.use((response) => {
            console.log(`✅ Axonaut API: ${response.status} ${response.config.url}`);
            return response;
        }, (error) => {
            const url = error.config?.url || 'unknown';
            const status = error.response?.status || 'unknown';
            console.error(`❌ Axonaut API Error: ${status} ${url}`);
            if (error.response?.data) {
                console.error('Error details:', error.response.data);
            }
            return Promise.reject(error);
        });
    }
    async testConnection() {
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
        }
        catch (error) {
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
    async getCompanies(params) {
        try {
            const queryParams = new URLSearchParams();
            if (params?.limit)
                queryParams.append('limit', params.limit.toString());
            if (params?.page)
                queryParams.append('page', params.page.toString());
            if (params?.search)
                queryParams.append('search', params.search);
            const url = `/companies${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
            const response = await this.client.get(url);
            return Array.isArray(response.data) ? response.data : (response.data.data || []);
        }
        catch (error) {
            throw new Error(`Erreur lors de la récupération des entreprises: ${error.message}`);
        }
    }
    async createCompany(companyData) {
        try {
            const response = await this.client.post('/companies', companyData);
            return response.data;
        }
        catch (error) {
            throw new Error(`Erreur lors de la création de l'entreprise: ${error.message}`);
        }
    }
    async getCompany(companyId) {
        try {
            const response = await this.client.get(`/companies/${companyId}`);
            return response.data;
        }
        catch (error) {
            throw new Error(`Erreur lors de la récupération de l'entreprise: ${error.message}`);
        }
    }
    async getProjects(params) {
        try {
            const queryParams = new URLSearchParams();
            if (params?.limit)
                queryParams.append('limit', params.limit.toString());
            if (params?.page)
                queryParams.append('page', params.page.toString());
            const url = `/projects${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
            const response = await this.client.get(url);
            return Array.isArray(response.data) ? response.data : (response.data.data || []);
        }
        catch (error) {
            throw new Error(`Erreur lors de la récupération des projets: ${error.message}`);
        }
    }
    async createProject(projectData) {
        try {
            const response = await this.client.post('/projects', projectData);
            return response.data;
        }
        catch (error) {
            throw new Error(`Erreur lors de la création du projet: ${error.message}`);
        }
    }
    async getInvoices(params) {
        try {
            const queryParams = new URLSearchParams();
            if (params?.limit)
                queryParams.append('limit', params.limit.toString());
            if (params?.page)
                queryParams.append('page', params.page.toString());
            if (params?.status)
                queryParams.append('status', params.status);
            if (params?.company_id)
                queryParams.append('company_id', params.company_id.toString());
            const url = `/invoices${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
            const response = await this.client.get(url);
            return Array.isArray(response.data) ? response.data : (response.data.data || []);
        }
        catch (error) {
            throw new Error(`Erreur lors de la récupération des factures: ${error.message}`);
        }
    }
    async getInvoice(invoiceId) {
        try {
            const response = await this.client.get(`/invoices/${invoiceId}`);
            return response.data;
        }
        catch (error) {
            throw new Error(`Erreur lors de la récupération de la facture: ${error.message}`);
        }
    }
    async createInvoice(invoiceData) {
        try {
            const response = await this.client.post('/invoices', invoiceData);
            return response.data;
        }
        catch (error) {
            throw new Error(`Erreur lors de la création de la facture: ${error.message}`);
        }
    }
    async getEmployees(companyId, params) {
        try {
            const queryParams = new URLSearchParams();
            if (params?.limit)
                queryParams.append('limit', params.limit.toString());
            if (params?.page)
                queryParams.append('page', params.page.toString());
            let url;
            if (companyId) {
                url = `/companies/${companyId}/employees${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
            }
            else {
                url = `/employees${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
            }
            const response = await this.client.get(url);
            return Array.isArray(response.data) ? response.data : (response.data.data || []);
        }
        catch (error) {
            throw new Error(`Erreur lors de la récupération des employés: ${error.message}`);
        }
    }
    async createEmployee(employeeData) {
        try {
            const response = await this.client.post('/employees', employeeData);
            return response.data;
        }
        catch (error) {
            throw new Error(`Erreur lors de la création de l'employé: ${error.message}`);
        }
    }
    async createContact(contactData) {
        try {
            const response = await this.client.post('/employees', contactData);
            return response.data;
        }
        catch (error) {
            throw new Error(`Erreur lors de la création du contact: ${error.message}`);
        }
    }
    async getAccountInfo() {
        try {
            const response = await this.client.get('/me');
            return response.data;
        }
        catch (error) {
            throw new Error(`Erreur lors de la récupération des informations du compte: ${error.message}`);
        }
    }
    async getUsers() {
        try {
            const response = await this.client.get('/users');
            return Array.isArray(response.data) ? response.data : (response.data.data || []);
        }
        catch (error) {
            throw new Error(`Erreur lors de la récupération des utilisateurs: ${error.message}`);
        }
    }
}
