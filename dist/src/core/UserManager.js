import { OAuth2Client } from 'google-auth-library';
import { encrypt } from '../utils/encryption.js';
import crypto from 'crypto';
export class UserManager {
    authenticatedUsers = new Map();
    oauth2Client;
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
            const existingUser = this.authenticatedUsers.get(userId);
            const user = {
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
        }
        catch (error) {
            console.error('❌ Erreur authentification Google:', error);
            throw new Error('Échec de l\'authentification Google');
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
                sub: userInfo.id
            };
        }
        catch (error) {
            console.error('❌ Erreur récupération info utilisateur:', error);
            throw error;
        }
    }
    createUserIdFromEmail(email) {
        return crypto.createHash('sha256').update(email.toLowerCase()).digest('hex').substring(0, 16);
    }
    getUser(userId) {
        const user = this.authenticatedUsers.get(userId);
        if (user) {
            user.lastLoginAt = new Date();
        }
        return user || null;
    }
    hasUser(userId) {
        return this.authenticatedUsers.has(userId);
    }
    addConnectedService(userId, serviceName) {
        const user = this.authenticatedUsers.get(userId);
        if (!user)
            return false;
        if (!user.connectedServices.includes(serviceName)) {
            user.connectedServices.push(serviceName);
            console.log(`✅ Service ${serviceName} ajouté à l'utilisateur ${user.email}`);
        }
        return true;
    }
    removeConnectedService(userId, serviceName) {
        const user = this.authenticatedUsers.get(userId);
        if (!user)
            return false;
        const index = user.connectedServices.indexOf(serviceName);
        if (index > -1) {
            user.connectedServices.splice(index, 1);
            console.log(`✅ Service ${serviceName} supprimé de l'utilisateur ${user.email}`);
            return true;
        }
        return false;
    }
    removeUser(userId) {
        const user = this.authenticatedUsers.get(userId);
        if (user) {
            this.authenticatedUsers.delete(userId);
            console.log(`✅ Utilisateur supprimé: ${user.email}`);
            return true;
        }
        return false;
    }
    getAllUsers() {
        return Array.from(this.authenticatedUsers.values());
    }
    getStats() {
        const users = this.getAllUsers();
        const totalServices = users.reduce((sum, user) => sum + user.connectedServices.length, 0);
        return {
            totalUsers: users.length,
            totalConnectedServices: totalServices,
            averageServicesPerUser: users.length > 0 ? (totalServices / users.length).toFixed(2) : 0
        };
    }
    cleanupInactiveUsers(daysInactive = 60) {
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
    getUsersMap() {
        return new Map(this.authenticatedUsers);
    }
    restoreUsers(users) {
        for (const user of users) {
            this.authenticatedUsers.set(user.userId, user);
        }
        console.log(`🔄 ${users.length} utilisateurs restaurés depuis Redis`);
    }
}
