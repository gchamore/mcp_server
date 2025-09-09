import crypto from 'crypto';
export class EncryptionService {
    static getEncryptionKey() {
        const key = process.env.ENCRYPTION_KEY;
        if (!key) {
            if (process.env.NODE_ENV === 'production') {
                throw new Error('ENCRYPTION_KEY must be set in production environment');
            }
            console.warn('⚠️  Using fallback encryption key - UNSAFE for production!');
            return crypto.scryptSync('fallback-key', 'salt', this.KEY_LENGTH);
        }
        if (key.length === 64) {
            return Buffer.from(key, 'hex');
        }
        return crypto.scryptSync(key, 'mcp-wesype-salt', this.KEY_LENGTH);
    }
    static encrypt(text) {
        try {
            const key = this.getEncryptionKey();
            const iv = crypto.randomBytes(this.IV_LENGTH);
            const cipher = crypto.createCipheriv(this.ALGORITHM, key, iv);
            cipher.setAAD(Buffer.from('mcp-wesype'));
            let encrypted = cipher.update(text, 'utf8', 'hex');
            encrypted += cipher.final('hex');
            const tag = cipher.getAuthTag();
            return iv.toString('hex') + ':' + tag.toString('hex') + ':' + encrypted;
        }
        catch (error) {
            console.error('Erreur de chiffrement:', error);
            throw new Error('Erreur lors du chiffrement des données');
        }
    }
    static isEncrypted(data) {
        if (!data || typeof data !== 'string') {
            return false;
        }
        const parts = data.split(':');
        return parts.length === 3 &&
            parts[0].length === this.IV_LENGTH * 2 &&
            parts[1].length === this.TAG_LENGTH * 2;
    }
    static decrypt(encryptedData) {
        try {
            if (!this.isEncrypted(encryptedData)) {
                console.warn('⚠️  Donnée non chiffrée détectée, retour en clair');
                return encryptedData;
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
        }
        catch (error) {
            console.error('Erreur de déchiffrement:', error);
            throw new Error('Erreur lors du déchiffrement des données');
        }
    }
    static generateEncryptionKey() {
        return crypto.randomBytes(this.KEY_LENGTH).toString('hex');
    }
    static hash(data) {
        return crypto.createHash('sha256').update(data + 'mcp-wesype-salt').digest('hex');
    }
    static verifyHash(data, hash) {
        return this.hash(data) === hash;
    }
}
EncryptionService.ALGORITHM = 'aes-256-gcm';
EncryptionService.KEY_LENGTH = 32;
EncryptionService.IV_LENGTH = 16;
EncryptionService.TAG_LENGTH = 16;
