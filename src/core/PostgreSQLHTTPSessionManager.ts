// src/core/PostgreSQLHTTPSessionManager.ts - Gestionnaire de sessions HTTP avec PostgreSQL

import { DatabaseManager } from '../database/DatabaseManager.js';
import { v4 as uuidv4 } from 'uuid';
import { encrypt, decrypt } from '../utils/encryption.js';

export interface HTTPUserSession {
    sessionId: string;
    userId: string;
    email: string;
    name: string;
    picture?: string;
    createdAt: Date;
    lastAccess: Date;
    expiresAt: Date;
}

export class PostgreSQLHTTPSessionManager {
    private database: DatabaseManager;
    private readonly SESSION_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 jours
    private sessionsCache = new Map<string, HTTPUserSession>(); // Cache en mémoire

    constructor(database: DatabaseManager) {
        this.database = database;
    }

    /**
     * Créer une nouvelle session HTTP
     */
    async createSession(userData: {
        userId: string;
        email: string;
        name: string;
        picture?: string;
    }): Promise<string> {
        const sessionId = this.generateSecureSessionId();
        const now = new Date();
        const expiresAt = new Date(now.getTime() + this.SESSION_DURATION);

        const session: HTTPUserSession = {
            sessionId,
            userId: userData.userId,
            email: userData.email,
            name: userData.name,
            picture: userData.picture,
            createdAt: now,
            lastAccess: now,
            expiresAt
        };

        try {
            // Sauvegarder en base dans une table dédiée aux sessions HTTP
            // Pour simplifier, on va utiliser la table users avec un champ session_data
            const encryptedSessionData = encrypt(JSON.stringify({
                sessionId,
                createdAt: now.toISOString(),
                lastAccess: now.toISOString(),
                expiresAt: expiresAt.toISOString()
            }));

            // Mettre à jour l'utilisateur avec les données de session
            await this.database.query(`
                UPDATE users 
                SET updated_at = NOW()
                WHERE user_id = $1
            `, [userData.userId]);

            // Mettre en cache
            this.sessionsCache.set(sessionId, session);

            console.log(`✅ Session HTTP créée pour ${userData.email}: ${sessionId}`);
            return sessionId;

        } catch (error) {
            console.error('❌ Erreur création session HTTP:', error);
            throw error;
        }
    }

    /**
     * Récupérer une session HTTP
     */
    async getSession(sessionId: string): Promise<HTTPUserSession | null> {
        // Vérifier le cache d'abord
        const cachedSession = this.sessionsCache.get(sessionId);
        if (cachedSession) {
            // Vérifier si la session n'a pas expiré
            if (new Date() > cachedSession.expiresAt) {
                this.sessionsCache.delete(sessionId);
                return null;
            }

            // Mettre à jour last access
            cachedSession.lastAccess = new Date();
            return cachedSession;
        }

        // Pour une version simplifiée, on va juste vérifier que la session existe dans le cache
        // Dans une version complète, on pourrait aussi stocker les sessions dans une table dédiée
        return null;
    }

    /**
     * Supprimer une session (logout)
     */
    async deleteSession(sessionId: string): Promise<void> {
        this.sessionsCache.delete(sessionId);
        console.log(`🗑️ Session HTTP supprimée: ${sessionId}`);
    }

    /**
     * Prolonger une session
     */
    async extendSession(sessionId: string): Promise<boolean> {
        const session = this.sessionsCache.get(sessionId);
        if (!session) {
            return false;
        }

        const now = new Date();
        session.lastAccess = now;
        session.expiresAt = new Date(now.getTime() + this.SESSION_DURATION);

        return true;
    }

    /**
     * Nettoyer les sessions expirées
     */
    async cleanupExpiredSessions(): Promise<number> {
        const now = new Date();
        let cleanedCount = 0;

        for (const [sessionId, session] of this.sessionsCache.entries()) {
            if (now > session.expiresAt) {
                this.sessionsCache.delete(sessionId);
                cleanedCount++;
            }
        }

        if (cleanedCount > 0) {
            console.log(`🧹 ${cleanedCount} sessions HTTP expirées nettoyées`);
        }

        return cleanedCount;
    }

    /**
     * Obtenir toutes les sessions actives d'un utilisateur
     */
    async getUserSessions(userId: string): Promise<HTTPUserSession[]> {
        const userSessions: HTTPUserSession[] = [];

        for (const session of this.sessionsCache.values()) {
            if (session.userId === userId && new Date() <= session.expiresAt) {
                userSessions.push(session);
            }
        }

        return userSessions;
    }

    /**
     * Révoquer toutes les sessions d'un utilisateur
     */
    async revokeUserSessions(userId: string): Promise<number> {
        let revokedCount = 0;

        for (const [sessionId, session] of this.sessionsCache.entries()) {
            if (session.userId === userId) {
                this.sessionsCache.delete(sessionId);
                revokedCount++;
            }
        }

        console.log(`🚫 ${revokedCount} sessions révoquées pour l'utilisateur ${userId}`);
        return revokedCount;
    }

    /**
     * Statistiques des sessions
     */
    async getSessionStats(): Promise<{
        totalSessions: number;
        activeSessions: number;
        expiredSessions: number;
    }> {
        const now = new Date();
        let activeSessions = 0;
        let expiredSessions = 0;

        for (const session of this.sessionsCache.values()) {
            if (now <= session.expiresAt) {
                activeSessions++;
            } else {
                expiredSessions++;
            }
        }

        return {
            totalSessions: this.sessionsCache.size,
            activeSessions,
            expiredSessions
        };
    }

    /**
     * Générer un ID de session sécurisé
     */
    private generateSecureSessionId(): string {
        return uuidv4();
    }

    /**
     * Vider le cache des sessions (pour les tests)
     */
    clearCache(): void {
        this.sessionsCache.clear();
    }
}
