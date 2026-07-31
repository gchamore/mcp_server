# État des lieux et feuille de route

Objectif visé : **une marketplace où chaque utilisateur choisit des MCP et y
accède de manière sécurisée.** Ce document fait le point sur ce qui est en
place, ce qui manque, et dans quel ordre le construire.

---

## 1. Persistance des sessions : ce qui est réellement garanti

Deux notions différentes sont souvent confondues sous le mot « session ».

### a) L'état de configuration d'un utilisateur — **persistant, vérifié**

C'est ce qui compte pour l'utilisateur : ses identifiants, ses URLs, ses
réglages. Tout vit en base (`connections`, `mcp_endpoints`), rien en mémoire.

Vérifié en conditions réelles (serveur compilé, PostgreSQL, `SIGKILL` puis
redémarrage) :

| Scénario | Résultat |
|---|---|
| 2 comptes Axonaut pour le même utilisateur (« Cabinet Paris », « Cabinet Lyon ») | ✅ créés, isolés |
| 2 points d'accès sur la même connexion (« principal », « Claude Desktop ») | ✅ |
| Libellé dupliqué sur le même connecteur | ✅ refusé (`CONFLICT`) |
| Crash brutal puis redémarrage, mêmes URLs réutilisées | ✅ 4/4 fonctionnent, sans reconfiguration |
| Chaque appel rattaché à la bonne connexion | ✅ tracé dans `tool_invocations` |
| Révocation d'un seul point d'accès | ✅ celui-ci passe à 401, les autres restent à 200 |

**Il n'y a rien à « reconstruire » après un redémarrage** : rien n'est perdu.
C'est précisément l'inverse de l'ancienne architecture, qui gardait les serveurs
MCP en mémoire et devait les recréer en analysant les URLs stockées — un
mécanisme qui échouait silencieusement dès qu'une session n'était pas
reconstructible.

### b) La session de protocole MCP (`Mcp-Session-Id`) — **volontairement absente**

Le transport tourne en mode *stateless* : un serveur MCP est créé par requête
HTTP puis détruit. Aucun `Mcp-Session-Id` n'est émis.

Ce que cela apporte :
- rien à reconstruire après un redéploiement ;
- plusieurs instances derrière un répartiteur de charge, sans état partagé ;
- pas de fuite mémoire liée à des sessions abandonnées.

Ce que cela coûte, honnêtement — le **flux GET/SSE** répond bien `200` et reste
ouvert (vérifié), mais comme chaque requête crée un serveur neuf, **rien ne
poussera jamais dans ce flux**. Les fonctionnalités MCP qui dépendent d'un canal
serveur → client sont donc inopérantes :

| Fonctionnalité MCP | État | Impact aujourd'hui |
|---|---|---|
| `tools/call`, `tools/list`, `initialize` | ✅ | Aucun |
| `sampling` (le serveur demande une complétion au client) | ❌ | Aucun connecteur ne l'utilise |
| `elicitation` (le serveur pose une question à l'utilisateur) | ❌ | Utile plus tard pour les confirmations d'écriture |
| `notifications/tools/list_changed` | ❌ | Le client ne saura pas qu'un outil a été ajouté avant reconnexion |
| Abonnements aux ressources, tâches longues | ❌ | Non utilisé |

**Quand faudra-t-il basculer en mode avec session ?** Le jour où un connecteur
aura besoin d'`elicitation` (par exemple « confirmez-vous l'envoi de cet
e-mail ? ») ou de notifications. La bascule est alors :
`sessionIdGenerator: () => randomUUID()` + un `EventStore` partagé (Redis) pour
la reprise après coupure. Le SDK prévoit ce point d'extension. Ce n'est **pas**
nécessaire aujourd'hui, et le faire maintenant réintroduirait précisément l'état
volatil qu'on vient de supprimer.

### c) « Plusieurs sessions MCP par outil » — **oui, sur deux axes**

```
Utilisateur
 └── Connexion « Cabinet Paris » (connecteur axonaut, clé API n°1)   ← axe 1 : plusieurs comptes
 │    ├── Point d'accès « principal »      → URL n°1                 ← axe 2 : plusieurs clients IA
 │    └── Point d'accès « Claude Desktop » → URL n°2
 └── Connexion « Cabinet Lyon »  (connecteur axonaut, clé API n°2)
      └── Point d'accès « principal »      → URL n°3
```

- **Axe 1 — plusieurs comptes du même service.** Contrainte
  `@@unique([userId, connectorId, label])` : autant de connexions que voulu,
  distinguées par leur libellé.
- **Axe 2 — plusieurs points d'accès par connexion.** Un par client IA, chacun
  révocable indépendamment, chacun avec ses propres compteurs d'usage. Si une
  URL fuite, on révoque celle-là sans perturber les autres.

---

## 2. Ce qui est en place

| Domaine | État |
|---|---|
| Comptes, sessions révocables, rôles en base, Google OAuth | ✅ |
| Catalogue piloté par les données, recherche, filtres par catégorie | ✅ |
| Connexions multi-comptes, identifiants chiffrés AES-256-GCM, vérification auprès du service | ✅ |
| Points d'accès MCP multiples, révocables, compteurs d'usage | ✅ |
| Transport MCP conforme (Streamable HTTP, SDK officiel) | ✅ |
| **Serveur d'autorisation OAuth 2.1** : découverte, enregistrement dynamique, PKCE, consentement | ✅ |
| **Connecteurs OAuth** : contrat, rafraîchissement automatique, révocation propre | ✅ |
| **Modes individuel / partagé** par couple (client MCP, connecteur) | ✅ |
| Administration : vue d'ensemble, comptes, statistiques par outil | ✅ |
| Journal d'audit, purge périodique | ✅ |
| 3 connecteurs (Axonaut, Brevo, Gmail), 21 outils | ✅ |
| 53 tests dont le flux OAuth de bout en bout, typecheck strict, ESLint, build vérifié | ✅ |

---

## 3. Ce qui manque pour une vraie marketplace

Classé par impact sur l'objectif « les utilisateurs vont chercher des MCP ».

> **Mise à jour.** Les points 1 et 2 ci-dessous (connecteurs OAuth2 et
> autorisation MCP native) ont été **réalisés** — voir [docs/oauth.md](oauth.md).
> Ils sont conservés ici pour mémoire, barrés.

### Bloquants

**~~1. Connecteurs OAuth2.~~ — FAIT.** Aujourd'hui seuls `api_key`, `bearer` et `basic`
sont gérés. Or les connecteurs les plus demandés — Gmail, Google Agenda,
Notion, Slack, HubSpot, Microsoft 365 — **n'ont pas de clé API** : ils exigent
un flux OAuth par utilisateur. Sans cela, le catalogue restera cantonné aux
services « à clé API », ce qui limite fortement l'attrait de la marketplace.

À construire, une seule fois, puis réutilisable par tous les connecteurs :
- enregistrement d'une application OAuth par connecteur (client_id/secret côté
  plateforme, dans la configuration serveur) ;
- flux de consentement par utilisateur, écran « autoriser Wesype à accéder à… » ;
- stockage chiffré des `access_token` / `refresh_token` dans `credentials` ;
- rafraîchissement automatique avant expiration, et invalidation propre de la
  connexion quand le refresh échoue ;
- affichage des scopes accordés, et bouton de révocation.

Le contrat de connecteur est déjà prêt à l'accueillir : il suffit d'ajouter un
`auth.type: 'oauth2'` avec la description des endpoints et des scopes, le reste
du système (catalogue, connexions, endpoints MCP) ne change pas.

**~~2. Autorisation MCP native (OAuth 2.1 côté serveur MCP).~~ — FAIT.** Aujourd'hui,
l'utilisateur copie une URL contenant un secret. La spécification MCP définit un
flux OAuth permettant au client IA de s'authentifier lui-même : dans Claude,
l'utilisateur clique « Se connecter » et un écran de consentement s'affiche, au
lieu de coller une URL. C'est un gain d'ergonomie majeur pour une marketplace
grand public, et cela supprime le secret dans l'URL. Le SDK fournit les briques
(`server/auth`). Compatible avec le mode sans session.

**3. Quotas et facturation.** Une marketplace suppose des offres. La matière
première existe (`tool_invocations` enregistre chaque appel avec sa durée), mais
il n'y a ni notion de plan, ni compteur mensuel, ni blocage au dépassement.
À prévoir : table `Plan`, quota d'appels, limitation de débit MCP **par
utilisateur** (aujourd'hui par IP), page « consommation » côté utilisateur.

### Importants

**4. Organisations et équipes.** Tout est individuel. Partager une connexion
Axonaut entre les 5 personnes d'un cabinet impose aujourd'hui de dupliquer la
clé API. Il faut une entité `Organization`, des membres avec rôles, et un
rattachement des connexions à l'organisation plutôt qu'à l'utilisateur.

**5. Gestion des secrets.** `ENCRYPTION_KEY` est une clé unique et statique.
Conséquences : sa rotation impose de tout re-chiffrer, et il n'existe aucune
séparation entre la clé maître et les clés de données. Pour héberger les clés
API de clients, viser un chiffrement « à enveloppe » : une clé de données par
connexion, elle-même chiffrée par une clé maître (KMS ou variable), avec un
champ `keyVersion` permettant une rotation progressive. Le format de
`crypto.ts` prévoit déjà un préfixe de version (`v2.`), la migration est donc
possible sans casse.

**6. Observabilité et santé des connecteurs.** Uniquement des journaux
aujourd'hui. Il manque : remontée d'erreurs (Sentry), métriques, et surtout une
**alerte quand le taux d'échec d'un connecteur s'envole** — si l'API d'Axonaut
change, toutes les connexions cassent et personne ne le sait avant le premier
ticket. Les données sont là (`tool_invocations.success`), il manque
l'agrégation et le seuil d'alerte.

**7. Intégration continue.** Aucun pipeline. À ajouter : lint + typecheck +
tests sur chaque PR, et une base PostgreSQL éphémère pour des tests
d'intégration couvrant les parcours qui touchent la base (aujourd'hui non
couverts par les 41 tests, volontairement).

**8. Guides d'installation par client.** On remet une URL sans expliquer où la
coller. Une page par client (Claude Desktop avec son `claude_desktop_config.json`,
Dust, ChatGPT) réduirait massivement le support. Générable automatiquement
depuis le connecteur.

### Confort

9. **Ressources et prompts MCP** — seuls les outils sont exposés. Les
   *resources* (documents consultables) et *prompts* (modèles de requête)
   enrichiraient les connecteurs.
10. **RGPD** — export des données, politique de rétention explicite, DPA. À
    traiter avant de démarcher des clients sérieux.
11. **Multi-instance** — la limitation de débit est en mémoire (donc par
    processus) ; brancher `rate-limit-redis`. La purge périodique s'exécutera
    sur chaque instance, sans conséquence (opérations idempotentes).
12. **Versionnement des connecteurs** — si le schéma d'un outil change, les
    clients gardent l'ancienne liste jusqu'à reconnexion (voir §1.b).

---

## 4. Ordre suggéré

| Étape | Contenu | Statut |
|---|---|---|
| ~~OAuth2 pour les connecteurs~~ | Contrat `auth.type: 'oauth2'`, rafraîchissement automatique, connecteur Gmail | ✅ fait |
| ~~Autorisation MCP native (OAuth 2.1)~~ | Découverte, enregistrement dynamique, consentement, modes individuel/partagé | ✅ fait |
| 1 | Google Cloud : activer l'API Gmail, déclarer les scopes et l'URI de redirection | ⏳ à faire chez Google, hors code |
| 2 | Générateur de connecteurs depuis OpenAPI ([l'étude](generation-de-connecteurs.md)) | Le multiplicateur du catalogue : 1–2 jours → 2–4 h par connecteur |
| 3 | Intégration continue + base éphémère | À faire avant que le catalogue grossisse |
| 4 | Organisations, plans et quotas | Nécessaire pour facturer |
| 5 | Observabilité, alertes de santé des connecteurs | Dès les premiers clients payants |
| 6 | Chiffrement à enveloppe, RGPD | Exigé aux premiers audits clients |
