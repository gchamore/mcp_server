// src/database/DatabaseManager.ts - Gestionnaire PostgreSQL sécurisé

import { Pool, PoolClient, QueryResult } from 'pg';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface DatabaseUser {
    id: number;
    user_id: string;
    email: string;
    name: string;
    picture?: string;
    google_refresh_token?: string;
    created_at: Date;
    last_login_at: Date;
    is_active: boolean;
    updated_at: Date;
}

export interface MCPConnection {
    id: number;
    user_id: string;
    service_name: 'gmail' | 'axonaut' | 'notion';
    is_connected: boolean;
    connected_at: Date;
    last_used?: Date;
    credentials?: string; // JSON chiffré
    service_metadata?: any; // JSONB
    created_at: Date;
    updated_at: Date;
}

export class DatabaseManager {
    private pool: Pool;
    private isInitialized = false;

    constructor() {
        // Configuration PostgreSQL pour Railway et développement local
        const config = {
            // En développement, utiliser l'URL publique. En production, Railway utilisera l'interne automatiquement
            connectionString: process.env.NODE_ENV === 'production' 
                ? (process.env.DATABASE_URL_INTERNAL || process.env.DATABASE_URL || process.env.DATABASE_URL_PUBLIC)
                : (process.env.DATABASE_URL || process.env.DATABASE_URL_PUBLIC),
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
            max: 10, // Maximum de connexions dans le pool
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 10000,
        };

        this.pool = new Pool(config);

        // Gestion des erreurs de connexion
        this.pool.on('error', (err) => {
            console.error('❌ Erreur PostgreSQL pool:', err);
        });

        this.pool.on('connect', () => {
            console.log('✅ Nouvelle connexion PostgreSQL établie');
        });
    }

    // Initialiser la base de données
    async initialize(): Promise<void> {
        if (this.isInitialized) {
            return;
        }

        try {
            console.log('🏗️ Initialisation de la base de données PostgreSQL...');
            
            // Test de connexion
            const client = await this.pool.connect();
            try {
                await client.query('SELECT NOW()');
                console.log('✅ Connexion PostgreSQL établie');
            } finally {
                client.release();
            }

            // Vérifier si les tables existent, sinon les créer
            await this.ensureTablesExist();
            
            this.isInitialized = true;
            console.log('✅ Base de données PostgreSQL initialisée');

        } catch (error) {
            console.error('❌ Erreur initialisation PostgreSQL:', error);
            throw new Error('Impossible d\'initialiser la base de données');
        }
    }

    // Vérifier l'existence des tables et les créer si nécessaire
    private async ensureTablesExist(): Promise<void> {
        try {
            const client = await this.pool.connect();
            try {
                // Vérifier si la table users existe
                const tableExists = await client.query(`
                    SELECT EXISTS (
                        SELECT FROM information_schema.tables 
                        WHERE table_schema = 'public' 
                        AND table_name = 'users'
                    );
                `);

                if (!tableExists.rows[0].exists) {
                    console.log('📋 Tables non trouvées, création en cours...');
                    await this.createTables();
                } else {
                    console.log('✅ Tables PostgreSQL déjà existantes');
                }
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('❌ Erreur vérification tables:', error);
            throw error;
        }
    }

    // Créer les tables depuis le schéma SQL
    private async createTables(): Promise<void> {
        try {
            // Utiliser le chemin source (pas dist) pour éviter les problèmes de build
            const schemaPath = process.env.NODE_ENV === 'production' 
                ? join(process.cwd(), 'src/database/schema.sql')
                : join(__dirname, '../../../src/database/schema.sql');
            
            const schema = readFileSync(schemaPath, 'utf8');
            
            const client = await this.pool.connect();
            try {
                await client.query(schema);
                console.log('✅ Tables PostgreSQL créées/vérifiées');
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('❌ Erreur création tables:', error);
            throw error;
        }
    }

    // === GESTION DES UTILISATEURS ===

    // Créer ou mettre à jour un utilisateur
    async upsertUser(userData: {
        user_id: string;
        email: string;
        name: string;
        picture?: string;
        google_refresh_token?: string;
    }): Promise<DatabaseUser> {
        const query = `
            INSERT INTO users (user_id, email, name, picture, google_refresh_token, last_login_at)
            VALUES ($1, $2, $3, $4, $5, NOW())
            ON CONFLICT (user_id) 
            DO UPDATE SET 
                email = EXCLUDED.email,
                name = EXCLUDED.name,
                picture = EXCLUDED.picture,
                google_refresh_token = EXCLUDED.google_refresh_token,
                last_login_at = NOW(),
                updated_at = NOW()
            RETURNING *`;

        const values = [
            userData.user_id,
            userData.email,
            userData.name,
            userData.picture || null,
            userData.google_refresh_token || null
        ];

        const result = await this.pool.query(query, values);
        return result.rows[0];
    }

    // Récupérer un utilisateur par user_id
    async getUserById(user_id: string): Promise<DatabaseUser | null> {
        const query = 'SELECT * FROM users WHERE user_id = $1 AND is_active = true';
        const result = await this.pool.query(query, [user_id]);
        return result.rows[0] || null;
    }

    // Récupérer un utilisateur par email
    async getUserByEmail(email: string): Promise<DatabaseUser | null> {
        const query = 'SELECT * FROM users WHERE email = $1 AND is_active = true';
        const result = await this.pool.query(query, [email]);
        return result.rows[0] || null;
    }

    // Désactiver un utilisateur (soft delete)
    async deactivateUser(user_id: string): Promise<boolean> {
        const query = 'UPDATE users SET is_active = false, updated_at = NOW() WHERE user_id = $1';
        const result = await this.pool.query(query, [user_id]);
        return (result.rowCount || 0) > 0;
    }

    // Supprimer définitivement un utilisateur (GDPR)
    async deleteUser(user_id: string): Promise<boolean> {
        const query = 'DELETE FROM users WHERE user_id = $1';
        const result = await this.pool.query(query, [user_id]);
        return (result.rowCount || 0) > 0;
    }

    // Récupérer tous les utilisateurs (pour admin)
    async getAllUsers(): Promise<DatabaseUser[]> {
        const query = 'SELECT * FROM users ORDER BY created_at DESC';
        const result = await this.pool.query(query);
        return result.rows;
    }

    // === GESTION DES CONNEXIONS MCP ===

    // Connecter un service MCP
    async connectMCPService(
        user_id: string, 
        service_name: 'gmail' | 'axonaut' | 'notion',
        credentials?: string,
        service_metadata?: any
    ): Promise<MCPConnection> {
        const query = `
            INSERT INTO mcp_connections (user_id, service_name, is_connected, credentials, service_metadata, last_used)
            VALUES ($1, $2, true, $3, $4, NOW())
            ON CONFLICT (user_id, service_name)
            DO UPDATE SET 
                is_connected = true,
                credentials = EXCLUDED.credentials,
                service_metadata = EXCLUDED.service_metadata,
                last_used = NOW(),
                updated_at = NOW()
            RETURNING *`;

        const values = [user_id, service_name, credentials || null, service_metadata || null];
        const result = await this.pool.query(query, values);
        return result.rows[0];
    }

    // Déconnecter un service MCP
    async disconnectMCPService(user_id: string, service_name: string): Promise<boolean> {
        const query = `
            UPDATE mcp_connections 
            SET is_connected = false, last_used = NOW(), updated_at = NOW()
            WHERE user_id = $1 AND service_name = $2`;

        const result = await this.pool.query(query, [user_id, service_name]);
        return (result.rowCount || 0) > 0;
    }

    // Récupérer les connexions MCP d'un utilisateur
    async getUserMCPConnections(user_id: string): Promise<MCPConnection[]> {
        const query = `
            SELECT * FROM mcp_connections 
            WHERE user_id = $1 
            ORDER BY service_name`;

        const result = await this.pool.query(query, [user_id]);
        return result.rows;
    }

    // Mettre à jour la dernière utilisation d'un service
    async updateServiceLastUsed(user_id: string, service_name: string): Promise<void> {
        const query = `
            UPDATE mcp_connections 
            SET last_used = NOW(), updated_at = NOW()
            WHERE user_id = $1 AND service_name = $2`;

        await this.pool.query(query, [user_id, service_name]);
    }

    // === STATISTIQUES ===

    // Obtenir les statistiques globales
    async getStats(): Promise<{
        totalUsers: number;
        activeUsers: number;
        totalConnections: number;
        serviceBreakdown: { service_name: string; count: number }[];
    }> {
        const queries = [
            'SELECT COUNT(*) as count FROM users',
            'SELECT COUNT(*) as count FROM users WHERE is_active = true',
            'SELECT COUNT(*) as count FROM mcp_connections WHERE is_connected = true',
            'SELECT service_name, COUNT(*) as count FROM mcp_connections WHERE is_connected = true GROUP BY service_name'
        ];

        const [totalUsers, activeUsers, totalConnections, serviceBreakdown] = await Promise.all([
            this.pool.query(queries[0]),
            this.pool.query(queries[1]),
            this.pool.query(queries[2]),
            this.pool.query(queries[3])
        ]);

        return {
            totalUsers: parseInt(totalUsers.rows[0].count),
            activeUsers: parseInt(activeUsers.rows[0].count),
            totalConnections: parseInt(totalConnections.rows[0].count),
            serviceBreakdown: serviceBreakdown.rows
        };
    }

    // === FERMETURE ===

    // Fermer les connexions
    async close(): Promise<void> {
        await this.pool.end();
        console.log('✅ Connexions PostgreSQL fermées');
    }

    // Health check
    async healthCheck(): Promise<boolean> {
        try {
            const result = await this.pool.query('SELECT 1');
            return result.rows.length > 0;
        } catch (error) {
            console.error('❌ Health check PostgreSQL échoué:', error);
            return false;
        }
    }
}
