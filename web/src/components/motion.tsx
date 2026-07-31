import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useSpring,
  type Variants,
} from 'motion/react';

/**
 * Primitives de mouvement.
 *
 * Parti pris : le mouvement sert la lecture, il ne l'illustre pas. Donc des
 * déplacements courts (12–20 px), une courbe expo-out, et un décalage entre
 * éléments de 60 ms — assez pour que l'œil suive un ordre, trop peu pour
 * qu'on attende. Les animations à ressort rebondissantes, très reconnaissables,
 * sont écartées : elles font « démo de bibliothèque ».
 *
 * `useReducedMotion` est respecté partout : les composants rendent alors leur
 * état final immédiatement, sans transition.
 */

const EASE = [0.16, 1, 0.3, 1] as const;

/** Fondu + montée à l'entrée dans le viewport. Joué une seule fois. */
export function Reveal({
  children,
  delay = 0,
  y = 16,
  className,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();

  return (
    <motion.div
      className={className}
      initial={reduced ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.75, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

const staggerParent: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
};

const staggerChild: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } },
};

/** Conteneur dont les enfants `<StaggerItem>` entrent en cascade. */
export function Stagger({
  children,
  className,
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'dl' | 'ul';
}) {
  const reduced = useReducedMotion();
  const Component = motion[Tag];

  return (
    <Component
      className={className}
      variants={staggerParent}
      initial={reduced ? false : 'hidden'}
      whileInView="show"
      viewport={{ once: true, margin: '-60px' }}
    >
      {children}
    </Component>
  );
}

export function StaggerItem({
  children,
  className,
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'article' | 'li';
}) {
  const Component = motion[Tag];
  return (
    <Component className={className} variants={staggerChild}>
      {children}
    </Component>
  );
}

/**
 * Compteur qui s'incrémente à l'apparition.
 *
 * Progression en ease-out : l'essentiel du chemin est fait tôt, la fin ralentit.
 * Un compteur linéaire paraît mécanique.
 */
export function Counter({
  value,
  duration = 1100,
  suffix = '',
}: {
  value: number;
  duration?: number;
  suffix?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-40px' });
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (!inView) return;
    if (reduced || value === 0) {
      setShown(value);
      return;
    }

    let frame = 0;
    const start = performance.now();

    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setShown(Math.round(value * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [inView, value, duration, reduced]);

  return (
    <span ref={ref} className="tabular">
      {new Intl.NumberFormat('fr-FR').format(shown)}
      {suffix}
    </span>
  );
}

/**
 * Halo qui suit le curseur.
 *
 * Amorti par un ressort très mou : la lumière traîne derrière le pointeur au
 * lieu de lui coller, ce qui donne une impression de matière plutôt que de
 * calque. Désactivé au clavier et sur pointeur grossier — sur mobile, il n'y a
 * pas de curseur à suivre.
 */
export function CursorGlow() {
  const reduced = useReducedMotion();
  const [enabled, setEnabled] = useState(false);

  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const springX = useSpring(x, { stiffness: 60, damping: 22, mass: 0.7 });
  const springY = useSpring(y, { stiffness: 60, damping: 22, mass: 0.7 });

  useEffect(() => {
    if (reduced || !window.matchMedia('(pointer: fine)').matches) return;
    setEnabled(true);

    const onMove = (event: PointerEvent) => {
      x.set(event.clientX);
      y.set(event.clientY);
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [reduced, x, y]);

  if (!enabled) return null;

  return (
    <motion.div
      className="cursor-glow"
      aria-hidden="true"
      style={{ left: springX, top: springY }}
    />
  );
}
