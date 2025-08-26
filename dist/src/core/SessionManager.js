import crypto from 'crypto';
import { redisPersistence } from '../utils/redis-persistence.js';
export class SessionManager {
    SESSION_DURATION = 7 * 24 * 60 * 60 * 1000;
    SESSION_PREFIX = 'session:';
    async createSession(userData) {
        const sessionId = this.generateSecureSessionId();
        const session = {
            sessionId,
            userId: userData.userId,
            email: userData.email,
            name: userData.name,
            picture: userData.picture,
            createdAt: new Date(),
            lastAccess: new Date(),
            expiresAt: new Date(Date.now() + this.SESSION_DURATION)
        };
        await this.saveSession(sessionId, session);
        console.log(`✅ Session créée pour ${userData.email}: ${sessionId.substring(0, 8)}...`);
        return sessionId;
    }
    async getSession(sessionId) {
        if (!sessionId)
            return null;
        try {
            const sessionData = await this.loadSession(sessionId);
            if (!sessionData)
                return null;
            if (sessionData.expiresAt < new Date()) {
                await this.deleteSession(sessionId);
                return null;
            }
            sessionData.lastAccess = new Date();
            await this.saveSession(sessionId, sessionData);
            return sessionData;
        }
        catch (error) {
            console.error('❌ Erreur récupération session:', error);
            return null;
        }
    }
    async deleteSession(sessionId) {
        if (!sessionId)
            return;
        try {
            await redisPersistence.del(`${this.SESSION_PREFIX}${sessionId}`);
            console.log(`🗑️ Session supprimée: ${sessionId.substring(0, 8)}...`);
        }
        catch (error) {
            console.error('❌ Erreur suppression session:', error);
        }
    }
    async extendSession(sessionId) {
        const session = await this.getSession(sessionId);
        if (!session)
            return false;
        session.expiresAt = new Date(Date.now() + this.SESSION_DURATION);
        await this.saveSession(sessionId, session);
        return true;
    }
    async cleanupExpiredSessions() {
        try {
            if (!redisPersistence.isAvailable)
                return 0;
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
        }
        catch (error) {
            console.error('❌ Erreur nettoyage sessions:', error);
            return 0;
        }
    }
    async getUserSessions(userId) {
        try {
            if (!redisPersistence.isAvailable)
                return [];
            const keys = await redisPersistence.keys(`${this.SESSION_PREFIX}*`);
            const userSessions = [];
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
        }
        catch (error) {
            console.error('❌ Erreur récupération sessions utilisateur:', error);
            return [];
        }
    }
    async revokeUserSessions(userId) {
        const sessions = await this.getUserSessions(userId);
        let revokedCount = 0;
        for (const session of sessions) {
            await this.deleteSession(session.sessionId);
            revokedCount++;
        }
        console.log(`🔒 ${revokedCount} sessions révoquées pour l'utilisateur ${userId}`);
        return revokedCount;
    }
    async getSessionStats() {
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
                    }
                    else {
                        expiredSessions++;
                    }
                }
            }
            return {
                totalSessions: keys.length,
                activeSessions,
                expiredSessions
            };
        }
        catch (error) {
            console.error('❌ Erreur statistiques sessions:', error);
            return { totalSessions: 0, activeSessions: 0, expiredSessions: 0 };
        }
    }
    generateSecureSessionId() {
        const randomBytes = crypto.randomBytes(32);
        const timestamp = Date.now().toString(36);
        return crypto.createHash('sha256')
            .update(randomBytes)
            .update(timestamp)
            .digest('hex');
    }
    async saveSession(sessionId, session) {
        const key = `${this.SESSION_PREFIX}${sessionId}`;
        const value = JSON.stringify(session);
        const ttlSeconds = Math.floor(this.SESSION_DURATION / 1000);
        await redisPersistence.set(key, value, ttlSeconds);
    }
    async loadSession(sessionId) {
        const key = `${this.SESSION_PREFIX}${sessionId}`;
        const sessionData = await redisPersistence.get(key);
        if (!sessionData)
            return null;
        const session = JSON.parse(sessionData);
        return {
            ...session,
            createdAt: new Date(session.createdAt),
            lastAccess: new Date(session.lastAccess),
            expiresAt: new Date(session.expiresAt)
        };
    }
}
