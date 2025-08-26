import { OAuth2Client } from 'google-auth-library';
import { encrypt } from '../utils/encryption.js';
import { redisPersistence } from '../utils/redis-persistence.js';
import crypto from 'crypto';
export class PersistentUserManager {
    oauth2Client;
    USER_PREFIX = 'user:';
    constructor(clientId, clientSecret, redirectUri) {
        this.oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUri);
    }
    getAuthUrl() {
        return this.oauth2Client.generateAuthUrl({
            access_type: 'offline',
            prompt: 'consent',
            scope: [
                'https://www.googleapis.com/auth/userinfo.email',
                'https://www.googleapis.com/auth/userinfo.profile'
            ],
        });
    }
    async authenticateWithGoogle(googleCode) {
        try {
            const { tokens } = await this.oauth2Client.getToken(googleCode);
            if (!tokens.access_token) {
                throw new Error('Token d\'accès Google manquant');
            }
            const userInfo = await this.getUserInfoFromGoogle(tokens.access_token);
            const userId = this.createUserIdFromEmail(userInfo.email);
            const user = await this.getOrCreateUser(userId, userInfo, tokens.refresh_token || undefined);
            console.log(`✅ Utilisateur authentifié: ${userInfo.email} (${userId})`);
            return userId;
        }
        catch (error) {
            console.error('❌ Erreur authentification Google:', error);
            throw new Error('Échec de l\'authentification Google');
        }
    }
    async getOrCreateUser(userId, userInfo, refreshToken) {
        const existingUser = await this.getUser(userId);
        const user = {
            userId,
            email: userInfo.email,
            name: userInfo.name,
            picture: userInfo.picture,
            googleRefreshToken: encrypt(refreshToken || ''),
            createdAt: existingUser?.createdAt || new Date(),
            lastLoginAt: new Date(),
            mcpConnections: existingUser?.mcpConnections || {}
        };
        await this.saveUser(user);
        return user;
    }
    async saveUser(user) {
        const userKey = `${this.USER_PREFIX}${user.userId}`;
        await redisPersistence.set(userKey, JSON.stringify(user));
    }
    async getUser(userId) {
        try {
            const userKey = `${this.USER_PREFIX}${userId}`;
            const userData = await redisPersistence.get(userKey);
            if (!userData) {
                return null;
            }
            const user = JSON.parse(userData);
            user.createdAt = new Date(user.createdAt);
            user.lastLoginAt = new Date(user.lastLoginAt);
            Object.values(user.mcpConnections).forEach(connection => {
                if (connection) {
                    connection.connectedAt = new Date(connection.connectedAt);
                    if (connection.lastUsed) {
                        connection.lastUsed = new Date(connection.lastUsed);
                    }
                }
            });
            return user;
        }
        catch (error) {
            console.error('❌ Erreur récupération utilisateur:', error);
            return null;
        }
    }
    async connectMCPService(userId, service, credentials) {
        try {
            const user = await this.getUser(userId);
            if (!user) {
                throw new Error('Utilisateur non trouvé');
            }
            user.mcpConnections[service] = {
                isConnected: true,
                connectedAt: new Date(),
                lastUsed: new Date(),
                credentials: credentials ? encrypt(JSON.stringify(credentials)) : undefined
            };
            await this.saveUser(user);
            console.log(`✅ Service ${service} connecté pour ${user.email}`);
            return true;
        }
        catch (error) {
            console.error(`❌ Erreur connexion ${service}:`, error);
            return false;
        }
    }
    async disconnectMCPService(userId, service) {
        try {
            const user = await this.getUser(userId);
            if (!user) {
                throw new Error('Utilisateur non trouvé');
            }
            if (user.mcpConnections[service]) {
                user.mcpConnections[service].isConnected = false;
                user.mcpConnections[service].lastUsed = new Date();
            }
            await this.saveUser(user);
            console.log(`✅ Service ${service} déconnecté pour ${user.email}`);
            return true;
        }
        catch (error) {
            console.error(`❌ Erreur déconnexion ${service}:`, error);
            return false;
        }
    }
    async getUserMCPConnections(userId) {
        const user = await this.getUser(userId);
        return user?.mcpConnections || null;
    }
    async updateServiceLastUsed(userId, service) {
        try {
            const user = await this.getUser(userId);
            if (user && user.mcpConnections[service]) {
                user.mcpConnections[service].lastUsed = new Date();
                await this.saveUser(user);
            }
        }
        catch (error) {
            console.error(`❌ Erreur mise à jour ${service}:`, error);
        }
    }
    async getUserInfoFromGoogle(accessToken) {
        try {
            const response = await fetch(`https://www.googleapis.com/oauth2/v2/userinfo?access_token=${accessToken}`);
            if (!response.ok) {
                throw new Error('Erreur lors de la récupération des informations utilisateur');
            }
            const userInfo = await response.json();
            return {
                email: userInfo.email,
                name: userInfo.name,
                picture: userInfo.picture,
                sub: userInfo.sub
            };
        }
        catch (error) {
            console.error('❌ Erreur récupération infos Google:', error);
            throw new Error('Impossible de récupérer les informations utilisateur');
        }
    }
    createUserIdFromEmail(email) {
        return crypto.createHash('sha256').update(email.toLowerCase()).digest('hex').substring(0, 16);
    }
    async deleteUser(userId) {
        try {
            const userKey = `${this.USER_PREFIX}${userId}`;
            await redisPersistence.del(userKey);
            console.log(`✅ Utilisateur ${userId} supprimé`);
            return true;
        }
        catch (error) {
            console.error('❌ Erreur suppression utilisateur:', error);
            return false;
        }
    }
    async getAllUsers() {
        try {
            const keys = await redisPersistence.keys(`${this.USER_PREFIX}*`);
            const users = [];
            for (const key of keys) {
                const userData = await redisPersistence.get(key);
                if (userData) {
                    const user = JSON.parse(userData);
                    user.createdAt = new Date(user.createdAt);
                    user.lastLoginAt = new Date(user.lastLoginAt);
                    users.push(user);
                }
            }
            return users;
        }
        catch (error) {
            console.error('❌ Erreur récupération utilisateurs:', error);
            return [];
        }
    }
}
