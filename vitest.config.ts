import { defineConfig } from 'vitest/config';

/**
 * Deux suites dans le même dépôt, avec des besoins opposés : le serveur veut
 * un environnement Node et une base de données, l'interface veut un DOM, le
 * plugin React et sa propre arborescence de dépendances.
 *
 * Les « projects » de Vitest les lancent d'une seule commande sans que l'une
 * impose ses réglages à l'autre. Le projet d'interface pointe vers `./web` et
 * non vers une configuration en ligne : c'est ce qui fait résoudre `react`,
 * `motion` et compagnie depuis `web/node_modules`, où ils sont réellement
 * installés.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'serveur',
          environment: 'node',
          include: ['tests/**/*.test.ts'],
          globals: false,
          setupFiles: ['tests/setup.ts'],
        },
      },
      './web',
    ],
  },
});
