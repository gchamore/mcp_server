import { z } from 'zod';
import { BrevoClient } from './client.js';
import { defineConnector, toolFactory, type ToolDefinition } from '../types.js';
import { date, fields, renderList, text } from '../format.js';
import { errorMessage } from '../../core/errors.js';

/**
 * Connecteur Brevo — marketing et e-mail transactionnel.
 *
 * Sert aussi de second exemple au registre : deux champs d'authentification de
 * types différents (mot de passe obligatoire, e-mail facultatif), pour montrer
 * que le formulaire du front est bien généré à partir de la définition.
 */

export type BrevoCredentials = { apiKey: string; senderEmail?: string };

const tool = toolFactory<BrevoCredentials>();

const limit = z
  .number()
  .int()
  .min(1)
  .max(100)
  .default(25)
  .describe('Nombre maximum d’éléments à renvoyer.');

const offset = z
  .number()
  .int()
  .min(0)
  .default(0)
  .describe('Décalage pour la pagination : 0 pour la première page, puis limit, 2×limit, etc.');

const client = (credentials: BrevoCredentials, signal: AbortSignal) =>
  new BrevoClient(credentials.apiKey, signal);

const getAccount = tool({
  name: 'get_account',
  title: 'Informations du compte',
  description:
    "Renvoie les informations du compte Brevo et les crédits restants. Utiliser pour vérifier le plan en cours ou le quota d'envoi disponible.",
  inputSchema: {},
  annotations: { readOnlyHint: true, openWorldHint: true },
  async handler(_args, ctx) {
    const account = await client(ctx.credentials, ctx.signal).getAccount();
    const credits = account.plan?.map((plan) => `${plan.type ?? 'plan'} : ${plan.credits ?? 0}`);

    return {
      text: [
        `**Compte Brevo** — ${text(account.companyName ?? account.email)}`,
        fields({
          Email: text(account.email),
          Contact: [account.firstName, account.lastName].filter(Boolean).join(' '),
        }),
        credits?.length ? `Crédits : ${credits.join(' · ')}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      data: account,
    };
  },
});

const listContacts = tool({
  name: 'list_contacts',
  title: 'Lister les contacts',
  description:
    "Liste les contacts Brevo, éventuellement restreints à une liste. Utiliser pour explorer la base d'audience ou compter les abonnés.",
  inputSchema: {
    limit,
    offset,
    list_id: z.number().int().positive().optional().describe('Restreindre à cette liste.'),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  async handler(args, ctx) {
    const { contacts, total } = await client(ctx.credentials, ctx.signal).listContacts({
      limit: args.limit,
      offset: args.offset,
      listId: args.list_id,
    });

    return {
      text: [
        renderList({
          title: 'Contacts Brevo',
          items: contacts,
          emptyMessage: 'Aucun contact trouvé',
          render: (contact) =>
            `- **${contact.email}** (id ${contact.id})\n  ${fields({
              Inscrit: date(contact.createdAt),
              Listes: contact.listIds?.join(', '),
              Statut: contact.emailBlacklisted ? 'désinscrit' : 'actif',
            })}`,
        }),
        `\n${total} contact(s) au total.`,
      ].join('\n'),
      data: { contacts, total },
    };
  },
});

const getContact = tool({
  name: 'get_contact',
  title: "Détail d'un contact",
  description:
    "Récupère un contact Brevo par son adresse e-mail ou son identifiant, avec ses attributs personnalisés. Utiliser pour répondre à une question sur une personne précise.",
  inputSchema: {
    identifier: z.string().min(1).describe('Adresse e-mail ou identifiant numérique du contact.'),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  async handler(args, ctx) {
    const contact = await client(ctx.credentials, ctx.signal).getContact(args.identifier);
    const attributes = Object.entries(contact.attributes ?? {})
      .map(([key, value]) => `  - ${key} : ${String(value)}`)
      .join('\n');

    return {
      text: [
        `**${contact.email}** (id ${contact.id})`,
        fields({
          Inscrit: date(contact.createdAt),
          Listes: contact.listIds?.join(', '),
          Statut: contact.emailBlacklisted ? 'désinscrit' : 'actif',
        }),
        attributes ? `\nAttributs :\n${attributes}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      data: contact,
    };
  },
});

const createContact = tool({
  name: 'create_contact',
  title: 'Créer ou mettre à jour un contact',
  description:
    "Crée un contact Brevo, ou met à jour ses attributs s'il existe déjà. À n'utiliser que sur demande explicite d'ajout à une liste.",
  inputSchema: {
    email: z.string().min(3).describe('Adresse e-mail du contact.'),
    list_ids: z
      .array(z.number().int().positive())
      .optional()
      .describe('Identifiants des listes auxquelles inscrire le contact.'),
    attributes: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .optional()
      .describe('Attributs Brevo, par exemple { "PRENOM": "Alice", "NOM": "Durand" }.'),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  async handler(args, ctx) {
    const result = await client(ctx.credentials, ctx.signal).createContact({
      email: args.email,
      listIds: args.list_ids,
      attributes: args.attributes,
      updateEnabled: true,
    });

    return {
      text: `Contact **${args.email}** enregistré${result.id ? ` (id ${result.id})` : ''}.`,
      data: result,
    };
  },
});

const listLists = tool({
  name: 'list_lists',
  title: 'Lister les listes de contacts',
  description:
    "Liste les listes de contacts Brevo et leur nombre d'abonnés. Utiliser pour retrouver l'identifiant d'une liste avant d'y inscrire un contact.",
  inputSchema: { limit, offset },
  annotations: { readOnlyHint: true, openWorldHint: true },
  async handler(args, ctx) {
    const { lists, total } = await client(ctx.credentials, ctx.signal).listLists({
      limit: args.limit,
      offset: args.offset,
    });

    return {
      text: [
        renderList({
          title: 'Listes Brevo',
          items: lists,
          emptyMessage: 'Aucune liste trouvée',
          render: (list) =>
            `- **${list.name}** (id ${list.id})\n  ${fields({
              Abonnés: list.totalSubscribers,
              Désinscrits: list.totalBlacklisted,
            })}`,
        }),
        `\n${total} liste(s) au total.`,
      ].join('\n'),
      data: { lists, total },
    };
  },
});

const listCampaigns = tool({
  name: 'list_campaigns',
  title: 'Lister les campagnes e-mail',
  description:
    "Liste les campagnes e-mail Brevo et leurs statistiques d'envoi. Utiliser pour analyser les performances marketing ou retrouver une campagne passée.",
  inputSchema: {
    limit,
    offset,
    status: z
      .enum(['draft', 'sent', 'archive', 'queued', 'suspended', 'in_process'])
      .optional()
      .describe('Filtrer sur un statut de campagne.'),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  async handler(args, ctx) {
    const { campaigns, total } = await client(ctx.credentials, ctx.signal).listCampaigns({
      limit: args.limit,
      offset: args.offset,
      status: args.status,
    });

    return {
      text: [
        renderList({
          title: 'Campagnes Brevo',
          items: campaigns,
          emptyMessage: 'Aucune campagne trouvée',
          render: (campaign) => {
            const stats = campaign.statistics?.globalStats;
            return `- **${campaign.name}** (id ${campaign.id})\n  ${fields({
              Objet: text(campaign.subject),
              Statut: text(campaign.status),
              Planifiée: date(campaign.scheduledAt),
              Envoyés: stats?.sent,
              Délivrés: stats?.delivered,
              'Clics uniques': stats?.uniqueClicks,
            })}`;
          },
        }),
        `\n${total} campagne(s) au total.`,
      ].join('\n'),
      data: { campaigns, total },
    };
  },
});

const sendEmail = tool({
  name: 'send_transactional_email',
  title: 'Envoyer un e-mail transactionnel',
  description:
    "Envoie un e-mail transactionnel via Brevo. Action irréversible : ne l'utiliser qu'après confirmation explicite du destinataire, de l'objet et du contenu par l'utilisateur.",
  inputSchema: {
    to_email: z.string().min(3).describe('Adresse e-mail du destinataire.'),
    to_name: z.string().optional().describe('Nom affiché du destinataire.'),
    subject: z.string().min(1).describe('Objet de l’e-mail.'),
    html_content: z.string().min(1).describe('Contenu HTML de l’e-mail.'),
    sender_email: z
      .string()
      .optional()
      .describe(
        'Expéditeur. Facultatif si un expéditeur par défaut est configuré sur la connexion.',
      ),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  async handler(args, ctx) {
    const sender = args.sender_email ?? ctx.credentials.senderEmail;
    if (!sender) {
      return {
        text:
          "Aucun expéditeur disponible. Renseigner « Expéditeur par défaut » sur la connexion Brevo, " +
          'ou fournir sender_email dans l’appel.',
      };
    }

    const result = await client(ctx.credentials, ctx.signal).sendTransactionalEmail({
      sender: { email: sender },
      to: [{ email: args.to_email, ...(args.to_name ? { name: args.to_name } : {}) }],
      subject: args.subject,
      htmlContent: args.html_content,
    });

    return {
      text: `E-mail envoyé à ${args.to_email}${result.messageId ? ` (message ${result.messageId})` : ''}.`,
      data: result,
    };
  },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const brevoTools: ToolDefinition<BrevoCredentials, any>[] = [
  getAccount,
  listContacts,
  getContact,
  createContact,
  listLists,
  listCampaigns,
  sendEmail,
];

export default defineConnector<BrevoCredentials>({
  id: 'brevo',
  name: 'Brevo',
  tagline: 'E-mailing, contacts et campagnes marketing',
  description:
    "Connecte votre compte Brevo (ex-Sendinblue) à votre assistant IA : consultation des contacts et des listes, analyse des campagnes, et envoi d'e-mails transactionnels.",
  category: 'marketing',
  status: 'beta',
  icon: 'https://www.brevo.com/favicon.ico',
  accentColor: '#0b996e',
  docsUrl: 'https://developers.brevo.com/reference/getting-started-1',

  auth: {
    type: 'api_key',
    instructions: 'Dans Brevo : votre profil → SMTP & API → Clés API → Générer une nouvelle clé.',
    docsUrl: 'https://developers.brevo.com/docs/getting-started',
    fields: [
      {
        key: 'apiKey',
        label: 'Clé API Brevo',
        type: 'password',
        required: true,
        placeholder: 'xkeysib-…',
        help: 'Clé de type v3, chiffrée avant stockage.',
        minLength: 20,
        maxLength: 200,
      },
      {
        key: 'senderEmail',
        label: 'Expéditeur par défaut',
        type: 'email',
        required: false,
        placeholder: 'contact@votre-domaine.fr',
        help: "Utilisé par l'outil d'envoi lorsque l'expéditeur n'est pas précisé. L'adresse doit être validée dans Brevo.",
      },
    ],
  },

  async verify(credentials, ctx) {
    try {
      const account = await new BrevoClient(credentials.apiKey, ctx.signal).getAccount();
      const label = account.companyName ?? account.email ?? undefined;
      return label ? { ok: true, accountLabel: label } : { ok: true };
    } catch (error) {
      ctx.logger.debug({ err: error }, 'Vérification Brevo échouée');
      return { ok: false, message: errorMessage(error) };
    }
  },

  tools: brevoTools,
});
