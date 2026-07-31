import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  connectorCount,
  listConnectors,
  loadConnectors,
  parseCredentials,
  requireConnector,
  toSummary,
} from '../src/connectors/registry.js';

/**
 * Filet de sécurité du registre.
 *
 * Le chargement se fait au niveau module (top-level await) et non dans un
 * `beforeAll`, afin que `it.each` soit réellement alimenté par les connecteurs
 * enregistrés. Un connecteur ajouté demain est donc testé automatiquement, sans
 * qu'on ait à toucher ce fichier.
 */
await loadConnectors();

const connectorIds = listConnectors().map((connector) => connector.id);

/** Dossiers présents sur le disque, hors fichiers utilitaires. */
function connectorFolders(): string[] {
  const directory = fileURLToPath(new URL('../src/connectors/', import.meta.url));
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

describe('registre des connecteurs', () => {
  it('charge les connecteurs déclarés', () => {
    expect(connectorCount()).toBeGreaterThanOrEqual(2);
    expect(connectorIds).toContain('axonaut');
    expect(connectorIds).toContain('brevo');
  });

  /**
   * Garde-fou du modèle « une ligne à ajouter » : si quelqu'un crée le dossier
   * d'un connecteur sans l'inscrire dans `connectors/index.ts`, ce test échoue
   * avec le nom manquant plutôt que de laisser le connecteur invisible.
   */
  it('enregistre tous les dossiers de connecteurs présents', () => {
    expect([...connectorIds].sort()).toEqual(connectorFolders());
  });

  it('fait correspondre l’id au nom du dossier', () => {
    for (const id of connectorIds) expect(connectorFolders()).toContain(id);
  });

  it('expose des identifiants uniques', () => {
    expect(new Set(connectorIds).size).toBe(connectorIds.length);
  });

  it.each(connectorIds)('« %s » respecte le contrat', (id) => {
    const connector = requireConnector(id);

    expect(connector.id).toMatch(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/);
    expect(connector.name.length).toBeGreaterThan(0);
    expect(connector.tagline.length).toBeGreaterThan(0);
    expect(connector.tools.length).toBeGreaterThan(0);
    expect(typeof connector.verify).toBe('function');

    // Deux familles d'authentification, deux contrats :
    //  - clé API : au moins un champ à saisir ;
    //  - OAuth   : aucun champ, mais des points d'entrée fournisseur complets.
    if (connector.auth.type === 'oauth2') {
      expect(connector.auth.fields).toHaveLength(0);
      expect(connector.auth.oauth?.authorizationUrl).toMatch(/^https:\/\//);
      expect(connector.auth.oauth?.tokenUrl).toMatch(/^https:\/\//);
      expect(connector.auth.oauth?.scopes.length).toBeGreaterThan(0);
      expect(connector.auth.oauth?.credentialsEnvPrefix).toMatch(/^[A-Z][A-Z0-9_]*$/);
    } else {
      expect(connector.auth.fields.length).toBeGreaterThan(0);
    }

    // Noms d'outils : snake_case, uniques, description non triviale.
    const names = connector.tools.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of connector.tools) {
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(tool.description.length).toBeGreaterThan(20);
      expect(typeof tool.handler).toBe('function');
    }

    // Champs d'authentification : clés uniques, options présentes sur les listes.
    const keys = connector.auth.fields.map((field) => field.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const field of connector.auth.fields) {
      if (field.type === 'select') expect(field.options?.length).toBeGreaterThan(0);
    }
  });

  it.each(connectorIds)('la vue publique de « %s » ne fuite rien', (id) => {
    const connector = requireConnector(id);
    const summary = toSummary(connector);
    const serialized = JSON.stringify(summary);

    // Ni code exécutable ni identifiants ne doivent traverser l'API.
    expect(serialized).not.toContain('handler');
    expect(serialized).not.toContain('"verify"');
    expect(summary.toolCount).toBe(summary.tools.length);

    // La configuration OAuth interne reste côté serveur : seuls les scopes,
    // que l'utilisateur doit pouvoir lire avant de consentir, sont exposés.
    expect(serialized).not.toContain('tokenUrl');
    expect(serialized).not.toContain('credentialsEnvPrefix');
    expect(serialized).not.toContain('clientSecret');
    if (connector.auth.type === 'oauth2') {
      expect(summary.auth.scopes).toEqual(connector.auth.oauth?.scopes);
    }
  });
});

describe('validation des identifiants', () => {
  it('accepte une saisie conforme et retire les espaces parasites', () => {
    const credentials = parseCredentials(requireConnector('axonaut'), {
      apiKey: '  une-cle-api-valide  ',
    });
    expect(credentials).toEqual({ apiKey: 'une-cle-api-valide' });
  });

  it('refuse un champ obligatoire manquant', () => {
    expect(() => parseCredentials(requireConnector('axonaut'), {})).toThrowError(
      /Identifiants invalides/,
    );
  });

  it('applique les contraintes de longueur déclarées par le connecteur', () => {
    expect(() => parseCredentials(requireConnector('axonaut'), { apiKey: 'court' })).toThrow();
  });

  it('ignore les champs non déclarés', () => {
    const credentials = parseCredentials(requireConnector('axonaut'), {
      apiKey: 'une-cle-api-valide',
      role: 'ADMIN',
    });
    expect(credentials).not.toHaveProperty('role');
  });

  it('accepte l’absence d’un champ facultatif', () => {
    const credentials = parseCredentials(requireConnector('brevo'), {
      apiKey: 'xkeysib-0123456789012345678901234',
    });
    expect(credentials).toEqual({ apiKey: 'xkeysib-0123456789012345678901234' });
  });

  it('valide le format d’un champ e-mail facultatif', () => {
    expect(() =>
      parseCredentials(requireConnector('brevo'), {
        apiKey: 'xkeysib-0123456789012345678901234',
        senderEmail: 'pas-une-adresse',
      }),
    ).toThrow();
  });
});
