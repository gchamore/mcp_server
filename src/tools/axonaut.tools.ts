import { McpTool } from '../types/mcp.types.js';
import { AxonautClient } from '../clients/axonaut.client.js';

/**
 * Outil pour récupérer les contacts Axonaut
 */
export const getContactsTool: McpTool = {
  name: "get_contacts",
  description: "Récupérer les contacts depuis Axonaut CRM",
  inputSchema: {
    type: "object",
    properties: {
      search: { 
        type: "string", 
        description: "Terme de recherche pour filtrer les contacts (nom, email, etc.)" 
      },
      limit: { 
        type: "number", 
        description: "Nombre maximum de contacts à retourner",
        default: 10,
        minimum: 1,
        maximum: 100
      },
      offset: {
        type: "number",
        description: "Décalage pour la pagination",
        default: 0,
        minimum: 0
      }
    }
  },
  
  async execute({ search, limit = 10, offset = 0 }: { search?: string; limit?: number; offset?: number }, apiKey: string) {
    try {
      const client = new AxonautClient(apiKey);
      const contacts = await client.getContacts({ search, limit, offset });
      
      if (!contacts || contacts.length === 0) {
        return "Aucun contact trouvé avec les critères spécifiés.";
      }
      
      const contactList = contacts.map((contact: any) => {
        return `• ${contact.name || 'Nom non renseigné'} ${contact.email ? `(${contact.email})` : ''} ${contact.phone ? `- ${contact.phone}` : ''} ${contact.company ? `- ${contact.company}` : ''}`;
      }).join('\n');
      
      return `📋 ${contacts.length} contact(s) trouvé(s):\n\n${contactList}`;
    } catch (error) {
      return `❌ Erreur lors de la récupération des contacts: ${error instanceof Error ? error.message : 'Erreur inconnue'}`;
    }
  }
};

/**
 * Outil pour créer un nouveau contact
 */
export const createContactTool: McpTool = {
  name: "create_contact",
  description: "Créer un nouveau contact dans Axonaut CRM",
  inputSchema: {
    type: "object",
    properties: {
      name: { 
        type: "string", 
        description: "Nom complet du contact" 
      },
      email: { 
        type: "string", 
        description: "Adresse email du contact",
        format: "email"
      },
      phone: { 
        type: "string", 
        description: "Numéro de téléphone du contact" 
      },
      company: { 
        type: "string", 
        description: "Nom de l'entreprise du contact" 
      }
    },
    required: ["name", "email"]
  },
  
  async execute({ name, email, phone, company }: { name: string; email: string; phone?: string; company?: string }, apiKey: string) {
    try {
      const client = new AxonautClient(apiKey);
      const contact = await client.createContact({ name, email, phone, company });
      
      return `✅ Contact créé avec succès!\n• Nom: ${contact.name}\n• Email: ${contact.email}\n• ID: ${contact.id}${phone ? `\n• Téléphone: ${phone}` : ''}${company ? `\n• Entreprise: ${company}` : ''}`;
    } catch (error) {
      return `❌ Erreur lors de la création du contact: ${error instanceof Error ? error.message : 'Erreur inconnue'}`;
    }
  }
};

/**
 * Outil pour récupérer les projets
 */
export const getProjectsTool: McpTool = {
  name: "get_projects",
  description: "Récupérer les projets depuis Axonaut CRM",
  inputSchema: {
    type: "object",
    properties: {
      status: { 
        type: "string", 
        description: "Filtrer par statut du projet (draft, active, completed, etc.)" 
      },
      limit: { 
        type: "number", 
        description: "Nombre maximum de projets à retourner",
        default: 10,
        minimum: 1,
        maximum: 100
      },
      offset: {
        type: "number",
        description: "Décalage pour la pagination",
        default: 0,
        minimum: 0
      }
    }
  },
  
  async execute({ status, limit = 10, offset = 0 }: { status?: string; limit?: number; offset?: number }, apiKey: string) {
    try {
      const client = new AxonautClient(apiKey);
      const projects = await client.getProjects({ status, limit, offset });
      
      if (!projects || projects.length === 0) {
        return "Aucun projet trouvé avec les critères spécifiés.";
      }
      
      const projectList = projects.map((project: any) => {
        return `• ${project.name || 'Nom non renseigné'} (${project.status || 'Statut non défini'})${project.description ? ` - ${project.description}` : ''}`;
      }).join('\n');
      
      return `📊 ${projects.length} projet(s) trouvé(s):\n\n${projectList}`;
    } catch (error) {
      return `❌ Erreur lors de la récupération des projets: ${error instanceof Error ? error.message : 'Erreur inconnue'}`;
    }
  }
};

/**
 * Outil pour récupérer les entreprises
 */
export const getCompaniesTool: McpTool = {
  name: "get_companies",
  description: "Récupérer les entreprises depuis Axonaut CRM",
  inputSchema: {
    type: "object",
    properties: {
      search: { 
        type: "string", 
        description: "Terme de recherche pour filtrer les entreprises" 
      },
      limit: { 
        type: "number", 
        description: "Nombre maximum d'entreprises à retourner",
        default: 10,
        minimum: 1,
        maximum: 100
      },
      offset: {
        type: "number",
        description: "Décalage pour la pagination",
        default: 0,
        minimum: 0
      }
    }
  },
  
  async execute({ search, limit = 10, offset = 0 }: { search?: string; limit?: number; offset?: number }, apiKey: string) {
    try {
      const client = new AxonautClient(apiKey);
      const companies = await client.getCompanies({ search, limit, offset });
      
      if (!companies || companies.length === 0) {
        return "Aucune entreprise trouvée avec les critères spécifiés.";
      }
      
      const companyList = companies.map((company: any) => {
        return `• ${company.name || 'Nom non renseigné'}${company.email ? ` (${company.email})` : ''}${company.phone ? ` - ${company.phone}` : ''}`;
      }).join('\n');
      
      return `🏢 ${companies.length} entreprise(s) trouvée(s):\n\n${companyList}`;
    } catch (error) {
      return `❌ Erreur lors de la récupération des entreprises: ${error instanceof Error ? error.message : 'Erreur inconnue'}`;
    }
  }
};

/**
 * Outil pour tester la connexion API
 */
export const testConnectionTool: McpTool = {
  name: "test_connection",
  description: "Tester la connexion à l'API Axonaut",
  inputSchema: {
    type: "object",
    properties: {}
  },
  
  async execute(args: any, apiKey: string) {
    try {
      const client = new AxonautClient(apiKey);
      const result = await client.testConnection();
      
      return `✅ ${result.message}\n• Utilisateur: ${result.user?.name || result.user?.email || 'Utilisateur connecté'}\n• API Key: ${apiKey.substring(0, 8)}...`;
    } catch (error) {
      return `❌ Échec du test de connexion: ${error instanceof Error ? error.message : 'Erreur inconnue'}`;
    }
  }
};

/**
 * Liste de tous les outils Axonaut disponibles
 */
export const AxonautTools: McpTool[] = [
  getContactsTool,
  createContactTool,
  getProjectsTool,
  getCompaniesTool,
  testConnectionTool
];
