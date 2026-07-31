import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * Comblement des trous de jsdom.
 *
 * jsdom implémente le DOM, pas le moteur de rendu : tout ce qui touche à la
 * mise en page ou à l'animation y est absent. Les composants de mouvement les
 * utilisent tous, et sans ces doublures le rendu échoue pour une raison qui
 * n'a rien à voir avec le composant testé.
 */

// `motion` interroge `prefers-reduced-motion` au montage.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  configurable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
});

// `useInView` (révélations, compteurs) et lenis s'appuient dessus.
class NoopObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}
/**
 * Affectation directe plutôt que `vi.stubGlobal` : un `vi.unstubAllGlobals()`
 * dans un fichier de test — usage parfaitement légitime pour rendre `fetch` —
 * effacerait aussi ces doublures, et les tests suivants échoueraient sur un
 * `ResizeObserver is not defined` sans rapport avec ce qu'ils vérifient.
 */
globalThis.IntersectionObserver = NoopObserver as unknown as typeof IntersectionObserver;
globalThis.ResizeObserver = NoopObserver as unknown as typeof ResizeObserver;

// jsdom ne cadence rien : sans ça, les compteurs bouclent à l'infini.
globalThis.requestAnimationFrame = (cb: FrameRequestCallback) =>
  setTimeout(() => cb(0), 0) as unknown as number;
globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);

window.scrollTo = vi.fn();

afterEach(cleanup);
