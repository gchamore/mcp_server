import Redis from 'ioredis';

// Interface pour les données à persister (identiques à persistence.ts)
export interface PersistentUserSession {
    userId: string;
    createdAt: string;
    lastAccessed: string;
    services: {
        gmail?: string;
        axonaut?: string;
    };
}

export interface PersistentGmailSession {
    serviceName: 'gmail';
    userId: string;
    userEmail: string;
    isAuthenticated: boolean;
    createdAt: string;
    lastAccessed: string;
    encryptedRefreshToken?: string;
    encryptedAccessToken?: string;
}

export interface PersistentAxonautSession {
    serviceName: 'axonaut';
    userId: string;
    userEmail: string;
    isAuthenticated: boolean;
    createdAt: string;
    lastAccessed: string;
    encryptedApiKey: string;
    baseUrl: string;
}

export class RedisPersistence {
    private redis: Redis;
    private isRedisAvailable: boolean = false;

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
        } else {
            console.log('🔗 Configuration Redis Railway détectée');
            
            // Validation et correction de l'URL Redis
            let cleanRedisUrl = redisUrl.trim();
            
            // Vérifier si l'URL est bien formée
            if (!cleanRedisUrl.startsWith('redis://') && !cleanRedisUrl.startsWith('rediss://')) {
                console.warn('⚠️ URL Redis malformée, tentative de correction...');
                if (cleanRedisUrl.startsWith('//')) {
                    cleanRedisUrl = 'redis:' + cleanRedisUrl;
                } else if (!cleanRedisUrl.includes('://')) {
                    cleanRedisUrl = 'redis://' + cleanRedisUrl;
                }
            }
            
            console.log('🔍 Redis URL configurée:', cleanRedisUrl.replace(/:[^:]*@/, ':***@')); // Masquer le mot de passe
            
            // Configuration spéciale pour Railway
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
            } else {
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

        // Gestion des erreurs Redis (avec limitation des messages)
        let errorCount = 0;
        this.redis.on('error', (error: Error) => {
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
            console.log('✅ Redis prêt');
            this.isRedisAvailable = true;
        });

        this.redis.on('close', () => {
            this.isRedisAvailable = false;
        });
    }

    // Initialiser la connexion Redis
    async initialize(): Promise<void> {
        const redisUrl = process.env.REDIS_URL;
        if (redisUrl) {
            console.log('🔍 URL Redis detectée:', redisUrl.replace(/:[^:]*@/, ':***@'));
            
            // Vérifier la structure de l'URL
            try {
                const url = new URL(redisUrl);
                console.log('✅ URL Redis valide:', url.protocol, url.hostname, url.port);
            } catch (urlError) {
                console.warn('⚠️ URL Redis invalide:', urlError);
                this.isRedisAvailable = false;
                return;
            }
        }
        
        // Forcer la connexion Redis
        try {
            console.log('🔄 Connexion explicite à Redis...');
            await this.redis.connect();
            console.log('✅ Connexion Redis forcée réussie');
            
            // Test de fonctionnement
            const pong = await this.redis.ping();
            if (pong === 'PONG') {
                this.isRedisAvailable = true;
                console.log('✅ Redis opérationnel et prêt');
            }
        } catch (error) {
            console.error('❌ Échec connexion Redis:', error.message);
            this.isRedisAvailable = false;
            
            // Essayer la configuration alternative Railway
            await this.tryPublicRedisUrl();
        }
    }

    // Essayer l'URL Redis publique de Railway
    private async tryPublicRedisUrl(): Promise<void> {
        try {
            const redisUrl = process.env.REDIS_URL;
            if (redisUrl && redisUrl.includes('redis.railway.internal')) {
                console.log('🔧 Tentative avec configuration Redis alternative...');
                
                // Essayons plusieurs variantes d'URL
                const urlVariants = [
                    redisUrl.replace('redis.railway.internal', 'redis.railway.app'),
                    redisUrl.replace('redis.railway.internal', 'redis-production.up.railway.app'),
                    redisUrl.replace('redis://', 'rediss://'), // SSL
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
                        
                        // Fermer l'ancienne connexion et utiliser la nouvelle
                        await this.redis.disconnect();
                        this.redis = testRedis;
                        this.isRedisAvailable = true;
                        
                        return;
                    } catch (error) {
                        console.log('❌ Échec avec cette URL');
                        continue;
                    }
                }
            }
        } catch (error) {
            console.warn('❌ Toutes les variantes Redis ont échoué');
        }
        
        console.warn('📝 Le serveur fonctionnera en mode sans persistance');
        this.isRedisAvailable = false;
    }

    // Test de santé Redis
    async healthCheck(): Promise<boolean> {
        try {
            if (!this.isRedisAvailable) {
                // Essayer de se reconnecter
                const pong = await this.redis.ping();
                this.isRedisAvailable = (pong === 'PONG');
            }
            return this.isRedisAvailable;
        } catch (error) {
            this.isRedisAvailable = false;
            return false;
        }
    }

    // Sauvegarder les sessions utilisateur
    async saveUserSessions(userSessions: Map<string, any>): Promise<void> {
        try {
            // Vérification de santé avec tentative de reconnexion
            if (!(await this.healthCheck())) {
                return;
            }

            const pipeline = this.redis.pipeline();
            
            for (const [userId, session] of userSessions) {
                const persistentSession: PersistentUserSession = {
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
        } catch (error) {
            console.error('❌ Erreur sauvegarde sessions utilisateur:', error.message);
            this.isRedisAvailable = false;
        }
    }

    // Sauvegarder les sessions Gmail
    async saveGmailSessions(gmailSessions: Map<string, any>): Promise<void> {
        try {
            if (!(await this.healthCheck())) {
                return;
            }

            const pipeline = this.redis.pipeline();
            
            for (const [userId, session] of gmailSessions) {
                const persistentSession: PersistentGmailSession = {
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
        } catch (error) {
            console.error('❌ Erreur sauvegarde sessions Gmail:', error.message);
            this.isRedisAvailable = false;
        }
    }

    // Sauvegarder les sessions Axonaut
    async saveAxonautSessions(axonautSessions: Map<string, any>): Promise<void> {
        try {
            if (!(await this.healthCheck())) {
                return;
            }

            const pipeline = this.redis.pipeline();
            
            for (const [userId, session] of axonautSessions) {
                const persistentSession: PersistentAxonautSession = {
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
        } catch (error) {
            console.error('❌ Erreur sauvegarde sessions Axonaut:', error.message);
            this.isRedisAvailable = false;
        }
    }

    // Charger les sessions utilisateur
    async loadUserSessions(): Promise<PersistentUserSession[]> {
        try {
            if (!(await this.healthCheck())) {
                return [];
            }

            const keys = await this.redis.keys('user:*');
            const sessions: PersistentUserSession[] = [];
            
            if (keys.length > 0) {
                const pipeline = this.redis.pipeline();
                for (const key of keys) {
                    pipeline.hget(key, 'data');
                }
                
                const results = await pipeline.exec();
                if (results) {
                    for (const result of results) {
                        if (result && result[1]) {
                            sessions.push(JSON.parse(result[1] as string));
                        }
                    }
                }
            }
            
            console.log(`📂 ${sessions.length} sessions utilisateur chargées depuis Redis`);
            return sessions;
        } catch (error) {
            console.error('❌ Erreur chargement sessions utilisateur:', error.message);
            this.isRedisAvailable = false;
            return [];
        }
    }

    // Charger les sessions Gmail
    async loadGmailSessions(): Promise<PersistentGmailSession[]> {
        try {
            if (!(await this.healthCheck())) {
                return [];
            }

            const keys = await this.redis.keys('gmail:*');
            const sessions: PersistentGmailSession[] = [];
            
            if (keys.length > 0) {
                const pipeline = this.redis.pipeline();
                for (const key of keys) {
                    pipeline.hget(key, 'data');
                }
                
                const results = await pipeline.exec();
                if (results) {
                    for (const result of results) {
                        if (result && result[1]) {
                            sessions.push(JSON.parse(result[1] as string));
                        }
                    }
                }
            }
            
            console.log(`📧 ${sessions.length} sessions Gmail chargées depuis Redis`);
            return sessions;
        } catch (error) {
            console.error('❌ Erreur chargement sessions Gmail:', error.message);
            this.isRedisAvailable = false;
            return [];
        }
    }

    // Charger les sessions Axonaut
    async loadAxonautSessions(): Promise<PersistentAxonautSession[]> {
        try {
            if (!(await this.healthCheck())) {
                return [];
            }

            const keys = await this.redis.keys('axonaut:*');
            const sessions: PersistentAxonautSession[] = [];
            
            if (keys.length > 0) {
                const pipeline = this.redis.pipeline();
                for (const key of keys) {
                    pipeline.hget(key, 'data');
                }
                
                const results = await pipeline.exec();
                if (results) {
                    for (const result of results) {
                        if (result && result[1]) {
                            sessions.push(JSON.parse(result[1] as string));
                        }
                    }
                }
            }
            
            console.log(`📊 ${sessions.length} sessions Axonaut chargées depuis Redis`);
            return sessions;
        } catch (error) {
            console.error('❌ Erreur chargement sessions Axonaut:', error.message);
            this.isRedisAvailable = false;
            return [];
        }
    }

    // Sauvegarder toutes les sessions
    async saveAllSessions(
        userSessions: Map<string, any>,
        gmailSessions: Map<string, any>,
        axonautSessions: Map<string, any>
    ): Promise<void> {
        if (!(await this.healthCheck())) {
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

    // Nettoyer une session spécifique
    async deleteUserSession(userId: string): Promise<void> {
        try {
            if (await this.healthCheck()) {
                await this.redis.del(`user:${userId}`, `gmail:${userId}`, `axonaut:${userId}`);
                console.log(`🗑️ Session ${userId} supprimée de Redis`);
            }
        } catch (error) {
            console.error('❌ Erreur suppression session Redis:', error.message);
        }
    }

    // Nettoyer les sessions expirées (plus de X jours d'inactivité)
    async cleanupExpiredSessions(daysOld: number = 30): Promise<void> {
        try {
            if (!(await this.healthCheck())) {
                return;
            }

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
        } catch (error) {
            console.error('❌ Erreur nettoyage sessions expirées:', error.message);
        }
    }

    // Statistiques Redis
    async getStats(): Promise<any> {
        try {
            if (!(await this.healthCheck())) {
                return { error: 'Redis non disponible' };
            }

            const userKeys = await this.redis.keys('user:*');
            const gmailKeys = await this.redis.keys('gmail:*');
            const axonautKeys = await this.redis.keys('axonaut:*');
            
            return {
                userSessions: userKeys.length,
                gmailSessions: gmailKeys.length,
                axonautSessions: axonautKeys.length,
                totalKeys: userKeys.length + gmailKeys.length + axonautKeys.length,
                isConnected: this.isRedisAvailable
            };
        } catch (error) {
            console.error('❌ Erreur statistiques Redis:', error.message);
            return { error: 'Impossible de récupérer les statistiques' };
        }
    }

    // Fermer la connexion Redis
    async disconnect(): Promise<void> {
        try {
            await this.redis.disconnect();
            console.log('🔌 Connexion Redis fermée');
        } catch (error) {
            console.log('🔌 Connexion Redis fermée (déjà fermée)');
        }
    }
}

// Instance globale
export const redisPersistence = new RedisPersistence();
