// Interface pour les données à persister (identiques à persistence.ts)
export interface PersistentUserSession {
    userId: string;
    createdAt: string;
    lastAccessed: string;
    authenticatedUser?: {
        userId: string;
        email: string;
        name: string;
        picture?: string;
        googleRefreshToken: string;
        createdAt: string;
        lastLoginAt: string;
        connectedServices: string[];
    };
    services: {
        gmail?: string;
        axonaut?: string;
    };
}

export interface PersistentAuthenticatedUser {
    userId: string;
    email: string;
    name: string;
    picture?: string;
    googleRefreshToken: string;
    createdAt: string;
    lastLoginAt: string;
    connectedServices: string[];
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

import Redis from 'ioredis';

export class RedisPersistence {
    private redis: Redis;
    private isRedisAvailable: boolean = false;

    constructor() {
        const redisUrl = process.env.REDIS_URL;
        
        if (!redisUrl) {
            console.log('🔶 REDIS_URL non configuré - fonctionnement sans persistance Redis');
            this.redis = new Redis({ lazyConnect: true });
        } else {
            console.log('🔗 Configuration Redis avec URL:', redisUrl.replace(/:([^:@]{8})[^:@]*@/, ':$1***@'));
            this.redis = new Redis(redisUrl, {
                maxRetriesPerRequest: 3,
                enableReadyCheck: false,
                lazyConnect: true,
                connectTimeout: 10000,
                commandTimeout: 5000
            });
        }

        // Gestion des erreurs Redis (avec limitation des messages)
        let errorCount = 0;
        this.redis.on('error', (error: Error) => {
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

    // Initialiser la connexion Redis
    async initialize(): Promise<void> {
        const redisUrl = process.env.REDIS_URL;
        if (redisUrl) {
            try {
                await this.redis.ping();
                this.isRedisAvailable = true;
                console.log('✅ Redis initialisé avec succès');
            } catch (error) {
                console.log('❌ Échec connexion Redis principale, test URL publique...');
                await this.tryPublicRedisUrl();
            }
        }
        
        // Forcer la connexion Redis
        try {
            await this.redis.connect();
        } catch (error) {
            console.log('⚠️ Redis indisponible, fonctionnement en mode local uniquement');
        }
    }

    // Essayer l'URL Redis publique de Railway
    private async tryPublicRedisUrl(): Promise<void> {
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
        } catch (error) {
            console.log('❌ Échec connexion Redis publique aussi');
            this.isRedisAvailable = false;
        }
    }

    // Test de santé Redis
    async healthCheck(): Promise<boolean> {
        if (!this.isRedisAvailable) return false;
        
        try {
            const result = await this.redis.ping();
            return result === 'PONG';
        } catch (error) {
            this.isRedisAvailable = false;
            return false;
        }
    }

    // Sauvegarder les utilisateurs authentifiés
    async saveAuthenticatedUsers(users: Map<string, any>): Promise<void> {
        if (!this.isRedisAvailable) return;

        try {
            const pipeline = this.redis.pipeline();
            
            // Supprimer les anciennes données
            const existingKeys = await this.redis.keys('user:auth:*');
            if (existingKeys.length > 0) {
                pipeline.del(...existingKeys);
            }

            // Sauvegarder les nouveaux utilisateurs
            for (const [userId, user] of users) {
                const userData: PersistentAuthenticatedUser = {
                    userId: user.userId,
                    email: user.email,
                    name: user.name,
                    picture: user.picture,
                    googleRefreshToken: user.googleRefreshToken,
                    createdAt: user.createdAt.toISOString(),
                    lastLoginAt: user.lastLoginAt.toISOString(),
                    connectedServices: user.connectedServices
                };
                
                pipeline.setex(`user:auth:${userId}`, 86400 * 30, JSON.stringify(userData)); // 30 jours
            }

            await pipeline.exec();
            console.log(`💾 ${users.size} utilisateurs authentifiés sauvegardés dans Redis`);
        } catch (error) {
            console.error('❌ Erreur sauvegarde utilisateurs Redis:', error);
        }
    }

    // Charger les utilisateurs authentifiés
    async loadAuthenticatedUsers(): Promise<PersistentAuthenticatedUser[]> {
        if (!this.isRedisAvailable) return [];

        try {
            const keys = await this.redis.keys('user:auth:*');
            if (keys.length === 0) return [];

            const pipeline = this.redis.pipeline();
            keys.forEach(key => pipeline.get(key));
            
            const results = await pipeline.exec();
            const users: PersistentAuthenticatedUser[] = [];

            if (results) {
                for (const result of results) {
                    if (result && result[1]) {
                        try {
                            const userData = JSON.parse(result[1] as string);
                            users.push(userData);
                        } catch (parseError) {
                            console.error('❌ Erreur parsing utilisateur Redis:', parseError);
                        }
                    }
                }
            }

            console.log(`🔄 ${users.length} utilisateurs authentifiés chargés depuis Redis`);
            return users;
        } catch (error) {
            console.error('❌ Erreur chargement utilisateurs Redis:', error);
            return [];
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

                // Ajouter les données utilisateur authentifié si disponibles
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
        } catch (error) {
            console.error('❌ Erreur sauvegarde sessions utilisateur:', error instanceof Error ? error.message : String(error));
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
            console.log(`💾 ${gmailSessions.size} sessions Gmail sauvegardées en Redis`);
        } catch (error) {
            console.error('❌ Erreur sauvegarde sessions Gmail:', error instanceof Error ? error.message : String(error));
            this.isRedisAvailable = false;
        }
    }

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
            console.log(`💾 ${axonautSessions.size} sessions Axonaut sauvegardées en Redis`);
        } catch (error) {
            console.error('❌ Erreur sauvegarde sessions Axonaut:', error instanceof Error ? error.message : String(error));
            this.isRedisAvailable = false;
        }
    }

    async loadUserSessions(): Promise<PersistentUserSession[]> {
        try {
            if (!(await this.healthCheck())) {
                return [];
            }

            const keys = await this.redis.keys('user:*');
            if (keys.length === 0) return [];

            const pipeline = this.redis.pipeline();
            keys.forEach(key => pipeline.hget(key, 'data'));
            
            const results = await pipeline.exec();
            const sessions: PersistentUserSession[] = [];

            if (results) {
                for (const result of results) {
                    if (result && result[1]) {
                        try {
                            const sessionData = JSON.parse(result[1] as string);
                            sessions.push(sessionData);
                        } catch (parseError) {
                            console.error('❌ Erreur parsing session utilisateur Redis:', parseError);
                        }
                    }
                }
            }

            console.log(`🔄 ${sessions.length} sessions utilisateur chargées depuis Redis`);
            return sessions;
        } catch (error) {
            console.error('❌ Erreur chargement sessions utilisateur Redis:', error instanceof Error ? error.message : String(error));
            return [];
        }
    }

    async loadGmailSessions(): Promise<PersistentGmailSession[]> {
        try {
            if (!(await this.healthCheck())) {
                return [];
            }

            const keys = await this.redis.keys('gmail:*');
            if (keys.length === 0) return [];

            const pipeline = this.redis.pipeline();
            keys.forEach(key => pipeline.hget(key, 'data'));
            
            const results = await pipeline.exec();
            const sessions: PersistentGmailSession[] = [];

            if (results) {
                for (const result of results) {
                    if (result && result[1]) {
                        try {
                            const sessionData = JSON.parse(result[1] as string);
                            sessions.push(sessionData);
                        } catch (parseError) {
                            console.error('❌ Erreur parsing session Gmail Redis:', parseError);
                        }
                    }
                }
            }

            console.log(`🔄 ${sessions.length} sessions Gmail chargées depuis Redis`);
            return sessions;
        } catch (error) {
            console.error('❌ Erreur chargement sessions Gmail Redis:', error instanceof Error ? error.message : String(error));
            return [];
        }
    }

    async loadAxonautSessions(): Promise<PersistentAxonautSession[]> {
        try {
            if (!(await this.healthCheck())) {
                return [];
            }

            const keys = await this.redis.keys('axonaut:*');
            if (keys.length === 0) return [];

            const pipeline = this.redis.pipeline();
            keys.forEach(key => pipeline.hget(key, 'data'));
            
            const results = await pipeline.exec();
            const sessions: PersistentAxonautSession[] = [];

            if (results) {
                for (const result of results) {
                    if (result && result[1]) {
                        try {
                            const sessionData = JSON.parse(result[1] as string);
                            sessions.push(sessionData);
                        } catch (parseError) {
                            console.error('❌ Erreur parsing session Axonaut Redis:', parseError);
                        }
                    }
                }
            }

            console.log(`🔄 ${sessions.length} sessions Axonaut chargées depuis Redis`);
            return sessions;
        } catch (error) {
            console.error('❌ Erreur chargement sessions Axonaut Redis:', error instanceof Error ? error.message : String(error));
            return [];
        }
    }

    // Sauvegarder toutes les sessions
    async saveAllSessions(
        userSessions: Map<string, any>,
        gmailSessions: Map<string, any>,
        axonautSessions: Map<string, any>,
        authenticatedUsers?: Map<string, any>
    ): Promise<void> {
        if (!(await this.healthCheck())) {
            console.log('⚠️ Redis indisponible, sauvegarde ignorée');
            return;
        }

        console.log('💾 Début sauvegarde complète Redis...');
        
        // Sauvegarder les utilisateurs authentifiés en premier
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

    // Nettoyer une session spécifique
    async deleteUserSession(userId: string): Promise<void> {
        if (!(await this.healthCheck())) return;

        try {
            const pipeline = this.redis.pipeline();
            pipeline.del(`user:${userId}`);
            pipeline.del(`user:auth:${userId}`);
            pipeline.del(`gmail:${userId}`);
            pipeline.del(`axonaut:${userId}`);
            
            await pipeline.exec();
            console.log(`🗑️ Session utilisateur ${userId} supprimée de Redis`);
        } catch (error) {
            console.error('❌ Erreur suppression session Redis:', error);
        }
    }

    // Nettoyer les sessions expirées (plus de X jours d'inactivité)
    async cleanupExpiredSessions(daysOld: number = 30): Promise<void> {
        if (!(await this.healthCheck())) return;

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
                } catch (parseError) {
                    console.error('❌ Erreur parsing session pour nettoyage:', parseError);
                    await this.redis.del(key);
                    deletedCount++;
                }
            }

            console.log(`🧹 ${deletedCount} sessions expirées supprimées de Redis`);
        } catch (error) {
            console.error('❌ Erreur nettoyage sessions Redis:', error);
        }
    }

    // Statistiques Redis
    async getStats(): Promise<any> {
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
        } catch (error) {
            return { redis: false, error: error instanceof Error ? error.message : String(error) };
        }
    }

    // Fermer la connexion Redis
    async disconnect(): Promise<void> {
        try {
            await this.redis.quit();
            console.log('👋 Connexion Redis fermée proprement');
        } catch (error) {
            console.error('❌ Erreur fermeture Redis:', error);
        }
    }
}

// Instance globale
export const redisPersistence = new RedisPersistence();
