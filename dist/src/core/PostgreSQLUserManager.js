import { OAuth2Client } from 'google-auth-library';
import { encrypt, decrypt } from '../utils/encryption.js';
import { createHash } from 'crypto';
export class PostgreSQLUserManager {
    oauth2Client;
    database;
    sessionManager;
    constructor(clientId, clientSecret, redirectUri, database, sessionManager) {
        this.oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUri);
        this.database = database;
        this.sessionManager = sessionManager;
    }
    getAuthUrl() {
        const scopes = [
            'openid',
            'profile',
            'email'
        ];
        return this.oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: scopes,
            prompt: 'consent'
        });
    }
    async authenticateWithGoogle(googleCode) {
        try {
            console.log('🔐 Authentification Google en cours...');
            const { tokens } = await this.oauth2Client.getToken(googleCode);
            if (!tokens.access_token) {
                throw new Error('Token d\'accès manquant');
            }
            const userInfo = await this.getUserInfoFromGoogle(tokens.access_token);
            console.log(`👤 Utilisateur Google récupéré: ${userInfo.email}`);
            const userId = this.createUserIdFromEmailPrivate(userInfo.email);
            const encryptedRefreshToken = tokens.refresh_token ? encrypt(tokens.refresh_token) : undefined;
            const user = await this.database.upsertUser({
                user_id: userId,
                email: userInfo.email,
                name: userInfo.name,
                picture: userInfo.picture,
                google_refresh_token: encryptedRefreshToken
            });
            console.log(`✅ Utilisateur authentifié et sauvegardé: ${user.email}`);
            return { userId, user };
        }
        catch (error) {
            console.error('❌ Erreur authentification Google:', error);
            throw new Error('Échec de l\'authentification Google');
        }
    }
    async ensureUserExists(userId, email, name) {
        let user = await this.getUser(userId);
        if (user) {
            console.log(`✅ Utilisateur existant trouvé: ${user.email}`);
            return user;
        }
        console.log(`🆕 Création d'un nouvel utilisateur: ${email} (${userId})`);
        const userData = {
            id: userId,
            email: email,
            name: name || email.split('@')[0],
            google_id: null,
            created_at: new Date(),
            updated_at: new Date(),
            is_active: true
        };
        const success = await this.database.createUser(userData);
        if (!success) {
            throw new Error(`Impossible de créer l'utilisateur ${email}`);
        }
        user = await this.getUser(userId);
        if (!user) {
            throw new Error(`Utilisateur créé mais introuvable: ${userId}`);
        }
        console.log(`✅ Nouvel utilisateur créé: ${user.email}`);
        return user;
    }
    async getUser(userId) {
        return this.database.getUserById(userId);
    }
    async getUserByEmail(email) {
        return this.database.getUserByEmail(email);
    }
    async getUserWithMCPSessions(userId) {
        const user = await this.getUser(userId);
        if (!user) {
            return null;
        }
        const mcpSessions = await this.sessionManager.getUserActiveSessions(userId);
        return {
            ...user,
            mcpSessions
        };
    }
    async deleteUser(userId) {
        return this.database.deleteUser(userId);
    }
    async deactivateUser(userId) {
        return this.database.deactivateUser(userId);
    }
    async getAllUsers() {
        return this.database.getAllUsers();
    }
    async connectGmailService(userId, refreshToken, accessToken, userEmail, tokenExpiresAt) {
        const credentials = {
            refreshToken,
            accessToken,
            userEmail,
            tokenExpiresAt
        };
        return this.sessionManager.createOrUpdateMCPSession(userId, 'gmail', credentials);
    }
    async connectAxonautService(userId, apiKey, baseUrl, userEmail) {
        const credentials = {
            apiKey,
            baseUrl,
            userEmail
        };
        const serviceMetadata = {
            baseUrl
        };
        return this.sessionManager.createOrUpdateMCPSession(userId, 'axonaut', credentials, serviceMetadata);
    }
    async disconnectMCPService(userId, serviceName) {
        return this.sessionManager.disconnectMCPService(userId, serviceName);
    }
    async getUserMCPSessions(userId) {
        return this.sessionManager.getUserActiveSessions(userId);
    }
    async getMCPSession(userId, serviceName) {
        return this.sessionManager.getMCPSession(userId, serviceName);
    }
    async updateMCPSessionCredentials(userId, serviceName, newCredentials) {
        return this.sessionManager.updateSessionCredentials(userId, serviceName, newCredentials);
    }
    async getUserInfoFromGoogle(accessToken) {
        try {
            this.oauth2Client.setCredentials({ access_token: accessToken });
            const response = await fetch(`https://www.googleapis.com/oauth2/v2/userinfo?access_token=${accessToken}`);
            if (!response.ok) {
                throw new Error(`Erreur API Google: ${response.status}`);
            }
            const userInfo = await response.json();
            return {
                email: userInfo.email,
                name: userInfo.name,
                picture: userInfo.picture,
                sub: userInfo.id
            };
        }
        catch (error) {
            console.error('❌ Erreur récupération infos utilisateur Google:', error);
            throw error;
        }
    }
    createUserIdFromEmail(email) {
        return createHash('sha256')
            .update(email.toLowerCase())
            .digest('hex')
            .substring(0, 32);
    }
    createUserIdFromEmailPrivate(email) {
        return this.createUserIdFromEmail(email);
    }
    async getUserGoogleRefreshToken(userId) {
        const user = await this.getUser(userId);
        if (!user || !user.google_refresh_token) {
            return null;
        }
        try {
            return decrypt(user.google_refresh_token);
        }
        catch (error) {
            console.error('❌ Erreur déchiffrement refresh token:', error);
            return null;
        }
    }
    async cleanupExpiredSessions() {
        return this.sessionManager.cleanupExpiredSessions();
    }
    async deleteOldDisconnectedSessions(daysOld = 30) {
        return this.sessionManager.deleteOldDisconnectedSessions(daysOld);
    }
    async connectMCPService(userId, serviceName, credentials, metadata) {
        try {
            await this.sessionManager.createOrUpdateMCPSession(userId, serviceName, credentials, metadata);
            return true;
        }
        catch (error) {
            console.error(`❌ Erreur connexion service ${serviceName}:`, error);
            return false;
        }
    }
    async getUserMCPConnections(userId) {
        const sessions = await this.sessionManager.getUserActiveSessions(userId);
        return sessions.map(session => ({
            id: 0,
            user_id: session.userId,
            service_name: session.serviceName,
            is_connected: session.isConnected,
            connected_at: session.connectedAt,
            last_used: session.lastUsed,
            credentials: JSON.stringify(session.credentials),
            service_metadata: session.serviceMetadata,
            session_id: session.sessionId,
            expires_at: session.expiresAt,
            created_at: session.connectedAt,
            updated_at: session.lastUsed
        }));
    }
    async getUsageStats() {
        const baseStats = await this.getStats();
        return {
            ...baseStats,
            users: baseStats.totalUsers,
            activeUsers: baseStats.activeUsers,
            services: baseStats.sessionStats.connectionsByService
        };
    }
    async getStats() {
        try {
            const [totalUsersResult, activeUsersResult, sessionStats] = await Promise.all([
                this.database.query('SELECT COUNT(*) as count FROM users'),
                this.database.query('SELECT COUNT(*) as count FROM users WHERE is_active = true'),
                this.sessionManager.getSessionStats()
            ]);
            return {
                totalUsers: parseInt(totalUsersResult.rows[0].count),
                activeUsers: parseInt(activeUsersResult.rows[0].count),
                sessionStats
            };
        }
        catch (error) {
            console.error('❌ Erreur récupération statistiques:', error);
            return {
                totalUsers: 0,
                activeUsers: 0,
                sessionStats: {
                    totalConnections: 0,
                    activeConnections: 0,
                    connectionsByService: {},
                    cachedSessions: 0
                }
            };
        }
    }
}
