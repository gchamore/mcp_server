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
                maxRetriesPerRequest: 1,  // Réduire les tentatives en local
                lazyConnect: true,
                enableOfflineQueue: true  // Permettre la queue en mode offline
            });
        } else {
            console.log('🔗 Configuration Redis Railway détectée');
            this.redis = new Redis(redisUrl, {
                maxRetriesPerRequest: 3,
                lazyConnect: true,
                enableOfflineQueue: false,
                // Configuration Railway optimisée
                connectTimeout: 10000,
                commandTimeout: 5000,
                family: 4 // Force IPv4 pour Railway
            });
        }

        // Gestion des erreurs Redis (avec limitation des messages)
        let errorCount = 0;
        this.redis.on('error', (error: Error) => {
            errorCount++;
            if (errorCount <= 3) { // Limiter à 3 messages d'erreur
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

    // Initialiser la connexion Redis
    async initialize(): Promise<void> {
        try {
            await this.redis.ping();
            console.log('📁 Redis initialisé et connecté');
            this.isRedisAvailable = true;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Erreur inconnue';
            console.warn('⚠️ Redis non disponible:', errorMessage);
            console.warn('📝 Le serveur fonctionnera en mode sans persistance');
            this.isRedisAvailable = false;
            // Ne pas lancer d'erreur, permettre au serveur de continuer
        }
    }

    // Test de santé Redis
    async healthCheck(): Promise<boolean> {
        // Retour rapide si Redis n'est pas disponible
        if (!this.isRedisAvailable) {
            return false;
        }
        
        try {
            const result = await this.redis.ping();
            const isHealthy = result === 'PONG';
            this.isRedisAvailable = isHealthy;
            return isHealthy;
        } catch (error) {
            this.isRedisAvailable = false;
            return false;
        }
    }

    // Sauvegarder les sessions utilisateur
    async saveUserSessions(userSessions: Map<string, any>): Promise<void> {
        try {
            // Vérification rapide sans ping
            if (!this.isRedisAvailable) {
                return; // Pas de message d'avertissement répétitif
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
            console.error('❌ Erreur sauvegarde sessions utilisateur:', error);
        }
    }

    // Sauvegarder les sessions Gmail
    async saveGmailSessions(gmailSessions: Map<string, any>): Promise<void> {
        try {
            // Vérification rapide sans ping
            if (!this.isRedisAvailable) {
                return; // Pas de message d'avertissement répétitif
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
            console.error('❌ Erreur sauvegarde sessions Gmail:', error);
        }
    }

    // Sauvegarder les sessions Axonaut
    async saveAxonautSessions(axonautSessions: Map<string, any>): Promise<void> {
        try {
            // Vérification rapide sans ping
            if (!this.isRedisAvailable) {
                return; // Pas de message d'avertissement répétitif
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
            console.error('❌ Erreur sauvegarde sessions Axonaut:', error);
        }
    }

    // Charger les sessions utilisateur
    async loadUserSessions(): Promise<PersistentUserSession[]> {
        try {
            // Vérification rapide sans ping
            if (!this.isRedisAvailable) {
                return []; // Pas de message d'avertissement répétitif
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
            console.error('❌ Erreur chargement sessions utilisateur:', error);
            return [];
        }
    }

    // Charger les sessions Gmail
    async loadGmailSessions(): Promise<PersistentGmailSession[]> {
        try {
            // Vérification rapide sans ping
            if (!this.isRedisAvailable) {
                return []; // Pas de message d'avertissement répétitif
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
            console.error('❌ Erreur chargement sessions Gmail:', error);
            return [];
        }
    }

    // Charger les sessions Axonaut
    async loadAxonautSessions(): Promise<PersistentAxonautSession[]> {
        try {
            // Vérification rapide sans ping
            if (!this.isRedisAvailable) {
                return []; // Pas de message d'avertissement répétitif
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
            console.error('❌ Erreur chargement sessions Axonaut:', error);
            return [];
        }
    }

    // Sauvegarder toutes les sessions
    async saveAllSessions(
        userSessions: Map<string, any>,
        gmailSessions: Map<string, any>,
        axonautSessions: Map<string, any>
    ): Promise<void> {
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

    // Nettoyer une session spécifique
    async deleteUserSession(userId: string): Promise<void> {
        try {
            await this.redis.del(`user:${userId}`, `gmail:${userId}`, `axonaut:${userId}`);
            console.log(`🗑️ Session ${userId} supprimée de Redis`);
        } catch (error) {
            console.error('❌ Erreur suppression session Redis:', error);
        }
    }

    // Nettoyer les sessions expirées (plus de X jours d'inactivité)
    async cleanupExpiredSessions(daysOld: number = 30): Promise<void> {
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
        } catch (error) {
            console.error('❌ Erreur nettoyage sessions expirées:', error);
        }
    }

    // Statistiques Redis
    async getStats(): Promise<any> {
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
        } catch (error) {
            console.error('❌ Erreur statistiques Redis:', error);
            return { error: 'Impossible de récupérer les statistiques' };
        }
    }

    // Fermer la connexion Redis
    async disconnect(): Promise<void> {
        await this.redis.disconnect();
        console.log('🔌 Connexion Redis fermée');
    }
}

// Instance globale
export const redisPersistence = new RedisPersistence();
