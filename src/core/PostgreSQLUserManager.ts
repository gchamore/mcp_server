// src/core/PostgreSQLUserManager.ts - Gestionnaire d'utilisateurs 100% PostgreSQL

import { OAuth2Client } from 'google-auth-library';
import { DatabaseManager, DatabaseUser } from '../database/DatabaseManager.js';
import { PostgreSQLSessionManager, MCPSessionData } from './PostgreSQLSessionManager.js';
import { encrypt, decrypt } from '../utils/encryption.js';
import { createHash } from 'crypto';

export interface GoogleUserInfo {
    email: string;
    name: string;
    picture?: string;
    sub: string; // Google ID
}

export interface UserWithMCPSessions extends DatabaseUser {
    mcpSessions: MCPSessionData[];
}

export class PostgreSQLUserManager {
    private oauth2Client: OAuth2Client;
    private database: DatabaseManager;
    private sessionManager: PostgreSQLSessionManager;

    constructor(
        clientId: string, 
        clientSecret: string, 
        redirectUri: string, 
        database: DatabaseManager,
        sessionManager: PostgreSQLSessionManager
    ) {
        this.oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUri);
        this.database = database;
        this.sessionManager = sessionManager;
    }

    // === AUTHENTIFICATION GOOGLE ===

    /**
     * Générer l'URL d'authentification Google
     */
    getAuthUrl(): string {
        const scopes = [
            'openid',
            'profile',
            'email'
        ];

        return this.oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: scopes,
            prompt: 'consent' // Force le consent pour obtenir refresh token
        });
    }

    /**
     * Authentifier un utilisateur avec Google OAuth
     */
    async authenticateWithGoogle(googleCode: string): Promise<{ userId: string; user: DatabaseUser }> {
        try {
            console.log('🔐 Authentification Google en cours...');

            // Échanger le code contre des tokens
            const { tokens } = await this.oauth2Client.getToken(googleCode);
            
            if (!tokens.access_token) {
                throw new Error('Token d\'accès manquant');
            }

            // Récupérer les informations utilisateur
            const userInfo = await this.getUserInfoFromGoogle(tokens.access_token);
            console.log(`👤 Utilisateur Google récupéré: ${userInfo.email}`);

            // Créer un userId stable basé sur l'email
            const userId = this.createUserIdFromEmailPrivate(userInfo.email);

            // Chiffrer le refresh token si disponible
            const encryptedRefreshToken = tokens.refresh_token ? encrypt(tokens.refresh_token) : undefined;

            // Créer ou mettre à jour l'utilisateur en base
            const user = await this.database.upsertUser({
                user_id: userId,
                email: userInfo.email,
                name: userInfo.name,
                picture: userInfo.picture,
                google_refresh_token: encryptedRefreshToken
            });

            console.log(`✅ Utilisateur authentifié et sauvegardé: ${user.email}`);
            return { userId, user };

        } catch (error) {
            console.error('❌ Erreur authentification Google:', error);
            throw new Error('Échec de l\'authentification Google');
        }
    }

    // === GESTION DES UTILISATEURS ===

    /**
     * S'assurer qu'un utilisateur existe dans la base de données
     * Créer l'utilisateur s'il n'existe pas, sinon le retourner
     */
    async ensureUserExists(userId: string, email: string, name?: string): Promise<DatabaseUser> {
        // Vérifier si l'utilisateur existe déjà
        let user = await this.getUser(userId);
        
        if (user) {
            console.log(`✅ Utilisateur existant trouvé: ${user.email}`);
            return user;
        }

        // Créer un nouvel utilisateur
        console.log(`🆕 Création d'un nouvel utilisateur: ${email} (${userId})`);
        
        const userData = {
            id: userId,
            email: email,
            name: name || email.split('@')[0], // Utiliser la partie avant @ comme nom par défaut
            google_id: null, // Pas d'ID Google pour les utilisateurs créés via API
            created_at: new Date(),
            updated_at: new Date(),
            is_active: true
        };

        const success = await this.database.createUser(userData);
        
        if (!success) {
            throw new Error(`Impossible de créer l'utilisateur ${email}`);
        }

        // Récupérer l'utilisateur créé
        user = await this.getUser(userId);
        if (!user) {
            throw new Error(`Utilisateur créé mais introuvable: ${userId}`);
        }

        console.log(`✅ Nouvel utilisateur créé: ${user.email}`);
        return user;
    }

    /**
     * Récupérer un utilisateur par ID
     */
    async getUser(userId: string): Promise<DatabaseUser | null> {
        return this.database.getUserById(userId);
    }

    /**
     * Récupérer un utilisateur par email
     */
    async getUserByEmail(email: string): Promise<DatabaseUser | null> {
        return this.database.getUserByEmail(email);
    }

    /**
     * Récupérer un utilisateur avec ses sessions MCP actives
     */
    async getUserWithMCPSessions(userId: string): Promise<UserWithMCPSessions | null> {
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

    /**
     * Supprimer un utilisateur et toutes ses données (GDPR compliance)
     */
    async deleteUser(userId: string): Promise<boolean> {
        return this.database.deleteUser(userId);
    }

    /**
     * Désactiver un utilisateur (soft delete)
     */
    async deactivateUser(userId: string): Promise<boolean> {
        return this.database.deactivateUser(userId);
    }

    /**
     * Récupérer tous les utilisateurs (pour admin)
     */
    async getAllUsers(): Promise<DatabaseUser[]> {
        return this.database.getAllUsers();
    }

    // === GESTION DES SERVICES MCP ===

    /**
     * Connecter un service Gmail à un utilisateur
     */
    async connectGmailService(
        userId: string,
        refreshToken: string,
        accessToken: string,
        userEmail: string,
        tokenExpiresAt?: Date
    ): Promise<MCPSessionData> {
        const credentials = {
            refreshToken,
            accessToken,
            userEmail,
            tokenExpiresAt
        };

        return this.sessionManager.createOrUpdateMCPSession(
            userId,
            'gmail',
            credentials
        );
    }

    /**
     * Connecter un service Axonaut à un utilisateur
     */
    async connectAxonautService(
        userId: string,
        apiKey: string,
        baseUrl: string,
        userEmail: string
    ): Promise<MCPSessionData> {
        const credentials = {
            apiKey,
            baseUrl,
            userEmail
        };

        const serviceMetadata = {
            baseUrl
        };

        return this.sessionManager.createOrUpdateMCPSession(
            userId,
            'axonaut',
            credentials,
            serviceMetadata
        );
    }

    /**
     * Déconnecter un service MCP
     */
    async disconnectMCPService(
        userId: string,
        serviceName: 'gmail' | 'axonaut' | 'notion'
    ): Promise<boolean> {
        return this.sessionManager.disconnectMCPService(userId, serviceName);
    }

    /**
     * Récupérer les sessions MCP actives d'un utilisateur
     */
    async getUserMCPSessions(userId: string): Promise<MCPSessionData[]> {
        return this.sessionManager.getUserActiveSessions(userId);
    }

    /**
     * Récupérer une session MCP spécifique
     */
    async getMCPSession(
        userId: string,
        serviceName: 'gmail' | 'axonaut' | 'notion'
    ): Promise<MCPSessionData | null> {
        return this.sessionManager.getMCPSession(userId, serviceName);
    }

    /**
     * Mettre à jour les credentials d'une session MCP
     */
    async updateMCPSessionCredentials(
        userId: string,
        serviceName: 'gmail' | 'axonaut' | 'notion',
        newCredentials: any
    ): Promise<boolean> {
        return this.sessionManager.updateSessionCredentials(userId, serviceName, newCredentials);
    }

    // === MÉTHODES UTILITAIRES ===

    /**
     * Récupérer les informations utilisateur depuis Google
     */
    private async getUserInfoFromGoogle(accessToken: string): Promise<GoogleUserInfo> {
        try {
            this.oauth2Client.setCredentials({ access_token: accessToken });
            
            const response = await fetch(
                `https://www.googleapis.com/oauth2/v2/userinfo?access_token=${accessToken}`
            );

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

        } catch (error) {
            console.error('❌ Erreur récupération infos utilisateur Google:', error);
            throw error;
        }
    }

    /**
     * Créer un userId stable basé sur l'email (méthode publique pour debug)
     */
    createUserIdFromEmail(email: string): string {
        return createHash('sha256')
            .update(email.toLowerCase())
            .digest('hex')
            .substring(0, 32);
    }

    /**
     * Créer un userId stable basé sur l'email (méthode privée)
     */
    private createUserIdFromEmailPrivate(email: string): string {
        return this.createUserIdFromEmail(email);
    }

    /**
     * Obtenir le refresh token déchiffré d'un utilisateur
     */
    async getUserGoogleRefreshToken(userId: string): Promise<string | null> {
        const user = await this.getUser(userId);
        if (!user || !user.google_refresh_token) {
            return null;
        }

        try {
            return decrypt(user.google_refresh_token);
        } catch (error) {
            console.error('❌ Erreur déchiffrement refresh token:', error);
            return null;
        }
    }

    // === NETTOYAGE ET MAINTENANCE ===

    /**
     * Nettoyer les sessions expirées
     */
    async cleanupExpiredSessions(): Promise<number> {
        return this.sessionManager.cleanupExpiredSessions();
    }

    /**
     * Supprimer les anciennes connexions MCP déconnectées
     */
    async deleteOldDisconnectedSessions(daysOld: number = 30): Promise<number> {
        return this.sessionManager.deleteOldDisconnectedSessions(daysOld);
    }

    /**
     * Connecter un service Gmail à un utilisateur (nouvelle signature compatible)
     */
    async connectMCPService(
        userId: string,
        serviceName: 'gmail' | 'axonaut' | 'notion',
        credentials: any,
        metadata?: any
    ): Promise<boolean> {
        try {
            await this.sessionManager.createOrUpdateMCPSession(
                userId,
                serviceName,
                credentials,
                metadata
            );
            return true;
        } catch (error) {
            console.error(`❌ Erreur connexion service ${serviceName}:`, error);
            return false;
        }
    }

    /**
     * Récupérer les connexions MCP d'un utilisateur (compatible avec l'ancien système)
     */
    async getUserMCPConnections(userId: string): Promise<any[]> {
        const sessions = await this.sessionManager.getUserActiveSessions(userId);
        
        return sessions.map(session => ({
            id: 0, // Pour compatibilité
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

    // === STATISTIQUES ===

    /**
     * Obtenir des statistiques d'usage (pour compatibilité)
     */
    async getUsageStats(): Promise<any> {
        const baseStats = await this.getStats();
        
        return {
            ...baseStats,
            // Format compatible avec l'ancien système
            users: baseStats.totalUsers,
            activeUsers: baseStats.activeUsers,
            services: baseStats.sessionStats.connectionsByService
        };
    }

    /**
     * Obtenir des statistiques sur les utilisateurs et sessions
     */
    async getStats(): Promise<{
        totalUsers: number;
        activeUsers: number;
        sessionStats: any;
    }> {
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

        } catch (error) {
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
