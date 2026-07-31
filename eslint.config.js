import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'web/dist/**', 'node_modules/**', 'web/node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: { ecmaVersion: 2023, sourceType: 'module' },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    files: ['tests/**/*.ts', 'prisma/seed.ts', 'src/core/logger.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    // Scripts de build : ils tournent sous Node, et leur sortie console *est*
    // leur interface.
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
    rules: { 'no-console': 'off' },
  },
  {
    /**
     * L'interface était purement et simplement exclue de l'analyse
     * (`ignores: ['web/**']`) : quelques milliers de lignes de React sans
     * aucun garde-fou.
     *
     * `react-hooks` est la règle qui compte ici. Elle attrape les dépendances
     * de `useEffect` incomplètes et les fermetures sur une valeur périmée —
     * des bugs que TypeScript ne voit pas, parce qu'ils sont parfaitement
     * typés et pourtant faux.
     */
    files: ['web/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaVersion: 2023, sourceType: 'module', ecmaFeatures: { jsx: true } },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['web/*.config.ts', 'web/src/test-setup.ts', 'web/src/**/*.test.tsx'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
);
