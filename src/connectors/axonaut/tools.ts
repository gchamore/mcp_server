import { z } from 'zod';
import { AxonautClient } from './client.js';
import { date, fields, money, renderList, text } from '../format.js';
import { toolFactory, type ToolDefinition } from '../types.js';

/**
 * Outils Axonaut exposés via MCP.
 *
 * Conventions suivies par tous les outils :
 *  - la description dit *quand* utiliser l'outil, pas seulement ce qu'il fait ;
 *  - `page` est systématiquement exposé pour les listes ;
 *  - la sortie renvoie `text` (lu par le modèle) et `data` (structuré, pour les
 *    clients qui exploitent `structuredContent`).
 */

export type AxonautCredentials = { apiKey: string };

const tool = toolFactory<AxonautCredentials>();

const page = z
  .number()
  .int()
  .min(1)
  .max(200)
  .default(1)
  .describe('Numéro de page, à partir de 1. Incrémenter pour parcourir les résultats suivants.');

const client = (credentials: AxonautCredentials, signal: AbortSignal) =>
  new AxonautClient(credentials.apiKey, signal);

const listCompanies = tool({
  name: 'list_companies',
  title: 'Lister les entreprises',
  description:
    "Liste les entreprises (clients, prospects, fournisseurs) du CRM Axonaut. Utiliser dès qu'une question porte sur le portefeuille clients, ou pour retrouver l'identifiant d'une entreprise avant d'appeler un autre outil.",
  inputSchema: {
    page,
    search: z.string().min(1).optional().describe('Filtre sur le nom de l’entreprise.'),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  async handler(args, ctx) {
    const companies = await client(ctx.credentials, ctx.signal).listCompanies({
      page: args.page,
      search: args.search,
    });

    return {
      text: renderList({
        title: 'Entreprises Axonaut',
        items: companies,
        page: args.page,
        emptyMessage: 'Aucune entreprise trouvée',
        render: (company) =>
          `- **${company.name}** (id ${company.id})\n  ${fields({
            Email: text(company.email),
            Téléphone: text(company.phone_number),
            Type: [
              company.is_customer ? 'client' : null,
              company.is_prospect ? 'prospect' : null,
              company.is_supplier ? 'fournisseur' : null,
            ]
              .filter(Boolean)
              .join(', '),
            Ville: text(company.address_city),
          })}`,
      }),
      data: companies,
    };
  },
});

const getCompany = tool({
  name: 'get_company',
  title: "Détail d'une entreprise",
  description:
    "Récupère la fiche complète d'une entreprise à partir de son identifiant Axonaut. Utiliser après list_companies lorsque l'utilisateur veut le détail d'un client précis.",
  inputSchema: {
    company_id: z.number().int().positive().describe('Identifiant Axonaut de l’entreprise.'),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  async handler(args, ctx) {
    const company = await client(ctx.credentials, ctx.signal).getCompany(args.company_id);

    return {
      text: [
        `**${company.name}** (id ${company.id})`,
        fields({
          Email: text(company.email),
          Téléphone: text(company.phone_number),
          Devise: text(company.currency),
          Adresse: [company.address_street, company.address_zip_code, company.address_city]
            .filter(Boolean)
            .join(' '),
        }),
        company.comments ? `\nCommentaires : ${company.comments}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      data: company,
    };
  },
});

const createCompany = tool({
  name: 'create_company',
  title: 'Créer une entreprise',
  description:
    "Crée une nouvelle entreprise dans Axonaut. À n'utiliser que sur demande explicite de création : vérifier d'abord avec list_companies que l'entreprise n'existe pas déjà.",
  inputSchema: {
    name: z.string().min(1).describe('Raison sociale.'),
    email: z.string().optional().describe('Email de contact principal.'),
    currency: z.string().default('EUR').describe('Code devise ISO, EUR par défaut.'),
    is_customer: z.boolean().optional().describe('Marquer comme client.'),
    is_prospect: z.boolean().optional().describe('Marquer comme prospect.'),
    comments: z.string().optional().describe('Notes internes.'),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  async handler(args, ctx) {
    const company = await client(ctx.credentials, ctx.signal).createCompany({
      name: args.name,
      email: args.email,
      currency: args.currency,
      comments: args.comments,
      is_customer: args.is_customer,
      is_prospect: args.is_prospect,
    });

    return {
      text: `Entreprise créée : **${company.name}** (id ${company.id}).`,
      data: company,
    };
  },
});

const listContacts = tool({
  name: 'list_contacts',
  title: 'Lister les contacts',
  description:
    "Liste les contacts (employés) enregistrés dans Axonaut, éventuellement restreints à une entreprise. Utiliser pour retrouver l'interlocuteur d'un client.",
  inputSchema: {
    page,
    company_id: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Restreindre aux contacts de cette entreprise.'),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  async handler(args, ctx) {
    const contacts = await client(ctx.credentials, ctx.signal).listEmployees({
      page: args.page,
      companyId: args.company_id,
    });

    return {
      text: renderList({
        title: 'Contacts Axonaut',
        items: contacts,
        page: args.page,
        emptyMessage: 'Aucun contact trouvé',
        render: (contact) =>
          `- **${[contact.firstname, contact.lastname].filter(Boolean).join(' ') || `Contact ${contact.id}`}** (id ${contact.id})\n  ${fields(
            {
              Email: text(contact.email),
              Téléphone: text(contact.cellphone_number ?? contact.phone_number),
              Fonction: text(contact.job),
              Entreprise: text(contact.company_name),
            },
          )}`,
      }),
      data: contacts,
    };
  },
});

const createContact = tool({
  name: 'create_contact',
  title: 'Créer un contact',
  description:
    "Crée un contact dans Axonaut, rattaché à une entreprise si company_id est fourni. À n'utiliser que sur demande explicite.",
  inputSchema: {
    firstname: z.string().min(1).describe('Prénom.'),
    lastname: z.string().min(1).describe('Nom de famille.'),
    email: z.string().optional().describe('Adresse email.'),
    phone: z.string().optional().describe('Numéro de téléphone.'),
    job: z.string().optional().describe('Fonction occupée.'),
    company_id: z.number().int().positive().optional().describe('Entreprise de rattachement.'),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  async handler(args, ctx) {
    const contact = await client(ctx.credentials, ctx.signal).createEmployee({
      firstname: args.firstname,
      lastname: args.lastname,
      email: args.email,
      cellphone_number: args.phone,
      job: args.job,
      company_id: args.company_id,
    });

    return {
      text: `Contact créé : **${args.firstname} ${args.lastname}** (id ${contact.id}).`,
      data: contact,
    };
  },
});

const listInvoices = tool({
  name: 'list_invoices',
  title: 'Lister les factures',
  description:
    "Liste les factures Axonaut, avec filtres facultatifs par entreprise et par statut de paiement. Utiliser pour toute question de facturation, d'impayés ou de chiffre d'affaires.",
  inputSchema: {
    page,
    company_id: z.number().int().positive().optional().describe('Restreindre à une entreprise.'),
    is_paid: z.boolean().optional().describe('true = payées, false = impayées.'),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  async handler(args, ctx) {
    const invoices = await client(ctx.credentials, ctx.signal).listInvoices({
      page: args.page,
      companyId: args.company_id,
      isPaid: args.is_paid,
    });

    const total = invoices.reduce((sum, invoice) => sum + (invoice.total_amount ?? 0), 0);

    return {
      text: [
        renderList({
          title: 'Factures Axonaut',
          items: invoices,
          page: args.page,
          emptyMessage: 'Aucune facture trouvée',
          render: (invoice) =>
            `- **${text(invoice.number, `Facture ${invoice.id}`)}** (id ${invoice.id})\n  ${fields({
              Client: text(invoice.company_name),
              Date: date(invoice.date),
              Échéance: date(invoice.due_date),
              'Total TTC': money(invoice.total_amount, invoice.currency ?? 'EUR'),
              Statut: invoice.is_paid ? 'payée' : 'impayée',
            })}`,
        }),
        invoices.length > 0 ? `\nTotal TTC de cette page : ${money(total)}.` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      data: invoices,
    };
  },
});

const getInvoice = tool({
  name: 'get_invoice',
  title: "Détail d'une facture",
  description:
    "Récupère une facture avec le détail de ses lignes. Utiliser lorsque l'utilisateur veut savoir ce qui a été facturé, ligne par ligne.",
  inputSchema: {
    invoice_id: z.number().int().positive().describe('Identifiant Axonaut de la facture.'),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  async handler(args, ctx) {
    const invoice = await client(ctx.credentials, ctx.signal).getInvoice(args.invoice_id);
    const currency = invoice.currency ?? 'EUR';

    const lines = invoice.invoice_lines?.length
      ? invoice.invoice_lines
          .map(
            (line, index) =>
              `  ${index + 1}. ${text(line.product_name ?? line.description, 'Ligne')} — ` +
              `${line.quantity ?? 1} × ${money(line.price, currency)} = ${money(line.pre_tax_amount, currency)}`,
          )
          .join('\n')
      : '  (aucune ligne détaillée)';

    return {
      text: [
        `**${text(invoice.number, `Facture ${invoice.id}`)}** (id ${invoice.id})`,
        fields({
          Client: text(invoice.company_name),
          Date: date(invoice.date),
          Échéance: date(invoice.due_date),
          'Montant HT': money(invoice.pre_tax_amount, currency),
          'Montant TTC': money(invoice.total_amount, currency),
          Statut: invoice.is_paid ? 'payée' : 'impayée',
        }),
        '',
        'Lignes :',
        lines,
      ].join('\n'),
      data: invoice,
    };
  },
});

const listQuotations = tool({
  name: 'list_quotations',
  title: 'Lister les devis',
  description:
    "Liste les devis Axonaut. Utiliser pour suivre le pipeline commercial et les propositions en attente de signature.",
  inputSchema: { page },
  annotations: { readOnlyHint: true, openWorldHint: true },
  async handler(args, ctx) {
    const quotations = await client(ctx.credentials, ctx.signal).listQuotations({
      page: args.page,
    });

    return {
      text: renderList({
        title: 'Devis Axonaut',
        items: quotations,
        page: args.page,
        emptyMessage: 'Aucun devis trouvé',
        render: (quotation) =>
          `- **${text(quotation.number ?? quotation.title, `Devis ${quotation.id}`)}** (id ${quotation.id})\n  ${fields(
            {
              Client: text(quotation.company_name),
              Date: date(quotation.date),
              'Total TTC': money(quotation.total_amount),
              Statut: text(quotation.status),
            },
          )}`,
      }),
      data: quotations,
    };
  },
});

const listProjects = tool({
  name: 'list_projects',
  title: 'Lister les projets',
  description:
    "Liste les projets Axonaut et leur statut. Utiliser pour les questions de suivi d'activité ou de charge en cours.",
  inputSchema: { page },
  annotations: { readOnlyHint: true, openWorldHint: true },
  async handler(args, ctx) {
    const projects = await client(ctx.credentials, ctx.signal).listProjects({ page: args.page });

    return {
      text: renderList({
        title: 'Projets Axonaut',
        items: projects,
        page: args.page,
        emptyMessage: 'Aucun projet trouvé',
        render: (project) =>
          `- **${project.name}** (id ${project.id})\n  ${fields({
            Entreprise: text(project.company_name),
            Statut: text(project.status),
            Description: text(project.description),
          })}`,
      }),
      data: projects,
    };
  },
});

const listExpenses = tool({
  name: 'list_expenses',
  title: 'Lister les dépenses',
  description:
    "Liste les dépenses et achats enregistrés dans Axonaut. Utiliser pour analyser les coûts ou répondre à une question de marge.",
  inputSchema: { page },
  annotations: { readOnlyHint: true, openWorldHint: true },
  async handler(args, ctx) {
    const expenses = await client(ctx.credentials, ctx.signal).listExpenses({ page: args.page });
    const total = expenses.reduce((sum, expense) => sum + (expense.total_amount ?? 0), 0);

    return {
      text: [
        renderList({
          title: 'Dépenses Axonaut',
          items: expenses,
          page: args.page,
          emptyMessage: 'Aucune dépense trouvée',
          render: (expense) =>
            `- **${text(expense.title, `Dépense ${expense.id}`)}** (id ${expense.id})\n  ${fields({
              Fournisseur: text(expense.supplier_name),
              Date: date(expense.date),
              'Total TTC': money(expense.total_amount),
            })}`,
        }),
        expenses.length > 0 ? `\nTotal TTC de cette page : ${money(total)}.` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      data: expenses,
    };
  },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const axonautTools: ToolDefinition<AxonautCredentials, any>[] = [
  listCompanies,
  getCompany,
  createCompany,
  listContacts,
  createContact,
  listInvoices,
  getInvoice,
  listQuotations,
  listProjects,
  listExpenses,
];
