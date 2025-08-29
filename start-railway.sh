#!/bin/bash

# Script de démarrage pour Railway - MCP Wesype + N8N
echo "🚀 Démarrage MCP Wesype + N8N sur Railway..."

# Configuration N8N pour Railway
export N8N_HOST=0.0.0.0
export N8N_PORT=5678
export N8N_PROTOCOL=https
export N8N_BASIC_AUTH_ACTIVE=true
export N8N_BASIC_AUTH_USER=admin
export N8N_BASIC_AUTH_PASSWORD=${N8N_PASSWORD:-"changeme123"}
export WEBHOOK_URL=https://${RAILWAY_PUBLIC_DOMAIN}
export N8N_EDITOR_BASE_URL=https://${RAILWAY_PUBLIC_DOMAIN}

# Démarrer N8N en arrière-plan
echo "🔧 Démarrage N8N sur le port 5678..."
n8n start &
N8N_PID=$!

# Attendre que N8N soit prêt
sleep 10

# Démarrer l'application principale
echo "🌐 Démarrage MCP Wesype sur le port ${PORT:-3000}..."
exec node dist/server.js
