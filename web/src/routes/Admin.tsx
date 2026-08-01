import { useState } from 'react';
import { McpClients } from './admin/McpClients';
import { Overview } from './admin/Overview';
import { Usage } from './admin/Usage';
import { Users } from './admin/Users';

/**
 * Panneau d'administration.
 *
 * Ce fichier ne contient plus que la coquille : le titre, les onglets, et le
 * choix de l'écran affiché. Chaque section vit dans `admin/`.
 *
 * Il faisait 595 lignes et réunissait quatre écrans sans rapport entre eux —
 * comptes, usage des outils, clients MCP, chiffres de la plateforme. Aucun ne
 * partageait d'état avec les autres : ils ne cohabitaient que parce qu'ils
 * s'affichaient au même endroit. C'est le genre de fichier où un défaut
 * s'installe sans se voir, parce que plus personne ne le lit en entier.
 */

const ONGLETS = [
  ['overview', "Vue d'ensemble"],
  ['users', 'Utilisateurs'],
  ['usage', 'Usage des outils'],
  ['clients', 'Clients MCP'],
] as const;

type Onglet = (typeof ONGLETS)[number][0];

export function Admin() {
  const [tab, setTab] = useState<Onglet>('overview');

  return (
    <div className="stack stack--loose">
      <div className="page-header">
        <div className="page-header__title">
          <h1>Administration</h1>
          <p>Vue d’ensemble de la plateforme, comptes utilisateurs et usage des connecteurs.</p>
        </div>
      </div>

      <div className="chips" role="tablist" aria-label="Sections d’administration">
        {ONGLETS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            className="chip"
            aria-pressed={tab === id}
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview />}
      {tab === 'users' && <Users />}
      {tab === 'usage' && <Usage />}
      {tab === 'clients' && <McpClients />}
    </div>
  );
}
