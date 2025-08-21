import Redis from 'ioredis';
export class RedisPersistence {
    redis;
    isRedisAvailable = false;
    constructor() {
        const redisUrl = process.env.REDIS_URL;
        if (!redisUrl) {
            console.warn('⚠️ REDIS_URL non configurée, utilisation de Redis local par défaut');
            this.redis = new Redis({
                host: 'localhost',
                port: 6379,
                maxRetriesPerRequest: 1,
                lazyConnect: true,
                enableOfflineQueue: true
            });
        }
        else {
            console.log('🔗 Configuration Redis Railway détectée');
            let cleanRedisUrl = redisUrl.trim();
            if (!cleanRedisUrl.startsWith('redis://') && !cleanRedisUrl.startsWith('rediss://')) {
                console.warn('⚠️ URL Redis malformée, tentative de correction...');
                if (cleanRedisUrl.startsWith('//')) {
                    cleanRedisUrl = 'redis:' + cleanRedisUrl;
                }
                else if (!cleanRedisUrl.includes('://')) {
                    cleanRedisUrl = 'redis://' + cleanRedisUrl;
                }
            }
            console.log('🔍 Redis URL configurée:', cleanRedisUrl.replace(/:[^:]*@/, ':***@'));
            if (cleanRedisUrl.includes('railway.internal')) {
                console.log('🚀 Utilisation configuration Railway interne');
                this.redis = new Redis(cleanRedisUrl, {
                    maxRetriesPerRequest: 3,
                    lazyConnect: true,
                    enableOfflineQueue: true,
                    connectTimeout: 15000,
                    commandTimeout: 10000,
                    family: 4
                });
            }
            else {
                console.log('🌐 Utilisation configuration Railway publique');
                this.redis = new Redis(cleanRedisUrl, {
                    maxRetriesPerRequest: 3,
                    lazyConnect: true,
                    enableOfflineQueue: true,
                    connectTimeout: 10000,
                    commandTimeout: 5000,
                    family: 4
                });
            }
        }
        let errorCount = 0;
        this.redis.on('error', (error) => {
            errorCount++;
            if (errorCount <= 3) {
                console.error('❌ Erreur Redis:', error.message);
                if (errorCount === 3) {
                    console.warn('🔇 Messages d\'erreur Redis supprimés (trop nombreux)');
                }
            }
            this.isRedisAvailable = false;
        });
        this.redis.on('connect', () => {
            console.log('✅ Connexion Redis établie');
            this.isRedisAvailable = true;
        });
        this.redis.on('ready', () => {
            this.isRedisAvailable = true;
        });
        this.redis.on('close', () => {
            this.isRedisAvailable = false;
        });
    }
    async initialize() {
        const redisUrl = process.env.REDIS_URL;
        if (redisUrl) {
            console.log('🔍 URL Redis detectée:', redisUrl.replace(/:[^:]*@/, ':***@'));
            try {
                const url = new URL(redisUrl);
                console.log('✅ URL Redis valide:', url.protocol, url.hostname, url.port);
            }
            catch (urlError) {
                console.warn('⚠️ URL Redis invalide:', urlError);
                this.isRedisAvailable = false;
                return;
            }
        }
        console.log('� Redis configuré, connexion en cours...');
        console.log('📝 Les event listeners gèrent la connexion automatiquement');
    }
    async tryPublicRedisUrl() {
        try {
            const redisUrl = process.env.REDIS_URL;
            if (redisUrl && redisUrl.includes('redis.railway.internal')) {
                console.log('🔧 Tentative avec configuration Redis alternative...');
                const urlVariants = [
                    redisUrl.replace('redis.railway.internal', 'redis.railway.app'),
                    redisUrl.replace('redis.railway.internal', 'redis-production.up.railway.app'),
                    redisUrl.replace('redis://', 'rediss://'),
                ];
                for (const testUrl of urlVariants) {
                    console.log('🔄 Test avec:', testUrl.replace(/:[^:]*@/, ':***@'));
                    try {
                        const testRedis = new Redis(testUrl, {
                            maxRetriesPerRequest: 1,
                            lazyConnect: true,
                            connectTimeout: 5000,
                            commandTimeout: 3000
                        });
                        await testRedis.ping();
                        console.log('✅ Connexion réussie, reconfiguration...');
                        await this.redis.disconnect();
                        this.redis = testRedis;
                        this.isRedisAvailable = true;
                        return;
                    }
                    catch (error) {
                        console.log('❌ Échec avec cette URL');
                        continue;
                    }
                }
            }
        }
        catch (error) {
            console.warn('❌ Toutes les variantes Redis ont échoué');
        }
        console.warn('📝 Le serveur fonctionnera en mode sans persistance');
        this.isRedisAvailable = false;
    }
    async healthCheck() {
        if (!this.isRedisAvailable) {
            return false;
        }
        try {
            const result = await this.redis.ping();
            const isHealthy = result === 'PONG';
            this.isRedisAvailable = isHealthy;
            return isHealthy;
        }
        catch (error) {
            this.isRedisAvailable = false;
            return false;
        }
    }
    async saveUserSessions(userSessions) {
        try {
            if (!this.isRedisAvailable) {
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
            console.error('❌ Erreur sauvegarde sessions utilisateur:', error);
        }
    }
    async saveGmailSessions(gmailSessions) {
        try {
            if (!this.isRedisAvailable) {
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
            console.log(`📧 ${gmailSessions.size} sessions Gmail sauvegardées en Redis`);
        }
        catch (error) {
            console.error('❌ Erreur sauvegarde sessions Gmail:', error);
        }
    }
    async saveAxonautSessions(axonautSessions) {
        try {
            if (!this.isRedisAvailable) {
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
            console.log(`📊 ${axonautSessions.size} sessions Axonaut sauvegardées en Redis`);
        }
        catch (error) {
            console.error('❌ Erreur sauvegarde sessions Axonaut:', error);
        }
    }
    async loadUserSessions() {
        try {
            if (!this.isRedisAvailable) {
                return [];
            }
            const keys = await this.redis.keys('user:*');
            const sessions = [];
            if (keys.length > 0) {
                const pipeline = this.redis.pipeline();
                for (const key of keys) {
                    pipeline.hget(key, 'data');
                }
                const results = await pipeline.exec();
                if (results) {
                    for (const result of results) {
                        if (result && result[1]) {
                            sessions.push(JSON.parse(result[1]));
                        }
                    }
                }
            }
            console.log(`📂 ${sessions.length} sessions utilisateur chargées depuis Redis`);
            return sessions;
        }
        catch (error) {
            console.error('❌ Erreur chargement sessions utilisateur:', error);
            return [];
        }
    }
    async loadGmailSessions() {
        try {
            if (!this.isRedisAvailable) {
                return [];
            }
            const keys = await this.redis.keys('gmail:*');
            const sessions = [];
            if (keys.length > 0) {
                const pipeline = this.redis.pipeline();
                for (const key of keys) {
                    pipeline.hget(key, 'data');
                }
                const results = await pipeline.exec();
                if (results) {
                    for (const result of results) {
                        if (result && result[1]) {
                            sessions.push(JSON.parse(result[1]));
                        }
                    }
                }
            }
            console.log(`📧 ${sessions.length} sessions Gmail chargées depuis Redis`);
            return sessions;
        }
        catch (error) {
            console.error('❌ Erreur chargement sessions Gmail:', error);
            return [];
        }
    }
    async loadAxonautSessions() {
        try {
            if (!this.isRedisAvailable) {
                return [];
            }
            const keys = await this.redis.keys('axonaut:*');
            const sessions = [];
            if (keys.length > 0) {
                const pipeline = this.redis.pipeline();
                for (const key of keys) {
                    pipeline.hget(key, 'data');
                }
                const results = await pipeline.exec();
                if (results) {
                    for (const result of results) {
                        if (result && result[1]) {
                            sessions.push(JSON.parse(result[1]));
                        }
                    }
                }
            }
            console.log(`📊 ${sessions.length} sessions Axonaut chargées depuis Redis`);
            return sessions;
        }
        catch (error) {
            console.error('❌ Erreur chargement sessions Axonaut:', error);
            return [];
        }
    }
    async saveAllSessions(userSessions, gmailSessions, axonautSessions) {
        if (!this.isRedisAvailable) {
            console.log('💾 Sauvegarde Redis ignorée (Redis non disponible)');
            return;
        }
        console.log('💾 Sauvegarde globale des sessions Redis...');
        await Promise.all([
            this.saveUserSessions(userSessions),
            this.saveGmailSessions(gmailSessions),
            this.saveAxonautSessions(axonautSessions)
        ]);
        console.log('✅ Sauvegarde globale Redis terminée');
    }
    async deleteUserSession(userId) {
        try {
            await this.redis.del(`user:${userId}`, `gmail:${userId}`, `axonaut:${userId}`);
            console.log(`🗑️ Session ${userId} supprimée de Redis`);
        }
        catch (error) {
            console.error('❌ Erreur suppression session Redis:', error);
        }
    }
    async cleanupExpiredSessions(daysOld = 30) {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - daysOld);
            const userKeys = await this.redis.keys('user:*');
            let deletedCount = 0;
            for (const key of userKeys) {
                const data = await this.redis.hget(key, 'data');
                if (data) {
                    const session = JSON.parse(data);
                    const lastAccessed = new Date(session.lastAccessed);
                    if (lastAccessed < cutoffDate) {
                        const userId = session.userId;
                        await this.deleteUserSession(userId);
                        deletedCount++;
                    }
                }
            }
            console.log(`🧹 ${deletedCount} sessions expirées supprimées (plus de ${daysOld} jours)`);
        }
        catch (error) {
            console.error('❌ Erreur nettoyage sessions expirées:', error);
        }
    }
    async getStats() {
        try {
            const userKeys = await this.redis.keys('user:*');
            const gmailKeys = await this.redis.keys('gmail:*');
            const axonautKeys = await this.redis.keys('axonaut:*');
            return {
                userSessions: userKeys.length,
                gmailSessions: gmailKeys.length,
                axonautSessions: axonautKeys.length,
                totalKeys: userKeys.length + gmailKeys.length + axonautKeys.length
            };
        }
        catch (error) {
            console.error('❌ Erreur statistiques Redis:', error);
            return { error: 'Impossible de récupérer les statistiques' };
        }
    }
    async disconnect() {
        await this.redis.disconnect();
        console.log('🔌 Connexion Redis fermée');
    }
}
export const redisPersistence = new RedisPersistence();
