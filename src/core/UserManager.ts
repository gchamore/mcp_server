// src/core/UserManager.ts - Gestionnaire d'utilisateurs avec authentification Google

import { OAuth2Client } from 'google-auth-library';
import { encrypt, decrypt } from '../utils/encryption.js';
import crypto from 'crypto';

export interface AuthenticatedUser {
    userId: string;           // ID stable basé sur l'email Google
    email: string;            // Email Google
    name: string;             // Nom Google
    picture?: string;         // Photo de profil Google
    googleRefreshToken: string; // Token Google chiffré
    createdAt: Date;
    lastLoginAt: Date;
    connectedServices: string[];
}

export interface GoogleUserInfo {
    email: string;
    name: string;
    picture?: string;
    sub: string; // Google ID
}

export class UserManager {
    private authenticatedUsers = new Map<string, AuthenticatedUser>();
    private oauth2Client: OAuth2Client;

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
            
            // Vérifier si l'utilisateur existe déjà
            const existingUser = this.authenticatedUsers.get(userId);
            
            const user: AuthenticatedUser = {
                userId,
                email: userInfo.email,
                name: userInfo.name,
                picture: userInfo.picture,
                googleRefreshToken: encrypt(tokens.refresh_token || ''),
                createdAt: existingUser?.createdAt || new Date(),
                lastLoginAt: new Date(),
                connectedServices: existingUser?.connectedServices || []
            };
            
            this.authenticatedUsers.set(userId, user);
            
            console.log(`✅ Utilisateur authentifié: ${userInfo.email} (${userId})`);
            return userId;
            
        } catch (error) {
            console.error('❌ Erreur authentification Google:', error);
            throw new Error('Échec de l\'authentification Google');
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
                sub: userInfo.id
            };
        } catch (error) {
            console.error('❌ Erreur récupération info utilisateur:', error);
            throw error;
        }
    }

    // Créer un userId stable basé sur l'email
    private createUserIdFromEmail(email: string): string {
        return crypto.createHash('sha256').update(email.toLowerCase()).digest('hex').substring(0, 16);
    }

    // Récupérer un utilisateur
    getUser(userId: string): AuthenticatedUser | null {
        const user = this.authenticatedUsers.get(userId);
        if (user) {
            // Mettre à jour lastLoginAt
            user.lastLoginAt = new Date();
        }
        return user || null;
    }

    // Vérifier si un utilisateur existe
    hasUser(userId: string): boolean {
        return this.authenticatedUsers.has(userId);
    }

    // Ajouter un service connecté à un utilisateur
    addConnectedService(userId: string, serviceName: string): boolean {
        const user = this.authenticatedUsers.get(userId);
        if (!user) return false;

        if (!user.connectedServices.includes(serviceName)) {
            user.connectedServices.push(serviceName);
            console.log(`✅ Service ${serviceName} ajouté à l'utilisateur ${user.email}`);
        }
        
        return true;
    }

    // Supprimer un service connecté
    removeConnectedService(userId: string, serviceName: string): boolean {
        const user = this.authenticatedUsers.get(userId);
        if (!user) return false;

        const index = user.connectedServices.indexOf(serviceName);
        if (index > -1) {
            user.connectedServices.splice(index, 1);
            console.log(`✅ Service ${serviceName} supprimé de l'utilisateur ${user.email}`);
            return true;
        }
        
        return false;
    }

    // Supprimer un utilisateur complètement
    removeUser(userId: string): boolean {
        const user = this.authenticatedUsers.get(userId);
        if (user) {
            this.authenticatedUsers.delete(userId);
            console.log(`✅ Utilisateur supprimé: ${user.email}`);
            return true;
        }
        return false;
    }

    // Obtenir tous les utilisateurs
    getAllUsers(): AuthenticatedUser[] {
        return Array.from(this.authenticatedUsers.values());
    }

    // Statistiques
    getStats() {
        const users = this.getAllUsers();
        const totalServices = users.reduce((sum, user) => sum + user.connectedServices.length, 0);
        
        return {
            totalUsers: users.length,
            totalConnectedServices: totalServices,
            averageServicesPerUser: users.length > 0 ? (totalServices / users.length).toFixed(2) : 0
        };
    }

    // Nettoyage des utilisateurs inactifs
    cleanupInactiveUsers(daysInactive: number = 60): number {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysInactive);
        
        let removedCount = 0;
        for (const [userId, user] of this.authenticatedUsers.entries()) {
            if (user.lastLoginAt < cutoffDate) {
                this.authenticatedUsers.delete(userId);
                removedCount++;
                console.log(`🗑️ Utilisateur inactif supprimé: ${user.email}`);
            }
        }
        
        return removedCount;
    }

    // Méthode pour obtenir les utilisateurs pour la sauvegarde Redis
    getUsersMap(): Map<string, AuthenticatedUser> {
        return new Map(this.authenticatedUsers);
    }

    // Restaurer les utilisateurs depuis Redis
    restoreUsers(users: AuthenticatedUser[]): void {
        for (const user of users) {
            this.authenticatedUsers.set(user.userId, user);
        }
        console.log(`🔄 ${users.length} utilisateurs restaurés depuis Redis`);
    }
}
