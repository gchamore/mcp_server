import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export class DatabaseManager {
    pool;
    isInitialized = false;
    constructor() {
        const config = {
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
            max: 10,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 10000,
        };
        if (!process.env.DATABASE_URL) {
            console.error('❌ DATABASE_URL manquante dans les variables d\'environnement');
            throw new Error('DATABASE_URL est requise');
        }
        this.pool = new Pool(config);
        this.pool.on('error', (err) => {
            console.error('❌ Erreur PostgreSQL pool:', err);
        });
        this.pool.on('connect', () => {
            console.log('✅ Nouvelle connexion PostgreSQL établie');
        });
        const dbUrl = process.env.DATABASE_URL;
        const maskedUrl = dbUrl.replace(/:\/\/[^@]*@/, '://***:***@');
        console.log(`🗄️ PostgreSQL configuré: ${maskedUrl}`);
    }
    async initialize() {
        if (this.isInitialized) {
            return;
        }
        try {
            console.log('🏗️ Initialisation de la base de données PostgreSQL...');
            const client = await this.pool.connect();
            try {
                await client.query('SELECT NOW()');
                console.log('✅ Connexion PostgreSQL établie');
            }
            finally {
                client.release();
            }
            await this.ensureTablesExist();
            this.isInitialized = true;
            console.log('✅ Base de données PostgreSQL initialisée');
        }
        catch (error) {
            console.error('❌ Erreur initialisation PostgreSQL:', error);
            throw new Error('Impossible d\'initialiser la base de données');
        }
    }
    async ensureTablesExist() {
        try {
            const client = await this.pool.connect();
            try {
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
                }
                else {
                    console.log('✅ Tables PostgreSQL déjà existantes');
                }
            }
            finally {
                client.release();
            }
        }
        catch (error) {
            console.error('❌ Erreur vérification tables:', error);
            throw error;
        }
    }
    async createTables() {
        try {
            const schemaPath = process.env.NODE_ENV === 'production'
                ? join(process.cwd(), 'src/database/schema.sql')
                : join(__dirname, '../../../src/database/schema.sql');
            const schema = readFileSync(schemaPath, 'utf8');
            const client = await this.pool.connect();
            try {
                await client.query(schema);
                console.log('✅ Tables PostgreSQL créées/vérifiées');
            }
            finally {
                client.release();
            }
        }
        catch (error) {
            console.error('❌ Erreur création tables:', error);
            throw error;
        }
    }
    async upsertUser(userData) {
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
    async getUserById(user_id) {
        const query = 'SELECT * FROM users WHERE user_id = $1 AND is_active = true';
        const result = await this.pool.query(query, [user_id]);
        return result.rows[0] || null;
    }
    async getUserByEmail(email) {
        const query = 'SELECT * FROM users WHERE email = $1 AND is_active = true';
        const result = await this.pool.query(query, [email]);
        return result.rows[0] || null;
    }
    async deactivateUser(user_id) {
        const query = 'UPDATE users SET is_active = false, updated_at = NOW() WHERE user_id = $1';
        const result = await this.pool.query(query, [user_id]);
        return (result.rowCount || 0) > 0;
    }
    async deleteUser(user_id) {
        const query = 'DELETE FROM users WHERE user_id = $1';
        const result = await this.pool.query(query, [user_id]);
        return (result.rowCount || 0) > 0;
    }
    async getAllUsers() {
        const query = 'SELECT * FROM users ORDER BY created_at DESC';
        const result = await this.pool.query(query);
        return result.rows;
    }
    async connectMCPService(user_id, service_name, credentials, service_metadata) {
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
    async disconnectMCPService(user_id, service_name) {
        const query = `
            UPDATE mcp_connections 
            SET is_connected = false, last_used = NOW(), updated_at = NOW()
            WHERE user_id = $1 AND service_name = $2`;
        const result = await this.pool.query(query, [user_id, service_name]);
        return (result.rowCount || 0) > 0;
    }
    async getUserMCPConnections(user_id) {
        const query = `
            SELECT * FROM mcp_connections 
            WHERE user_id = $1 
            ORDER BY service_name`;
        const result = await this.pool.query(query, [user_id]);
        return result.rows;
    }
    async updateServiceLastUsed(user_id, service_name) {
        const query = `
            UPDATE mcp_connections 
            SET last_used = NOW(), updated_at = NOW()
            WHERE user_id = $1 AND service_name = $2`;
        await this.pool.query(query, [user_id, service_name]);
    }
    async getStats() {
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
    async close() {
        await this.pool.end();
        console.log('✅ Connexions PostgreSQL fermées');
    }
    async healthCheck() {
        try {
            const result = await this.pool.query('SELECT 1');
            return result.rows.length > 0;
        }
        catch (error) {
            console.error('❌ Health check PostgreSQL échoué:', error);
            return false;
        }
    }
}
