import { describe, expect, it } from 'vitest';
import {
  decryptJson,
  encryptJson,
  generateToken,
  hashToken,
  safeEqual,
} from '../src/core/crypto.js';

describe('chiffrement des identifiants', () => {
  it('effectue un aller-retour sans perte', () => {
    const credentials = { apiKey: 'sk_live_1234567890', senderEmail: 'a@b.fr' };
    expect(decryptJson(encryptJson(credentials))).toEqual(credentials);
  });

  it('produit un texte chiffré différent à chaque appel (IV aléatoire)', () => {
    const first = encryptJson({ apiKey: 'identique' });
    const second = encryptJson({ apiKey: 'identique' });

    expect(first).not.toBe(second);
    expect(decryptJson(first)).toEqual(decryptJson(second));
  });

  it('ne laisse pas apparaître le secret en clair', () => {
    expect(encryptJson({ apiKey: 'super-secret' })).not.toContain('super-secret');
  });

  it('rejette un texte chiffré altéré (authentification GCM)', () => {
    const payload = encryptJson({ apiKey: 'valeur' });
    const parts = payload.split('.');

    /**
     * On inverse un bit du texte chiffré, en base64url **décodé**.
     *
     * La version précédente changeait le dernier caractère de la chaîne
     * base64url. Ce caractère ne porte parfois que deux bits significatifs, le
     * reste étant du remplissage ignoré au décodage : selon l'IV tiré au sort,
     * l'altération disparaissait au décodage et le test échouait environ une
     * fois sur quatre — un faux négatif sur une garantie d'intégrité, ce qu'on
     * ne peut pas se permettre de laisser passer.
     */
    const cipher = Buffer.from(parts[3]!, 'base64url');
    cipher[0] = cipher[0]! ^ 0x01;
    const tampered = [parts[0], parts[1], parts[2], cipher.toString('base64url')].join('.');

    expect(() => decryptJson(tampered)).toThrow();
  });

  it('rejette un format inconnu', () => {
    expect(() => decryptJson('pas-du-tout-chiffre')).toThrow();
    expect(() => decryptJson('v1.a.b.c')).toThrow();
  });
});

describe('tokens', () => {
  it('génère des tokens préfixés, uniques et sûrs pour une URL', () => {
    const token = generateToken('mcp');

    expect(token.startsWith('mcp_')).toBe(true);
    expect(token).toMatch(/^mcp_[A-Za-z0-9_-]+$/);
    expect(generateToken('mcp')).not.toBe(token);
  });

  it('hache de façon déterministe', () => {
    const token = generateToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).toHaveLength(64);
    expect(hashToken(token)).not.toBe(hashToken(generateToken()));
  });

  it('compare sans fuite temporelle', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
