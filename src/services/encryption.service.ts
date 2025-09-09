import crypto from 'crypto';

/**
 * Service de chiffrement pour les données sensibles
 */
export class EncryptionService {
  private static readonly ALGORITHM = 'aes-256-gcm';
  private static readonly KEY_LENGTH = 32;
  private static readonly IV_LENGTH = 16;
  private static readonly TAG_LENGTH = 16;

  /**
   * Récupérer la clé de chiffrement depuis l'environnement
   */
  private static getEncryptionKey(): Buffer {
    const key = process.env.ENCRYPTION_KEY;
    
    if (!key) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('ENCRYPTION_KEY must be set in production environment');
      }
      console.warn('⚠️  Using fallback encryption key - UNSAFE for production!');
      return crypto.scryptSync('fallback-key', 'salt', this.KEY_LENGTH);
    }

    // Si la clé est en hex, la convertir
    if (key.length === 64) {
      return Buffer.from(key, 'hex');
    }

    // Sinon, dériver une clé depuis la string
    return crypto.scryptSync(key, 'mcp-wesype-salt', this.KEY_LENGTH);
  }

  /**
   * Chiffrer une donnée sensible
   */
  static encrypt(text: string): string {
    try {
      const key = this.getEncryptionKey();
      const iv = crypto.randomBytes(this.IV_LENGTH);
      const cipher = crypto.createCipheriv(this.ALGORITHM, key, iv);
      cipher.setAAD(Buffer.from('mcp-wesype'));

      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      const tag = cipher.getAuthTag();

      // Combiner IV + tag + données chiffrées
      return iv.toString('hex') + ':' + tag.toString('hex') + ':' + encrypted;
    } catch (error) {
      console.error('Erreur de chiffrement:', error);
      throw new Error('Erreur lors du chiffrement des données');
    }
  }

  /**
   * Vérifier si une donnée est chiffrée (format: iv:tag:encrypted)
   */
  static isEncrypted(data: string): boolean {
    if (!data || typeof data !== 'string') {
      return false;
    }
    
    // Format chiffré: iv:tag:encrypted (3 parties séparées par :)
    const parts = data.split(':');
    return parts.length === 3 && 
           parts[0].length === this.IV_LENGTH * 2 && // IV en hex
           parts[1].length === this.TAG_LENGTH * 2; // Tag en hex
  }

  /**
   * Déchiffrer une donnée sensible
   */
  static decrypt(encryptedData: string): string {
    try {
      // Vérifier si la donnée est vraiment chiffrée
      if (!this.isEncrypted(encryptedData)) {
        console.warn('⚠️  Donnée non chiffrée détectée, retour en clair');
        return encryptedData; // Retourner tel quel si pas chiffré
      }

      const key = this.getEncryptionKey();
      const parts = encryptedData.split(':');
      
      if (parts.length !== 3) {
        throw new Error('Format de données chiffrées invalide');
      }

      const iv = Buffer.from(parts[0], 'hex');
      const tag = Buffer.from(parts[1], 'hex');
      const encrypted = parts[2];

      const decipher = crypto.createDecipheriv(this.ALGORITHM, key, iv);
      decipher.setAAD(Buffer.from('mcp-wesype'));
      decipher.setAuthTag(tag);

      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      console.error('Erreur de déchiffrement:', error);
      throw new Error('Erreur lors du déchiffrement des données');
    }
  }

  /**
   * Générer une clé de chiffrement sécurisée
   */
  static generateEncryptionKey(): string {
    return crypto.randomBytes(this.KEY_LENGTH).toString('hex');
  }

  /**
   * Hasher une donnée (pour les comparaisons)
   */
  static hash(data: string): string {
    return crypto.createHash('sha256').update(data + 'mcp-wesype-salt').digest('hex');
  }

  /**
   * Vérifier un hash
   */
  static verifyHash(data: string, hash: string): boolean {
    return this.hash(data) === hash;
  }
}
