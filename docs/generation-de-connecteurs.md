# Générer des connecteurs MCP automatiquement — étude

**Question posée :** peut-on standardiser la création de MCP à partir d'API,
c'est-à-dire générer un connecteur depuis la documentation d'un service — de
manière **déterministe, sans IA** ?

**Réponse courte :** oui pour environ 80 % du travail, à une condition ferme :
que le service publie une **spécification machine-lisible** (OpenAPI, GraphQL).
Les 20 % restants sont des décisions éditoriales qui ne peuvent pas être
dérivées mécaniquement — mais on peut les réduire à un petit fichier de recette
versionné, ce qui garde la génération reproductible.

---

## 1. Le point de départ décide de tout

| Source | Structure | Génération déterministe ? |
|---|---|---|
| **OpenAPI 3.x / Swagger 2.0** | Chemins, paramètres typés, schémas de réponse, sécurité | ✅ Oui, c'est le cas nominal |
| **GraphQL (introspection)** | Schéma entièrement typé | ✅ Oui, et même plus proprement |
| **Postman Collection v2.1** | Requêtes d'exemple, typage faible | ⚠️ Partiel : noms et URLs oui, schémas non |
| **Capture de trafic (HAR)** | Exemples uniquement | ⚠️ Inférence de schéma, fragile |
| **Documentation en prose (HTML/Markdown)** | Aucune structure | ❌ Non, sans IA c'est hors de portée |

Le vrai facteur limitant n'est donc pas la technique de génération : c'est la
**disponibilité d'une spec**. Bonne nouvelle, elle est plus fréquente qu'on ne
croit — vérifié le 31/07/2026 :

| Service | Spec publique | Opérations |
|---|---|---|
| Brevo | OpenAPI 3.0.1 | **206** |
| Stripe | OpenAPI 3.0.0 | **589** |
| GitHub | OpenAPI 3.0.3 | **1216** |

---

## 2. Ce qui se dérive mécaniquement

Correspondance entre OpenAPI et notre `ConnectorDefinition` :

| Élément OpenAPI | Cible dans le connecteur | Déterministe |
|---|---|---|
| `servers[0].url` | `baseUrl` du client HTTP | ✅ |
| `operationId` | nom de l'outil (converti en `snake_case`) | ✅ (repli : méthode + chemin) |
| `summary` / `description` | description de l'outil | ✅ recopie — **qualité variable, voir §3.2** |
| `parameters` (query/path/header) | propriétés de `inputSchema` | ✅ |
| `requestBody.content['application/json'].schema` | propriétés de `inputSchema` | ✅ |
| `responses.2xx…schema` | `outputSchema` (facultatif) | ✅ |
| `securitySchemes` | `auth.fields` du connecteur | ✅ pour `apiKey`, `http bearer`, `http basic` |
| `securitySchemes` de type `oauth2` | flux OAuth | ⚠️ nécessite la brique OAuth de la plateforme |
| Méthode HTTP | `annotations.readOnlyHint` (GET/HEAD), `destructiveHint` (DELETE) | ✅ heuristique fiable |
| `tags` | catégorie, regroupement, filtrage | ✅ |
| `deprecated: true` | exclusion automatique | ✅ |

**Exemple vécu.** Le `securityScheme` de Brevo déclare
`{ type: apiKey, in: header, name: api-key }`. Mon connecteur écrit à la main
utilise `headers: { 'api-key': apiKey }`. Un générateur aurait produit
exactement la même chose, sans lire la documentation. Le mapping de
l'authentification est donc bien un problème résolu.

---

## 3. Ce qui ne se dérive pas — les quatre vrais obstacles

### 3.1 L'explosion du nombre d'outils *(l'obstacle principal)*

206 opérations chez Brevo, 1216 chez GitHub. Or un serveur MCP utilisable tient
autour de **20 à 40 outils** : au-delà, le modèle choisit mal, et la liste
d'outils sature le contexte à chaque requête.

Sur Brevo, j'ai retenu **7 outils sur 206 — soit 3,4 %**. Ce choix n'est
dérivable d'aucune règle : il vient de ce que les utilisateurs veulent faire
(consulter des contacts, analyser des campagnes, envoyer un e-mail), pas de la
structure de l'API.

Atténuations mécanisables :

- filtrage par `tags` (allow-list) ;
- filtrage par méthode (n'exposer que les lectures pour une v1) ;
- exclusion automatique de `deprecated` et des endpoints d'administration ;
- **extension `x-mcp-expose: true`** posée dans un fichier annexe ;
- à plus long terme, chargement différé des outils (*tool search*), qui repousse
  la limite sans la supprimer.

Aucune ne remplace la sélection humaine. **C'est là que se joue la qualité d'un
connecteur, et c'est irréductible.**

### 3.2 Les descriptions sont écrites pour des développeurs

OpenAPI dit *ce que fait* un endpoint (« Returns a list of companies »).
Le modèle a besoin de savoir **quand l'utiliser** (« Utiliser dès qu'une
question porte sur le portefeuille clients, ou pour retrouver l'identifiant
d'une entreprise avant d'appeler un autre outil »).

C'est précisément ce que recommande notre propre guide d'écriture. Un générateur
peut produire une description de départ correcte par gabarit ; il ne peut pas
inventer l'intention métier. **C'est le premier levier de qualité d'un
connecteur**, et le plus souvent négligé.

### 3.3 La pagination n'est pas déclarée comme telle

OpenAPI décrit un paramètre `page`, `limit`, `offset` ou `cursor` — mais ne dit
nulle part que c'est de la pagination, ni comment savoir qu'il reste des
résultats (`has_more`, `next_cursor`, en-tête `Link`, ou simplement « la page
est pleine »). Non dérivable en général.

Solution pratique : une petite bibliothèque de **stratégies** (`page`, `offset`,
`cursor`, `link-header`), détectées par heuristique sur le nom des paramètres,
et surchargeables dans la recette. C'est fiable dans ~80 % des cas, et
explicitement corrigeable dans les autres.

### 3.4 La mise en forme des réponses

Renvoyer le JSON brut de 50 entreprises × 40 champs coûte cher en tokens et se
lit mal. Nos connecteurs rendent du Markdown compact (voir `connectors/format.ts`).

Un générateur peut produire un rendu générique honnête : détecter le tableau de
résultats, choisir un champ-titre par heuristique (`name`, `title`, `label`,
`email`), et lister quelques champs scalaires. Ce sera correct, rarement
excellent. Surchargeable dans la recette.

---

## 4. Architecture proposée : génération à la compilation

Deux approches possibles. **Génération de code à la compilation**, plutôt
qu'interprétation de la spec à l'exécution :

| | Interprétation à l'exécution | **Génération de code (retenu)** |
|---|---|---|
| Typage | Perdu, tout devient `unknown` | Conservé, vérifié par TypeScript |
| Débogage | Difficile, la logique est dans la spec | Normal, on lit le code produit |
| Revue | Invisible en PR | Le diff est relisible |
| Stabilité | Un changement de spec amont modifie le serveur en production | Il produit un diff, qu'on valide |
| Démarrage | Analyse de spec au boot | Rien |

Le point décisif est la **revue** : la sélection des outils et la rédaction des
descriptions sont des décisions produit, elles doivent passer par une PR.

### Arborescence

```
specs/
  brevo.openapi.yaml          ← spec amont, figée dans le dépôt
  brevo.recipe.yaml           ← recette : sélection + surcharges (écrite à la main)
scripts/
  generate-connector.ts       ← le générateur
src/connectors/brevo/
  generated/client.ts         ← généré — ne pas éditer
  generated/tools.ts          ← généré — ne pas éditer
  index.ts                    ← écrit à la main : manifeste, verify(), assemblage
```

### La recette, seul fichier à écrire

```yaml
connector:
  id: brevo
  name: Brevo
  category: marketing
  icon: https://www.brevo.com/favicon.ico

spec: ./brevo.openapi.yaml
auth: api-key                  # référence un securityScheme de la spec

include:                       # sélection explicite — le cœur de la curation
  - operationId: getAccount
  - operationId: getContacts
  - operationId: getLists
  - tag: Email Campaigns
    methods: [get]             # lectures uniquement

exclude:
  - operationId: deleteContact

tools:
  getContacts:
    name: list_contacts        # renommage vers notre convention
    title: Lister les contacts
    description: >
      Liste les contacts Brevo, éventuellement restreints à une liste.
      Utiliser pour explorer la base d'audience ou compter les abonnés.
    pagination: { style: offset, limit: limit, offset: offset }
    render: { root: contacts, title: email, fields: [createdAt, listIds] }
```

Le générateur produit ensuite du code conforme au contrat existant — mêmes
`toolFactory`, mêmes `HttpClient`, mêmes helpers de rendu. **Rien à changer dans
le reste de la plateforme.**

### Reproductibilité

- Même spec + même recette → même code, à l'octet près (générateur sans
  horodatage ni aléa).
- Vérifiable en intégration continue : régénérer et échouer si le diff n'est pas
  vide (`git diff --exit-code`) — cela garantit que personne n'a édité à la main
  un fichier généré.
- Mise à jour d'API amont : on remplace la spec, on régénère, **on lit le
  diff**. Une suppression d'endpoint ou un changement de type devient visible au
  lieu de casser en production.

---

## 5. Ce que ça change concrètement

| | Aujourd'hui (manuel) | Avec le générateur |
|---|---|---|
| Client HTTP + types | ~250 lignes à écrire | généré |
| Schémas d'entrée (zod) | à écrire par outil | générés |
| Câblage de l'authentification | à écrire | généré |
| Squelettes d'outils | à écrire | générés |
| **Sélection des outils** | implicite | **explicite, dans la recette** |
| **Descriptions « quand utiliser »** | à écrire | **à écrire** (irréductible) |
| Rendu des réponses | à écrire | générique, surchargeable |
| Estimation | 1 à 2 jours | **2 à 4 heures** |

Le gain n'est pas seulement du temps : la recette **rend la curation explicite
et relisible**, là où elle est aujourd'hui noyée dans le code.

---

## 6. Et sans spec du tout ?

Pour un service qui ne publie que de la prose, trois options, par ordre de
préférence :

1. **Chercher une spec non officielle.** Beaucoup d'API ont un OpenAPI
   communautaire, ou un portail de documentation qui en expose un (les portails
   Redoc/Swagger UI chargent presque toujours un JSON accessible directement).
2. **Écrire la spec à la main pour les seuls endpoints voulus.** Décrire 8
   endpoints en OpenAPI prend une heure, et on retombe dans le cas nominal — en
   prime, la spec devient un actif réutilisable.
3. **Utiliser un modèle hors ligne pour rédiger la recette**, puis relire. Le
   **runtime reste 100 % déterministe** : l'IA n'intervient qu'à l'écriture d'un
   fichier YAML qu'un humain valide et versionne. C'est un assistant de
   rédaction, pas une dépendance d'exécution.

La distinction est importante : « sans IA » doit vouloir dire **aucune IA dans
le chemin d'exécution ni dans la reproductibilité du build** — pas forcément
« aucune IA n'a jamais aidé à rédiger un fichier de configuration ».

---

## 7. Verdict

| Aspect | Automatisable sans IA |
|---|---|
| Client HTTP, types, schémas d'entrée/sortie | ✅ intégralement |
| Câblage de l'authentification (clé API, bearer, basic) | ✅ intégralement |
| Authentification OAuth2 | ✅ une fois la brique plateforme construite |
| Annotations lecture/écriture | ✅ par heuristique fiable |
| Pagination | ⚠️ heuristique + surcharge |
| Mise en forme des réponses | ⚠️ générique, surchargeable |
| **Choix des outils à exposer** | ❌ décision produit |
| **Descriptions « quand utiliser »** | ❌ décision produit |

**Recommandation.** Construire le générateur — c'est le multiplicateur du
catalogue, et le premier chantier de la feuille de route. Mais le concevoir
autour de la recette, en assumant que les 20 % non automatisables sont
justement ce qui distingue un bon connecteur d'un mauvais. Un générateur qui
exposerait les 206 opérations de Brevo produirait un MCP inutilisable ; un
générateur qui produit 7 outils bien décrits en quelques heures produit un bon
connecteur.

Prochaine étape concrète, si vous validez : implémenter `generate-connector.ts`
en le validant sur Brevo — dont le connecteur écrit à la main sert de référence,
puisqu'on peut comparer le code généré à celui existant.
