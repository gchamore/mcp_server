import { z } from 'zod';
import { defineConnector, toolFactory } from '../types.js';
import { HttpClient } from '../../core/http-client.js';
import { errorMessage } from '../../core/errors.js';
import { fields, renderList, text } from '../format.js';

/**
 * ===========================================================================
 *  Connecteur Dust — piloter ses agents depuis un autre client IA
 * ===========================================================================
 *
 * Construit sur la spécification OpenAPI publique de Dust. L'authentification
 * est une clé d'API d'espace de travail (Bearer), et chaque route est préfixée
 * par l'identifiant de cet espace — d'où les trois champs : clé, identifiant,
 * région (Dust héberge en us-central1 et europe-west1, deux domaines
 * distincts).
 *
 * Le choix des outils suit la règle du projet : peu, et utiles. Le cœur est
 * `ask_agent` — poser une question à un agent Dust et rapporter sa réponse —
 * parce que c'est l'usage qui a du sens depuis un client MCP : faire répondre
 * un agent spécialisé (avec ses sources de données Dust) au milieu d'une autre
 * conversation. Le reste sert à découvrir quoi appeler.
 */

export type DustCredentials = {
  apiKey: string;
  workspaceId: string;
  region?: string;
};

const tool = toolFactory<DustCredentials>();

const BASES: Record<string, string> = {
  us: 'https://dust.tt',
  eu: 'https://eu.dust.tt',
};

const client = (credentials: DustCredentials) =>
  new HttpClient({
    baseUrl: `${BASES[credentials.region ?? 'us'] ?? BASES.us}/api/v1/w/${encodeURIComponent(
      credentials.workspaceId,
    )}`,
    serviceName: 'Dust',
    headers: { Authorization: `Bearer ${credentials.apiKey}` },
  });

// --- Formes de réponse (sous-ensembles utiles de la spec) -------------------

interface DustAgent {
  sId: string;
  name: string;
  description?: string;
  scope?: string;
  model?: { modelId?: string; providerId?: string };
  status?: string;
}

interface DustMessage {
  type?: string;
  content?: string | null;
  status?: string;
  sId?: string;
}

interface DustConversation {
  sId: string;
  title?: string | null;
  created?: number;
  /** Rangées de versions : la dernière version de chaque message est [n-1]. */
  content?: DustMessage[][];
}

const renderAgent = (agent: DustAgent) =>
  `- **@${agent.name}** (\`${agent.sId}\`)\n  ${fields({
    Description: text(agent.description).slice(0, 140),
    Modèle: agent.model?.modelId,
    Portée: agent.scope,
  })}`;

/** Dernier message d'agent d'une conversation, dans sa dernière version. */
function lastAgentAnswer(conversation: DustConversation): DustMessage | undefined {
  for (const versions of [...(conversation.content ?? [])].reverse()) {
    const message = versions[versions.length - 1];
    if (message?.type === 'agent_message') return message;
  }
  return undefined;
}

// --- Outils -----------------------------------------------------------------

const listAgents = tool({
  name: 'list_agents',
  title: 'Lister les agents',
  description:
    'Liste les agents Dust de l’espace de travail, avec leur identifiant (sId), leur description ' +
    'et leur modèle. Utiliser en premier pour savoir quels agents existent avant d’en interroger un ' +
    'avec ask_agent.',
  inputSchema: {
    view: z
      .enum(['list', 'all', 'published', 'global', 'favorites'])
      .default('list')
      .describe('Filtre : « list » = agents actifs accessibles (défaut), « global » = agents Dust intégrés.'),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  async handler(args, ctx) {
    const reponse = await client(ctx.credentials).get<{ agentConfigurations: DustAgent[] }>(
      '/assistant/agent_configurations',
      { query: { view: args.view }, signal: ctx.signal },
    );

    return {
      text: renderList({
        items: reponse.agentConfigurations,
        title: `Agents Dust (${reponse.agentConfigurations.length})`,
        emptyMessage: 'Aucun agent visible avec cette clé.',
        render: renderAgent,
      }),
      data: reponse.agentConfigurations,
    };
  },
});

const searchAgents = tool({
  name: 'search_agents',
  title: 'Rechercher un agent',
  description:
    'Recherche des agents Dust par nom. Utiliser quand on connaît approximativement le nom d’un ' +
    'agent (« support », « sales »…) pour retrouver son identifiant exact.',
  inputSchema: {
    q: z.string().min(1).max(80).describe('Fragment du nom de l’agent.'),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  async handler(args, ctx) {
    const reponse = await client(ctx.credentials).get<{ agentConfigurations: DustAgent[] }>(
      '/assistant/agent_configurations/search',
      { query: { q: args.q }, signal: ctx.signal },
    );

    return {
      text: renderList({
        items: reponse.agentConfigurations,
        title: `Agents correspondant à « ${args.q} »`,
        emptyMessage: 'Aucun agent ne correspond.',
        render: renderAgent,
      }),
      data: reponse.agentConfigurations,
    };
  },
});

const getAgent = tool({
  name: 'get_agent',
  title: 'Détail d’un agent',
  description:
    'Renvoie la configuration d’un agent Dust : instructions, modèle, portée. Utiliser pour ' +
    'comprendre ce que fait un agent avant de l’interroger, ou pour vérifier sa configuration.',
  inputSchema: {
    agentId: z.string().min(1).max(60).describe('Identifiant sId de l’agent (voir list_agents).'),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  async handler(args, ctx) {
    const reponse = await client(ctx.credentials).get<{ agentConfiguration: DustAgent }>(
      `/assistant/agent_configurations/${encodeURIComponent(args.agentId)}`,
      { signal: ctx.signal },
    );
    const agent = reponse.agentConfiguration;

    return { text: renderAgent(agent), data: agent };
  },
});

const askAgent = tool({
  name: 'ask_agent',
  title: 'Interroger un agent',
  description:
    'Pose une question à un agent Dust et rapporte sa réponse complète. C’est l’outil principal : ' +
    'utiliser dès qu’une question relève d’un agent spécialisé de l’espace de travail (il répond ' +
    'avec ses instructions et ses sources de données Dust). L’identifiant s’obtient via ' +
    'list_agents ou search_agents.',
  inputSchema: {
    agentId: z.string().min(1).max(60).describe('Identifiant sId de l’agent à interroger.'),
    message: z.string().min(1).max(8000).describe('La question ou consigne, en langage naturel.'),
    title: z
      .string()
      .max(120)
      .optional()
      .describe('Titre de la conversation créée côté Dust (facultatif).'),
  },
  annotations: { readOnlyHint: false, openWorldHint: true },
  async handler(args, ctx) {
    const reponse = await client(ctx.credentials).post<{ conversation: DustConversation }>(
      '/assistant/conversations',
      {
        title: args.title ?? null,
        visibility: 'unlisted',
        message: {
          content: args.message,
          // La mention est ce qui désigne l'agent interrogé.
          mentions: [{ configurationId: args.agentId }],
          context: {
            username: 'toolink',
            timezone: 'Europe/Paris',
            fullName: null,
            email: null,
            profilePictureUrl: null,
            origin: 'api',
          },
        },
        // Mode bloquant : la réponse HTTP n'arrive qu'une fois l'agent terminé.
        blocking: true,
      },
      // Un agent qui consulte ses sources prend le temps qu'il faut : le délai
      // par défaut du client (15 s) serait presque toujours dépassé.
      { signal: ctx.signal, timeoutMs: 180_000 },
    );

    const conversation = reponse.conversation;
    const answer = lastAgentAnswer(conversation);

    return {
      text: [
        `**Réponse de l'agent** (conversation \`${conversation.sId}\`)`,
        '',
        text(answer?.content, "L'agent n'a pas produit de réponse — vérifier l'identifiant."),
      ].join('\n'),
      data: { conversationId: conversation.sId, answer: answer?.content ?? null },
    };
  },
});

const getConversation = tool({
  name: 'get_conversation',
  title: 'Relire une conversation',
  description:
    'Récupère une conversation Dust existante et son dernier échange. Utiliser pour relire la ' +
    'réponse d’un ask_agent précédent (l’identifiant de conversation est renvoyé par ask_agent).',
  inputSchema: {
    conversationId: z.string().min(1).max(60).describe('Identifiant sId de la conversation.'),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  async handler(args, ctx) {
    const reponse = await client(ctx.credentials).get<{ conversation: DustConversation }>(
      `/assistant/conversations/${encodeURIComponent(args.conversationId)}`,
      { signal: ctx.signal },
    );

    const conversation = reponse.conversation;
    const answer = lastAgentAnswer(conversation);

    return {
      text: [
        `**Conversation** ${text(conversation.title, '(sans titre)')} — \`${conversation.sId}\``,
        `${conversation.content?.length ?? 0} message(s).`,
        '',
        answer?.content ? `Dernière réponse d'agent :\n${answer.content}` : 'Aucune réponse d’agent.',
      ].join('\n'),
      data: conversation,
    };
  },
});

// --- Définition -------------------------------------------------------------

export const dust = defineConnector<DustCredentials>({
  id: 'dust',
  name: 'Dust',
  tagline: 'Interrogez vos agents Dust — et leurs sources de données — depuis n’importe quel client IA.',
  description:
    'Relie votre espace de travail Dust : listez vos agents, consultez leur configuration, et ' +
    'surtout posez-leur des questions — l’agent répond avec ses instructions et ses sources de ' +
    'données, et sa réponse revient dans votre conversation.',
  category: 'productivity',
  status: 'beta',
  icon: 'https://dust.tt/favicon.ico',
  accentColor: '#10b981',
  docsUrl: 'https://docs.dust.tt/reference/developer-platform-overview',

  auth: {
    type: 'api_key',
    instructions:
      'Dans Dust : Paramètres de l’espace de travail → API Keys → créer une clé. ' +
      'L’identifiant de l’espace est dans l’URL : dust.tt/w/IDENTIFIANT/…',
    docsUrl: 'https://docs.dust.tt/reference/api-keys',
    fields: [
      {
        key: 'apiKey',
        label: 'Clé API Dust',
        type: 'password',
        required: true,
        placeholder: 'sk-…',
        help: 'Clé d’espace de travail, chiffrée avant stockage.',
        minLength: 10,
        maxLength: 200,
      },
      {
        key: 'workspaceId',
        label: 'Identifiant de l’espace de travail',
        type: 'text',
        required: true,
        placeholder: '0ec9852c2f',
        help: 'Le segment après /w/ dans l’URL de votre espace Dust.',
        minLength: 4,
        maxLength: 40,
      },
      {
        key: 'region',
        label: 'Région d’hébergement',
        type: 'select',
        required: false,
        defaultValue: 'us',
        help: 'EU si votre espace est hébergé sur eu.dust.tt.',
        options: [
          { value: 'us', label: 'États-Unis (dust.tt)' },
          { value: 'eu', label: 'Europe (eu.dust.tt)' },
        ],
      },
    ],
  },

  async verify(credentials, ctx) {
    try {
      const reponse = await client(credentials).get<{ agentConfigurations: DustAgent[] }>(
        '/assistant/agent_configurations',
        { query: { view: 'list' }, signal: ctx.signal },
      );
      return {
        ok: true,
        accountLabel: `Espace ${credentials.workspaceId} · ${reponse.agentConfigurations.length} agent(s)`,
      };
    } catch (error) {
      ctx.logger.debug({ err: error }, 'Vérification Dust échouée');
      return { ok: false, message: errorMessage(error) };
    }
  },

  tools: [listAgents, searchAgents, getAgent, askAgent, getConversation],
});
