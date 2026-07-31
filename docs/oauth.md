# Autorisation : les deux couches OAuth

Le mot « OAuth » recouvre ici **deux mécanismes distincts**, qui n'ont ni le
même rôle ni le même sens. Les confondre est la source d'erreur la plus
fréquente sur ce sujet.

```
                    ┌──────────── COUCHE A ────────────┐
   Claude / Dust ──►│  Wesype est SERVEUR              │
   ChatGPT          │  d'autorisation                  │
                    │  « ce client peut-il accéder     │
                    │    aux outils de cet             │
                    │    utilisateur ? »               │
                    └──────────────┬───────────────────┘
                                   │
                    ┌──────────── COUCHE B ────────────┐
                    │  Wesype est CLIENT OAuth         │──► Google / Notion
                    │  « Wesype peut-il lire la boîte  │    Slack / HubSpot
                    │    Gmail de cet utilisateur ? »  │
                    └──────────────────────────────────┘
```

**La couche A, la plateforme IA la déclenche toute seule.** La couche B, non :
si Wesype expose des outils Gmail, c'est Wesype qui appelle l'API Google, donc
Wesype qui doit détenir le jeton. Personne ne peut le faire à sa place.

Les deux sont **chaînées** : quand le client IA déclenche la couche A, l'écran
de consentement enchaîne la couche B si l'utilisateur n'a pas encore raccordé
son compte. Un seul parcours navigateur, tout est configuré.

> À ne pas confondre non plus avec `/api/auth/google` : là, Wesype est client de
> Google pour **connecter l'utilisateur au site**. C'est une troisième chose,
> sans rapport avec MCP.

---

## Couche A — le client IA s'authentifie auprès de Wesype

### Le parcours, tel qu'il se déroule réellement

Vérifié de bout en bout sur le serveur compilé :

| Étape | Ce qui se passe | Point d'entrée |
|---|---|---|
| 1 | L'utilisateur colle `https://…/mcp/gmail` dans son client IA | — |
| 2 | Le client appelle sans jeton → **401** + `WWW-Authenticate: Bearer … resource_metadata="…"` | `src/mcp/router.ts` |
| 3 | Il suit `resource_metadata` et apprend qui délivre les jetons | `/.well-known/oauth-protected-resource/mcp/:connectorId` |
| 4 | Il lit les métadonnées du serveur d'autorisation | `/.well-known/oauth-authorization-server` |
| 5 | Il **s'enregistre tout seul** (RFC 7591) et reçoit un `client_id` | `POST /register` |
| 6 | Il ouvre le navigateur sur `/authorize` avec PKCE | `POST /authorize` |
| 7 | Wesype redirige vers son propre écran de consentement | `/autoriser?demande=…` |
| 8 | L'utilisateur se connecte, choisit le mode et le compte, approuve | `POST /api/oauth/authorization/approve` |
| 9 | Retour au client avec un code, échangé contre des jetons | `POST /token` |
| 10 | Tous les appels MCP portent `Authorization: Bearer …` | `src/mcp/router.ts` |

**Aucun secret n'est copié-collé.** C'est ce que Dust appelle l'option
« Automatic », et c'est le mode recommandé.

### Choix d'implémentation

**Le serveur d'autorisation vient du SDK officiel** (`mcpAuthRouter`), monté à
la racine car la spécification impose des chemins fixes. Nous n'implémentons que
`OAuthServerProvider` (`src/modules/oauth/provider.ts`) : toute la mécanique
protocolaire — validation PKCE, formats d'erreur, limitation de débit — vient
du SDK, donc reste conforme au fil des versions.

**La demande en attente voyage chiffrée dans l'URL**, pas en base. Au moment où
le navigateur arrive sur `/authorize`, on ne sait pas encore qui est
l'utilisateur : il faut donc mémoriser la demande le temps qu'il se connecte.
Plutôt qu'une table à purger, la demande est sérialisée puis chiffrée
(AES-256-GCM) dans le paramètre `demande`. Toute altération fait échouer le
déchiffrement, et il n'y a rien à nettoyer.

**Les clients issus de l'enregistrement dynamique sont publics.** Aucun secret
n'est émis : PKCE (`S256`) tient lieu d'authentification, comme l'impose
OAuth 2.1 — un client de bureau ne peut de toute façon pas garder un secret.
Les clients créés à la main par un administrateur, eux, sont confidentiels et
disposent d'un secret (voir « Static OAuth » plus bas). Leur secret est stocké
chiffré et non haché, parce que le SDK le compare en clair.

**Rotation et détection de rejeu.** Un jeton de rafraîchissement est révoqué dès
qu'il est utilisé. Un code d'autorisation rejoué révoque **toute la famille** de
jetons qui en découle : un code intercepté ne donne donc accès à rien de
durable.

**Tous les jetons sont stockés hachés** (SHA-256). Une fuite de la base ne donne
aucun accès.

### Correspondance avec les options de Dust

La documentation de Dust décrit trois façons d'ajouter un serveur MCP distant.
Voici ce que couvre notre implémentation :

| Option Dust | Ce qu'elle exige du serveur | État |
|---|---|---|
| **Automatic** (recommandée) | Découverte depuis l'URL, enregistrement dynamique, flux OAuth | ✅ supporté |
| **Static OAuth** | Client pré-enregistré : `client_id`, `client_secret`, points d'entrée `/authorize` et `/token`, scopes | ✅ supporté — voir ci-dessous |
| **Bearer Token** | Un jeton statique envoyé en en-tête `Authorization` | ✅ couvert par le chemin à jeton d'URL |

**Deux points relevés en relisant la doc de Dust, et corrigés :**

1. **L'indicateur de ressource n'est pas garanti.** La spécification MCP impose
   `resource` (RFC 8707), mais la documentation de Dust ne le mentionne nulle
   part. Une première version rejetait la demande en son absence, ce qui aurait
   cassé le parcours. Désormais, si `resource` manque, l'écran de consentement
   propose simplement la liste des connecteurs et l'utilisateur désigne celui
   qu'il veut.

2. **Le mode « Static OAuth » exige un client confidentiel.** Dust demande à
   l'administrateur de créer une application côté serveur distant, puis de
   coller `client_id` et `client_secret`. C'est incompatible avec des clients
   publics. On peut donc créer un client statique depuis
   **Administration → Clients MCP**, qui affiche une fois les cinq valeurs
   attendues par Dust :

   | Champ Dust | Valeur fournie |
   |---|---|
   | Static OAuth URL | l'URL du connecteur, ex. `https://…/mcp/axonaut` |
   | OAuth Authorization Endpoint | `https://…/authorize` |
   | OAuth token endpoint | `https://…/token` |
   | Client ID / Client Secret | générés à la création |
   | OAuth scopes | `mcp` |

   Les URI de rappel de Dust (`https://dust.tt/oauth/mcp_static/finalize` et sa
   variante `eu.`) sont pré-remplies.

---

## Couche B — Wesype s'authentifie auprès du service tiers

Un connecteur déclare `auth.type: 'oauth2'` et ses points d'entrée. L'utilisateur
ne saisit **aucune clé**.

```ts
auth: {
  type: 'oauth2',
  fields: [],                       // rien à saisir
  oauth: {
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    credentialsEnvPrefix: 'GOOGLE', // → GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
    scopes: ['https://www.googleapis.com/auth/gmail.readonly', …],
    authorizationParams: { access_type: 'offline', prompt: 'consent' },
  },
}
```

Les jetons obtenus deviennent les « identifiants » de la connexion, chiffrés
exactement comme une clé API. **Le rafraîchissement est automatique** : avant
chaque session MCP, un jeton proche de l'expiration est renouvelé
(`ensureFreshCredentials`). Si le fournisseur refuse — consentement révoqué — la
connexion bascule en erreur avec un message actionnable, plutôt que d'accumuler
des échecs opaques.

L'identifiant et le secret de l'application ne sont **pas** dans le connecteur :
ce sont des secrets d'exploitation, lus dans l'environnement. Un connecteur dont
l'application n'est pas configurée apparaît **désactivé** dans le catalogue au
lieu de faire échouer le démarrage.

---

## Individuel ou partagé : ce n'est pas notre question

L'écran de consentement posait autrefois la question. Elle a été retirée, parce
que les plateformes IA la posent **déjà** au moment où l'on colle l'URL, et en
tirent elles-mêmes les conséquences.

[Dust](https://docs.dust.tt/docs/personal-vs-workspace-credentials-for-tools-mcp-servers)
distingue ainsi *Personal credentials* et *Shared credentials* :

| Choix côté Dust | Ce que nous voyons |
|---|---|
| **Shared** | Un seul parcours d'autorisation, fait par l'administrateur. Son jeton est ensuite réutilisé pour tout l'espace de travail. |
| **Personal** | L'administrateur en fait un, puis **chaque** utilisateur fait le sien à sa première utilisation. |

La distinction se réduit donc, de notre côté, à un simple **nombre de parcours
d'autorisation**. Chaque jeton que nous émettons porte déjà un utilisateur et une
connexion : les deux comportements en découlent sans qu'on ait à les nommer.

Reposer la question était au mieux redondant, au pire contradictoire — rien
n'empêchait de répondre « partagé » chez nous après avoir choisi « personnel »
dans Dust, et les deux modèles se seraient contredits en silence. Le protocole ne
transmet d'ailleurs aucun indicateur de mode : nous ne pouvons pas le connaître.

Il ne reste donc qu'une décision sur l'écran de consentement : **autoriser ou
refuser**. Et lorsqu'aucun compte n'est encore raccordé sur un connecteur OAuth,
le bouton principal part directement chez le fournisseur — au retour,
l'autorisation est accordée sans redemander, le clic initial valant consentement.

---

## Les trois modes d'authentification de Dust

| Mode Dust | Ce qu'il envoie | Ce qu'il faut chez nous |
|---|---|---|
| **Automatic** | Découverte + enregistrement dynamique (RFC 7591) | Rien : c'est le chemin nominal |
| **Static OAuth** | `client_id` et `client_secret` saisis à la main | Un client confidentiel pré-enregistré (voir *Client statique*) |
| **Bearer Token** | Un jeton collé, envoyé en en-tête `Authorization` | Un jeton de point d'accès (`mcp_…`) créé depuis « Mes connexions » |

Le mode **Bearer Token** est celui qui convient aux connecteurs à clé API, où il
n'y a rien à négocier : la personne crée son point d'accès, copie le jeton, le
colle dans Dust. Le serveur accepte ce jeton aussi bien en en-tête que dans le
chemin d'URL — mêmes droits, même révocation. L'en-tête est même préférable : un
segment d'URL finit dans les journaux d'accès et les en-têtes `Referer`.

---

## Chemin de repli : jeton statique dans l'URL

`https://…/mcp/:connectorId/:token` reste disponible pour les clients incapables
de faire de l'OAuth. Toujours un compte partagé, puisque **l'URL est
l'identité**. Le jeton est révocable individuellement depuis « Mes connexions ».

À réserver aux cas où l'OAuth n'est pas possible : le secret transite alors dans
une URL, avec les risques habituels (journaux d'accès, historique de navigateur).

---

## Mettre en service un connecteur OAuth

En prenant Gmail comme exemple. **Ces étapes se font chez le fournisseur, elles
ne peuvent pas être automatisées.**

1. Dans la Google Cloud Console, sur l'application désignée par
   `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` :
   - activer l'**API Gmail** ;
   - ajouter les scopes de `src/connectors/gmail/index.ts` à l'écran de
     consentement ;
   - déclarer l'URI de redirection :
     `<APP_BASE_URL>/api/connections/oauth/gmail/callback`.
2. Les scopes Gmail sont classés « sensibles » par Google : une **validation**
   est exigée avant une ouverture au public. Tant qu'elle n'est pas obtenue,
   l'application fonctionne pour les comptes de test déclarés dans la console.
3. Redémarrer le serveur : le connecteur passe de « désactivé » à disponible.

> **Faut-il réutiliser l'application Google du login ?** C'est possible et
> immédiat, mais cela mélange l'authentification de la plateforme et l'accès aux
> données : l'écran de consentement Google devient plus intimidant, et une
> révocation côté utilisateur casse les deux à la fois. Une application dédiée
> aux connecteurs est préférable dès que le produit sort du prototype.

---

## Ce qui est couvert par les tests

`tests/oauth-flow.test.ts` déroule le flux complet contre une base réelle :
enregistrement dynamique, redirection vers le consentement, ressource inconnue
refusée proprement, consentement, échange du code, appel MCP authentifié,
cloisonnement entre connecteurs, rejeu de code refusé **et** révocation de la
famille de jetons, `code_verifier` invalide refusé, **parcours sans indicateur
de ressource**, et **client confidentiel statique** (échange refusé sans secret,
accepté avec).

La suite se saute d'elle-même si aucune base n'est joignable :

```bash
docker run -d --name wesype-test-db -e POSTGRES_PASSWORD=test \
  -e POSTGRES_USER=test -e POSTGRES_DB=wesype_test -p 55432:5432 postgres:16-alpine
export DATABASE_URL=postgresql://test:test@localhost:55432/wesype_test
npx prisma migrate deploy && npm test
```
