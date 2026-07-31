import { useEffect } from 'react';
import Lenis from 'lenis';

/**
 * Défilement inertiel.
 *
 * Volontairement réservé aux pages vitrine, et **pas** activé globalement :
 * sur un tableau de bord, l'inertie décale ce qu'on vise et donne une
 * impression de latence — exactement l'inverse de l'effet recherché. Une page
 * qu'on contemple gagne à glisser ; une page qu'on manipule doit répondre au
 * pixel.
 *
 * Désactivé si l'utilisateur a demandé moins d'animations : l'inertie est
 * précisément ce qui gêne dans ce cas.
 */
export function useSmoothScroll(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const lenis = new Lenis({
      duration: 1.1,
      // Courbe expo-out, cohérente avec le reste du système.
      easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      wheelMultiplier: 0.9,
      touchMultiplier: 1.6,
    });

    let frame = 0;
    const raf = (time: number) => {
      lenis.raf(time);
      frame = requestAnimationFrame(raf);
    };
    frame = requestAnimationFrame(raf);

    return () => {
      cancelAnimationFrame(frame);
      lenis.destroy();
    };
  }, [enabled]);
}
