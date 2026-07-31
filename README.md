# MCP Wesype

Plateforme qui transforme vos outils métier (CRM, facturation, e-mailing) en
serveurs **Model Context Protocol** utilisables directement par Claude, Dust ou
ChatGPT. L'utilisateur renseigne sa clé API, récupère une URL, et son assistant
sait travailler avec ses données.

---

## Démarrage rapide

```bash
# 1. Dépendances (installe aussi celles du front)
npm install

# 2. Configuration
cp .env.example .env
node -e "console.log('ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('hex'))" >> .env
node -e "console.log('SESSION_SECRET=' + require('crypto').randomBytes(32).toString('hex'))" >> .env
# puis renseigner DATABASE_URL

# 3. Base de données
npx prisma migrate deploy
npm run db:seed          # comptes de test (développement uniquement)

# 4. Lancement (API sur :3000, interface sur :5173)
npm run dev
```

Le premier compte créé devient automatiquement administrateur.

---

## Architecture

```
src/
├─ index.ts              Démarrage, arrêt propre, tâches de fond
├─ app.ts                Fabrique Express (montage des routeurs, SPA, santé)
├─ api.ts                Assemblage de l'API sous /api
│
├─ core/                 Socle transverse
│  ├─ env.ts             Configuration validée par zod — seul accès à process.env
│  ├─ crypto.ts          AES-256-GCM, tokens opaques, comparaison à temps constant
│  ├─ errors.ts          Erreurs typées → réponses HTTP cohérentes
│  ├─ logger.ts          Journalisation structurée avec masquage des secrets
│  ├─ http-client.ts     Client HTTP des connecteurs (délais, erreurs traduites)
│  ├─ prisma.ts          Client de base de données
│  └─ audit.ts           Piste d'audit des actions sensibles
│
├─ connectors/           ⭐ Le cœur extensible
│  ├─ types.ts           Contrat d'un connecteur
│  ├─ index.ts           Liste des connecteurs (1 ligne par service)
│  ├─ registry.ts        Chargement, validation, projections publiques
│  ├─ format.ts          Aides de rendu Markdown pour les outils
│  ├─ axonaut/           CRM & facturation (10 outils, clé API)
│  ├─ brevo/             E-mailing & marketing (7 outils, clé API)
│  └─ gmail/             Boîte e-mail (4 outils, OAuth)
│
├─ mcp/                  Transport MCP
│  ├─ server-factory.ts  Connecteur → serveur MCP (SDK officiel)
│  ├─ resolve.ts         Jeton → connexion + identifiants frais
│  ├─ well-known.ts      Métadonnées de ressource protégée (RFC 9728)
│  └─ router.ts          Streamable HTTP, OAuth + repli par jeton
│
├─ modules/              Fonctionnalités (routeur + service colocalisés)
│  ├─ auth/              Sessions, mots de passe, Google OAuth
│  ├─ oauth/             Serveur d'autorisation OAuth 2.1 pour clients MCP
│  ├─ connections/       Identifiants utilisateur par connecteur
│  ├─ endpoints/         Points d'accès MCP révocables
│  ├─ catalog/           Catalogue public
│  └─ admin/             Supervision, comptes, statistiques
│
├─ middleware/           auth · validate · rate-limit · security · error-handler
└─ jobs/                 Purge périodique

web/                     Interface React + Vite (SPA)
├─ src/components/       Design system, formulaire d'identifiants générique
├─ src/routes/           Catalogue, détail connecteur, connexions, admin
└─ src/lib/api.ts        Client HTTP typé
```

---

## Documentation

| Document | Contenu |
|---|---|
| [Ajouter un connecteur](docs/ajouter-un-connecteur.md) | La procédure : un dossier, un fichier, une ligne |
| [Autorisation OAuth](docs/oauth.md) | Les deux couches OAuth, les trois modes de Dust, mise en service |
| [État des lieux et feuille de route](docs/etat-des-lieux.md) | Ce qui est en place, ce qui manque pour la marketplace |
| [Générer des connecteurs](docs/generation-de-connecteurs.md) | Étude : génération déterministe depuis OpenAPI |

## Ajouter un connecteur

Un dossier, un fichier, une ligne. Aucune migration, aucune modification du
front, aucune route à déclarer.

👉 **[docs/ajouter-un-connecteur.md](docs/ajouter-un-connecteur.md)**

Tout se déduit d'un objet auto-descriptif : la carte du catalogue, le formulaire
d'identifiants, la validation serveur, le serveur MCP et les statistiques
d'administration.

---

## Modèle de sécurité

| Sujet | Choix |
|---|---|
| Session web | Token opaque en cookie `httpOnly` + `SameSite=Lax`, révocable en base. Pas de JWT : « déconnecter tous mes appareils » doit avoir un effet immédiat. |
| Identifiants tiers | Chiffrés AES-256-GCM avant stockage. Jamais réaffichés en clair, jamais journalisés. |
| Accès MCP | OAuth 2.1 par défaut (PKCE obligatoire, clients publics, rotation des jetons de rafraîchissement, révocation de famille sur rejeu). Repli par jeton statique révocable. |
| Jetons OAuth | Stockés hachés (SHA-256). Une fuite de la base ne donne aucun accès. |
| Rôles | En base (`USER` / `ADMIN`), vérifiés côté serveur. Aucune liste d'e-mails dans le code. |
| CSRF | `SameSite=Lax` + vérification d'origine sur les méthodes mutantes. |
| CORS | Liste blanche explicite (`CORS_ORIGINS`), avec cookies. |
| En-têtes | `helmet` avec CSP restrictive : aucune ressource externe hors icônes. |
| Débit | `express-rate-limit`, plus strict sur l'authentification et les envois d'e-mail. |
| Énumération de comptes | Réponses et temps de réponse identiques que le compte existe ou non. |
| Journaux | Masquage des mots de passe, clés API, jetons et cookies. |

**Comment un client IA se connecte** : il suffit de coller l'URL publique du
connecteur (`https://…/mcp/gmail`). Le client reçoit un 401 accompagné d'un
en-tête `WWW-Authenticate`, découvre nos métadonnées, s'enregistre seul, ouvre
le navigateur sur l'écran de consentement, et repart avec un jeton. Aucun secret
n'est copié-collé. Détail complet dans [docs/oauth.md](docs/oauth.md).

---

## Transport MCP

Streamable HTTP, en mode **sans session** : un serveur et un transport sont
créés par requête HTTP puis détruits. Conséquences directes — aucun état MCP en
mémoire, rien à reconstruire après un redéploiement, et la possibilité de faire
tourner plusieurs instances derrière un répartiteur de charge.

```
POST|GET|DELETE  /mcp/:connectorId          Chemin OAuth (recommandé)
POST|GET|DELETE  /mcp/:connectorId/:token   Repli par jeton statique
GET              /mcp                        Informations publiques (sans secret)

GET   /.well-known/oauth-protected-resource/mcp/:connectorId
GET   /.well-known/oauth-authorization-server
POST  /register · GET /authorize · POST /token · POST /revoke
```

---

## Commandes

| Commande | Effet |
|---|---|
| `npm run dev` | API + interface, en rechargement à chaud |
| `npm run build` | Compile le serveur puis l'interface |
| `npm start` | Applique les migrations puis démarre le serveur |
| `npm test` | Suite de tests (Vitest) |
| `npm run typecheck` | TypeScript strict, serveur et interface |
| `npm run lint` / `lint:fix` | ESLint |
| `npm run db:migrate` | Nouvelle migration Prisma |
| `npm run db:studio` | Explorateur de base |
| `npm run db:seed` | Comptes de développement |

---

## Configuration

Toutes les variables sont validées au démarrage (`src/core/env.ts`) : une valeur
manquante ou mal formée arrête le serveur avec un message explicite, plutôt que
de produire une panne obscure plus tard.

Voir [`.env.example`](.env.example) pour la liste commentée. Obligatoires en
production : `DATABASE_URL`, `ENCRYPTION_KEY`, `SESSION_SECRET`. Facultatifs :
Google OAuth (`GOOGLE_CLIENT_*`) et SMTP (`SMTP_*`, requis pour la
réinitialisation de mot de passe) — leur absence désactive proprement la
fonctionnalité correspondante.

---

## Déploiement (Railway)

`railway.toml` est déjà configuré : `npm run build` puis `npm start`, avec un
health check sur `/health`. `npm start` applique les migrations avant de
démarrer.

Variables à définir sur le service : `DATABASE_URL`, `ENCRYPTION_KEY`,
`SESSION_SECRET`, `CORS_ORIGINS`, et selon les besoins `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `SMTP_*`. `APP_BASE_URL` est déduit de
`RAILWAY_PUBLIC_DOMAIN` si absent.

> **Attention** : `ENCRYPTION_KEY` chiffre les identifiants tiers. La changer
> rend illisibles toutes les connexions existantes. Sauvegardez-la hors du dépôt.

### Passage à plusieurs instances

Trois points, tous documentés dans le code :

1. **Limitation de débit** — stockage en mémoire, donc par processus. Brancher
   `rate-limit-redis` (`src/middleware/rate-limit.ts`).
2. **Purge périodique** — s'exécutera sur chaque instance ; les opérations sont
   idempotentes, donc sans conséquence (`src/jobs/cleanup.ts`).
3. **Transport MCP** — déjà sans état, rien à faire.
