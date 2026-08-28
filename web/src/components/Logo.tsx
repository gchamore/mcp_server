/**
 * ===========================================================================
 *  Identité Toolink — le T-borne
 * ===========================================================================
 *
 * Un T massif, taillé en deux barres pleines, terminé par une borne de
 * connexion — l'anneau sous le pied, en couleur d'accent. C'est le vocabulaire
 * d'un schéma électrique : la barre, la ligne, le point de raccordement. Le nom
 * est dedans : l'outil (le T) et le lien (la borne).
 *
 * Le symbole précédent — deux maillons entrelacés en traits fins — devenait
 * illisible en petit : des courbes qui se croisent à 16 px font une pelote.
 * D'où le parti inverse : des masses pleines, angles nets comme le reste du
 * système (rayons quasi nuls), et un seul élément fin, l'anneau, qui porte la
 * couleur. Lisible du favicon à l'affiche.
 */

export function LogoMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {/* La traverse et le fût : pleins, angles vifs. */}
      <path fill="currentColor" d="M3 4h18v4.5H3z" />
      <path fill="currentColor" d="M9.75 8.5h4.5V15h-4.5z" />
      {/* La borne : seul élément fin, seul élément coloré. */}
      <circle
        cx="12"
        cy="18.25"
        r="2.6"
        fill="none"
        stroke="var(--accent, #4da3ff)"
        strokeWidth="1.8"
      />
    </svg>
  );
}
