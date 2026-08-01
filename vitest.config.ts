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

    /**
     * -----------------------------------------------------------------------
     * Couverture
     * -----------------------------------------------------------------------
     *
     * Le but n'est pas d'atteindre un chiffre, mais d'empêcher qu'il baisse
     * sans que personne le remarque. Les seuils sont donc posés légèrement
     * sous le niveau réellement atteint : ils bloquent une régression, pas
     * l'ajout de code.
     *
     * Le premier relevé annonçait 51 %, chiffre faux : `web/dist` — les
     * bundles construits par Vite — était compté comme du code non testé. Un
     * indicateur pollué est pire qu'aucun indicateur, parce qu'on finit par
     * l'ignorer.
     *
     * Ce qui reste volontairement peu couvert, et pourquoi :
     *
     *  • `services/mail` — envoie de vrais e-mails, testé par un faux
     *    transporteur ne prouverait que le faux ;
     *  • `connectors/*\/tools` — de la mise en forme d'appels d'API distantes ;
     *    les tester reviendrait à réécrire les API en double ;
     *  • `routes/*.tsx` — couverts par les tests de rendu, qui vérifient qu'ils
     *    s'affichent, pas chaque branche d'interface.
     */
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts', 'web/src/**/*.{ts,tsx}'],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/*.d.ts',
        // Bundles construits : du code déjà mesuré à la source.
        'web/dist/**',
        'dist/**',
        // Amorçage et déclarations : rien à vérifier, tout à exécuter.
        'src/index.ts',
        'web/src/main.tsx',
        'web/src/test-setup.ts',
        'src/types/**',
      ],
      /**
       * Seuils posés au niveau réellement atteint, moins une marge de deux
       * points. Ils ne récompensent rien : ils empêchent que le chiffre
       * descende sans que personne s'en aperçoive.
       *
       * Ce qui les tire vers le bas, mesuré : les clients et les outils des
       * connecteurs (1 % à 42 %). Ce sont des traductions d'API distantes ; les
       * couvrir reviendrait à réécrire ces API en double dans des simulacres,
       * et à tester le simulacre. Je préfère un chiffre bas et honnête à un
       * chiffre élevé obtenu en excluant ce qui gêne.
       *
       * Les parties qui portent le risque, elles, sont couvertes : autorisation
       * OAuth 88 %, service de l'interface 94 %, transport MCP 77 %,
       * intergiciels 80 %, socle 76 %.
       */
      thresholds: {
        statements: 52,
        branches: 64,
        functions: 49,
        lines: 52,
      },
    },
  },
});
