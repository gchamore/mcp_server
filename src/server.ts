// src/server.ts - Serveur multi-services refactorisé

import 'dotenv/config';
import express from "express";
import path from "path";
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

// Import des nouvelles classes
import { ServiceRegistry } from "./core/ServiceRegistry.js";
import { MultiTenantManager } from "./core/MultiTenantManager.js";
import { GmailService } from "./services/gmail/GmailService.js";
import { UserSession } from "./types/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ✅ CONFIGURATION POUR RAILWAY (un seul port)
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || 
  (process.env.RAILWAY_PUBLIC_DOMAIN 
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` 
    : `http://localhost:${PORT}`);

// ✅ CONFIGURATION OAUTH VIA VARIABLES D'ENVIRONNEMENT
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

// Vérification des variables d'environnement
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.error('❌ Variables d\'environnement Google OAuth manquantes');
  console.error('Configurez GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET dans Railway');
  process.exit(1);
}

// ✅ INITIALISATION DE L'ARCHITECTURE MODULAIRE
console.log('🏗️ Initialisation de l\'architecture multi-services...');

// 1. Créer le registre des services
const serviceRegistry = new ServiceRegistry();

// 2. Créer le gestionnaire multi-tenant
const multiTenantManager = new MultiTenantManager(serviceRegistry);

// 3. Initialiser le service Gmail
const gmailService = new GmailService(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  BASE_URL
);

// 4. Enregistrer le service Gmail
serviceRegistry.registerService(gmailService);

console.log('✅ Architecture initialisée avec les services:', serviceRegistry.getServiceNames());

// Nettoyage automatique des sessions toutes les heures
setInterval(() => {
  multiTenantManager.cleanupExpiredSessions();
  gmailService.cleanupExpiredSessions();
}, 60 * 60 * 1000);

// ✅ APPLICATION EXPRESS UNIFIÉE
const app = express();

// ✅ NOUVELLES ROUTES MULTI-SERVICES

// Route MCP unifiée par utilisateur (remplace l'ancienne route Gmail)
app.get('/:userId/mcp/sse', async (req, res) => {
  const userId = req.params.userId;
  
  // Vérifier si l'utilisateur existe
  let userSession = multiTenantManager.getUserSession(userId);
  
  // Pour la compatibilité avec l'ancienne version, vérifier Gmail directement
  if (!userSession) {
    const gmailSession = gmailService.getGmailSession(userId);
    if (gmailSession) {
      // Créer une session utilisateur avec le service Gmail
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

  let transport: SSEServerTransport | undefined = undefined;
  let sessionId: string | undefined = undefined;

  try {
    req.socket.setTimeout(0);
    req.socket.setNoDelay(true);
    req.socket.setKeepAlive(true);

    // ✅ 1. CRÉER LE TRANSPORT
    transport = new SSEServerTransport(`/${userId}/mcp/message`, res);
    sessionId = transport.sessionId;

    // ✅ 2. CRÉER LE SERVEUR MCP MULTI-SERVICES
    const server = new McpServer({
      name: `Multi-Service Assistant - ${userId}`,
      version: "2.0.0",
    });

    // ✅ 3. ENREGISTRER LES OUTILS DE TOUS LES SERVICES CONNECTÉS
    for (const serviceName of connectedServices) {
      const service = serviceRegistry.getService(serviceName);
      const serviceSession = multiTenantManager.getServiceSession(userId, serviceName);
      
      if (service && serviceSession) {
        console.log(`[MCP] Enregistrement des outils ${serviceName}...`);
        service.registerTools(server, serviceSession);
      }
    }

    // ✅ 4. CONNECTER LE TRANSPORT AU SERVEUR
    multiTenantManager.setActiveMcpSession(sessionId, transport);
    
    server.connect(transport).then(() => {
      console.log(`[MCP] Serveur connecté pour ${userId} avec les services: ${connectedServices.join(', ')}`);
    });

  } catch (error) {
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

// Route pour traiter les messages MCP (remplace l'ancienne route Gmail)
app.post('/:userId/mcp/message', async (req, res) => {
  const sessionId = req.query.sessionId as string;
  
  const transport = multiTenantManager.getActiveMcpSession(sessionId);
  if (!transport) {
    res.status(404).json({ error: 'Session MCP not found' });
    return;
  }
  
  transport.handlePostMessage(req, res);
});

// ✅ COMPATIBILITÉ AVEC L'ANCIENNE ROUTE GMAIL
// Rediriger l'ancienne route vers la nouvelle
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

// ✅ MIDDLEWARES
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ✅ ROUTES FRONTEND
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Route pour la page d'accueil (alias)
app.get('/home', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Route pour servir les pages de services
app.get('/pages/:serviceName.html', (req, res) => {
  const serviceName = req.params.serviceName;
  const servicePage = path.join(__dirname, '..', 'public', 'pages', `${serviceName}.html`);
  
  // Vérifier si le service existe
  if (!serviceRegistry.hasService(serviceName)) {
    return res.status(404).send('Service non trouvé');
  }
  
  // Vérifier si la page existe
  res.sendFile(servicePage, (err) => {
    if (err) {
      res.status(404).send('Page de service non trouvée');
    }
  });
});

// Route pour l'ancienne interface (compatibilité)
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index_dashboard.html'));
});

// Route pour l'interface détaillée
app.get('/detailed', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index_detailed.html'));
});

// ✅ NOUVELLES ROUTES API POUR LA GESTION MULTI-SERVICES

// API pour obtenir les services disponibles
app.get('/api/services', (req, res) => {
  res.json({
    success: true,
    services: serviceRegistry.getServicesConfig(),
    stats: serviceRegistry.getStats()
  });
});

// API pour obtenir les services connectés d'un utilisateur
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

// ✅ ROUTES OAUTH (CONSERVÉES POUR LA COMPATIBILITÉ)
app.post('/api/auth/start', async (req, res) => {
  try {
    // Pour le moment, on garde Gmail par défaut pour la compatibilité
    const authUrl = gmailService.createAuthUrl();
    res.json({
      success: true,
      authUrl: authUrl,
      service: 'gmail'
    });
  } catch (error) {
    console.error('[OAuth] Erreur création URL:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la génération de l\'URL d\'authentification'
    });
  }
});

app.get('/oauth/callback', async (req, res) => {
  const code = req.query.code as string;
  const error = req.query.error as string;

  if (error || !code) {
    console.error('[OAuth] Erreur callback:', error || 'Code manquant');
    return res.redirect(`/pages/gmail.html?error=${encodeURIComponent(error || 'Code d\'autorisation manquant')}`);
  }

  try {
    // Authentifier avec Gmail
    const authResult = await gmailService.handleCallback(code);
    
    if (authResult.success && authResult.userId) {
      console.log(`[OAuth] Authentification réussie pour ${authResult.userEmail}: ${authResult.userId}`);
      res.redirect(`/pages/gmail.html?success=true&userId=${authResult.userId}&email=${encodeURIComponent(authResult.userEmail || '')}&service=gmail`);
    } else {
      throw new Error(authResult.error || 'Erreur inconnue');
    }
  } catch (error) {
    console.error('[OAuth] Erreur traitement callback:', error);
    res.redirect(`/pages/gmail.html?error=${encodeURIComponent('Erreur lors de l\'authentification')}`);
  }
});

// ✅ API DE STATUT AMÉLIORÉE
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

// ✅ HEALTH CHECK POUR RAILWAY
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

// ✅ ROUTE 404
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

// ✅ DÉMARRAGE SERVEUR
app.listen(PORT, () => {
  console.log(`🚀 Multi-Service MCP Server running on port ${PORT}`);
  console.log(`🌐 Base URL: ${BASE_URL}`);
  console.log(`📱 Interface: ${BASE_URL}`);
  console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📋 Services activés: ${serviceRegistry.getEnabledServices().map(s => s.displayName).join(', ')}`);
  console.log(`📡 Endpoint MCP: ${BASE_URL}/:userId/mcp/sse`);
});
