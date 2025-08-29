// src/core/PostgreSQLSessionManager.ts - Gestionnaire de sessions 100% PostgreSQL

import { DatabaseManager, MCPConnection } from '../database/DatabaseManager.js';
import { encrypt, decrypt, encryptObject, decryptObject } from '../utils/encryption.js';
import { v4 as uuidv4 } from 'uuid';

export interface MCPSessionData {
    sessionId: string;
    userId: string;
    serviceName: 'gmail' | 'axonaut' | 'notion';
    isConnected: boolean;
    connectedAt: Date;
    lastUsed: Date;
    credentials: any; // Credentials déchiffrées en mémoire
    serviceMetadata?: any;
    expiresAt?: Date;
}

export interface GmailCredentials {
    refreshToken: string;
    accessToken?: string;
    userEmail: string;
    tokenExpiresAt?: Date;
}

export interface AxonautCredentials {
    apiKey: string;
    baseUrl: string;
    userEmail: string;
}

export class PostgreSQLSessionManager {
    private database: DatabaseManager;
    private activeSessions = new Map<string, MCPSessionData>(); // Cache en mémoire des sessions actives

    constructor(database: DatabaseManager) {
        this.database = database;
    }

    // === GESTION DES SESSIONS MCP ===

    /**
     * Créer une nouvelle session MCP ou mettre à jour une existante
     */
    async createOrUpdateMCPSession(
        userId: string,
        serviceName: 'gmail' | 'axonaut' | 'notion',
        credentials: GmailCredentials | AxonautCredentials,
        serviceMetadata?: any,
        expiresAt?: Date
    ): Promise<MCPSessionData> {
        const sessionId = uuidv4();
        const now = new Date();

        // Chiffrer les credentials avant sauvegarde
        const encryptedCredentials = encryptObject(credentials);

        try {
            // Insérer ou mettre à jour la connexion MCP
            const query = `
                INSERT INTO mcp_connections (
                    user_id, service_name, is_connected, connected_at, last_used,
                    credentials, service_metadata, session_id, expires_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                ON CONFLICT (user_id, service_name) 
                DO UPDATE SET
                    is_connected = $3,
                    last_used = $5,
                    credentials = $6,
                    service_metadata = $7,
                    session_id = $8,
                    expires_at = $9,
                    updated_at = NOW()
                RETURNING *
            `;

            const values = [
                userId,
                serviceName,
                true,
                now,
                now,
                encryptedCredentials,
                serviceMetadata ? JSON.stringify(serviceMetadata) : null,
                sessionId,
                expiresAt
            ];

            const result = await this.database.query(query, values);
            const mcpConnection = result.rows[0];

            // Créer l'objet session avec credentials déchiffrées
            const sessionData: MCPSessionData = {
                sessionId,
                userId,
                serviceName,
                isConnected: true,
                connectedAt: mcpConnection.connected_at,
                lastUsed: now,
                credentials, // Credentials non chiffrées en mémoire
                serviceMetadata,
                expiresAt
            };

            // Mettre en cache
            this.activeSessions.set(sessionId, sessionData);

            console.log(`✅ Session MCP créée/mise à jour: ${serviceName} pour user ${userId}`);
            return sessionData;

        } catch (error) {
            console.error(`❌ Erreur création session MCP ${serviceName}:`, error);
            throw error;
        }
    }

    /**
     * Récupérer une session MCP active
     */
    async getMCPSession(userId: string, serviceName: 'gmail' | 'axonaut' | 'notion'): Promise<MCPSessionData | null> {
        try {
            // D'abord vérifier le cache
            const cachedSession = Array.from(this.activeSessions.values())
                .find(session => session.userId === userId && session.serviceName === serviceName);

            if (cachedSession && this.isSessionValid(cachedSession)) {
                // Mettre à jour last_used en base
                await this.updateLastUsed(userId, serviceName);
                cachedSession.lastUsed = new Date();
                return cachedSession;
            }

            // Sinon récupérer depuis la base
            const query = `
                SELECT * FROM mcp_connections 
                WHERE user_id = $1 AND service_name = $2 AND is_connected = true
            `;

            const result = await this.database.query(query, [userId, serviceName]);

            if (result.rows.length === 0) {
                return null;
            }

            const mcpConnection = result.rows[0];

            // Vérifier si la session n'a pas expiré
            if (mcpConnection.expires_at && new Date() > new Date(mcpConnection.expires_at)) {
                await this.disconnectMCPService(userId, serviceName);
                return null;
            }

            // Déchiffrer les credentials
            const credentials = decryptObject(mcpConnection.credentials);

            const sessionData: MCPSessionData = {
                sessionId: mcpConnection.session_id,
                userId,
                serviceName,
                isConnected: true,
                connectedAt: mcpConnection.connected_at,
                lastUsed: mcpConnection.last_used,
                credentials,
                serviceMetadata: mcpConnection.service_metadata ? JSON.parse(mcpConnection.service_metadata) : undefined,
                expiresAt: mcpConnection.expires_at
            };

            // Mettre en cache
            this.activeSessions.set(sessionData.sessionId, sessionData);

            // Mettre à jour last_used
            await this.updateLastUsed(userId, serviceName);
            sessionData.lastUsed = new Date();

            return sessionData;

        } catch (error) {
            console.error(`❌ Erreur récupération session MCP ${serviceName}:`, error);
            return null;
        }
    }

    /**
     * Déconnecter un service MCP
     */
    async disconnectMCPService(userId: string, serviceName: 'gmail' | 'axonaut' | 'notion'): Promise<boolean> {
        try {
            const query = `
                UPDATE mcp_connections 
                SET is_connected = false, updated_at = NOW()
                WHERE user_id = $1 AND service_name = $2
            `;

            await this.database.query(query, [userId, serviceName]);

            // Supprimer du cache
            for (const [sessionId, session] of this.activeSessions.entries()) {
                if (session.userId === userId && session.serviceName === serviceName) {
                    this.activeSessions.delete(sessionId);
                    break;
                }
            }

            console.log(`✅ Service MCP déconnecté: ${serviceName} pour user ${userId}`);
            return true;

        } catch (error) {
            console.error(`❌ Erreur déconnexion service MCP ${serviceName}:`, error);
            return false;
        }
    }

    /**
     * Mettre à jour les credentials d'une session
     */
    async updateSessionCredentials(
        userId: string,
        serviceName: 'gmail' | 'axonaut' | 'notion',
        newCredentials: any
    ): Promise<boolean> {
        try {
            const encryptedCredentials = encryptObject(newCredentials);

            const query = `
                UPDATE mcp_connections 
                SET credentials = $1, last_used = NOW(), updated_at = NOW()
                WHERE user_id = $2 AND service_name = $3 AND is_connected = true
            `;

            await this.database.query(query, [encryptedCredentials, userId, serviceName]);

            // Mettre à jour le cache
            for (const session of this.activeSessions.values()) {
                if (session.userId === userId && session.serviceName === serviceName) {
                    session.credentials = newCredentials;
                    session.lastUsed = new Date();
                    break;
                }
            }

            console.log(`✅ Credentials mis à jour: ${serviceName} pour user ${userId}`);
            return true;

        } catch (error) {
            console.error(`❌ Erreur mise à jour credentials ${serviceName}:`, error);
            return false;
        }
    }

    /**
     * Récupérer toutes les sessions actives d'un utilisateur
     */
    async getUserActiveSessions(userId: string): Promise<MCPSessionData[]> {
        try {
            const query = `
                SELECT * FROM mcp_connections 
                WHERE user_id = $1 AND is_connected = true
                ORDER BY last_used DESC
            `;

            const result = await this.database.query(query, [userId]);
            const sessions: MCPSessionData[] = [];

            for (const row of result.rows) {
                // Vérifier si la session n'a pas expiré
                if (row.expires_at && new Date() > new Date(row.expires_at)) {
                    await this.disconnectMCPService(userId, row.service_name);
                    continue;
                }

                const credentials = decryptObject(row.credentials);
                sessions.push({
                    sessionId: row.session_id,
                    userId,
                    serviceName: row.service_name,
                    isConnected: true,
                    connectedAt: row.connected_at,
                    lastUsed: row.last_used,
                    credentials,
                    serviceMetadata: row.service_metadata ? JSON.parse(row.service_metadata) : undefined,
                    expiresAt: row.expires_at
                });
            }

            return sessions;

        } catch (error) {
            console.error('❌ Erreur récupération sessions utilisateur:', error);
            return [];
        }
    }

    /**
     * Nettoyer les sessions expirées
     */
    async cleanupExpiredSessions(): Promise<number> {
        try {
            const query = `
                UPDATE mcp_connections 
                SET is_connected = false, updated_at = NOW()
                WHERE expires_at IS NOT NULL AND expires_at < NOW() AND is_connected = true
            `;

            const result = await this.database.query(query);
            const cleanedCount = result.rowCount || 0;

            // Nettoyer le cache
            for (const [sessionId, session] of this.activeSessions.entries()) {
                if (!this.isSessionValid(session)) {
                    this.activeSessions.delete(sessionId);
                }
            }

            if (cleanedCount > 0) {
                console.log(`🧹 ${cleanedCount} sessions expirées nettoyées`);
            }

            return cleanedCount;

        } catch (error) {
            console.error('❌ Erreur nettoyage sessions expirées:', error);
            return 0;
        }
    }

    /**
     * Supprimer définitivement les anciennes connexions MCP déconnectées
     */
    async deleteOldDisconnectedSessions(daysOld: number = 30): Promise<number> {
        try {
            const query = `
                DELETE FROM mcp_connections 
                WHERE is_connected = false 
                AND updated_at < NOW() - INTERVAL '${daysOld} days'
            `;

            const result = await this.database.query(query);
            const deletedCount = result.rowCount || 0;

            if (deletedCount > 0) {
                console.log(`🗑️ ${deletedCount} anciennes connexions MCP supprimées`);
            }

            return deletedCount;

        } catch (error) {
            console.error('❌ Erreur suppression anciennes connexions:', error);
            return 0;
        }
    }

    // === MÉTHODES UTILITAIRES ===

    private async updateLastUsed(userId: string, serviceName: string): Promise<void> {
        const query = `
            UPDATE mcp_connections 
            SET last_used = NOW(), updated_at = NOW()
            WHERE user_id = $1 AND service_name = $2
        `;
        await this.database.query(query, [userId, serviceName]);
    }

    private isSessionValid(session: MCPSessionData): boolean {
        if (!session.expiresAt) return true;
        return new Date() < session.expiresAt;
    }

    // === STATISTIQUES ===

    async getSessionStats(): Promise<{
        totalConnections: number;
        activeConnections: number;
        connectionsByService: Record<string, number>;
        cachedSessions: number;
    }> {
        try {
            const totalQuery = 'SELECT COUNT(*) as count FROM mcp_connections';
            const activeQuery = 'SELECT COUNT(*) as count FROM mcp_connections WHERE is_connected = true';
            const byServiceQuery = `
                SELECT service_name, COUNT(*) as count 
                FROM mcp_connections 
                WHERE is_connected = true 
                GROUP BY service_name
            `;

            const [totalResult, activeResult, byServiceResult] = await Promise.all([
                this.database.query(totalQuery),
                this.database.query(activeQuery),
                this.database.query(byServiceQuery)
            ]);

            const connectionsByService: Record<string, number> = {};
            byServiceResult.rows.forEach(row => {
                connectionsByService[row.service_name] = parseInt(row.count);
            });

            return {
                totalConnections: parseInt(totalResult.rows[0].count),
                activeConnections: parseInt(activeResult.rows[0].count),
                connectionsByService,
                cachedSessions: this.activeSessions.size
            };

        } catch (error) {
            console.error('❌ Erreur récupération statistiques sessions:', error);
            return {
                totalConnections: 0,
                activeConnections: 0,
                connectionsByService: {},
                cachedSessions: 0
            };
        }
    }

    /**
     * Vider le cache des sessions actives
     */
    clearCache(): void {
        this.activeSessions.clear();
        console.log('🧹 Cache des sessions vidé');
    }

    /**
     * Récupérer une session par son ID
     */
    getSessionById(sessionId: string): MCPSessionData | null {
        return this.activeSessions.get(sessionId) || null;
    }
}
