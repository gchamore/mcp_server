import { describe, expect, it } from 'vitest';
import { maskSensitiveUrl } from '../src/core/logger.js';

/**
 * Masquage des URL avant journalisation.
 *
 * La liste d'expurgation de pino couvre les en-têtes ; elle ne pouvait rien
 * pour les URL. Or le chemin MCP de repli et le lien de réinitialisation font
 * transiter le secret dans l'URL même : chaque requête le déposait en clair
 * dans les journaux de l'hébergeur. Hacher les jetons en base ne protège de
 * rien si les logs en gardent l'original.
 */
describe('maskSensitiveUrl', () => {
  it('masque le jeton du chemin MCP de repli', () => {
    const masked = maskSensitiveUrl('/mcp/gmail/mcp_AbC-123_xyz');
    expect(masked).toBe('/mcp/gmail/[jeton]');
    expect(masked).not.toContain('AbC-123');
  });

  it('masque le jeton de réinitialisation en paramètre', () => {
    const masked = maskSensitiveUrl('/reinitialiser-mot-de-passe?token=rst_secret123');
    expect(masked).not.toContain('secret123');
    expect(masked).toContain('token=[masqué]');
  });

  it('masque code, state et demande — les paramètres du parcours OAuth', () => {
    const masked = maskSensitiveUrl(
      '/api/auth/google/callback?code=4/abc&state=xyz&demande=v2.iv.tag.data',
    );
    expect(masked).not.toContain('4/abc');
    expect(masked).not.toContain('xyz');
    expect(masked).not.toContain('v2.iv.tag.data');
  });

  it('laisse intactes les URL ordinaires', () => {
    for (const url of ['/catalogue', '/mcp/gmail', '/api/connectors?q=facture', '/assets/x.js']) {
      expect(maskSensitiveUrl(url)).toBe(url);
    }
  });
});
