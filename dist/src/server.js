import 'dotenv/config';
import express from "express";
import path from "path";
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { ServiceRegistry } from "./core/ServiceRegistry.js";
import { MultiTenantManager } from "./core/MultiTenantManager.js";
import { GmailService } from "./services/gmail/GmailService.js";
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
console.log('🏗️ Initialisation de l\'architecture multi-services...');
const serviceRegistry = new ServiceRegistry();
const multiTenantManager = new MultiTenantManager(serviceRegistry);
const gmailService = new GmailService(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, BASE_URL);
serviceRegistry.registerService(gmailService);
console.log('✅ Architecture initialisée avec les services:', serviceRegistry.getServiceNames());
setInterval(() => {
    multiTenantManager.cleanupExpiredSessions();
    gmailService.cleanupExpiredSessions();
}, 60 * 60 * 1000);
const app = express();
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
        res.status(404).send('User session not found');
        return;
    }
    const connectedServices = multiTenantManager.getConnectedServices(userId);
    if (connectedServices.length === 0) {
        res.status(400).send('No services connected for this user');
        return;
    }
    console.log(`[MCP] Connection multi-services pour l'utilisateur ${userId}`);
    console.log(`[MCP] Services connectés: ${connectedServices.join(', ')}`);
    let transport = undefined;
    let sessionId = undefined;
    try {
        req.socket.setTimeout(0);
        req.socket.setNoDelay(true);
        req.socket.setKeepAlive(true);
        transport = new SSEServerTransport(`/${userId}/mcp/message`, res);
        sessionId = transport.sessionId;
        const server = new McpServer({
            name: `Multi-Service Assistant - ${userId}`,
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
        multiTenantManager.setActiveMcpSession(sessionId, transport);
        server.connect(transport).then(() => {
            console.log(`[MCP] Serveur connecté pour ${userId} avec les services: ${connectedServices.join(', ')}`);
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
    const sessionId = req.query.sessionId;
    const transport = multiTenantManager.getActiveMcpSession(sessionId);
    if (!transport) {
        res.status(404).json({ error: 'Session MCP not found' });
        return;
    }
    transport.handlePostMessage(req, res);
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
        if (!multiTenantManager.hasServiceSession(userId, serviceName)) {
            return res.status(404).json({
                success: false,
                error: `Aucune session ${serviceName} trouvée pour l'utilisateur ${userId}`
            });
        }
        const removed = multiTenantManager.removeServiceSession(userId, serviceName);
        if (removed && serviceName === 'gmail') {
            const gmailSession = gmailService.getGmailSession(userId);
            if (gmailSession) {
                console.log(`[Disconnect] Nettoyage session Gmail pour ${userId}`);
            }
        }
        if (removed) {
            console.log(`[Disconnect] Session ${serviceName} supprimée pour l'utilisateur ${userId}`);
            res.json({
                success: true,
                message: `Déconnexion ${serviceName} réussie`,
                userId,
                service: serviceName
            });
        }
        else {
            throw new Error('Erreur lors de la suppression de la session');
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
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        baseUrl: BASE_URL,
        environment: process.env.NODE_ENV || 'development',
        version: '2.0.0',
        architecture: 'multi-services'
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
});
