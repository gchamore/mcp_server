import { encryptObject, decryptObject } from '../utils/encryption.js';
import { v4 as uuidv4 } from 'uuid';
export class PostgreSQLSessionManager {
    database;
    activeSessions = new Map();
    constructor(database) {
        this.database = database;
    }
    async createOrUpdateMCPSession(userId, serviceName, credentials, serviceMetadata, expiresAt) {
        const sessionId = uuidv4();
        const now = new Date();
        const encryptedCredentials = encryptObject(credentials);
        try {
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
            const sessionData = {
                sessionId,
                userId,
                serviceName,
                isConnected: true,
                connectedAt: mcpConnection.connected_at,
                lastUsed: now,
                credentials,
                serviceMetadata,
                expiresAt
            };
            this.activeSessions.set(sessionId, sessionData);
            console.log(`✅ Session MCP créée/mise à jour: ${serviceName} pour user ${userId}`);
            return sessionData;
        }
        catch (error) {
            console.error(`❌ Erreur création session MCP ${serviceName}:`, error);
            throw error;
        }
    }
    async getMCPSession(userId, serviceName) {
        try {
            const cachedSession = Array.from(this.activeSessions.values())
                .find(session => session.userId === userId && session.serviceName === serviceName);
            if (cachedSession && this.isSessionValid(cachedSession)) {
                await this.updateLastUsed(userId, serviceName);
                cachedSession.lastUsed = new Date();
                return cachedSession;
            }
            const query = `
                SELECT * FROM mcp_connections 
                WHERE user_id = $1 AND service_name = $2 AND is_connected = true
            `;
            const result = await this.database.query(query, [userId, serviceName]);
            if (result.rows.length === 0) {
                return null;
            }
            const mcpConnection = result.rows[0];
            if (mcpConnection.expires_at && new Date() > new Date(mcpConnection.expires_at)) {
                await this.disconnectMCPService(userId, serviceName);
                return null;
            }
            const credentials = decryptObject(mcpConnection.credentials);
            const sessionData = {
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
            this.activeSessions.set(sessionData.sessionId, sessionData);
            await this.updateLastUsed(userId, serviceName);
            sessionData.lastUsed = new Date();
            return sessionData;
        }
        catch (error) {
            console.error(`❌ Erreur récupération session MCP ${serviceName}:`, error);
            return null;
        }
    }
    async disconnectMCPService(userId, serviceName) {
        try {
            const query = `
                UPDATE mcp_connections 
                SET is_connected = false, updated_at = NOW()
                WHERE user_id = $1 AND service_name = $2
            `;
            await this.database.query(query, [userId, serviceName]);
            for (const [sessionId, session] of this.activeSessions.entries()) {
                if (session.userId === userId && session.serviceName === serviceName) {
                    this.activeSessions.delete(sessionId);
                    break;
                }
            }
            console.log(`✅ Service MCP déconnecté: ${serviceName} pour user ${userId}`);
            return true;
        }
        catch (error) {
            console.error(`❌ Erreur déconnexion service MCP ${serviceName}:`, error);
            return false;
        }
    }
    async updateSessionCredentials(userId, serviceName, newCredentials) {
        try {
            const encryptedCredentials = encryptObject(newCredentials);
            const query = `
                UPDATE mcp_connections 
                SET credentials = $1, last_used = NOW(), updated_at = NOW()
                WHERE user_id = $2 AND service_name = $3 AND is_connected = true
            `;
            await this.database.query(query, [encryptedCredentials, userId, serviceName]);
            for (const session of this.activeSessions.values()) {
                if (session.userId === userId && session.serviceName === serviceName) {
                    session.credentials = newCredentials;
                    session.lastUsed = new Date();
                    break;
                }
            }
            console.log(`✅ Credentials mis à jour: ${serviceName} pour user ${userId}`);
            return true;
        }
        catch (error) {
            console.error(`❌ Erreur mise à jour credentials ${serviceName}:`, error);
            return false;
        }
    }
    async getUserActiveSessions(userId) {
        try {
            const query = `
                SELECT * FROM mcp_connections 
                WHERE user_id = $1 AND is_connected = true
                ORDER BY last_used DESC
            `;
            const result = await this.database.query(query, [userId]);
            const sessions = [];
            for (const row of result.rows) {
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
        }
        catch (error) {
            console.error('❌ Erreur récupération sessions utilisateur:', error);
            return [];
        }
    }
    async cleanupExpiredSessions() {
        try {
            const query = `
                UPDATE mcp_connections 
                SET is_connected = false, updated_at = NOW()
                WHERE expires_at IS NOT NULL AND expires_at < NOW() AND is_connected = true
            `;
            const result = await this.database.query(query);
            const cleanedCount = result.rowCount || 0;
            for (const [sessionId, session] of this.activeSessions.entries()) {
                if (!this.isSessionValid(session)) {
                    this.activeSessions.delete(sessionId);
                }
            }
            if (cleanedCount > 0) {
                console.log(`🧹 ${cleanedCount} sessions expirées nettoyées`);
            }
            return cleanedCount;
        }
        catch (error) {
            console.error('❌ Erreur nettoyage sessions expirées:', error);
            return 0;
        }
    }
    async deleteOldDisconnectedSessions(daysOld = 30) {
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
        }
        catch (error) {
            console.error('❌ Erreur suppression anciennes connexions:', error);
            return 0;
        }
    }
    async updateLastUsed(userId, serviceName) {
        const query = `
            UPDATE mcp_connections 
            SET last_used = NOW(), updated_at = NOW()
            WHERE user_id = $1 AND service_name = $2
        `;
        await this.database.query(query, [userId, serviceName]);
    }
    isSessionValid(session) {
        if (!session.expiresAt)
            return true;
        return new Date() < session.expiresAt;
    }
    async getSessionStats() {
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
            const connectionsByService = {};
            byServiceResult.rows.forEach(row => {
                connectionsByService[row.service_name] = parseInt(row.count);
            });
            return {
                totalConnections: parseInt(totalResult.rows[0].count),
                activeConnections: parseInt(activeResult.rows[0].count),
                connectionsByService,
                cachedSessions: this.activeSessions.size
            };
        }
        catch (error) {
            console.error('❌ Erreur récupération statistiques sessions:', error);
            return {
                totalConnections: 0,
                activeConnections: 0,
                connectionsByService: {},
                cachedSessions: 0
            };
        }
    }
    clearCache() {
        this.activeSessions.clear();
        console.log('🧹 Cache des sessions vidé');
    }
    getSessionById(sessionId) {
        return this.activeSessions.get(sessionId) || null;
    }
}
