import { z } from 'zod';
import { GmailClient, type GmailMessageSummary } from './client.js';
import {
  defineConnector,
  toolFactory,
  type OAuthCredentials,
  type ToolDefinition,
} from '../types.js';
import { fields, renderList, text } from '../format.js';
import { errorMessage } from '../../core/errors.js';

/**
 * Connecteur Gmail — premier connecteur OAuth de la plateforme.
 *
 * L'utilisateur ne saisit aucune clé : il est envoyé chez Google, autorise, et
 * les jetons deviennent les identifiants de sa connexion. Le rafraîchissement
 * est pris en charge automatiquement avant chaque session MCP.
 *
 * ┌─ Prérequis d'exploitation ──────────────────────────────────────────────┐
 * │ Dans la Google Cloud Console, sur l'application désignée par            │
 * │ GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET :                              │
 * │  1. activer l'API Gmail ;                                              │
 * │  2. ajouter les scopes ci-dessous à l'écran de consentement ;          │
 * │  3. déclarer l'URI de redirection :                                    │
 * │     <APP_BASE_URL>/api/connections/oauth/gmail/callback                │
 * │                                                                        │
 * │ Les scopes Gmail sont « sensibles » chez Google : une validation est   │
 * │ exigée avant une mise à disposition publique. Tant qu'elle n'est pas   │
 * │ faite, l'application fonctionne pour les comptes de test déclarés.     │
 * └────────────────────────────────────────────────────────────────────────┘
 */

type GmailCredentials = OAuthCredentials;

const tool = toolFactory<GmailCredentials>();

const client = (credentials: GmailCredentials, signal: AbortSignal) =>
  new GmailClient(credentials.accessToken, signal);

const renderMessage = (message: GmailMessageSummary) =>
  `- **${text(message.subject, '(sans objet)')}**${message.unread ? ' · non lu' : ''}\n  ${fields({
    De: text(message.from),
    Le: text(message.date),
    id: message.id,
  })}\n  ${text(message.snippet, '')}`;

const listMessages = tool({
  name: 'list_messages',
  title: 'Rechercher des e-mails',
  description:
    "Recherche des e-mails dans la boîte Gmail de l'utilisateur, avec la syntaxe de recherche Gmail " +
    "(ex. « from:client@x.fr is:unread after:2026/01/01 »). Utiliser dès qu'une question porte sur " +
    'des messages reçus ou envoyés, ou pour retrouver l’identifiant d’un message avant de le lire.',
  inputSchema: {
    query: z
      .string()
      .max(300)
      .optional()
      .describe('Requête au format Gmail. Laisser vide pour les messages les plus récents.'),
    max_results: z
      .number()
      .int()
      .min(1)
      .max(25)
      .default(10)
      .describe('Nombre de messages à renvoyer (25 maximum, chaque message coûtant un appel).'),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  async handler(args, ctx) {
    const messages = await client(ctx.credentials, ctx.signal).listMessages({
      ...(args.query ? { query: args.query } : {}),
      maxResults: args.max_results,
    });

    return {
      text: renderList({
        title: 'Messages Gmail',
        items: messages,
        emptyMessage: 'Aucun message ne correspond à cette recherche',
        render: renderMessage,
      }),
      data: messages,
    };
  },
});

const getMessage = tool({
  name: 'get_message',
  title: "Lire un e-mail",
  description:
    "Récupère le contenu complet d'un e-mail à partir de son identifiant. Utiliser après " +
    "list_messages lorsque l'utilisateur veut connaître le contenu exact d'un message.",
  inputSchema: {
    message_id: z.string().min(1).describe('Identifiant du message, renvoyé par list_messages.'),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  async handler(args, ctx) {
    const message = await client(ctx.credentials, ctx.signal).getMessage(args.message_id, 'full');

    return {
      text: [
        `**${text(message.subject, '(sans objet)')}**`,
        fields({ De: text(message.from), À: text(message.to), Le: text(message.date) }),
        '',
        text(message.body ?? message.snippet, '(corps vide)'),
      ].join('\n'),
      data: message,
    };
  },
});

const listLabels = tool({
  name: 'list_labels',
  title: 'Lister les libellés',
  description:
    "Liste les libellés Gmail et le nombre de messages non lus de chacun. Utiliser pour savoir où " +
    "en est la boîte de réception, ou pour retrouver un libellé avant de filtrer une recherche.",
  inputSchema: {},
  annotations: { readOnlyHint: true, openWorldHint: true },
  async handler(_args, ctx) {
    const labels = await client(ctx.credentials, ctx.signal).listLabels();

    return {
      text: renderList({
        title: 'Libellés Gmail',
        items: labels.filter((label) => label.type !== 'system' || label.messagesUnread),
        emptyMessage: 'Aucun libellé',
        render: (label) =>
          `- **${label.name}** (id ${label.id})\n  ${fields({
            Total: label.messagesTotal,
            'Non lus': label.messagesUnread,
          })}`,
      }),
      data: labels,
    };
  },
});

const sendMessage = tool({
  name: 'send_message',
  title: 'Envoyer un e-mail',
  description:
    "Envoie un e-mail depuis le compte Gmail de l'utilisateur. Action irréversible : ne l'utiliser " +
    "qu'après avoir fait valider le destinataire, l'objet et le contenu par l'utilisateur.",
  inputSchema: {
    to: z.string().min(3).describe('Destinataire. Plusieurs adresses séparées par des virgules.'),
    subject: z.string().min(1).max(200).describe('Objet du message.'),
    body: z.string().min(1).describe('Corps du message, en texte brut.'),
    cc: z.string().optional().describe('Copie, adresses séparées par des virgules.'),
    thread_id: z
      .string()
      .optional()
      .describe('Pour répondre dans un fil existant : threadId renvoyé par list_messages.'),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  async handler(args, ctx) {
    const result = await client(ctx.credentials, ctx.signal).sendMessage({
      to: args.to,
      subject: args.subject,
      body: args.body,
      ...(args.cc ? { cc: args.cc } : {}),
      ...(args.thread_id ? { threadId: args.thread_id } : {}),
    });

    return {
      text: `E-mail envoyé à ${args.to}${result.id ? ` (message ${result.id})` : ''}.`,
      data: result,
    };
  },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const gmailTools: ToolDefinition<GmailCredentials, any>[] = [
  listMessages,
  getMessage,
  listLabels,
  sendMessage,
];

export default defineConnector<GmailCredentials>({
  id: 'gmail',
  name: 'Gmail',
  tagline: 'Boîte e-mail : recherche, lecture et envoi',
  description:
    "Donne à votre assistant IA l'accès à votre boîte Gmail : rechercher des messages, en lire le " +
    "contenu, consulter vos libellés et envoyer des e-mails en votre nom. La connexion se fait par " +
    'Google, sans aucune clé à saisir.',
  category: 'productivity',
  status: 'beta',
  icon: 'https://ssl.gstatic.com/ui/v1/icons/mail/rfr/gmail.ico',
  accentColor: '#ea4335',
  docsUrl: 'https://developers.google.com/gmail/api',

  auth: {
    type: 'oauth2',
    instructions:
      'Vous serez redirigé vers Google pour autoriser MCP Wesype à accéder à votre boîte. ' +
      'Aucune clé à saisir, et vous pouvez révoquer l’accès à tout moment depuis votre compte Google.',
    docsUrl: 'https://myaccount.google.com/permissions',
    // Aucun champ : l'utilisateur ne saisit rien.
    fields: [],
    oauth: {
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      revokeUrl: 'https://oauth2.googleapis.com/revoke',
      credentialsEnvPrefix: 'GOOGLE',
      scopes: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/userinfo.email',
      ],
      authorizationParams: {
        // Indispensable pour obtenir un refresh_token chez Google : sans ces
        // deux paramètres, l'accès expire au bout d'une heure sans recours.
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
      },
    },
  },

  async verify(credentials, ctx) {
    try {
      const profile = await new GmailClient(credentials.accessToken, ctx.signal).getProfile();
      return profile.emailAddress
        ? { ok: true, accountLabel: profile.emailAddress }
        : { ok: true };
    } catch (error) {
      ctx.logger.debug({ err: error }, 'Vérification Gmail échouée');
      return { ok: false, message: errorMessage(error) };
    }
  },

  tools: gmailTools,
});
