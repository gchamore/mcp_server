import 'dotenv/config';
import express from "express";
import path from "path";
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { ServiceRegistry } from "./core/ServiceRegistry.js";
import { MultiTenantManager } from "./core/MultiTenantManager.js";
import { PostgreSQLUserManager } from "./core/PostgreSQLUserManager.js";
import { PostgreSQLSessionManager } from "./core/PostgreSQLSessionManager.js";
import { PostgreSQLHTTPSessionManager } from "./core/PostgreSQLHTTPSessionManager.js";
import { DatabaseManager } from "./database/DatabaseManager.js";
import { GmailService } from "./services/gmail/GmailService.js";
import { AxonautService } from "./services/axonaut/AxonautService.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN
        ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
        : `http://localhost:${PORT}`);
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    console.error('❌ Variables d\'environnement Google OAuth manquantes');
    console.error('Configurez GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET dans Railway');
    process.exit(1);
}
if (!process.env.ENCRYPTION_KEY) {
    console.warn('⚠️ ENCRYPTION_KEY manquante - génération d\'une clé temporaire');
    console.warn('⚠️ Configurez ENCRYPTION_KEY dans Railway pour la production');
}
console.log('🏗️ Initialisation de l\'architecture multi-services...');
const serviceRegistry = new ServiceRegistry();
const database = new DatabaseManager();
await database.initialize();
const mcpSessionManager = new PostgreSQLSessionManager(database);
const httpSessionManager = new PostgreSQLHTTPSessionManager(database);
const userManager = new PostgreSQLUserManager(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, `${BASE_URL}/auth/google/callback`, database, mcpSessionManager);
const multiTenantManager = new MultiTenantManager(serviceRegistry);
const gmailService = new GmailService(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, BASE_URL);
const axonautService = new AxonautService();
serviceRegistry.registerService(gmailService);
serviceRegistry.registerService(axonautService);
console.log('Architecture initialisée avec les services:', serviceRegistry.getServiceNames());
console.log('✅ Architecture PostgreSQL 100% initialisée');
setInterval(async () => {
    try {
        const cleanedMCP = await mcpSessionManager.cleanupExpiredSessions();
        const cleanedHTTP = await httpSessionManager.cleanupExpiredSessions();
        if (cleanedMCP > 0 || cleanedHTTP > 0) {
            console.log(`🧹 Sessions nettoyées: ${cleanedMCP} MCP, ${cleanedHTTP} HTTP`);
        }
    }
    catch (error) {
        console.error('❌ Erreur nettoyage sessions:', error);
    }
}, 60 * 60 * 1000);
setInterval(() => {
    const activeSessions = multiTenantManager.getActiveMcpSessions();
    let heartbeatCount = 0;
    for (const [sessionId, transport] of activeSessions) {
        try {
            if (transport && typeof transport.write === 'function') {
                transport.write('event: ping\ndata: {}\n\n');
                heartbeatCount++;
            }
        }
        catch (error) {
            console.warn(`⚠️ Erreur heartbeat session ${sessionId}:`, error);
            multiTenantManager.removeActiveMcpSession(sessionId);
        }
    }
    if (heartbeatCount > 0) {
        console.log(`💓 Heartbeat envoyé à ${heartbeatCount} session(s) MCP`);
    }
}, 30 * 1000);
const app = express();
app.set('trust proxy', 1);
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Cache-Control');
    res.header('Access-Control-Expose-Headers', 'Content-Length, Content-Range');
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
        return;
    }
    next();
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.header('Access-Control-Allow-Credentials', 'true');
    if (req.path.includes('/sse')) {
        res.header('Cache-Control', 'no-cache');
        res.header('Connection', 'keep-alive');
        res.header('Content-Type', 'text/event-stream');
    }
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
        return;
    }
    next();
});
app.use((req, res, next) => {
    req.cookies = {};
    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
        cookieHeader.split(';').forEach(cookie => {
            const [name, value] = cookie.trim().split('=');
            if (name && value) {
                req.cookies[name] = decodeURIComponent(value);
            }
        });
    }
    next();
});
app.use(async (req, res, next) => {
    const sessionId = req.cookies['mcp-session'];
    if (sessionId) {
        const session = await httpSessionManager.getSession(sessionId);
        if (session) {
            req.userSession = session;
        }
    }
    next();
});
const setSecureCookie = (res, name, value, maxAge) => {
    const isProduction = process.env.NODE_ENV === 'production';
    const cookieOptions = [
        `${name}=${encodeURIComponent(value)}`,
        `Max-Age=${maxAge || 7 * 24 * 60 * 60}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Strict'
    ];
    if (isProduction) {
        cookieOptions.push('Secure');
    }
    res.setHeader('Set-Cookie', cookieOptions.join('; '));
};
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
});
app.get('/api/debug/userid/:email', (req, res) => {
    const email = decodeURIComponent(req.params.email);
    const userId = userManager.createUserIdFromEmail(email);
    res.json({
        email,
        userId,
        mcpEndpoint: `${BASE_URL}/${userId}/mcp/sse`
    });
});
app.get('/api/w/:workspaceId/mcp/discover_oauth_metadata', async (req, res) => {
    console.log('[DUST.TT] Découverte OAuth metadata');
    res.json({
        endpoints: [
            {
                name: "Wesype MCP Server",
                description: "Multi-service MCP server supporting Gmail and Axonaut",
                url: `${BASE_URL}/mcp`,
                oauth: {
                    client_id: GOOGLE_CLIENT_ID,
                    auth_url: "https://accounts.google.com/o/oauth2/auth",
                    token_url: "https://oauth2.googleapis.com/token",
                    scopes: ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send"]
                }
            }
        ]
    });
});
app.get('/discover_oauth_metadata', async (req, res) => {
    console.log('[DUST.TT] Découverte OAuth metadata (endpoint simple)');
    res.json({
        endpoints: [
            {
                name: "Wesype MCP Server",
                description: "Multi-service MCP server supporting Gmail and Axonaut",
                url: `${BASE_URL}/mcp`,
                oauth: {
                    client_id: GOOGLE_CLIENT_ID,
                    auth_url: "https://accounts.google.com/o/oauth2/auth",
                    token_url: "https://oauth2.googleapis.com/token",
                    scopes: ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send"]
                }
            }
        ]
    });
});
app.get('/mcp', async (req, res) => {
    console.log(`[MCP-DUST] Connexion MCP globale depuis Dust.tt`);
    const demoUserId = "df07fc29133a08605492e76941c54606";
    let userSession = multiTenantManager.getUserSession(demoUserId);
    if (!userSession) {
        const gmailSession = gmailService.getGmailSession(demoUserId);
        if (gmailSession) {
            multiTenantManager.createUserSession(demoUserId);
            userSession = multiTenantManager.getUserSession(demoUserId);
            if (userSession) {
                userSession.services.gmail = gmailSession;
            }
        }
    }
    if (!userSession) {
        console.log('[MCP-DUST] Aucune session utilisateur trouvée, création d\'une session par défaut');
        multiTenantManager.createUserSession(demoUserId);
        userSession = multiTenantManager.getUserSession(demoUserId);
    }
    const connectedServices = multiTenantManager.getConnectedServices(demoUserId);
    console.log(`[MCP-DUST] Services connectés: ${connectedServices.join(', ')}`);
    if (connectedServices.length === 0) {
        console.log('[MCP-DUST] Aucun service connecté, serveur MCP minimal');
    }
    let transport = undefined;
    let sessionId = undefined;
    try {
        req.socket.setTimeout(0);
        req.socket.setNoDelay(true);
        req.socket.setKeepAlive(true);
        transport = new SSEServerTransport(`/mcp/message`, res);
        sessionId = transport.sessionId;
        const server = new McpServer({
            name: "Wesype MCP Server",
            version: "2.0.0",
        });
        for (const serviceName of connectedServices) {
            const service = serviceRegistry.getService(serviceName);
            const serviceSession = multiTenantManager.getServiceSession(demoUserId, serviceName);
            if (service && serviceSession) {
                console.log(`[MCP-DUST] Enregistrement des outils ${serviceName}...`);
                service.registerTools(server, serviceSession);
            }
        }
        if (connectedServices.length === 0) {
            server.tool("wesype_status", "Obtenir le statut du serveur Wesype", {}, async () => {
                return {
                    content: [
                        {
                            type: "text",
                            text: `🔧 **Serveur Wesype MCP**\n\n` +
                                `Services disponibles: Gmail, Axonaut\n` +
                                `Services connectés: ${connectedServices.length}\n` +
                                `Pour utiliser les services, connectez-vous via: ${BASE_URL}`
                        }
                    ]
                };
            });
        }
        multiTenantManager.setActiveMcpSession(sessionId, transport);
        server.connect(transport).then(() => {
            console.log(`[MCP-DUST] Serveur MCP connecté pour Dust.tt`);
        });
    }
    catch (error) {
        console.error(`[MCP-DUST] Erreur connexion:`, error);
        if (sessionId) {
            multiTenantManager.removeActiveMcpSession(sessionId);
        }
        if (transport) {
            transport.close();
        }
        res.status(500).send('Internal server error');
    }
});
app.post('/mcp/message', async (req, res) => {
    const sessionId = req.query.sessionId;
    const transport = multiTenantManager.getActiveMcpSession(sessionId);
    if (!transport) {
        res.status(404).json({ error: 'Session MCP not found' });
        return;
    }
    transport.handlePostMessage(req, res);
});
app.get('/api/mcp/metadata', async (req, res) => {
    res.json({
        name: "Wesype MCP Server",
        version: "1.0.0",
        description: "Multi-service MCP server supporting Gmail and Axonaut",
        capabilities: ["gmail", "axonaut"],
        endpoint: `${BASE_URL}/mcp`
    });
});
app.get('/:userId/mcp/sse', async (req, res) => {
    const userId = req.params.userId;
    let userSession = multiTenantManager.getUserSession(userId);
    if (!userSession) {
        const gmailSession = gmailService.getGmailSession(userId);
        if (gmailSession) {
            multiTenantManager.createUserSession(userId);
            userSession = multiTenantManager.getUserSession(userId);
            if (userSession) {
                userSession.services.gmail = gmailSession;
            }
        }
    }
    if (!userSession) {
        console.log(`[MCP] Création d'une session par défaut pour l'utilisateur ${userId}`);
        multiTenantManager.createUserSession(userId);
        userSession = multiTenantManager.getUserSession(userId);
    }
    if (!userSession) {
        res.status(500).send('Cannot create user session');
        return;
    }
    const connectedServices = multiTenantManager.getConnectedServices(userId);
    console.log(`[MCP] Connection multi-services pour l'utilisateur ${userId}`);
    console.log(`[MCP] Services connectés: ${connectedServices.join(', ') || 'aucun'}`);
    if (connectedServices.length === 0) {
        console.log(`[MCP] Aucun service connecté pour ${userId}, création d'un serveur MCP minimal`);
    }
    let transport = undefined;
    let sessionId = undefined;
    try {
        req.socket.setTimeout(0);
        req.socket.setNoDelay(true);
        req.socket.setKeepAlive(true);
        transport = new SSEServerTransport(`/${userId}/mcp/message`, res);
        sessionId = transport.sessionId;
        let serverName = "MCP";
        if (connectedServices.length === 1) {
            const serviceName = connectedServices[0];
            const service = serviceRegistry.getService(serviceName);
            serverName = `MCP ${service?.displayName || serviceName}`;
        }
        else if (connectedServices.length > 1) {
            serverName = "MCP Multi-Services";
        }
        else {
            serverName = "MCP Wesype";
        }
        const server = new McpServer({
            name: serverName,
            version: "2.0.0",
        });
        for (const serviceName of connectedServices) {
            const service = serviceRegistry.getService(serviceName);
            const serviceSession = multiTenantManager.getServiceSession(userId, serviceName);
            if (service && serviceSession) {
                console.log(`[MCP] Enregistrement des outils ${serviceName}...`);
                service.registerTools(server, serviceSession);
            }
        }
        if (connectedServices.length === 0) {
            console.log(`[MCP] Ajout d'outils de démonstration pour ${userId}`);
            server.tool("wesype_status", "Obtenir le statut du serveur Wesype MCP", {
                type: "object",
                properties: {},
            }, async () => {
                return {
                    content: [
                        {
                            type: "text",
                            text: `🔧 Serveur Wesype MCP actif
									
Utilisateur: ${userId}
Services disponibles: Gmail, Axonaut
Services connectés: ${connectedServices.length}

Pour connecter des services:
- Gmail: ${BASE_URL}/pages/gmail.html
- Axonaut: ${BASE_URL}/pages/axonaut.html`
                        }
                    ],
                };
            });
            server.tool("list_available_services", "Lister les services disponibles sur ce serveur MCP", {
                type: "object",
                properties: {},
            }, async () => {
                const services = serviceRegistry.getAllServices().map(s => ({
                    name: s.serviceName,
                    displayName: s.displayName,
                    enabled: s.isEnabled(),
                    description: s.serviceName === 'gmail' ? 'Service Gmail pour emails' : 'Service Axonaut CRM'
                }));
                return {
                    content: [
                        {
                            type: "text",
                            text: `📋 Services disponibles:\n\n${services.map(s => `• ${s.displayName} (${s.name}) - ${s.enabled ? '✅ Activé' : '❌ Désactivé'}\n  ${s.description}`).join('\n\n')}`
                        }
                    ],
                };
            });
        }
        multiTenantManager.setActiveMcpSession(sessionId, transport);
        transport.onclose = () => {
            console.log(`[MCP] Transport fermé pour ${userId}`);
            if (sessionId) {
                multiTenantManager.removeActiveMcpSession(sessionId);
            }
        };
        transport.onerror = (error) => {
            console.error(`[MCP] Erreur transport pour ${userId}:`, error);
        };
        console.log(`[MCP] Tentative de connexion du serveur MCP pour ${userId}...`);
        server.connect(transport).then(() => {
            console.log(`[MCP] ✅ Serveur MCP connecté avec succès pour ${userId}`);
            console.log(`[MCP] Services: ${connectedServices.join(', ') || 'aucun'}`);
            console.log(`[MCP] Session ID: ${sessionId}`);
            const heartbeatInterval = setInterval(() => {
                try {
                    if (res && !res.headersSent && !res.destroyed) {
                        res.write('data: {"type":"heartbeat","timestamp":' + Date.now() + '}\n\n');
                        console.log(`[MCP] ❤️ Heartbeat envoyé pour ${userId}`);
                    }
                    else {
                        clearInterval(heartbeatInterval);
                        console.log(`[MCP] Heartbeat arrêté pour ${userId} (connexion fermée)`);
                    }
                }
                catch (error) {
                    console.error(`[MCP] Erreur heartbeat pour ${userId}:`, error);
                    clearInterval(heartbeatInterval);
                }
            }, 30000);
            req.on('close', () => {
                console.log(`[MCP] Connexion fermée pour ${userId}`);
                clearInterval(heartbeatInterval);
                if (sessionId) {
                    multiTenantManager.removeActiveMcpSession(sessionId);
                }
            });
        }).catch((error) => {
            console.error(`[MCP] ❌ Erreur lors de la connexion du serveur pour ${userId}:`, error);
            if (sessionId) {
                multiTenantManager.removeActiveMcpSession(sessionId);
            }
            if (transport) {
                transport.close();
            }
        });
    }
    catch (error) {
        console.error(`[MCP] Erreur connexion pour ${userId}:`, error);
        if (sessionId) {
            multiTenantManager.removeActiveMcpSession(sessionId);
        }
        if (transport) {
            transport.close();
        }
        res.status(500).send('Internal server error');
    }
});
app.post('/:userId/mcp/message', async (req, res) => {
    const userId = req.params.userId;
    const sessionId = req.query.sessionId;
    console.log(`[MCP] Message reçu pour ${userId}, session: ${sessionId}`);
    console.log(`[MCP] Body:`, JSON.stringify(req.body, null, 2));
    const transport = multiTenantManager.getActiveMcpSession(sessionId);
    if (!transport) {
        console.error(`[MCP] Session MCP introuvable: ${sessionId}`);
        res.status(404).json({ error: 'Session MCP not found' });
        return;
    }
    try {
        console.log(`[MCP] Traitement du message pour ${userId}`);
        transport.handlePostMessage(req, res);
    }
    catch (error) {
        console.error(`[MCP] Erreur traitement message:`, error);
        res.status(500).json({ error: 'Message processing error' });
    }
});
app.post('/:userId/mcp/sse', async (req, res) => {
    const userId = req.params.userId;
    console.log(`[MCP] POST SSE pour ${userId}`);
    let userSession = multiTenantManager.getUserSession(userId);
    if (!userSession) {
        const gmailSession = gmailService.getGmailSession(userId);
        if (gmailSession) {
            multiTenantManager.createUserSession(userId);
            userSession = multiTenantManager.getUserSession(userId);
            if (userSession) {
                userSession.services.gmail = gmailSession;
            }
        }
    }
    if (!userSession) {
        console.log(`[MCP] Création d'une session par défaut pour l'utilisateur ${userId} (POST)`);
        multiTenantManager.createUserSession(userId);
        userSession = multiTenantManager.getUserSession(userId);
    }
    if (!userSession) {
        res.status(500).send('Cannot create user session');
        return;
    }
    const connectedServices = multiTenantManager.getConnectedServices(userId);
    console.log(`[MCP] POST SSE - Services connectés: ${connectedServices.join(', ') || 'aucun'}`);
    let transport = undefined;
    let sessionId = undefined;
    try {
        req.socket.setTimeout(0);
        req.socket.setNoDelay(true);
        req.socket.setKeepAlive(true);
        transport = new SSEServerTransport(`/${userId}/mcp/message`, res);
        sessionId = transport.sessionId;
        const server = new McpServer({
            name: connectedServices.length > 0 ? "MCP Multi-Services" : "MCP Wesype",
            version: "2.0.0",
        });
        if (connectedServices.length > 0) {
            for (const serviceName of connectedServices) {
                const service = serviceRegistry.getService(serviceName);
                const serviceSession = multiTenantManager.getServiceSession(userId, serviceName);
                if (service && serviceSession) {
                    console.log(`[MCP] POST - Enregistrement des outils ${serviceName}...`);
                    service.registerTools(server, serviceSession);
                }
            }
        }
        else {
            server.tool("mcp_status", "Obtenir le statut du serveur MCP", {}, async () => {
                return {
                    content: [{
                            type: "text",
                            text: `🚀 **MCP Wesype**\n\nServeur MCP actif pour l'utilisateur ${userId}\n\n📊 Services connectés: ${connectedServices.length}\n⏰ ${new Date().toLocaleString()}`
                        }]
                };
            });
        }
        multiTenantManager.setActiveMcpSession(sessionId, transport);
        server.connect(transport).then(() => {
            console.log(`[MCP] POST SSE - Serveur connecté pour ${userId}`);
        });
    }
    catch (error) {
        console.error(`[MCP] Erreur POST SSE pour ${userId}:`, error);
        if (sessionId) {
            multiTenantManager.removeActiveMcpSession(sessionId);
        }
        if (transport) {
            transport.close();
        }
        res.status(500).send('Internal server error');
    }
});
app.get('/:userId/gmail/sse', (req, res) => {
    const userId = req.params.userId;
    console.log(`[COMPATIBILITÉ] Redirection ${userId}/gmail/sse vers ${userId}/mcp/sse`);
    res.redirect(`/${userId}/mcp/sse`);
});
app.post('/:userId/gmail/message', (req, res) => {
    const userId = req.params.userId;
    const sessionId = req.query.sessionId;
    console.log(`[COMPATIBILITÉ] Redirection ${userId}/gmail/message vers ${userId}/mcp/message`);
    res.redirect(301, `/${userId}/mcp/message?sessionId=${sessionId}`);
});
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});
app.get('/home', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});
app.get('/pages/:serviceName.html', (req, res) => {
    const serviceName = req.params.serviceName;
    const servicePage = path.join(__dirname, '..', 'public', 'pages', `${serviceName}.html`);
    if (!serviceRegistry.hasService(serviceName)) {
        return res.status(404).send('Service non trouvé');
    }
    res.sendFile(servicePage, (err) => {
        if (err) {
            res.status(404).send('Page de service non trouvée');
        }
    });
});
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index_dashboard.html'));
});
app.get('/detailed', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index_detailed.html'));
});
app.get('/api/user/:userId/connections', async (req, res) => {
    try {
        const userId = req.params.userId;
        if (!userId) {
            return res.status(400).json({ error: 'UserId manquant' });
        }
        const user = await userManager.getUser(userId);
        console.log(`[CONNECTIONS API] Utilisateur trouvé:`, user ? `Email: ${user.email}` : 'Utilisateur non trouvé');
        const connections = await database.getUserMCPConnections(userId);
        const gmailConnection = connections.find(conn => conn.service_name === 'gmail');
        if (gmailConnection && gmailConnection.is_connected) {
            const mcpEndpoint = `${BASE_URL}/${userId}/mcp/sse`;
            return res.json({
                success: true,
                connections: {
                    gmail: {
                        isConnected: true,
                        connectedAt: gmailConnection.connected_at,
                        lastUsed: gmailConnection.last_used,
                        mcpEndpoint: mcpEndpoint,
                        userEmail: user?.email || 'Email non disponible'
                    }
                }
            });
        }
        else {
            return res.json({
                success: true,
                connections: {
                    gmail: {
                        isConnected: false
                    }
                }
            });
        }
    }
    catch (error) {
        console.error('Erreur lors de la vérification des connexions:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});
app.post('/api/user/:userId/disconnect/:serviceName', async (req, res) => {
    try {
        const userId = req.params.userId;
        const serviceName = req.params.serviceName;
        if (!userId || !serviceName) {
            return res.status(400).json({ error: 'Paramètres manquants' });
        }
        if (!['gmail', 'axonaut', 'notion'].includes(serviceName)) {
            return res.status(400).json({ error: 'Service non valide' });
        }
        const success = await database.disconnectMCPService(userId, serviceName);
        if (success) {
            if (serviceName === 'gmail') {
                gmailService.removeSession(userId);
            }
            else if (serviceName === 'axonaut') {
                axonautService.removeSession(userId);
            }
            res.json({
                success: true,
                message: `Service ${serviceName} déconnecté avec succès`
            });
        }
        else {
            res.status(404).json({
                success: false,
                error: 'Service non trouvé ou déjà déconnecté'
            });
        }
    }
    catch (error) {
        console.error('Erreur lors de la déconnexion:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});
app.delete('/api/user/:userId/delete-mcp/:serviceName', async (req, res) => {
    try {
        const userId = req.params.userId;
        const serviceName = req.params.serviceName;
        console.log(`[DELETE MCP] Tentative de suppression - UserId: ${userId}, Service: ${serviceName}`);
        if (!userId || !serviceName) {
            return res.status(400).json({ error: 'Paramètres manquants' });
        }
        if (!['gmail', 'axonaut', 'notion'].includes(serviceName)) {
            return res.status(400).json({ error: 'Service non valide' });
        }
        const success = await database.deleteMCPService(userId, serviceName);
        console.log(`[DELETE MCP] Résultat suppression - Success: ${success}`);
        if (success) {
            if (serviceName === 'gmail') {
                gmailService.removeSession(userId);
            }
            else if (serviceName === 'axonaut') {
                axonautService.removeSession(userId);
            }
            res.json({
                success: true,
                message: `MCP ${serviceName} supprimé avec succès`
            });
        }
        else {
            res.status(404).json({
                success: false,
                error: 'Service non trouvé ou déjà supprimé'
            });
        }
    }
    catch (error) {
        console.error('Erreur lors de la suppression du MCP:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});
app.get('/api/session/current', async (req, res) => {
    try {
        let userId = req.query.userId;
        if (!userId) {
            const authHeader = req.headers.authorization;
            if (authHeader && authHeader.startsWith('Bearer ')) {
            }
        }
        if (!userId) {
            try {
                const redisPersistence = global.redisPersistence;
                if (redisPersistence && redisPersistence.isAvailable) {
                }
            }
            catch (e) {
            }
        }
        if (userId) {
            res.json({
                success: true,
                userId: userId
            });
        }
        else {
            res.json({
                success: false,
                error: 'Aucune session active trouvée'
            });
        }
    }
    catch (error) {
        console.error('Erreur lors de la récupération de session:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});
app.get('/api/services', (req, res) => {
    res.json({
        success: true,
        services: serviceRegistry.getServicesConfig(),
        stats: serviceRegistry.getStats()
    });
});
app.get('/api/users/:userId/services', (req, res) => {
    const userId = req.params.userId;
    const connectedServices = multiTenantManager.getConnectedServices(userId);
    const serviceDetails = connectedServices.map(serviceName => {
        const service = serviceRegistry.getService(serviceName);
        const session = multiTenantManager.getServiceSession(userId, serviceName);
        return {
            name: serviceName,
            displayName: service?.displayName || serviceName,
            isConnected: true,
            userEmail: session?.userEmail,
            lastAccessed: session?.lastAccessed
        };
    });
    res.json({
        success: true,
        userId,
        connectedServices: serviceDetails,
        mcpEndpoint: `${BASE_URL}/${userId}/mcp/sse`
    });
});
app.get('/api/google/client-id', (req, res) => {
    res.json({
        clientId: GOOGLE_CLIENT_ID
    });
});
app.get('/api/auth/google', async (req, res) => {
    try {
        const authUrl = userManager.getAuthUrl();
        res.json({
            success: true,
            authUrl
        });
    }
    catch (error) {
        console.error('❌ Erreur génération URL auth Google:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur lors de la génération de l\'URL d\'authentification'
        });
    }
});
app.post('/api/auth/google/start', async (req, res) => {
    try {
        const { OAuth2Client } = await import('google-auth-library');
        const oauth2Client = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, `${BASE_URL}/auth/google/callback`);
        const authUrl = oauth2Client.generateAuthUrl({
            access_type: 'offline',
            prompt: 'consent',
            scope: [
                'https://www.googleapis.com/auth/userinfo.email',
                'https://www.googleapis.com/auth/userinfo.profile'
            ],
        });
        res.json({
            success: true,
            authUrl
        });
    }
    catch (error) {
        console.error('❌ Erreur génération URL auth Google:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur lors de la génération de l\'URL d\'authentification'
        });
    }
});
app.get('/auth/google/callback', async (req, res) => {
    try {
        const { code, error } = req.query;
        if (error) {
            console.error('❌ Erreur OAuth Google:', error);
            return res.redirect('/?error=access_denied');
        }
        if (!code) {
            return res.redirect('/?error=no_code');
        }
        const authResult = await userManager.authenticateWithGoogle(code);
        const { userId, user } = authResult;
        if (!user) {
            console.error('❌ Utilisateur non trouvé après authentification');
            return res.redirect('/?error=user_not_found');
        }
        const sessionId = await httpSessionManager.createSession({
            userId: user.user_id,
            email: user.email,
            name: user.name,
            picture: user.picture
        });
        setSecureCookie(res, 'mcp-session', sessionId);
        res.redirect('/pages/services.html?auth=success');
    }
    catch (error) {
        console.error('❌ Erreur callback Google:', error);
        res.redirect('/?error=callback_error');
    }
});
app.get('/auth/google/callback/gmail', async (req, res) => {
    try {
        const { code, error, state } = req.query;
        if (error) {
            console.error('❌ Erreur OAuth Gmail:', error);
            return res.redirect('/pages/gmail.html?error=access_denied');
        }
        if (!code) {
            return res.redirect('/pages/gmail.html?error=no_code');
        }
        let userId = null;
        if (state) {
            const stateParams = new URLSearchParams(state);
            userId = stateParams.get('userId');
        }
        if (!userId) {
            console.error('❌ UserId manquant dans le state OAuth');
            return res.redirect('/pages/gmail.html?error=invalid_state');
        }
        const user = await userManager.getUser(userId);
        if (!user) {
            console.error('❌ Utilisateur non trouvé:', userId);
            return res.redirect('/?error=user_not_found');
        }
        const authResult = await gmailService.handleCallback(code);
        if (authResult.success && authResult.userId) {
            const gmailSession = gmailService.gmailSessions.get(authResult.userId);
            if (gmailSession) {
                await userManager.connectGmailService(userId, gmailSession.encryptedRefreshToken || '', gmailSession.encryptedAccessToken || '', authResult.userEmail || '', undefined);
                return res.redirect(`/pages/gmail.html?success=true&userId=${userId}&email=${encodeURIComponent(authResult.userEmail || '')}`);
            }
            else {
                return res.redirect('/pages/gmail.html?error=session_not_found');
            }
        }
        else {
            return res.redirect('/pages/gmail.html?error=auth_failed');
        }
    }
    catch (error) {
        console.error('❌ Erreur callback Gmail:', error);
        return res.redirect('/pages/gmail.html?error=server_error');
    }
});
app.get('/auth/axonaut/callback', async (req, res) => {
    try {
        return res.redirect('/pages/axonaut.html?auth=success');
    }
    catch (error) {
        console.error('❌ Erreur callback Axonaut:', error);
        return res.redirect('/pages/axonaut.html?error=server_error');
    }
});
app.get('/api/user/me', async (req, res) => {
    if (!req.userSession) {
        return res.status(401).json({
            success: false,
            error: 'Non authentifié'
        });
    }
    res.json({
        success: true,
        user: {
            userId: req.userSession.userId,
            email: req.userSession.email,
            name: req.userSession.name,
            picture: req.userSession.picture
        }
    });
});
app.post('/api/auth/logout', async (req, res) => {
    const sessionId = req.cookies['mcp-session'];
    if (sessionId) {
        await httpSessionManager.deleteSession(sessionId);
    }
    res.setHeader('Set-Cookie', 'mcp-session=; Max-Age=0; Path=/; HttpOnly');
    res.json({
        success: true,
        message: 'Déconnexion réussie'
    });
});
app.post('/auth/google/callback', async (req, res) => {
    try {
        const { code } = req.body;
        if (!code) {
            return res.status(400).json({
                success: false,
                error: 'Code Google manquant'
            });
        }
        const userId = await userManager.authenticateWithGoogle(code);
        res.json({
            success: true,
            userId,
            redirectUrl: `/pages/services.html?userId=${userId}`
        });
    }
    catch (error) {
        console.error('❌ Erreur authentification Google:', error);
        res.status(401).json({
            success: false,
            error: 'Authentification Google échouée'
        });
    }
});
app.post('/api/auth/google', async (req, res) => {
    try {
        const { googleCode } = req.body;
        if (!googleCode) {
            return res.status(400).json({
                success: false,
                error: 'Code Google manquant'
            });
        }
        const userId = await userManager.authenticateWithGoogle(googleCode);
        res.json({
            success: true,
            userId,
            redirectUrl: `/pages/services.html?userId=${userId}`
        });
    }
    catch (error) {
        console.error('❌ Erreur authentification Google:', error);
        res.status(401).json({
            success: false,
            error: 'Authentification Google échouée'
        });
    }
});
app.get('/api/account/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const user = await userManager.getUser(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'Utilisateur non trouvé'
            });
        }
        const connectedServices = [];
        const mcpConnections = await userManager.getUserMCPConnections(userId);
        if (mcpConnections) {
            const gmailConnection = mcpConnections.find(c => c.service_name === 'gmail' && c.is_connected);
            if (gmailConnection) {
                connectedServices.push({
                    name: 'gmail',
                    displayName: 'Gmail',
                    connectedAt: gmailConnection.connected_at,
                    lastUsed: gmailConnection.last_used
                });
            }
            const axonautConnection = mcpConnections.find(c => c.service_name === 'axonaut' && c.is_connected);
            if (axonautConnection) {
                connectedServices.push({
                    name: 'axonaut',
                    displayName: 'Axonaut',
                    connectedAt: axonautConnection.connected_at,
                    lastUsed: axonautConnection.last_used
                });
            }
            const notionConnection = mcpConnections.find(c => c.service_name === 'notion' && c.is_connected);
            if (notionConnection) {
                connectedServices.push({
                    name: 'notion',
                    displayName: 'Notion',
                    connectedAt: notionConnection.connected_at,
                    lastUsed: notionConnection.last_used
                });
            }
        }
        res.json({
            success: true,
            user: {
                email: user.email,
                name: user.name,
                picture: user.picture,
                createdAt: user.created_at,
                lastLoginAt: user.last_login_at
            },
            connectedServices
        });
    }
    catch (error) {
        console.error('❌ Erreur récupération compte:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur'
        });
    }
});
app.post('/api/account/:userId/disconnect/:serviceName', async (req, res) => {
    try {
        const { userId, serviceName } = req.params;
        const user = await userManager.getUser(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'Utilisateur non trouvé'
            });
        }
        const success = await userManager.disconnectMCPService(userId, serviceName);
        const removed = multiTenantManager.removeServiceSession(userId, serviceName);
        if (success && removed) {
            if (serviceName === 'gmail') {
                gmailService.removeSession(userId);
            }
            else if (serviceName === 'axonaut') {
                axonautService.removeSession(userId);
            }
            res.json({
                success: true,
                message: `Service ${serviceName} déconnecté avec succès`
            });
        }
        else {
            res.status(404).json({
                success: false,
                error: 'Service non trouvé ou déjà déconnecté'
            });
        }
    }
    catch (error) {
        console.error('❌ Erreur déconnexion service:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur lors de la déconnexion'
        });
    }
});
app.delete('/api/account/:userId/delete', async (req, res) => {
    try {
        const { userId } = req.params;
        const user = await userManager.getUser(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'Utilisateur non trouvé'
            });
        }
        const userSession = multiTenantManager.getUserSession(userId);
        if (userSession) {
            if (userSession.services.gmail) {
                gmailService.removeSession(userId);
            }
            if (userSession.services.axonaut) {
                axonautService.removeSession(userId);
            }
        }
        multiTenantManager.getUserSessionsMap().delete(userId);
        await userManager.deleteUser(userId);
        res.json({
            success: true,
            message: 'Compte supprimé avec succès'
        });
    }
    catch (error) {
        console.error('❌ Erreur suppression compte:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur lors de la suppression du compte'
        });
    }
});
app.get('/api/admin/stats', async (req, res) => {
    try {
        const stats = await userManager.getUsageStats();
        res.json(stats);
    }
    catch (error) {
        console.error('❌ Erreur récupération statistiques admin:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur'
        });
    }
});
app.get('/api/admin/users', async (req, res) => {
    try {
        const allUsers = await database.getAllUsers();
        const usersWithConnections = await Promise.all(allUsers.map(async (user) => {
            const mcpConnections = await userManager.getUserMCPConnections(user.user_id);
            return {
                ...user,
                mcpConnections
            };
        }));
        res.json(usersWithConnections);
    }
    catch (error) {
        console.error('❌ Erreur récupération utilisateurs admin:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur'
        });
    }
});
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/pages/admin.html'));
});
app.post('/api/auth/start', async (req, res) => {
    try {
        const authUrl = gmailService.createAuthUrl();
        res.json({
            success: true,
            authUrl: authUrl,
            service: 'gmail'
        });
    }
    catch (error) {
        console.error('[OAuth] Erreur création URL:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur lors de la génération de l\'URL d\'authentification'
        });
    }
});
app.post('/api/oauth/gmail', async (req, res) => {
    console.log('🚀 [API-OAUTH-GMAIL] Route appelée');
    console.log('🍪 [API-OAUTH-GMAIL] Cookies:', req.cookies);
    try {
        const sessionId = req.cookies['mcp-session'];
        if (!sessionId) {
            console.error('❌ [API-OAUTH-GMAIL] Pas de session');
            return res.status(401).json({
                success: false,
                error: 'Session utilisateur requise'
            });
        }
        const session = await httpSessionManager.getSession(sessionId);
        if (!session) {
            console.error('❌ [API-OAUTH-GMAIL] Session invalide');
            return res.status(401).json({
                success: false,
                error: 'Session utilisateur invalide'
            });
        }
        console.log('👤 [API-OAUTH-GMAIL] Session utilisateur valide:', session.email);
        const state = `flow=gmail&userId=${session.userId}`;
        const authUrl = gmailService.createAuthUrl(state);
        console.log('🔗 [API-OAUTH-GMAIL] URL générée avec userId dans state:', authUrl);
        res.json({
            success: true,
            authUrl: authUrl,
            service: 'gmail'
        });
    }
    catch (error) {
        console.error('❌ [API-OAUTH-GMAIL] Erreur création URL:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur lors de la génération de l\'URL d\'authentification Gmail'
        });
    }
});
app.get('/oauth/callback', async (req, res) => {
    const code = req.query.code;
    const error = req.query.error;
    if (error || !code) {
        console.error('[OAuth] Erreur callback:', error || 'Code manquant');
        return res.redirect(`/pages/gmail.html?error=${encodeURIComponent(error || 'Code d\'autorisation manquant')}`);
    }
    try {
        const authResult = await gmailService.handleCallback(code);
        if (authResult.success && authResult.userId) {
            console.log(`[OAuth] Authentification réussie pour ${authResult.userEmail}: ${authResult.userId}`);
            let userSession = multiTenantManager.getUserSession(authResult.userId);
            if (!userSession) {
                multiTenantManager.createUserSession(authResult.userId);
                userSession = multiTenantManager.getUserSession(authResult.userId);
            }
            const gmailSession = gmailService.getGmailSession(authResult.userId);
            if (userSession && gmailSession) {
                multiTenantManager.addServiceSession(authResult.userId, 'gmail', gmailSession);
                console.log(`[Gmail] Session ajoutée à l'utilisateur ${authResult.userId}`);
            }
            console.log(`✅ Session Gmail ${authResult.userId} sauvegardée en PostgreSQL`);
            res.redirect(`/pages/gmail.html?success=true&userId=${authResult.userId}&email=${encodeURIComponent(authResult.userEmail || '')}&service=gmail`);
        }
        else {
            throw new Error(authResult.error || 'Erreur inconnue');
        }
    }
    catch (error) {
        console.error('[OAuth] Erreur traitement callback:', error);
        res.redirect(`/pages/gmail.html?error=${encodeURIComponent('Erreur lors de l\'authentification')}`);
    }
});
app.post('/api/axonaut/auth', express.json(), async (req, res) => {
    const { userId, apiKey, baseUrl } = req.body;
    if (!userId || !apiKey || !baseUrl) {
        return res.status(400).json({
            success: false,
            error: 'userId, apiKey et baseUrl sont requis'
        });
    }
    try {
        console.log(`[Axonaut] Tentative d'authentification pour l'utilisateur ${userId}`);
        const existingUser = await userManager.getUser(userId);
        if (!existingUser) {
            return res.status(400).json({
                success: false,
                error: 'Utilisateur non trouvé. Veuillez vous connecter d\'abord via Google.'
            });
        }
        console.log(`✅ Utilisateur existant trouvé: ${existingUser.email}`);
        const authResult = await axonautService.authenticateWithApiKey(apiKey, baseUrl, existingUser.email, userId);
        if (authResult.success && authResult.userId) {
            const axonautSession = axonautService.getAxonautSession(authResult.userId);
            if (!axonautSession) {
                throw new Error('Session Axonaut non trouvée après création');
            }
            const mcpSession = await userManager.connectAxonautService(userId, apiKey, baseUrl, authResult.userEmail || existingUser.email);
            let userSession = multiTenantManager.getUserSession(userId);
            if (!userSession) {
                multiTenantManager.createUserSession(userId);
                userSession = multiTenantManager.getUserSession(userId);
            }
            if (userSession) {
                multiTenantManager.addServiceSession(userId, 'axonaut', axonautSession);
                console.log(`[Axonaut] Authentification réussie pour ${userId}`);
                console.log(`✅ Session Axonaut ${userId} sauvegardée en PostgreSQL avec ID: ${mcpSession.sessionId}`);
                res.json({
                    success: true,
                    message: 'Authentification Axonaut réussie',
                    userId,
                    service: 'axonaut',
                    userEmail: authResult.userEmail,
                    mcpEndpoint: `${BASE_URL}/${userId}/mcp/sse`,
                    sessionId: mcpSession.sessionId
                });
            }
            else {
                throw new Error('Erreur lors de la création de la session utilisateur');
            }
        }
        else {
            res.status(401).json({
                success: false,
                error: authResult.error || 'Erreur d\'authentification Axonaut'
            });
        }
    }
    catch (error) {
        console.error('[Axonaut] Erreur authentification:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur lors de l\'authentification Axonaut'
        });
    }
});
app.post('/api/disconnect/:userId/:serviceName', async (req, res) => {
    const { userId, serviceName } = req.params;
    try {
        console.log(`[Disconnect] Tentative de déconnexion ${serviceName} pour l'utilisateur ${userId}`);
        const service = serviceRegistry.getService(serviceName);
        if (!service) {
            return res.status(404).json({
                success: false,
                error: `Service ${serviceName} non trouvé`
            });
        }
        let hasSession = multiTenantManager.hasServiceSession(userId, serviceName);
        if (!hasSession && serviceName === 'gmail') {
            const gmailSession = gmailService.getGmailSession(userId);
            hasSession = !!gmailSession;
            console.log(`[Disconnect] Session Gmail trouvée directement dans GmailService: ${!!gmailSession}`);
        }
        if (!hasSession && serviceName === 'axonaut') {
            const axonautSession = axonautService.getAxonautSession(userId);
            hasSession = !!axonautSession;
            console.log(`[Disconnect] Session Axonaut trouvée directement dans AxonautService: ${!!axonautSession}`);
        }
        let hasDatabaseConnection = false;
        try {
            const connections = await database.getUserMCPConnections(userId);
            hasDatabaseConnection = connections.some(conn => conn.service_name === serviceName && conn.is_connected);
            console.log(`[Disconnect] Connexion ${serviceName} trouvée en base de données: ${hasDatabaseConnection}`);
        }
        catch (dbError) {
            console.warn(`[Disconnect] Erreur vérification base de données:`, dbError);
        }
        if (!hasSession && !hasDatabaseConnection) {
            console.log(`[Disconnect] Aucune session ${serviceName} active ni connexion en base pour l'utilisateur ${userId}`);
            return res.status(404).json({
                success: false,
                error: `Aucune session active ${serviceName} trouvée pour l'utilisateur ${userId}`
            });
        }
        let removed = false;
        let serviceSpecificRemoved = false;
        let databaseDisconnected = false;
        try {
            removed = multiTenantManager.removeServiceSession(userId, serviceName);
            console.log(`[Disconnect] Session ${serviceName} supprimée du MultiTenantManager: ${removed}`);
            if (serviceName === 'gmail') {
                serviceSpecificRemoved = gmailService.removeSession(userId);
                console.log(`[Disconnect] Session Gmail supprimée du service: ${serviceSpecificRemoved}`);
            }
            else if (serviceName === 'axonaut') {
                serviceSpecificRemoved = axonautService.removeSession(userId);
                console.log(`[Disconnect] Session Axonaut supprimée du service: ${serviceSpecificRemoved}`);
            }
            if (hasDatabaseConnection) {
                databaseDisconnected = await database.disconnectMCPService(userId, serviceName);
                console.log(`[Disconnect] Connexion ${serviceName} supprimée de la base de données: ${databaseDisconnected}`);
            }
            const overallSuccess = removed || serviceSpecificRemoved || databaseDisconnected;
            if (overallSuccess) {
                console.log(`[Disconnect] Déconnexion ${serviceName} réussie pour l'utilisateur ${userId}`);
                res.json({
                    success: true,
                    message: `Déconnexion ${serviceName} réussie`,
                    userId,
                    service: serviceName,
                    details: {
                        multiTenantManager: removed,
                        serviceSpecific: serviceSpecificRemoved,
                        database: databaseDisconnected
                    }
                });
            }
            else {
                console.warn(`[Disconnect] Aucune session trouvée à supprimer pour ${userId}/${serviceName}`);
                res.json({
                    success: true,
                    message: `Aucune session active à supprimer pour ${serviceName}`,
                    userId,
                    service: serviceName
                });
            }
        }
        catch (cleanupError) {
            console.error(`[Disconnect] Erreur lors du nettoyage:`, cleanupError);
            res.json({
                success: true,
                message: `Déconnexion ${serviceName} effectuée (avec avertissements)`,
                userId,
                service: serviceName,
                warning: 'Nettoyage partiel'
            });
        }
    }
    catch (error) {
        console.error(`[Disconnect] Erreur déconnexion ${serviceName}:`, error);
        res.status(500).json({
            success: false,
            error: 'Erreur lors de la déconnexion'
        });
    }
});
app.get('/api/status', (req, res) => {
    const stats = multiTenantManager.getStats();
    const serviceStats = serviceRegistry.getStats();
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        baseUrl: BASE_URL,
        version: '2.0.0',
        architecture: 'multi-services',
        users: stats,
        services: serviceStats
    });
});
app.get('/health', async (req, res) => {
    const dbStats = await userManager.getStats();
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        baseUrl: BASE_URL,
        environment: process.env.NODE_ENV || 'development',
        version: '3.0.0',
        architecture: 'postgresql-only',
        database: {
            connected: true,
            url_configured: !!process.env.DATABASE_URL,
            stats: dbStats
        }
    });
});
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Route not found',
        message: `${req.method} ${req.originalUrl} not found`,
        available_endpoints: {
            mcp: '/:userId/mcp/sse',
            services: '/api/services',
            user_services: '/api/users/:userId/services',
            auth: '/api/auth/start',
            status: '/api/status',
            health: '/health'
        }
    });
});
app.listen(PORT, () => {
    console.log(`🚀 Multi-Service MCP Server running on port ${PORT}`);
    console.log(`🌐 Base URL: ${BASE_URL}`);
    console.log(`📱 Interface: ${BASE_URL}`);
    console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`📋 Services activés: ${serviceRegistry.getEnabledServices().map(s => s.displayName).join(', ')}`);
    console.log(`📡 Endpoint MCP: ${BASE_URL}/:userId/mcp/sse`);
    console.log(`💾 Persistance Redis activée avec utilisateurs persistants`);
});
