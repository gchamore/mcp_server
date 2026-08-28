/**
 * ===========================================================================
 *  Identité Toolink
 * ===========================================================================
 *
 * Le symbole dit le nom : un maillon (« link ») suspendu à une barre — les deux
 * forment un T. Un outil qu'on raccorde, c'est exactement ce que fait la
 * plateforme.
 *
 * Construction sur la même grille que les icônes du système (24 unités, trait
 * 1,7, `currentColor`) : le logo est une icône parmi les autres, pas une pièce
 * rapportée. Le tissage est réel — la barre s'interrompt là où le maillon la
 * traverse — c'est ce détail qui fait lire « chaîne » et non « deux formes
 * posées l'une sur l'autre ».
 */

export function LogoMark({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      aria-hidden="true"
    >
      {/* La barre : un maillon horizontal, bord inférieur interrompu aux deux
          points où l'anneau la traverse. */}
      <path d="M10 11.5 H7.5 A3.75 3.75 0 0 1 7.5 4 H16.5 A3.75 3.75 0 0 1 16.5 11.5 H14" />
      {/* L'anneau : passe devant la barre, puis descend — la boucle du T. */}
      <path d="M8.5 8.75 V16.5 A3.5 3.5 0 0 0 15.5 16.5 V8.75" />
    </svg>
  );
}

