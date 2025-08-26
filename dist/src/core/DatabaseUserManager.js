import { OAuth2Client } from 'google-auth-library';
import { encrypt, decrypt } from '../utils/encryption.js';
import crypto from 'crypto';
export class DatabaseUserManager {
    oauth2Client;
    database;
    constructor(clientId, clientSecret, redirectUri, database) {
        this.oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUri);
        this.database = database;
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
            await this.database.upsertUser({
                user_id: userId,
                email: userInfo.email,
                name: userInfo.name,
                picture: userInfo.picture,
                google_refresh_token: tokens.refresh_token ? encrypt(tokens.refresh_token) : undefined
            });
            console.log(`✅ Utilisateur authentifié: ${userInfo.email} (${userId})`);
            return userId;
        }
        catch (error) {
            console.error('❌ Erreur authentification Google:', error);
            throw new Error('Échec de l\'authentification Google');
        }
    }
    async getUser(userId) {
        try {
            return await this.database.getUserById(userId);
        }
        catch (error) {
            console.error('❌ Erreur récupération utilisateur:', error);
            return null;
        }
    }
    async getUserWithConnections(userId) {
        try {
            const user = await this.database.getUserById(userId);
            if (!user) {
                return null;
            }
            const mcpConnections = await this.database.getUserMCPConnections(userId);
            return {
                ...user,
                mcpConnections
            };
        }
        catch (error) {
            console.error('❌ Erreur récupération utilisateur avec connexions:', error);
            return null;
        }
    }
    async connectMCPService(userId, service, credentials, metadata) {
        try {
            const user = await this.database.getUserById(userId);
            if (!user) {
                throw new Error('Utilisateur non trouvé');
            }
            const encryptedCredentials = credentials ? encrypt(JSON.stringify(credentials)) : undefined;
            await this.database.connectMCPService(userId, service, encryptedCredentials, metadata);
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
            const success = await this.database.disconnectMCPService(userId, service);
            if (success) {
                console.log(`✅ Service ${service} déconnecté pour ${userId}`);
            }
            return success;
        }
        catch (error) {
            console.error(`❌ Erreur déconnexion ${service}:`, error);
            return false;
        }
    }
    async getUserMCPConnections(userId) {
        try {
            return await this.database.getUserMCPConnections(userId);
        }
        catch (error) {
            console.error('❌ Erreur récupération connexions MCP:', error);
            return [];
        }
    }
    async updateServiceLastUsed(userId, service) {
        try {
            await this.database.updateServiceLastUsed(userId, service);
        }
        catch (error) {
            console.error(`❌ Erreur mise à jour ${service}:`, error);
        }
    }
    async getServiceCredentials(userId, service) {
        try {
            const connections = await this.database.getUserMCPConnections(userId);
            const connection = connections.find(c => c.service_name === service && c.is_connected);
            if (!connection || !connection.credentials) {
                return null;
            }
            const decryptedCredentials = decrypt(connection.credentials);
            return JSON.parse(decryptedCredentials);
        }
        catch (error) {
            console.error(`❌ Erreur récupération credentials ${service}:`, error);
            return null;
        }
    }
    async deleteUser(userId) {
        try {
            const success = await this.database.deleteUser(userId);
            if (success) {
                console.log(`✅ Utilisateur ${userId} supprimé`);
            }
            return success;
        }
        catch (error) {
            console.error('❌ Erreur suppression utilisateur:', error);
            return false;
        }
    }
    async deactivateUser(userId) {
        try {
            const success = await this.database.deactivateUser(userId);
            if (success) {
                console.log(`✅ Utilisateur ${userId} désactivé`);
            }
            return success;
        }
        catch (error) {
            console.error('❌ Erreur désactivation utilisateur:', error);
            return false;
        }
    }
    async getUsageStats() {
        try {
            return await this.database.getStats();
        }
        catch (error) {
            console.error('❌ Erreur récupération statistiques:', error);
            return {
                totalUsers: 0,
                activeUsers: 0,
                totalConnections: 0,
                serviceBreakdown: []
            };
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
    async healthCheck() {
        return await this.database.healthCheck();
    }
}
