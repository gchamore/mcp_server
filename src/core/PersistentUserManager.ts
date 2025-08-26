// src/core/PersistentUserManager.ts - Gestionnaire d'utilisateurs persistants avec Redis

import { OAuth2Client } from 'google-auth-library';
import { encrypt, decrypt } from '../utils/encryption.js';
import { redisPersistence } from '../utils/redis-persistence.js';
import crypto from 'crypto';

export interface PersistentUser {
    userId: string;           // ID stable basé sur l'email Google
    email: string;            // Email Google
    name: string;             // Nom Google
    picture?: string;         // Photo de profil Google
    googleRefreshToken: string; // Token Google chiffré
    createdAt: Date;
    lastLoginAt: Date;
    // Connexions MCP liées à ce compte
    mcpConnections: {
        gmail?: {
            isConnected: boolean;
            connectedAt: Date;
            lastUsed?: Date;
        };
        axonaut?: {
            isConnected: boolean;
            connectedAt: Date;
            lastUsed?: Date;
            credentials?: string; // Chiffrés
        };
        notion?: {
            isConnected: boolean;
            connectedAt: Date;
            lastUsed?: Date;
            credentials?: string; // Chiffrés
        };
    };
}

export interface GoogleUserInfo {
    email: string;
    name: string;
    picture?: string;
    sub: string; // Google ID
}

export class PersistentUserManager {
    private oauth2Client: OAuth2Client;
    private readonly USER_PREFIX = 'user:';

    constructor(clientId: string, clientSecret: string, redirectUri: string) {
        this.oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUri);
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
            
            // Récupérer ou créer l'utilisateur persistant
            const user = await this.getOrCreateUser(userId, userInfo, tokens.refresh_token || undefined);
            
            console.log(`✅ Utilisateur authentifié: ${userInfo.email} (${userId})`);
            return userId;
            
        } catch (error) {
            console.error('❌ Erreur authentification Google:', error);
            throw new Error('Échec de l\'authentification Google');
        }
    }

    // Récupérer ou créer un utilisateur persistant
    private async getOrCreateUser(userId: string, userInfo: GoogleUserInfo, refreshToken?: string): Promise<PersistentUser> {
        const existingUser = await this.getUser(userId);
        
        const user: PersistentUser = {
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

    // Sauvegarder un utilisateur en Redis
    private async saveUser(user: PersistentUser): Promise<void> {
        const userKey = `${this.USER_PREFIX}${user.userId}`;
        await redisPersistence.set(userKey, JSON.stringify(user));
    }

    // Récupérer un utilisateur depuis Redis
    async getUser(userId: string): Promise<PersistentUser | null> {
        try {
            const userKey = `${this.USER_PREFIX}${userId}`;
            const userData = await redisPersistence.get(userKey);
            
            if (!userData) {
                return null;
            }
            
            const user = JSON.parse(userData) as PersistentUser;
            // Reconvertir les dates
            user.createdAt = new Date(user.createdAt);
            user.lastLoginAt = new Date(user.lastLoginAt);
            
            // Reconvertir les dates des connexions MCP
            Object.values(user.mcpConnections).forEach(connection => {
                if (connection) {
                    connection.connectedAt = new Date(connection.connectedAt);
                    if (connection.lastUsed) {
                        connection.lastUsed = new Date(connection.lastUsed);
                    }
                }
            });
            
            return user;
        } catch (error) {
            console.error('❌ Erreur récupération utilisateur:', error);
            return null;
        }
    }

    // Connecter un service MCP à un utilisateur
    async connectMCPService(userId: string, service: 'gmail' | 'axonaut' | 'notion', credentials?: any): Promise<boolean> {
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
        } catch (error) {
            console.error(`❌ Erreur connexion ${service}:`, error);
            return false;
        }
    }

    // Déconnecter un service MCP
    async disconnectMCPService(userId: string, service: 'gmail' | 'axonaut' | 'notion'): Promise<boolean> {
        try {
            const user = await this.getUser(userId);
            if (!user) {
                throw new Error('Utilisateur non trouvé');
            }

            if (user.mcpConnections[service]) {
                user.mcpConnections[service].isConnected = false;
                user.mcpConnections[service].lastUsed = new Date();
                // Garder les credentials pour une éventuelle reconnexion
            }

            await this.saveUser(user);
            console.log(`✅ Service ${service} déconnecté pour ${user.email}`);
            return true;
        } catch (error) {
            console.error(`❌ Erreur déconnexion ${service}:`, error);
            return false;
        }
    }

    // Récupérer les services connectés d'un utilisateur
    async getUserMCPConnections(userId: string): Promise<PersistentUser['mcpConnections'] | null> {
        const user = await this.getUser(userId);
        return user?.mcpConnections || null;
    }

    // Mettre à jour la dernière utilisation d'un service
    async updateServiceLastUsed(userId: string, service: 'gmail' | 'axonaut' | 'notion'): Promise<void> {
        try {
            const user = await this.getUser(userId);
            if (user && user.mcpConnections[service]) {
                user.mcpConnections[service].lastUsed = new Date();
                await this.saveUser(user);
            }
        } catch (error) {
            console.error(`❌ Erreur mise à jour ${service}:`, error);
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

    // Supprimer un utilisateur (GDPR compliance)
    async deleteUser(userId: string): Promise<boolean> {
        try {
            const userKey = `${this.USER_PREFIX}${userId}`;
            await redisPersistence.del(userKey);
            console.log(`✅ Utilisateur ${userId} supprimé`);
            return true;
        } catch (error) {
            console.error('❌ Erreur suppression utilisateur:', error);
            return false;
        }
    }

    // Lister tous les utilisateurs (pour admin)
    async getAllUsers(): Promise<PersistentUser[]> {
        try {
            const keys = await redisPersistence.keys(`${this.USER_PREFIX}*`);
            const users: PersistentUser[] = [];
            
            for (const key of keys) {
                const userData = await redisPersistence.get(key);
                if (userData) {
                    const user = JSON.parse(userData) as PersistentUser;
                    // Reconvertir les dates
                    user.createdAt = new Date(user.createdAt);
                    user.lastLoginAt = new Date(user.lastLoginAt);
                    users.push(user);
                }
            }
            
            return users;
        } catch (error) {
            console.error('❌ Erreur récupération utilisateurs:', error);
            return [];
        }
    }
}
