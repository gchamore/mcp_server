// src/core/SessionManager.ts - Gestionnaire de sessions HTTP sécurisées

import crypto from 'crypto';
import { redisPersistence } from '../utils/redis-persistence.js';

export interface UserSession {
    sessionId: string;
    userId: string;
    email: string;
    name: string;
    picture?: string;
    createdAt: Date;
    lastAccess: Date;
    expiresAt: Date;
}

export class SessionManager {
    private readonly SESSION_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 jours
    private readonly SESSION_PREFIX = 'session:';

    // Créer une nouvelle session
    async createSession(userData: {
        userId: string;
        email: string;
        name: string;
        picture?: string;
    }): Promise<string> {
        // Générer un sessionId sécurisé
        const sessionId = this.generateSecureSessionId();
        
        const session: UserSession = {
            sessionId,
            userId: userData.userId,
            email: userData.email,
            name: userData.name,
            picture: userData.picture,
            createdAt: new Date(),
            lastAccess: new Date(),
            expiresAt: new Date(Date.now() + this.SESSION_DURATION)
        };

        // Sauvegarder en Redis avec expiration
        await this.saveSession(sessionId, session);
        
        console.log(`✅ Session créée pour ${userData.email}: ${sessionId.substring(0, 8)}...`);
        return sessionId;
    }

    // Récupérer une session
    async getSession(sessionId: string): Promise<UserSession | null> {
        if (!sessionId) return null;

        try {
            const sessionData = await this.loadSession(sessionId);
            if (!sessionData) return null;

            // Vérifier l'expiration
            if (sessionData.expiresAt < new Date()) {
                await this.deleteSession(sessionId);
                return null;
            }

            // Mettre à jour le lastAccess
            sessionData.lastAccess = new Date();
            await this.saveSession(sessionId, sessionData);

            return sessionData;
        } catch (error) {
            console.error('❌ Erreur récupération session:', error);
            return null;
        }
    }

    // Supprimer une session (logout)
    async deleteSession(sessionId: string): Promise<void> {
        if (!sessionId) return;

        try {
            await redisPersistence.del(`${this.SESSION_PREFIX}${sessionId}`);
            console.log(`🗑️ Session supprimée: ${sessionId.substring(0, 8)}...`);
        } catch (error) {
            console.error('❌ Erreur suppression session:', error);
        }
    }

    // Prolonger une session
    async extendSession(sessionId: string): Promise<boolean> {
        const session = await this.getSession(sessionId);
        if (!session) return false;

        session.expiresAt = new Date(Date.now() + this.SESSION_DURATION);
        await this.saveSession(sessionId, session);
        return true;
    }

    // Nettoyer les sessions expirées
    async cleanupExpiredSessions(): Promise<number> {
        try {
            if (!redisPersistence.isAvailable) return 0;

            const keys = await redisPersistence.keys(`${this.SESSION_PREFIX}*`);
            let deletedCount = 0;

            for (const key of keys) {
                const sessionData = await redisPersistence.get(key);
                if (sessionData) {
                    const session = JSON.parse(sessionData);
                    if (new Date(session.expiresAt) < new Date()) {
                        await redisPersistence.del(key);
                        deletedCount++;
                    }
                }
            }

            if (deletedCount > 0) {
                console.log(`🧹 ${deletedCount} sessions expirées nettoyées`);
            }
            return deletedCount;
        } catch (error) {
            console.error('❌ Erreur nettoyage sessions:', error);
            return 0;
        }
    }

    // Obtenir toutes les sessions actives d'un utilisateur
    async getUserSessions(userId: string): Promise<UserSession[]> {
        try {
            if (!redisPersistence.isAvailable) return [];

            const keys = await redisPersistence.keys(`${this.SESSION_PREFIX}*`);
            const userSessions: UserSession[] = [];

            for (const key of keys) {
                const sessionData = await redisPersistence.get(key);
                if (sessionData) {
                    const session = JSON.parse(sessionData);
                    if (session.userId === userId && new Date(session.expiresAt) > new Date()) {
                        userSessions.push({
                            ...session,
                            createdAt: new Date(session.createdAt),
                            lastAccess: new Date(session.lastAccess),
                            expiresAt: new Date(session.expiresAt)
                        });
                    }
                }
            }

            return userSessions;
        } catch (error) {
            console.error('❌ Erreur récupération sessions utilisateur:', error);
            return [];
        }
    }

    // Révoquer toutes les sessions d'un utilisateur
    async revokeUserSessions(userId: string): Promise<number> {
        const sessions = await this.getUserSessions(userId);
        let revokedCount = 0;

        for (const session of sessions) {
            await this.deleteSession(session.sessionId);
            revokedCount++;
        }

        console.log(`🔒 ${revokedCount} sessions révoquées pour l'utilisateur ${userId}`);
        return revokedCount;
    }

    // Statistiques des sessions
    async getSessionStats(): Promise<{
        totalSessions: number;
        activeSessions: number;
        expiredSessions: number;
    }> {
        try {
            if (!redisPersistence.isAvailable) {
                return { totalSessions: 0, activeSessions: 0, expiredSessions: 0 };
            }

            const keys = await redisPersistence.keys(`${this.SESSION_PREFIX}*`);
            let activeSessions = 0;
            let expiredSessions = 0;

            for (const key of keys) {
                const sessionData = await redisPersistence.get(key);
                if (sessionData) {
                    const session = JSON.parse(sessionData);
                    if (new Date(session.expiresAt) > new Date()) {
                        activeSessions++;
                    } else {
                        expiredSessions++;
                    }
                }
            }

            return {
                totalSessions: keys.length,
                activeSessions,
                expiredSessions
            };
        } catch (error) {
            console.error('❌ Erreur statistiques sessions:', error);
            return { totalSessions: 0, activeSessions: 0, expiredSessions: 0 };
        }
    }

    // Méthodes privées
    private generateSecureSessionId(): string {
        // Générer 32 bytes aléatoires + timestamp pour unicité
        const randomBytes = crypto.randomBytes(32);
        const timestamp = Date.now().toString(36);
        return crypto.createHash('sha256')
            .update(randomBytes)
            .update(timestamp)
            .digest('hex');
    }

    private async saveSession(sessionId: string, session: UserSession): Promise<void> {
        const key = `${this.SESSION_PREFIX}${sessionId}`;
        const value = JSON.stringify(session);
        const ttlSeconds = Math.floor(this.SESSION_DURATION / 1000);
        
        await redisPersistence.set(key, value, ttlSeconds);
    }

    private async loadSession(sessionId: string): Promise<UserSession | null> {
        const key = `${this.SESSION_PREFIX}${sessionId}`;
        const sessionData = await redisPersistence.get(key);
        
        if (!sessionData) return null;

        const session = JSON.parse(sessionData);
        return {
            ...session,
            createdAt: new Date(session.createdAt),
            lastAccess: new Date(session.lastAccess),
            expiresAt: new Date(session.expiresAt)
        };
    }
}
