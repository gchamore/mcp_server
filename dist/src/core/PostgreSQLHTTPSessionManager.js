import { v4 as uuidv4 } from 'uuid';
import { encrypt } from '../utils/encryption.js';
export class PostgreSQLHTTPSessionManager {
    database;
    SESSION_DURATION = 7 * 24 * 60 * 60 * 1000;
    sessionsCache = new Map();
    constructor(database) {
        this.database = database;
    }
    async createSession(userData) {
        const sessionId = this.generateSecureSessionId();
        const now = new Date();
        const expiresAt = new Date(now.getTime() + this.SESSION_DURATION);
        const session = {
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
            const encryptedSessionData = encrypt(JSON.stringify({
                sessionId,
                createdAt: now.toISOString(),
                lastAccess: now.toISOString(),
                expiresAt: expiresAt.toISOString()
            }));
            await this.database.query(`
                UPDATE users 
                SET updated_at = NOW()
                WHERE user_id = $1
            `, [userData.userId]);
            this.sessionsCache.set(sessionId, session);
            console.log(`✅ Session HTTP créée pour ${userData.email}: ${sessionId}`);
            return sessionId;
        }
        catch (error) {
            console.error('❌ Erreur création session HTTP:', error);
            throw error;
        }
    }
    async getSession(sessionId) {
        const cachedSession = this.sessionsCache.get(sessionId);
        if (cachedSession) {
            if (new Date() > cachedSession.expiresAt) {
                this.sessionsCache.delete(sessionId);
                return null;
            }
            cachedSession.lastAccess = new Date();
            return cachedSession;
        }
        return null;
    }
    async deleteSession(sessionId) {
        this.sessionsCache.delete(sessionId);
        console.log(`🗑️ Session HTTP supprimée: ${sessionId}`);
    }
    async extendSession(sessionId) {
        const session = this.sessionsCache.get(sessionId);
        if (!session) {
            return false;
        }
        const now = new Date();
        session.lastAccess = now;
        session.expiresAt = new Date(now.getTime() + this.SESSION_DURATION);
        return true;
    }
    async cleanupExpiredSessions() {
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
    async getUserSessions(userId) {
        const userSessions = [];
        for (const session of this.sessionsCache.values()) {
            if (session.userId === userId && new Date() <= session.expiresAt) {
                userSessions.push(session);
            }
        }
        return userSessions;
    }
    async revokeUserSessions(userId) {
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
    async getSessionStats() {
        const now = new Date();
        let activeSessions = 0;
        let expiredSessions = 0;
        for (const session of this.sessionsCache.values()) {
            if (now <= session.expiresAt) {
                activeSessions++;
            }
            else {
                expiredSessions++;
            }
        }
        return {
            totalSessions: this.sessionsCache.size,
            activeSessions,
            expiredSessions
        };
    }
    generateSecureSessionId() {
        return uuidv4();
    }
    clearCache() {
        this.sessionsCache.clear();
    }
}
