import type { z, ZodRawShape } from 'zod';
import type { Logger } from '../core/logger.js';

/**
 * =========================================================================
 *  Contrat des connecteurs — la seule chose à connaître pour ajouter un MCP
 * =========================================================================
 *
 * Un connecteur est un objet auto-descriptif. À partir de lui, la plateforme
 * dérive TOUT le reste, sans qu'aucun autre fichier ne soit modifié :
 *
 *   • la fiche du catalogue et la carte affichée dans l'UI  → name / tagline / icon
 *   • le formulaire de saisie des identifiants               → auth.fields
 *   • la validation serveur des identifiants                 → auth.fields + verify()
 *   • le serveur MCP exposé aux clients IA                   → tools
 *
 * Pour ajouter un connecteur : créer `src/connectors/<id>/index.ts` exportant
 * par défaut `defineConnector({...})`. Le registre le découvre au démarrage.
 */

/** Regroupement utilisé par les filtres du catalogue. */
export type ConnectorCategory =
  | 'crm'
  | 'finance'
  | 'productivity'
  | 'marketing'
  | 'support'
  | 'developer'
  | 'other';

export type ConnectorStatus = 'stable' | 'beta' | 'coming-soon';

/** Identifiants saisis par l'utilisateur, toujours des chaînes. */
export type Credentials = Record<string, string>;

export type CredentialFieldType = 'text' | 'password' | 'url' | 'email' | 'select';

/**
 * Un champ du formulaire de connexion. Le front génère l'input à partir de ça ;
 * le serveur valide avec les mêmes contraintes. Une seule source de vérité.
 */
export interface CredentialField {
  key: string;
  label: string;
  type: CredentialFieldType;
  /** Défaut : true. */
  required?: boolean;
  placeholder?: string;
  /** Phrase d'aide affichée sous le champ. */
  help?: string;
  /** Source d'une expression régulière (sans délimiteurs), appliquée des deux côtés. */
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  defaultValue?: string;
  /** Requis lorsque `type === 'select'`. */
  options?: { value: string; label: string }[];
}

/**
 * Configuration OAuth d'un connecteur — « couche B ».
 *
 * À ne pas confondre avec le serveur d'autorisation de la plateforme
 * (« couche A », src/modules/oauth) : ici, c'est Wesype qui est CLIENT du
 * service tiers, pour obtenir un jeton au nom de l'utilisateur.
 *
 * L'identifiant et le secret de l'application ne sont PAS dans le connecteur :
 * ce sont des secrets d'exploitation, lus dans l'environnement via
 * `<PREFIX>_CLIENT_ID` / `<PREFIX>_CLIENT_SECRET`. Un connecteur dont
 * l'application n'est pas configurée apparaît désactivé dans le catalogue au
 * lieu de faire échouer le démarrage.
 */
export interface ConnectorOAuthConfig {
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string[];
  /** Préfixe des variables d'environnement. Ex. « GOOGLE ». */
  credentialsEnvPrefix: string;
  /** Paramètres supplémentaires sur l'URL d'autorisation (ex. access_type=offline). */
  authorizationParams?: Record<string, string>;
  /** URL de révocation côté fournisseur, appelée à la suppression de la connexion. */
  revokeUrl?: string;
}

export interface ConnectorAuth {
  type: 'api_key' | 'basic' | 'bearer' | 'oauth2';
  /** Vide pour un connecteur OAuth : l'utilisateur ne saisit rien. */
  fields: CredentialField[];
  /** Requis lorsque `type === 'oauth2'`. */
  oauth?: ConnectorOAuthConfig;
  /** Lien vers la doc du service expliquant où récupérer la clé. */
  docsUrl?: string;
  /** Instructions courtes affichées au-dessus du formulaire. */
  instructions?: string;
}

/**
 * Identifiants d'un connecteur OAuth, tels que stockés (chiffrés) en base.
 *
 * Déclaré en intersection et non en `interface … extends` : une interface avec
 * signature d'index n'accepte pas de propriétés optionnelles.
 */
export type OAuthCredentials = Credentials & {
  accessToken: string;
  refreshToken?: string;
  /** Date ISO d'expiration du jeton d'accès. */
  expiresAt?: string;
  scope?: string;
};

/** Résultat de `verify()` : sert à passer la connexion en ACTIVE ou ERROR. */
export type VerifyResult =
  | { ok: true; accountLabel?: string }
  | { ok: false; message: string };

/** Contexte transmis à chaque exécution d'outil. */
export interface ToolContext<C extends Credentials = Credentials> {
  credentials: C;
  connectionId: string;
  logger: Logger;
  /** Annulé si le client MCP abandonne la requête — à passer à `fetch`. */
  signal: AbortSignal;
}

/**
 * Ce que renvoie un outil. `text` est ce que le modèle lit ; `data` est renvoyé
 * en `structuredContent` pour les clients qui savent l'exploiter.
 */
export type ToolResult = string | { text: string; data?: unknown };

export interface ToolAnnotations {
  /** L'outil ne modifie rien côté service distant. */
  readOnlyHint?: boolean;
  /** L'outil peut détruire ou écraser des données. */
  destructiveHint?: boolean;
  /** Deux appels identiques produisent le même effet. */
  idempotentHint?: boolean;
  /** L'outil interagit avec un système externe. */
  openWorldHint?: boolean;
}

export interface ToolDefinition<
  C extends Credentials = Credentials,
  S extends ZodRawShape = ZodRawShape,
> {
  /** snake_case, unique au sein du connecteur. */
  name: string;
  /** Libellé lisible affiché dans l'UI et par les clients MCP. */
  title: string;
  /**
   * Description lue par le modèle. Écrire *quand* utiliser l'outil, pas
   * seulement ce qu'il fait — c'est ce qui pilote son déclenchement.
   */
  description: string;
  inputSchema: S;
  annotations?: ToolAnnotations;
  handler: (args: ShapeOutput<S>, ctx: ToolContext<C>) => Promise<ToolResult>;
}

/** Type des arguments après validation, dérivé du `ZodRawShape` déclaré. */
export type ShapeOutput<S extends ZodRawShape> = z.output<z.ZodObject<S>>;

export interface ConnectorDefinition<C extends Credentials = Credentials> {
  /** Slug stable : `[a-z0-9-]+`. Sert de clé en base et dans les URLs. */
  id: string;
  name: string;
  /** Une ligne pour la carte du catalogue. */
  tagline: string;
  /** Paragraphe pour la page de détail. */
  description: string;
  category: ConnectorCategory;
  status?: ConnectorStatus;
  /** URL absolue ou data-URI. Affiché en 40×40 dans le catalogue. */
  icon: string;
  /** Couleur d'accent (hex) utilisée par la carte. */
  accentColor?: string;
  docsUrl?: string;
  auth: ConnectorAuth;
  /**
   * Teste les identifiants contre le service distant. Appelé à la création et
   * à la mise à jour d'une connexion, et à la demande depuis l'UI.
   */
  verify: (credentials: C, ctx: { signal: AbortSignal; logger: Logger }) => Promise<VerifyResult>;
  /**
   * La forme des arguments varie d'un outil à l'autre : ce tableau est
   * existentiellement quantifié sur `S`, ce que TypeScript ne sait pas
   * exprimer. `never` ne convient pas — `S` apparaît en position covariante
   * (`inputSchema`) comme contravariante (les arguments du handler).
   *
   * Le `any` reste donc, mais confiné à cette ligne : il ne s'échappe pas de la
   * déclaration, puisque chaque outil conserve sa signature exacte au moment
   * où il est écrit.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: ToolDefinition<C, any>[];
}

/**
 * ===========================================================================
 *  Vue effacée d'un connecteur
 * ===========================================================================
 *
 * Le moteur — registre, transport MCP, résolution d'une connexion — manipule
 * des connecteurs sans savoir lesquels. Or chacun a son propre type
 * d'identifiants, et `verify` comme les handlers les prennent en *entrée* :
 * ces positions sont contravariantes, si bien qu'un
 * `ConnectorDefinition<GmailCredentials>` n'est pas assignable à un
 * `ConnectorDefinition<Credentials>`. TypeScript a raison de refuser.
 *
 * La réponse retenue jusqu'ici était `ConnectorDefinition<any>`, répété dans
 * sept fichiers. Elle réglait la compilation en supprimant toute vérification
 * partout où le type circulait — y compris là où elle aurait servi.
 *
 * `AnyConnector` fait le contraire : il fixe une fois pour toutes la forme que
 * le moteur voit, avec `Credentials` en entrée et rien d'autre. La conversion
 * a lieu dans `defineConnector`, à un seul endroit, où elle est justifiable :
 * les identifiants sont validés au moment de leur écriture, par le schéma
 * déclaré par le connecteur lui-même (voir `parseCredentials`). Ce qui arrive
 * au handler correspond donc bien à ce qu'il attend.
 */
export interface AnyTool extends Omit<ToolDefinition, 'inputSchema' | 'handler'> {
  inputSchema: ZodRawShape;
  handler: (args: Record<string, unknown>, ctx: ToolContext<Credentials>) => Promise<ToolResult>;
}

export interface AnyConnector extends Omit<ConnectorDefinition, 'verify' | 'tools'> {
  verify: (
    credentials: Credentials,
    ctx: { signal: AbortSignal; logger: Logger },
  ) => Promise<VerifyResult>;
  tools: AnyTool[];
}

/**
 * Déclare un connecteur.
 *
 * Le paramètre reste typé précisément : à l'intérieur de la définition,
 * `credentials` a le type du connecteur et l'autocomplétion fonctionne. C'est
 * en sortie que le type est effacé, pour que le moteur puisse les traiter tous
 * de la même façon.
 *
 * La conversion ci-dessous est l'unique renoncement de typage du projet. Elle
 * est confinée ici et couverte par la validation d'exécution.
 */
export function defineConnector<C extends Credentials>(
  definition: ConnectorDefinition<C>,
): AnyConnector {
  return definition as unknown as AnyConnector;
}

/**
 * Fabrique d'outils liée à un type d'identifiants.
 *
 * Curryfiée parce que TypeScript ne peut pas inférer partiellement : le type des
 * identifiants doit être annoncé (il n'apparaît que dans le contexte), tandis
 * que le schéma d'entrée, lui, s'infère depuis `inputSchema`. On écrit donc :
 *
 *   const tool = toolFactory<AxonautCredentials>();
 *   const listCompanies = tool({ name: 'list_companies', inputSchema: { page }, ... });
 *
 * et `args` est typé automatiquement dans le handler.
 */
export function toolFactory<C extends Credentials>() {
  return <S extends ZodRawShape>(tool: ToolDefinition<C, S>): ToolDefinition<C, S> => tool;
}

/** Vue publique d'un connecteur, envoyée au front. Ne contient aucun secret. */
export interface ConnectorSummary {
  id: string;
  name: string;
  tagline: string;
  description: string;
  category: ConnectorCategory;
  status: ConnectorStatus;
  icon: string;
  accentColor: string;
  docsUrl?: string;
  /** Vue expurgée : ni `oauth` (URLs internes), ni secret d'application. */
  auth: {
    type: ConnectorAuth['type'];
    fields: CredentialField[];
    docsUrl?: string;
    instructions?: string;
    /** Scopes demandés au service tiers, affichés à l'utilisateur avant consentement. */
    scopes?: string[];
  };
  /** false si l'application OAuth n'est pas configurée sur ce serveur. */
  available: boolean;
  unavailableReason?: string;
  /** URL MCP publique à coller dans un client IA. */
  mcpUrl: string;
  tools: { name: string; title: string; description: string; readOnly: boolean }[];
  toolCount: number;
}
