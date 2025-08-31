import { McpTool } from '../types/mcp.types.js';
import { AxonautClient } from '../clients/axonaut.client.js';

/**
 * Outil de test de connexion Axonaut
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
      
      if (result.success) {
        return `✅ Connexion Axonaut réussie!\n\nInformations du compte:\n${JSON.stringify(result.data, null, 2)}`;
      } else {
        return `❌ Erreur de connexion Axonaut: ${result.message}`;
      }
    } catch (error) {
      return `❌ Échec du test de connexion: ${error instanceof Error ? error.message : 'Erreur inconnue'}`;
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
      }
    }
  },
  
  async execute({ search, limit = 10 }: { search?: string; limit?: number }, apiKey: string) {
    try {
      const client = new AxonautClient(apiKey);
      const companies = await client.getCompanies({ search, limit });
      
      if (!companies || companies.length === 0) {
        return "📋 Aucune entreprise trouvée.";
      }
      
      return `📋 **Entreprises Axonaut** (${companies.length} résultats)\n\n` +
        companies.map((company, index) =>
          `${index + 1}. **${company.name}**\n` +
          `   📧 Email: ${company.email || 'N/A'}\n` +
          `   💰 Devise: ${company.currency || 'N/A'}\n` +
          `   📊 Type: ${company.is_customer ? '👤 Client' : ''}${company.is_prospect ? '🎯 Prospect' : ''}\n` +
          `   💬 Commentaires: ${company.comments || 'N/A'}\n` +
          `   🆔 ID: ${company.id}\n`
        ).join('\n');
    } catch (error) {
      return `❌ Erreur lors de la récupération des entreprises: ${error instanceof Error ? error.message : 'Erreur inconnue'}`;
    }
  }
};

/**
 * Outil pour créer une entreprise
 */
export const createCompanyTool: McpTool = {
  name: "create_company",
  description: "Créer une nouvelle entreprise dans Axonaut",
  inputSchema: {
    type: "object",
    properties: {
      name: { 
        type: "string", 
        description: "Nom de l'entreprise" 
      },
      email: { 
        type: "string", 
        description: "Email de l'entreprise",
        format: "email"
      },
      currency: { 
        type: "string", 
        description: "Devise de l'entreprise (défaut: EUR)",
        default: "EUR"
      },
      comments: { 
        type: "string", 
        description: "Commentaires sur l'entreprise" 
      },
      is_customer: { 
        type: "boolean", 
        description: "Si c'est un client" 
      },
      is_prospect: { 
        type: "boolean", 
        description: "Si c'est un prospect" 
      }
    },
    required: ["name"]
  },
  
  async execute({ name, email, currency = 'EUR', comments, is_customer, is_prospect }: any, apiKey: string) {
    try {
      const client = new AxonautClient(apiKey);
      const company = await client.createCompany({
        name,
        email,
        currency,
        comments,
        is_customer,
        is_prospect
      });
      
      return `✅ **Entreprise créée avec succès !**\n\n` +
        `🏢 **${company.name}**\n` +
        `📧 Email: ${company.email || 'N/A'}\n` +
        `💰 Devise: ${company.currency || 'N/A'}\n` +
        `📊 Type: ${company.is_customer ? '👤 Client' : ''}${company.is_prospect ? '🎯 Prospect' : ''}\n` +
        `💬 Commentaires: ${company.comments || 'N/A'}\n` +
        `🆔 ID: ${company.id}`;
    } catch (error) {
      return `❌ Erreur lors de la création de l'entreprise: ${error instanceof Error ? error.message : 'Erreur inconnue'}`;
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
      limit: { 
        type: "number", 
        description: "Nombre maximum de projets à retourner",
        default: 10,
        minimum: 1,
        maximum: 100
      }
    }
  },
  
  async execute({ limit = 10 }: { limit?: number }, apiKey: string) {
    try {
      const client = new AxonautClient(apiKey);
      const projects = await client.getProjects({ limit });
      
      if (!projects || projects.length === 0) {
        return "📁 Aucun projet trouvé.";
      }
      
      return `📁 **Projets Axonaut** (${projects.length} résultats)\n\n` +
        projects.map((project, index) =>
          `${index + 1}. **${project.name}**\n` +
          `   📝 Description: ${project.description || 'N/A'}\n` +
          `   📊 Statut: ${project.status || 'N/A'}\n` +
          `   🏢 Entreprise: ${project.company?.name || 'N/A'}\n` +
          `   🆔 ID: ${project.id}\n`
        ).join('\n');
    } catch (error) {
      return `❌ Erreur lors de la récupération des projets: ${error instanceof Error ? error.message : 'Erreur inconnue'}`;
    }
  }
};

/**
 * Outil pour récupérer les factures
 */
export const getInvoicesTool: McpTool = {
  name: "get_invoices",
  description: "Récupérer les factures depuis Axonaut",
  inputSchema: {
    type: "object",
    properties: {
      limit: { 
        type: "number", 
        description: "Nombre maximum de factures à retourner",
        default: 10,
        minimum: 1,
        maximum: 100
      },
      status: {
        type: "string",
        description: "Filtrer par statut (draft, sent, paid, etc.)"
      },
      company_id: {
        type: "number",
        description: "ID de l'entreprise pour filtrer les factures"
      }
    }
  },
  
  async execute({ limit = 10, status, company_id }: any, apiKey: string) {
    try {
      const client = new AxonautClient(apiKey);
      const invoices = await client.getInvoices({ limit, status, company_id });
      
      if (!invoices || invoices.length === 0) {
        return "🧾 Aucune facture trouvée.";
      }
      
      return `🧾 **Factures Axonaut** (${invoices.length} résultats)\n\n` +
        invoices.map((invoice, index) =>
          `${index + 1}. **Facture ${invoice.number || invoice.id}**\n` +
          `   💰 Montant: ${invoice.total_amount || invoice.amount || 'N/A'}€\n` +
          `   📅 Date: ${invoice.date || invoice.creation_date || 'N/A'}\n` +
          `   🔔 Statut: ${invoice.status || 'N/A'}\n` +
          `   🏢 Client: ${invoice.company?.name || 'N/A'}\n` +
          `   🆔 ID: ${invoice.id}\n`
        ).join('\n');
    } catch (error) {
      return `❌ Erreur lors de la récupération des factures: ${error instanceof Error ? error.message : 'Erreur inconnue'}`;
    }
  }
};

/**
 * Outil pour récupérer le détail d'une facture
 */
export const getInvoiceDetailTool: McpTool = {
  name: "get_invoice_detail",
  description: "Récupérer le détail complet d'une facture spécifique",
  inputSchema: {
    type: "object",
    properties: {
      invoice_id: {
        type: "number",
        description: "ID de la facture à récupérer"
      }
    },
    required: ["invoice_id"]
  },
  
  async execute({ invoice_id }: { invoice_id: number }, apiKey: string) {
    try {
      const client = new AxonautClient(apiKey);
      const invoice = await client.getInvoice(invoice_id);
      
      return `🧾 **Détail de la facture ${invoice.number || invoice.id}**\n\n` +
        `📋 **Informations générales:**\n` +
        `   • Numéro: ${invoice.number || 'N/A'}\n` +
        `   • Date: ${invoice.date || invoice.creation_date || 'N/A'}\n` +
        `   • Statut: ${invoice.status || 'N/A'}\n` +
        `   • Montant HT: ${invoice.pre_tax_amount || 'N/A'}€\n` +
        `   • Montant TTC: ${invoice.total_amount || invoice.amount || 'N/A'}€\n\n` +

        `🏢 **Client:**\n` +
        `   • Nom: ${invoice.company?.name || 'N/A'}\n` +
        `   • Email: ${invoice.company?.email || 'N/A'}\n\n` +

        (invoice.invoice_lines && invoice.invoice_lines.length > 0 ?
          `📦 **Lignes de facture:**\n` +
          invoice.invoice_lines.map((line, index) =>
            `   ${index + 1}. ${line.product_name || line.description || 'Produit'}\n` +
            `      • Quantité: ${line.quantity || 'N/A'}\n` +
            `      • Prix unitaire: ${line.unit_price || 'N/A'}€\n` +
            `      • Total HT: ${line.total_pre_tax_amount || 'N/A'}€\n`
          ).join('\n') :
          `📦 **Lignes de facture:** Aucune ligne détectée\n`
        ) +

        `\n🆔 **ID:** ${invoice.id}`;
    } catch (error) {
      return `❌ Erreur lors de la récupération de la facture: ${error instanceof Error ? error.message : 'Erreur inconnue'}`;
    }
  }
};

/**
 * Outil pour récupérer les employés (contacts)
 */
export const getEmployeesTool: McpTool = {
  name: "get_employees",
  description: "Récupérer les employés (contacts) depuis Axonaut",
  inputSchema: {
    type: "object",
    properties: {
      limit: { 
        type: "number", 
        description: "Nombre maximum d'employés à retourner",
        default: 10,
        minimum: 1,
        maximum: 100
      },
      company_id: {
        type: "number",
        description: "ID de l'entreprise pour filtrer les employés"
      }
    }
  },
  
  async execute({ limit = 10, company_id }: any, apiKey: string) {
    try {
      const client = new AxonautClient(apiKey);
      const employees = await client.getEmployees(company_id, { limit });
      
      if (!employees || employees.length === 0) {
        return "👥 Aucun employé trouvé.";
      }
      
      return `� **Employés Axonaut** (${employees.length} résultats)\n\n` +
        employees.map((employee, index) =>
          `${index + 1}. **${employee.name}**\n` +
          `   📧 Email: ${employee.email || 'N/A'}\n` +
          `   📞 Téléphone: ${employee.phone || 'N/A'}\n` +
          `   🏢 Entreprise: ${employee.company?.name || 'N/A'}\n` +
          `   🆔 ID: ${employee.id}\n`
        ).join('\n');
    } catch (error) {
      return `❌ Erreur lors de la récupération des employés: ${error instanceof Error ? error.message : 'Erreur inconnue'}`;
    }
  }
};

/**
 * Outil pour créer un contact/employé
 */
export const createContactTool: McpTool = {
  name: "create_contact",
  description: "Créer un nouveau contact/employé dans Axonaut",
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
      company_id: { 
        type: "number", 
        description: "ID de l'entreprise associée" 
      }
    },
    required: ["name"]
  },
  
  async execute({ name, email, phone, company_id }: any, apiKey: string) {
    try {
      const client = new AxonautClient(apiKey);
      const contact = await client.createContact({ name, email, phone, company_id });
      
      return `✅ **Contact créé avec succès !**\n\n` +
        `👤 **${contact.name}**\n` +
        `📧 Email: ${contact.email || 'N/A'}\n` +
        `📞 Téléphone: ${contact.phone || 'N/A'}\n` +
        `🏢 Entreprise: ${contact.company?.name || 'N/A'}\n` +
        `🆔 ID: ${contact.id}`;
    } catch (error) {
      return `❌ Erreur lors de la création du contact: ${error instanceof Error ? error.message : 'Erreur inconnue'}`;
    }
  }
};

/**
 * Liste de tous les outils Axonaut disponibles
 */
export const AxonautTools: McpTool[] = [
  testConnectionTool,
  getCompaniesTool,
  createCompanyTool,
  getProjectsTool,
  getInvoicesTool,
  getInvoiceDetailTool,
  getEmployeesTool,
  createContactTool
];
