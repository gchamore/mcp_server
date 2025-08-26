import Redis from 'ioredis';
export class RedisPersistence {
    redis;
    isRedisAvailable = false;
    constructor() {
        const redisUrl = process.env.REDIS_URL;
        if (!redisUrl) {
            console.log('🔶 REDIS_URL non configuré - fonctionnement sans persistance Redis');
            this.redis = new Redis({ lazyConnect: true });
        }
        else {
            console.log('🔗 Configuration Redis avec URL:', redisUrl.replace(/:([^:@]{8})[^:@]*@/, ':$1***@'));
            this.redis = new Redis(redisUrl, {
                maxRetriesPerRequest: 3,
                enableReadyCheck: false,
                lazyConnect: true,
                connectTimeout: 10000,
                commandTimeout: 5000
            });
        }
        let errorCount = 0;
        this.redis.on('error', (error) => {
            errorCount++;
            if (errorCount <= 3) {
                console.error(`❌ Erreur Redis (${errorCount}/3):`, error.message);
                if (errorCount === 3) {
                    console.log('🔇 Messages d\'erreur Redis supprimés (trop nombreux)');
                }
            }
            this.isRedisAvailable = false;
        });
        this.redis.on('connect', () => {
            console.log('🟡 Connexion Redis en cours...');
        });
        this.redis.on('ready', () => {
            console.log('✅ Redis connecté et prêt');
            this.isRedisAvailable = true;
            errorCount = 0;
        });
        this.redis.on('close', () => {
            console.log('🔴 Connexion Redis fermée');
            this.isRedisAvailable = false;
        });
    }
    async initialize() {
        const redisUrl = process.env.REDIS_URL;
        if (redisUrl) {
            try {
                await this.redis.ping();
                this.isRedisAvailable = true;
                console.log('✅ Redis initialisé avec succès');
            }
            catch (error) {
                console.log('❌ Échec connexion Redis principale, test URL publique...');
                await this.tryPublicRedisUrl();
            }
        }
        try {
            await this.redis.connect();
        }
        catch (error) {
            console.log('⚠️ Redis indisponible, fonctionnement en mode local uniquement');
        }
    }
    async tryPublicRedisUrl() {
        try {
            const publicHost = process.env.REDISHOST;
            const publicPort = process.env.REDISPORT;
            const publicPassword = process.env.REDISPASSWORD;
            if (publicHost && publicPort && publicPassword) {
                const publicUrl = `redis://:${publicPassword}@${publicHost}:${publicPort}`;
                console.log('🔄 Test connexion Redis publique...');
                this.redis = new Redis(publicUrl, {
                    maxRetriesPerRequest: 3,
                    enableReadyCheck: false,
                    lazyConnect: true
                });
                await this.redis.ping();
                this.isRedisAvailable = true;
                console.log('✅ Redis publique connecté');
            }
        }
        catch (error) {
            console.log('❌ Échec connexion Redis publique aussi');
            this.isRedisAvailable = false;
        }
    }
    async healthCheck() {
        if (!this.isRedisAvailable)
            return false;
        try {
            const result = await this.redis.ping();
            return result === 'PONG';
        }
        catch (error) {
            this.isRedisAvailable = false;
            return false;
        }
    }
    async saveAuthenticatedUsers(users) {
        if (!this.isRedisAvailable)
            return;
        try {
            const pipeline = this.redis.pipeline();
            const existingKeys = await this.redis.keys('user:auth:*');
            if (existingKeys.length > 0) {
                pipeline.del(...existingKeys);
            }
            for (const [userId, user] of users) {
                const userData = {
                    userId: user.userId,
                    email: user.email,
                    name: user.name,
                    picture: user.picture,
                    googleRefreshToken: user.googleRefreshToken,
                    createdAt: user.createdAt.toISOString(),
                    lastLoginAt: user.lastLoginAt.toISOString(),
                    connectedServices: user.connectedServices
                };
                pipeline.setex(`user:auth:${userId}`, 86400 * 30, JSON.stringify(userData));
            }
            await pipeline.exec();
            console.log(`💾 ${users.size} utilisateurs authentifiés sauvegardés dans Redis`);
        }
        catch (error) {
            console.error('❌ Erreur sauvegarde utilisateurs Redis:', error);
        }
    }
    async loadAuthenticatedUsers() {
        if (!this.isRedisAvailable)
            return [];
        try {
            const keys = await this.redis.keys('user:auth:*');
            if (keys.length === 0)
                return [];
            const pipeline = this.redis.pipeline();
            keys.forEach(key => pipeline.get(key));
            const results = await pipeline.exec();
            const users = [];
            if (results) {
                for (const result of results) {
                    if (result && result[1]) {
                        try {
                            const userData = JSON.parse(result[1]);
                            users.push(userData);
                        }
                        catch (parseError) {
                            console.error('❌ Erreur parsing utilisateur Redis:', parseError);
                        }
                    }
                }
            }
            console.log(`🔄 ${users.length} utilisateurs authentifiés chargés depuis Redis`);
            return users;
        }
        catch (error) {
            console.error('❌ Erreur chargement utilisateurs Redis:', error);
            return [];
        }
    }
    async saveUserSessions(userSessions) {
        try {
            if (!(await this.healthCheck())) {
                return;
            }
            const pipeline = this.redis.pipeline();
            for (const [userId, session] of userSessions) {
                const persistentSession = {
                    userId: session.userId,
                    createdAt: session.createdAt.toISOString(),
                    lastAccessed: session.lastAccessed.toISOString(),
                    services: {}
                };
                if (session.authenticatedUser) {
                    persistentSession.authenticatedUser = {
                        userId: session.authenticatedUser.userId,
                        email: session.authenticatedUser.email,
                        name: session.authenticatedUser.name,
                        picture: session.authenticatedUser.picture,
                        googleRefreshToken: session.authenticatedUser.googleRefreshToken,
                        createdAt: session.authenticatedUser.createdAt.toISOString(),
                        lastLoginAt: session.authenticatedUser.lastLoginAt.toISOString(),
                        connectedServices: session.authenticatedUser.connectedServices
                    };
                }
                if (session.services.gmail) {
                    persistentSession.services.gmail = session.services.gmail.userId;
                }
                if (session.services.axonaut) {
                    persistentSession.services.axonaut = session.services.axonaut.userId;
                }
                pipeline.hset(`user:${userId}`, 'data', JSON.stringify(persistentSession));
            }
            await pipeline.exec();
            console.log(`💾 ${userSessions.size} sessions utilisateur sauvegardées en Redis`);
        }
        catch (error) {
            console.error('❌ Erreur sauvegarde sessions utilisateur:', error instanceof Error ? error.message : String(error));
            this.isRedisAvailable = false;
        }
    }
    async saveGmailSessions(gmailSessions) {
        try {
            if (!(await this.healthCheck())) {
                return;
            }
            const pipeline = this.redis.pipeline();
            for (const [userId, session] of gmailSessions) {
                const persistentSession = {
                    serviceName: 'gmail',
                    userId: session.userId,
                    userEmail: session.userEmail,
                    isAuthenticated: session.isAuthenticated,
                    createdAt: session.createdAt.toISOString(),
                    lastAccessed: session.lastAccessed.toISOString(),
                    encryptedRefreshToken: session.encryptedRefreshToken,
                    encryptedAccessToken: session.encryptedAccessToken
                };
                pipeline.hset(`gmail:${userId}`, 'data', JSON.stringify(persistentSession));
            }
            await pipeline.exec();
            console.log(`💾 ${gmailSessions.size} sessions Gmail sauvegardées en Redis`);
        }
        catch (error) {
            console.error('❌ Erreur sauvegarde sessions Gmail:', error instanceof Error ? error.message : String(error));
            this.isRedisAvailable = false;
        }
    }
    async saveAxonautSessions(axonautSessions) {
        try {
            if (!(await this.healthCheck())) {
                return;
            }
            const pipeline = this.redis.pipeline();
            for (const [userId, session] of axonautSessions) {
                const persistentSession = {
                    serviceName: 'axonaut',
                    userId: session.userId,
                    userEmail: session.userEmail,
                    isAuthenticated: session.isAuthenticated,
                    createdAt: session.createdAt.toISOString(),
                    lastAccessed: session.lastAccessed.toISOString(),
                    encryptedApiKey: session.encryptedApiKey,
                    baseUrl: session.baseUrl
                };
                pipeline.hset(`axonaut:${userId}`, 'data', JSON.stringify(persistentSession));
            }
            await pipeline.exec();
            console.log(`💾 ${axonautSessions.size} sessions Axonaut sauvegardées en Redis`);
        }
        catch (error) {
            console.error('❌ Erreur sauvegarde sessions Axonaut:', error instanceof Error ? error.message : String(error));
            this.isRedisAvailable = false;
        }
    }
    async loadUserSessions() {
        try {
            if (!(await this.healthCheck())) {
                return [];
            }
            const keys = await this.redis.keys('user:*');
            if (keys.length === 0)
                return [];
            const pipeline = this.redis.pipeline();
            keys.forEach(key => pipeline.hget(key, 'data'));
            const results = await pipeline.exec();
            const sessions = [];
            if (results) {
                for (const result of results) {
                    if (result && result[1]) {
                        try {
                            const sessionData = JSON.parse(result[1]);
                            sessions.push(sessionData);
                        }
                        catch (parseError) {
                            console.error('❌ Erreur parsing session utilisateur Redis:', parseError);
                        }
                    }
                }
            }
            console.log(`🔄 ${sessions.length} sessions utilisateur chargées depuis Redis`);
            return sessions;
        }
        catch (error) {
            console.error('❌ Erreur chargement sessions utilisateur Redis:', error instanceof Error ? error.message : String(error));
            return [];
        }
    }
    async loadGmailSessions() {
        try {
            if (!(await this.healthCheck())) {
                return [];
            }
            const keys = await this.redis.keys('gmail:*');
            if (keys.length === 0)
                return [];
            const pipeline = this.redis.pipeline();
            keys.forEach(key => pipeline.hget(key, 'data'));
            const results = await pipeline.exec();
            const sessions = [];
            if (results) {
                for (const result of results) {
                    if (result && result[1]) {
                        try {
                            const sessionData = JSON.parse(result[1]);
                            sessions.push(sessionData);
                        }
                        catch (parseError) {
                            console.error('❌ Erreur parsing session Gmail Redis:', parseError);
                        }
                    }
                }
            }
            console.log(`🔄 ${sessions.length} sessions Gmail chargées depuis Redis`);
            return sessions;
        }
        catch (error) {
            console.error('❌ Erreur chargement sessions Gmail Redis:', error instanceof Error ? error.message : String(error));
            return [];
        }
    }
    async loadAxonautSessions() {
        try {
            if (!(await this.healthCheck())) {
                return [];
            }
            const keys = await this.redis.keys('axonaut:*');
            if (keys.length === 0)
                return [];
            const pipeline = this.redis.pipeline();
            keys.forEach(key => pipeline.hget(key, 'data'));
            const results = await pipeline.exec();
            const sessions = [];
            if (results) {
                for (const result of results) {
                    if (result && result[1]) {
                        try {
                            const sessionData = JSON.parse(result[1]);
                            sessions.push(sessionData);
                        }
                        catch (parseError) {
                            console.error('❌ Erreur parsing session Axonaut Redis:', parseError);
                        }
                    }
                }
            }
            console.log(`🔄 ${sessions.length} sessions Axonaut chargées depuis Redis`);
            return sessions;
        }
        catch (error) {
            console.error('❌ Erreur chargement sessions Axonaut Redis:', error instanceof Error ? error.message : String(error));
            return [];
        }
    }
    async saveAllSessions(userSessions, gmailSessions, axonautSessions, authenticatedUsers) {
        if (!(await this.healthCheck())) {
            console.log('⚠️ Redis indisponible, sauvegarde ignorée');
            return;
        }
        console.log('💾 Début sauvegarde complète Redis...');
        if (authenticatedUsers) {
            await this.saveAuthenticatedUsers(authenticatedUsers);
        }
        await Promise.all([
            this.saveUserSessions(userSessions),
            this.saveGmailSessions(gmailSessions),
            this.saveAxonautSessions(axonautSessions)
        ]);
        console.log('✅ Sauvegarde complète Redis terminée');
    }
    async deleteUserSession(userId) {
        if (!(await this.healthCheck()))
            return;
        try {
            const pipeline = this.redis.pipeline();
            pipeline.del(`user:${userId}`);
            pipeline.del(`user:auth:${userId}`);
            pipeline.del(`gmail:${userId}`);
            pipeline.del(`axonaut:${userId}`);
            await pipeline.exec();
            console.log(`🗑️ Session utilisateur ${userId} supprimée de Redis`);
        }
        catch (error) {
            console.error('❌ Erreur suppression session Redis:', error);
        }
    }
    async cleanupExpiredSessions(daysOld = 30) {
        if (!(await this.healthCheck()))
            return;
        try {
            const cutoffTimestamp = Date.now() - (daysOld * 24 * 60 * 60 * 1000);
            const keys = await this.redis.keys('user:*');
            let deletedCount = 0;
            for (const key of keys) {
                try {
                    const sessionData = await this.redis.hget(key, 'data');
                    if (sessionData) {
                        const session = JSON.parse(sessionData);
                        const lastAccessed = new Date(session.lastAccessed).getTime();
                        if (lastAccessed < cutoffTimestamp) {
                            await this.redis.del(key);
                            deletedCount++;
                        }
                    }
                }
                catch (parseError) {
                    console.error('❌ Erreur parsing session pour nettoyage:', parseError);
                    await this.redis.del(key);
                    deletedCount++;
                }
            }
            console.log(`🧹 ${deletedCount} sessions expirées supprimées de Redis`);
        }
        catch (error) {
            console.error('❌ Erreur nettoyage sessions Redis:', error);
        }
    }
    async getStats() {
        if (!(await this.healthCheck())) {
            return { redis: false, message: 'Redis indisponible' };
        }
        try {
            const info = await this.redis.info('memory');
            const keyPattern = await this.redis.keys('*');
            const stats = {
                redis: true,
                totalKeys: keyPattern.length,
                memoryInfo: info,
                userSessions: (await this.redis.keys('user:*')).length,
                gmailSessions: (await this.redis.keys('gmail:*')).length,
                axonautSessions: (await this.redis.keys('axonaut:*')).length,
                authenticatedUsers: (await this.redis.keys('user:auth:*')).length
            };
            return stats;
        }
        catch (error) {
            return { redis: false, error: error instanceof Error ? error.message : String(error) };
        }
    }
    async disconnect() {
        try {
            await this.redis.quit();
            console.log('👋 Connexion Redis fermée proprement');
        }
        catch (error) {
            console.error('❌ Erreur fermeture Redis:', error);
        }
    }
}
export const redisPersistence = new RedisPersistence();
