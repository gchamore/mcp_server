import axios from 'axios';
export class AxonautClient {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.api = axios.create({
            baseURL: 'https://axonaut.com/api/v2',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'User-Agent': 'MCP-Wesype/1.0'
            },
            timeout: 30000
        });
        this.api.interceptors.request.use((config) => {
            console.log(`🔗 Axonaut API: ${config.method?.toUpperCase()} ${config.url}`);
            return config;
        }, (error) => {
            console.error('❌ Axonaut Request Error:', error);
            return Promise.reject(error);
        });
        this.api.interceptors.response.use((response) => {
            console.log(`✅ Axonaut API: ${response.status} ${response.config.url}`);
            return response;
        }, (error) => {
            console.error(`❌ Axonaut API Error: ${error.response?.status} ${error.config?.url}`);
            return Promise.reject(error);
        });
    }
    async getContacts(params = {}) {
        try {
            const response = await this.api.get('/contacts', { params });
            return response.data.data || response.data;
        }
        catch (error) {
            throw new Error(`Erreur lors de la récupération des contacts: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
        }
    }
    async createContact(contact) {
        try {
            const response = await this.api.post('/contacts', contact);
            return response.data;
        }
        catch (error) {
            throw new Error(`Erreur lors de la création du contact: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
        }
    }
    async getContact(contactId) {
        try {
            const response = await this.api.get(`/contacts/${contactId}`);
            return response.data;
        }
        catch (error) {
            throw new Error(`Erreur lors de la récupération du contact: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
        }
    }
    async updateContact(contactId, updates) {
        try {
            const response = await this.api.put(`/contacts/${contactId}`, updates);
            return response.data;
        }
        catch (error) {
            throw new Error(`Erreur lors de la mise à jour du contact: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
        }
    }
    async getProjects(params = {}) {
        try {
            const response = await this.api.get('/projects', { params });
            return response.data.data || response.data;
        }
        catch (error) {
            throw new Error(`Erreur lors de la récupération des projets: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
        }
    }
    async createProject(project) {
        try {
            const response = await this.api.post('/projects', project);
            return response.data;
        }
        catch (error) {
            throw new Error(`Erreur lors de la création du projet: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
        }
    }
    async getCompanies(params = {}) {
        try {
            const response = await this.api.get('/companies', { params });
            return response.data.data || response.data;
        }
        catch (error) {
            throw new Error(`Erreur lors de la récupération des entreprises: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
        }
    }
    async testConnection() {
        try {
            const response = await this.api.get('/me');
            return {
                success: true,
                user: response.data,
                message: 'Connexion API Axonaut réussie'
            };
        }
        catch (error) {
            throw new Error(`Test de connexion échoué: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
        }
    }
}
