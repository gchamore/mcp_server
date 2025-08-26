// src/core/DatabaseUserManager.ts - Gestionnaire d'utilisateurs avec PostgreSQL + Redis

import { OAuth2Client } from 'google-auth-library';
import { encrypt, decrypt } from '../utils/encryption.js';
import { DatabaseManager, DatabaseUser, MCPConnection } from '../database/DatabaseManager.js';
import crypto from 'crypto';

export interface GoogleUserInfo {
    email: string;
    name: string;
    picture?: string;
    sub: string; // Google ID
}

export interface UserWithConnections extends DatabaseUser {
    mcpConnections: MCPConnection[];
}

export class DatabaseUserManager {
    private oauth2Client: OAuth2Client;
    private database: DatabaseManager;

    constructor(clientId: string, clientSecret: string, redirectUri: string, database: DatabaseManager) {
        this.oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUri);
        this.database = database;
    }

    // Générer l'URL d'authentification Google
    getAuthUrl(): string {
        return this.oauth2Client.generateAuthUrl({
            access_type: 'offline',
            prompt: 'consent',
            scope: [
                'https://www.googleapis.com/auth/userinfo.email',
                'https://www.googleapis.com/auth/userinfo.profile'
            ],
        });
    }

    // Authentifier un utilisateur avec Google OAuth
    async authenticateWithGoogle(googleCode: string): Promise<string> {
        try {
            // Échanger le code contre des tokens
            const { tokens } = await this.oauth2Client.getToken(googleCode);
            
            if (!tokens.access_token) {
                throw new Error('Token d\'accès Google manquant');
            }

            // Récupérer les informations utilisateur
            const userInfo = await this.getUserInfoFromGoogle(tokens.access_token);
            
            // Créer un userId stable basé sur l'email
            const userId = this.createUserIdFromEmail(userInfo.email);
            
            // Sauvegarder/mettre à jour l'utilisateur en base
            await this.database.upsertUser({
                user_id: userId,
                email: userInfo.email,
                name: userInfo.name,
                picture: userInfo.picture,
                google_refresh_token: tokens.refresh_token ? encrypt(tokens.refresh_token) : undefined
            });
            
            console.log(`✅ Utilisateur authentifié: ${userInfo.email} (${userId})`);
            return userId;
            
        } catch (error) {
            console.error('❌ Erreur authentification Google:', error);
            throw new Error('Échec de l\'authentification Google');
        }
    }

    // Récupérer un utilisateur par ID
    async getUser(userId: string): Promise<DatabaseUser | null> {
        try {
            return await this.database.getUserById(userId);
        } catch (error) {
            console.error('❌ Erreur récupération utilisateur:', error);
            return null;
        }
    }

    // Récupérer un utilisateur avec ses connexions MCP
    async getUserWithConnections(userId: string): Promise<UserWithConnections | null> {
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
        } catch (error) {
            console.error('❌ Erreur récupération utilisateur avec connexions:', error);
            return null;
        }
    }

    // Connecter un service MCP à un utilisateur
    async connectMCPService(
        userId: string, 
        service: 'gmail' | 'axonaut' | 'notion', 
        credentials?: any,
        metadata?: any
    ): Promise<boolean> {
        try {
            const user = await this.database.getUserById(userId);
            if (!user) {
                throw new Error('Utilisateur non trouvé');
            }

            const encryptedCredentials = credentials ? encrypt(JSON.stringify(credentials)) : undefined;
            
            await this.database.connectMCPService(userId, service, encryptedCredentials, metadata);
            
            console.log(`✅ Service ${service} connecté pour ${user.email}`);
            return true;
        } catch (error) {
            console.error(`❌ Erreur connexion ${service}:`, error);
            return false;
        }
    }

    // Déconnecter un service MCP
    async disconnectMCPService(userId: string, service: 'gmail' | 'axonaut' | 'notion'): Promise<boolean> {
        try {
            const success = await this.database.disconnectMCPService(userId, service);
            
            if (success) {
                console.log(`✅ Service ${service} déconnecté pour ${userId}`);
            }
            
            return success;
        } catch (error) {
            console.error(`❌ Erreur déconnexion ${service}:`, error);
            return false;
        }
    }

    // Récupérer les connexions MCP d'un utilisateur
    async getUserMCPConnections(userId: string): Promise<MCPConnection[]> {
        try {
            return await this.database.getUserMCPConnections(userId);
        } catch (error) {
            console.error('❌ Erreur récupération connexions MCP:', error);
            return [];
        }
    }

    // Mettre à jour la dernière utilisation d'un service
    async updateServiceLastUsed(userId: string, service: 'gmail' | 'axonaut' | 'notion'): Promise<void> {
        try {
            await this.database.updateServiceLastUsed(userId, service);
        } catch (error) {
            console.error(`❌ Erreur mise à jour ${service}:`, error);
        }
    }

    // Récupérer les credentials déchiffrés d'un service
    async getServiceCredentials(userId: string, service: 'gmail' | 'axonaut' | 'notion'): Promise<any | null> {
        try {
            const connections = await this.database.getUserMCPConnections(userId);
            const connection = connections.find(c => c.service_name === service && c.is_connected);
            
            if (!connection || !connection.credentials) {
                return null;
            }

            const decryptedCredentials = decrypt(connection.credentials);
            return JSON.parse(decryptedCredentials);
        } catch (error) {
            console.error(`❌ Erreur récupération credentials ${service}:`, error);
            return null;
        }
    }

    // Supprimer un utilisateur (GDPR compliance)
    async deleteUser(userId: string): Promise<boolean> {
        try {
            const success = await this.database.deleteUser(userId);
            if (success) {
                console.log(`✅ Utilisateur ${userId} supprimé`);
            }
            return success;
        } catch (error) {
            console.error('❌ Erreur suppression utilisateur:', error);
            return false;
        }
    }

    // Désactiver un utilisateur (soft delete)
    async deactivateUser(userId: string): Promise<boolean> {
        try {
            const success = await this.database.deactivateUser(userId);
            if (success) {
                console.log(`✅ Utilisateur ${userId} désactivé`);
            }
            return success;
        } catch (error) {
            console.error('❌ Erreur désactivation utilisateur:', error);
            return false;
        }
    }

    // Récupérer les statistiques d'utilisation
    async getUsageStats(): Promise<{
        totalUsers: number;
        activeUsers: number;
        totalConnections: number;
        serviceBreakdown: { service_name: string; count: number }[];
    }> {
        try {
            return await this.database.getStats();
        } catch (error) {
            console.error('❌ Erreur récupération statistiques:', error);
            return {
                totalUsers: 0,
                activeUsers: 0,
                totalConnections: 0,
                serviceBreakdown: []
            };
        }
    }

    // Récupérer les informations utilisateur depuis Google
    private async getUserInfoFromGoogle(accessToken: string): Promise<GoogleUserInfo> {
        try {
            const response = await fetch(
                `https://www.googleapis.com/oauth2/v2/userinfo?access_token=${accessToken}`
            );
            
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
        } catch (error) {
            console.error('❌ Erreur récupération infos Google:', error);
            throw new Error('Impossible de récupérer les informations utilisateur');
        }
    }

    // Créer un ID utilisateur stable basé sur l'email
    private createUserIdFromEmail(email: string): string {
        return crypto.createHash('sha256').update(email.toLowerCase()).digest('hex').substring(0, 16);
    }

    // Health check
    async healthCheck(): Promise<boolean> {
        return await this.database.healthCheck();
    }
}
