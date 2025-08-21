import crypto from 'crypto';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const SALT_LENGTH = 32;
function getEncryptionKey() {
    const key = process.env.ENCRYPTION_KEY;
    if (!key || key.length < 32) {
        console.warn('⚠️ ENCRYPTION_KEY manquante ou trop courte, génération d\'une clé temporaire');
        return crypto.randomBytes(32);
    }
    return crypto.createHash('sha256').update(key).digest();
}
export function encrypt(text) {
    try {
        const key = getEncryptionKey();
        const iv = crypto.randomBytes(IV_LENGTH);
        const salt = crypto.randomBytes(SALT_LENGTH);
        const derivedKey = crypto.pbkdf2Sync(key, salt, 100000, 32, 'sha256');
        const cipher = crypto.createCipher(ALGORITHM, derivedKey);
        cipher.setAAD(salt);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const tag = cipher.getAuthTag();
        return [
            salt.toString('hex'),
            iv.toString('hex'),
            tag.toString('hex'),
            encrypted
        ].join(':');
    }
    catch (error) {
        console.error('❌ Erreur de chiffrement:', error);
        throw new Error('Erreur de chiffrement des données sensibles');
    }
}
export function decrypt(encryptedData) {
    try {
        const parts = encryptedData.split(':');
        if (parts.length !== 4) {
            throw new Error('Format de données chiffrées invalide');
        }
        const [saltHex, ivHex, tagHex, encrypted] = parts;
        const salt = Buffer.from(saltHex, 'hex');
        const iv = Buffer.from(ivHex, 'hex');
        const tag = Buffer.from(tagHex, 'hex');
        const key = getEncryptionKey();
        const derivedKey = crypto.pbkdf2Sync(key, salt, 100000, 32, 'sha256');
        const decipher = crypto.createDecipher(ALGORITHM, derivedKey);
        decipher.setAuthTag(tag);
        decipher.setAAD(salt);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }
    catch (error) {
        console.error('❌ Erreur de déchiffrement:', error);
        throw new Error('Erreur de déchiffrement des données sensibles');
    }
}
export function encryptObject(obj) {
    return encrypt(JSON.stringify(obj));
}
export function decryptObject(encryptedData) {
    const decryptedJson = decrypt(encryptedData);
    return JSON.parse(decryptedJson);
}
export function maskApiKey(apiKey) {
    if (!apiKey || apiKey.length < 8)
        return '[MASKED]';
    return `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}`;
}
export function generateEncryptionKey() {
    return crypto.randomBytes(32).toString('hex');
}
