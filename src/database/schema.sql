-- src/database/schema.sql - Schéma PostgreSQL pour les comptes utilisateur

-- Table des utilisateurs
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(32) UNIQUE NOT NULL, -- Hash basé sur email
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    picture VARCHAR(512),
    google_refresh_token TEXT, -- Chiffré
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_login_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_active BOOLEAN DEFAULT true,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table des connexions MCP
CREATE TABLE IF NOT EXISTS mcp_connections (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(32) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    service_name VARCHAR(50) NOT NULL, -- 'gmail', 'axonaut', 'notion'
    is_connected BOOLEAN DEFAULT true,
    connected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_used TIMESTAMP WITH TIME ZONE,
    credentials TEXT, -- JSON chiffré avec les credentials spécifiques au service
    service_metadata JSONB, -- Métadonnées spécifiques (ex: baseUrl pour Axonaut)
    session_id VARCHAR(64), -- ID de session unique pour identifier la session MCP active
    expires_at TIMESTAMP WITH TIME ZONE, -- Date d'expiration optionnelle
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(user_id, service_name)
);

-- Index pour performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_user_id ON users(user_id);
CREATE INDEX IF NOT EXISTS idx_mcp_connections_user_id ON mcp_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_mcp_connections_service ON mcp_connections(service_name);

-- Trigger pour updated_at automatique
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Supprimer les triggers existants s'ils existent et les recréer
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at 
    BEFORE UPDATE ON users 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_mcp_connections_updated_at ON mcp_connections;
CREATE TRIGGER update_mcp_connections_updated_at 
    BEFORE UPDATE ON mcp_connections 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
