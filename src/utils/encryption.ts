import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const SALT_LENGTH = 32;

// Obtenir la clé de chiffrement depuis les variables d'environnement
function getEncryptionKey(): Buffer {
	const key = process.env.ENCRYPTION_KEY;
	if (!key || key.length < 32) {
		console.warn('⚠️ ENCRYPTION_KEY manquante ou trop courte, génération d\'une clé temporaire');
		// En production, ceci devrait lever une erreur
		return crypto.randomBytes(32);
	}
	return crypto.createHash('sha256').update(key).digest();
}

// Chiffrer une chaîne
// Chiffrer une chaîne
export function encrypt(text: string): string {
	try {
		const key = getEncryptionKey();
		const iv = crypto.randomBytes(IV_LENGTH);
		const salt = crypto.randomBytes(SALT_LENGTH);

		// Dériver une clé avec le salt
		const derivedKey = crypto.pbkdf2Sync(key, salt, 100000, 32, 'sha256');

		const cipher = crypto.createCipheriv(ALGORITHM, derivedKey, iv);
		cipher.setAAD(salt); // Données authentifiées additionnelles

		let encrypted = cipher.update(text, 'utf8', 'hex');
		encrypted += cipher.final('hex');

		const tag = cipher.getAuthTag();

		// Format: salt:iv:tag:encrypted
		return [
			salt.toString('hex'),
			iv.toString('hex'),
			tag.toString('hex'),
			encrypted
		].join(':');
	} catch (error) {
		console.error('❌ Erreur de chiffrement:', error);
		throw new Error('Erreur de chiffrement des données sensibles');
	}
}

// Déchiffrer une chaîne
export function decrypt(encryptedData: string): string {
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

		const decipher = crypto.createDecipheriv(ALGORITHM, derivedKey, iv);
		decipher.setAuthTag(tag);
		decipher.setAAD(salt);

		let decrypted = decipher.update(encrypted, 'hex', 'utf8');
		decrypted += decipher.final('utf8');

		return decrypted;
	} catch (error) {
		console.error('❌ Erreur de déchiffrement:', error);
		throw new Error('Erreur de déchiffrement des données sensibles');
	}
}

// Chiffrer un objet JSON
export function encryptObject(obj: any): string {
	return encrypt(JSON.stringify(obj));
}

// Déchiffrer vers un objet JSON
export function decryptObject<T>(encryptedData: string): T {
	const decryptedJson = decrypt(encryptedData);
	return JSON.parse(decryptedJson) as T;
}

// Masquer partiellement une clé API pour les logs
export function maskApiKey(apiKey: string): string {
	if (!apiKey || apiKey.length < 8) return '[MASKED]';
	return `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}`;
}

// Générer une clé de chiffrement sécurisée
export function generateEncryptionKey(): string {
	return crypto.randomBytes(32).toString('hex');
}
