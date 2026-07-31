/**
 * Environnement de test.
 *
 * Ces variables sont posées avant tout import de `src/`, car `core/env.ts`
 * valide la configuration au moment de son chargement.
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.ENCRYPTION_KEY ??= '0'.repeat(64);
process.env.SESSION_SECRET ??= 'secret-de-test-suffisamment-long-pour-passer';
// Assignation ferme et non `??=` : Vite/Vitest définit déjà `BASE_URL` à « / ».
process.env.APP_BASE_URL = 'http://localhost:3000';
process.env.LOG_LEVEL ??= 'silent';
