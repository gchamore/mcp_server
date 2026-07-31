# Ajouter un connecteur MCP

Ce guide décrit l'unique procédure pour brancher un nouveau service. Elle ne
touche **ni la base de données, ni le front, ni le routage**.

> Résumé : un dossier, un fichier, une ligne dans `src/connectors/index.ts`.

---

## 1. Créer le dossier

Le nom du dossier **est** l'identifiant du connecteur (`[a-z0-9-]`) et doit être
identique au champ `id` de la définition.

```
src/connectors/
  pennylane/
    index.ts     ← la définition (obligatoire)
    client.ts    ← l'appel HTTP au service (recommandé)
    tools.ts     ← les outils, si index.ts devient long
```

## 2. Écrire le client HTTP

Utilisez `HttpClient` (`src/core/http-client.ts`) : il apporte le délai maximal,
la propagation du signal d'annulation et surtout la **traduction des erreurs**
distantes en messages exploitables (401 → « vérifiez la clé API », 429 → « limite
de débit »). N'écrivez pas de `fetch` nu et ne journalisez jamais d'en-têtes.

```ts
// src/connectors/pennylane/client.ts
import { HttpClient } from '../../core/http-client.js';

export class PennylaneClient {
  private readonly http: HttpClient;

  constructor(apiKey: string, private readonly signal?: AbortSignal) {
    this.http = new HttpClient({
      baseUrl: 'https://app.pennylane.com/api/external/v1',
      serviceName: 'Pennylane',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  }

  listInvoices(page: number) {
    return this.http.get<{ invoices: unknown[] }>('/customer_invoices', {
      query: { page },
      ...(this.signal ? { signal: this.signal } : {}),
    });
  }
}
```

## 3. Écrire la définition

```ts
// src/connectors/pennylane/index.ts
import { z } from 'zod';
import { PennylaneClient } from './client.js';
import { defineConnector, toolFactory, type ToolDefinition } from '../types.js';
import { renderList } from '../format.js';
import { errorMessage } from '../../core/errors.js';

type PennylaneCredentials = { apiKey: string };

const tool = toolFactory<PennylaneCredentials>();

const listInvoices = tool({
  name: 'list_invoices',
  title: 'Lister les factures clients',
  description:
    "Liste les factures clients Pennylane. Utiliser pour toute question de facturation, d'impayés ou de chiffre d'affaires.",
  inputSchema: {
    page: z.number().int().min(1).default(1).describe('Numéro de page, à partir de 1.'),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  async handler(args, ctx) {
    const { invoices } = await new PennylaneClient(ctx.credentials.apiKey, ctx.signal)
      .listInvoices(args.page);

    return {
      text: renderList({
        title: 'Factures Pennylane',
        items: invoices,
        page: args.page,
        emptyMessage: 'Aucune facture trouvée',
        render: (invoice) => `- ${JSON.stringify(invoice)}`,
      }),
      data: invoices,
    };
  },
});

export default defineConnector<PennylaneCredentials>({
  id: 'pennylane',                    // identique au nom du dossier
  name: 'Pennylane',
  tagline: 'Comptabilité et facturation',
  description: 'Accès en lecture à vos factures et écritures comptables Pennylane.',
  category: 'finance',                 // crm | finance | productivity | marketing | support | developer | other
  status: 'beta',                      // stable | beta | coming-soon
  icon: 'https://www.pennylane.com/favicon.ico',
  accentColor: '#0f766e',
  docsUrl: 'https://pennylane.readme.io/',

  auth: {
    type: 'api_key',
    instructions: 'Dans Pennylane : Paramètres → API → Générer un jeton.',
    fields: [
      {
        key: 'apiKey',
        label: 'Jeton API Pennylane',
        type: 'password',
        required: true,
        minLength: 20,
        help: 'Chiffré avant stockage, jamais réaffiché en clair.',
      },
    ],
  },

  async verify(credentials, ctx) {
    try {
      await new PennylaneClient(credentials.apiKey, ctx.signal).listInvoices(1);
      return { ok: true };
    } catch (error) {
      return { ok: false, message: errorMessage(error) };
    }
  },

  tools: [listInvoices] as ToolDefinition<PennylaneCredentials, never>[],
});
```

## 4. Enregistrer le connecteur

Une seule ligne, dans [`src/connectors/index.ts`](../src/connectors/index.ts) :

```ts
import pennylane from './pennylane/index.js';

export const connectors: ConnectorDefinition<any>[] = [axonaut, brevo, pennylane];
```

## 5. Vérifier

```bash
npm run typecheck
npm test
```

Les tests de `tests/connectors.test.ts` s'appliquent automatiquement au nouveau
connecteur : contrat respecté, noms d'outils valides, absence de fuite dans la
vue publique, et — surtout — **échec explicite si vous oubliez l'étape 4**.

---

## Ce que vous n'avez PAS à faire

| Élément | Pourquoi c'est automatique |
|---|---|
| Migration de base | Le catalogue vit dans le code ; la table `connections` est générique. |
| Page front | `ConnectorDetail` est générique et se construit depuis l'API. |
| Formulaire d'identifiants | `CredentialForm` est généré depuis `auth.fields`. |
| Route MCP | `/mcp/:connectorId/:token` résout le connecteur via le registre. |
| Filtre de catégorie | Calculé à partir des connecteurs chargés. |
| Statistiques d'admin | `ToolInvocation` enregistre `connectorId` et `toolName`. |

---

## Conseils de rédaction des outils

Les descriptions sont lues par le modèle : elles pilotent le déclenchement.

- **Dire *quand* utiliser l'outil**, pas seulement ce qu'il fait.
  *« Utiliser dès qu'une question porte sur le portefeuille clients »* vaut mieux
  que *« Récupère les entreprises »*.
- **Annoter honnêtement.** `readOnlyHint: true` pour les lectures,
  `destructiveHint: true` pour tout ce qui envoie ou supprime — l'interface
  affiche ces marqueurs à l'utilisateur, et certains clients demandent une
  confirmation à partir de là.
- **Exposer la pagination.** Sans paramètre `page`/`offset`, le modèle conclut
  qu'il a tout vu après le premier lot.
- **Nommer en `snake_case`**, cohérent d'un connecteur à l'autre
  (`list_*`, `get_*`, `create_*`).
- **Renvoyer `{ text, data }`.** `text` est lu par le modèle, `data` alimente
  `structuredContent` pour les clients qui l'exploitent.
- **Ne jamais mettre d'identifiant dans un message d'erreur** renvoyé au modèle.
