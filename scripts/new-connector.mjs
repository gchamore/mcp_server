/**
 * ===========================================================================
 *  Générateur de connecteur — `npm run new:connector <id> "<Nom>"`
 * ===========================================================================
 *
 * La promesse du registre est « un connecteur = un dossier + une ligne dans
 * l'index ». Ce script tient la promesse jusqu'au bout : il crée le dossier à
 * partir d'un gabarit conforme au contrat de types, ET insère la ligne dans
 * l'index — car un test vérifie que tout dossier sur disque est enregistré, et
 * il échouerait sinon.
 *
 * Le gabarit compile tel quel : `HttpClient` partagé, un outil de lecture
 * annoté, le schéma d'authentification par clé API. Il reste ensuite à
 * remplacer l'URL de base, écrire `verify()` contre le vrai service, et
 * ajouter les outils. Les endroits à modifier sont marqués `À FAIRE`.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [id, nom] = process.argv.slice(2);

if (!id || !/^[a-z0-9-]+$/.test(id) || !nom) {
  console.error('Usage : npm run new:connector <id-en-minuscules> "<Nom affiché>"');
  console.error('Exemple : npm run new:connector stripe "Stripe"');
  process.exit(1);
}

const RACINE = path.resolve(import.meta.dirname, '..');
const DOSSIER = path.join(RACINE, 'src', 'connectors', id);
const INDEX = path.join(RACINE, 'src', 'connectors', 'index.ts');

if (existsSync(DOSSIER)) {
  console.error(`Le connecteur « ${id} » existe déjà : ${DOSSIER}`);
  process.exit(1);
}

/** Identifiant TypeScript dérivé de l'id (stripe-tax → stripeTax). */
const varName = id.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
const typeName = varName[0].toUpperCase() + varName.slice(1);

const gabarit = `import { z } from 'zod';
import { defineConnector, toolFactory } from '../types.js';
import { HttpClient } from '../../core/http-client.js';
import { errorMessage } from '../../core/errors.js';

/**
 * Connecteur ${nom}.
 *
 * À FAIRE : décrire ici ce que le connecteur expose et pourquoi ces outils-là.
 */

export type ${typeName}Credentials = { apiKey: string };

const tool = toolFactory<${typeName}Credentials>();

// Le signal d'annulation se passe par requête (\`{ signal: ctx.signal }\`),
// pas à la construction : un même client sert plusieurs appels.
const client = (credentials: ${typeName}Credentials) =>
  new HttpClient({
    // À FAIRE : URL de base de l'API ${nom}.
    baseUrl: 'https://api.example.com/v1',
    serviceName: '${nom}',
    headers: { Authorization: \`Bearer \${credentials.apiKey}\` },
  });

const ping = tool({
  name: 'get_account',
  title: 'Informations du compte',
  description:
    // À FAIRE : dire QUAND utiliser l'outil, pas seulement ce qu'il fait —
    // c'est cette phrase qui pilote son déclenchement par le modèle.
    \`Renvoie les informations du compte ${nom}. Utiliser pour vérifier que la connexion fonctionne.\`,
  inputSchema: {
    exemple: z.string().optional().describe('À FAIRE : décrire chaque argument.'),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  async handler(_args, ctx) {
    // À FAIRE : appeler le vrai point d'entrée.
    const compte = await client(ctx.credentials).get<{ name?: string }>('/account', {
      signal: ctx.signal,
    });
    return { text: \`**Compte ${nom}** — \${compte.name ?? 'inconnu'}\`, data: compte };
  },
});

export const ${varName} = defineConnector<${typeName}Credentials>({
  id: '${id}',
  name: '${nom}',
  // À FAIRE : une ligne pour la carte du catalogue.
  tagline: 'À compléter.',
  // À FAIRE : un paragraphe pour la page de détail.
  description: 'À compléter.',
  // Catégories admises : voir ConnectorCategory dans ../types.ts.
  category: 'productivity',
  status: 'beta',
  // À FAIRE : icône du service (URL absolue ou data-URI, affichée en 40×40).
  icon: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="%231e3a8a"/></svg>',
  accentColor: '#1e3a8a',

  auth: {
    type: 'api_key',
    // À FAIRE : où trouver la clé, pas à quoi elle sert.
    instructions: 'Dans ${nom} : Paramètres → API → Générer une clé.',
    fields: [
      {
        key: 'apiKey',
        label: 'Clé API ${nom}',
        type: 'password',
        required: true,
        help: 'Chiffrée avant stockage, jamais réaffichée.',
        minLength: 10,
        maxLength: 200,
      },
    ],
  },

  async verify(credentials, ctx) {
    try {
      // À FAIRE : appel léger qui prouve que la clé est valide, et renvoyer un
      // libellé de compte lisible (raison sociale, adresse e-mail…).
      await client(credentials).get('/account', { signal: ctx.signal });
      return { ok: true };
    } catch (error) {
      ctx.logger.debug({ err: error }, 'Vérification ${nom} échouée');
      return { ok: false, message: errorMessage(error) };
    }
  },

  tools: [ping],
});
`;

await mkdir(DOSSIER, { recursive: true });
await writeFile(path.join(DOSSIER, 'index.ts'), gabarit);

// L'index : import + entrée dans la liste, sans quoi le test « tout dossier
// sur disque est enregistré » échoue — c'est voulu.
let index = await readFile(INDEX, 'utf8');
const importLigne = `import { ${varName} } from './${id}/index.js';`;

if (!index.includes(importLigne)) {
  const imports = [...index.matchAll(/^import .* from '\.\/.*\/index\.js';$/gm)];
  const dernier = imports[imports.length - 1];
  index =
    index.slice(0, dernier.index + dernier[0].length) +
    '\n' +
    importLigne +
    index.slice(dernier.index + dernier[0].length);

  index = index.replace(/(export const connectors[^=]*= \[)([^\]]*)(\])/, (_, avant, liste, apres) => {
    const entrees = liste
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);
    entrees.push(varName);
    return `${avant}${entrees.sort().join(', ')}${apres}`;
  });

  await writeFile(INDEX, index);
}

console.log(`Connecteur « ${id} » créé.`);
console.log(`  dossier : src/connectors/${id}/index.ts`);
console.log(`  index   : entrée « ${varName} » ajoutée à src/connectors/index.ts`);
console.log('');
console.log('Prochaines étapes — cherchez les marqueurs « À FAIRE » :');
console.log('  1. URL de base et appel de vérification réels');
console.log('  2. Les outils : peu, bien choisis, descriptions qui disent QUAND les utiliser');
console.log('  3. `npm test` — le registre valide la définition au démarrage');
