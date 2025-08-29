// src/server.ts - Serveur multi-services refactorisé

import 'dotenv/config';
import express from "express";
import path from "path";
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

// Déclarations de types étendus pour Express
declare global {
    namespace Express {
        interface Request {
            cookies: { [key: string]: string };
            userSession?: import('./core/PostgreSQLHTTPSessionManager.js').HTTPUserSession;
        }
    }
}

// Import des nouvelles classes
import { ServiceRegistry } from "./core/ServiceRegistry.js";
import { MultiTenantManager } from "./core/MultiTenantManager.js";
import { PostgreSQLUserManager } from "./core/PostgreSQLUserManager.js";
import { PostgreSQLSessionManager } from "./core/PostgreSQLSessionManager.js";
import { PostgreSQLHTTPSessionManager } from "./core/PostgreSQLHTTPSessionManager.js";
import { DatabaseManager } from "./database/DatabaseManager.js";
import { GmailService } from "./services/gmail/GmailService.js";
import { AxonautService } from "./services/axonaut/AxonautService.js";
import { UserSession, GmailSession, AxonautSession } from "./types/index.js";
import { google } from 'googleapis';
import { decrypt } from "./utils/encryption.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

//  CONFIGURATION POUR RAILWAY (un seul port)
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL ||
	(process.env.RAILWAY_PUBLIC_DOMAIN
		? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
		: `http://localhost:${PORT}`);

//  CONFIGURATION OAUTH VIA VARIABLES D'ENVIRONNEMENT
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

// Vérification des variables d'environnement
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
	console.error('❌ Variables d\'environnement Google OAuth manquantes');
	console.error('Configurez GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET dans Railway');
	process.exit(1);
}

// Vérification de la clé de chiffrement
if (!process.env.ENCRYPTION_KEY) {
	console.warn('⚠️ ENCRYPTION_KEY manquante - génération d\'une clé temporaire');
	console.warn('⚠️ Configurez ENCRYPTION_KEY dans Railway pour la production');
}

//  INITIALISATION DE L'ARCHITECTURE MODULAIRE
console.log('🏗️ Initialisation de l\'architecture multi-services...');

// 1. Créer le registre des services
const serviceRegistry = new ServiceRegistry();

// 2. Initialiser PostgreSQL
const database = new DatabaseManager();
await database.initialize();

// 3. Créer le gestionnaire de sessions MCP PostgreSQL
const mcpSessionManager = new PostgreSQLSessionManager(database);

// 4. Créer le gestionnaire de sessions HTTP PostgreSQL
const httpSessionManager = new PostgreSQLHTTPSessionManager(database);

// 5. Créer le gestionnaire utilisateur avec PostgreSQL
const userManager = new PostgreSQLUserManager(
	GOOGLE_CLIENT_ID,
	GOOGLE_CLIENT_SECRET,
	`${BASE_URL}/auth/google/callback`,
	database,
	mcpSessionManager
);

// 5. Créer le gestionnaire multi-tenant
const multiTenantManager = new MultiTenantManager(serviceRegistry);

// 6. Initialiser le service Gmail
const gmailService = new GmailService(
	GOOGLE_CLIENT_ID,
	GOOGLE_CLIENT_SECRET,
	BASE_URL
);

// 7. Initialiser le service Axonaut
const axonautService = new AxonautService();

// 8. Enregistrer les services
serviceRegistry.registerService(gmailService);
serviceRegistry.registerService(axonautService);

console.log('Architecture initialisée avec les services:', serviceRegistry.getServiceNames());

console.log('✅ Architecture PostgreSQL 100% initialisée');

// Nettoyage périodique des sessions expirées (toutes les heures)
setInterval(async () => {
	try {
		const cleanedMCP = await mcpSessionManager.cleanupExpiredSessions();
		const cleanedHTTP = await httpSessionManager.cleanupExpiredSessions();
		
		if (cleanedMCP > 0 || cleanedHTTP > 0) {
			console.log(`🧹 Sessions nettoyées: ${cleanedMCP} MCP, ${cleanedHTTP} HTTP`);
		}
	} catch (error) {
		console.error('❌ Erreur nettoyage sessions:', error);
	}
}, 60 * 60 * 1000); // 1 heure

// Heartbeat pour les connexions SSE (toutes les 30 secondes)
setInterval(() => {
	const activeSessions = multiTenantManager.getActiveMcpSessions();
	let heartbeatCount = 0;
	
	for (const [sessionId, transport] of activeSessions) {
		try {
			// Envoyer un ping SSE pour maintenir la connexion
			if (transport && typeof transport.write === 'function') {
				transport.write('event: ping\ndata: {}\n\n');
				heartbeatCount++;
			}
		} catch (error) {
			console.warn(`⚠️ Erreur heartbeat session ${sessionId}:`, error);
			// Supprimer la session défaillante
			multiTenantManager.removeActiveMcpSession(sessionId);
		}
	}
	
	if (heartbeatCount > 0) {
		console.log(`💓 Heartbeat envoyé à ${heartbeatCount} session(s) MCP`);
	}
}, 30 * 1000); // 30 secondes

// APPLICATION EXPRESS UNIFIÉE
const app = express();

// Juste trust proxy pour Railway (utile pour req.ip)
app.set('trust proxy', 1);

// Configuration CORS pour Dust.tt et autres clients MCP
app.use((req, res, next) => {
	res.header('Access-Control-Allow-Origin', '*');
	res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
	res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Cache-Control');
	res.header('Access-Control-Expose-Headers', 'Content-Length, Content-Range');
	
	// Répondre aux requêtes preflight OPTIONS
	if (req.method === 'OPTIONS') {
		res.sendStatus(200);
		return;
	}
	
	next();
});

// Configuration des cookies et sessions
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuration CORS pour permettre les connexions MCP cross-origin
app.use((req, res, next) => {
	// Autoriser toutes les origines pour les endpoints MCP
	res.header('Access-Control-Allow-Origin', '*');
	res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
	res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
	res.header('Access-Control-Allow-Credentials', 'true');
	
	// Pour les endpoints SSE, configuration spéciale
	if (req.path.includes('/sse')) {
		res.header('Cache-Control', 'no-cache');
		res.header('Connection', 'keep-alive');
		res.header('Content-Type', 'text/event-stream');
	}
	
	// Répondre aux requêtes OPTIONS (preflight)
	if (req.method === 'OPTIONS') {
		res.sendStatus(200);
		return;
	}
	
	next();
});

// Middleware pour parser les cookies
app.use((req, res, next) => {
	// Parser simple des cookies
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


// Middleware de session sécurisée
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

// Helper pour définir des cookies sécurisés
const setSecureCookie = (res: express.Response, name: string, value: string, maxAge?: number) => {
	const isProduction = process.env.NODE_ENV === 'production';
	const cookieOptions = [
		`${name}=${encodeURIComponent(value)}`,
		`Max-Age=${maxAge || 7 * 24 * 60 * 60}`, // 7 jours par défaut
		'Path=/',
		'HttpOnly',
		'SameSite=Strict'
	];
	
	if (isProduction) {
		cookieOptions.push('Secure');
	}
	
	res.setHeader('Set-Cookie', cookieOptions.join('; '));
};

// Headers de sécurité légers (optionnel)
app.use((req, res, next) => {
	res.setHeader('X-Content-Type-Options', 'nosniff');
	res.setHeader('X-Frame-Options', 'DENY');
	next();
});

// NOUVELLES ROUTES MULTI-SERVICES

// Route debug pour récupérer le USER_ID basé sur l'email
app.get('/api/debug/userid/:email', (req, res) => {
	const email = decodeURIComponent(req.params.email);
	const userId = userManager.createUserIdFromEmail(email);
	
	res.json({
		email,
		userId,
		mcpEndpoint: `${BASE_URL}/${userId}/mcp/sse`
	});
});

// Endpoint de découverte OAuth pour Dust.tt
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

// Endpoint de découverte simple (au cas où)
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

// Endpoint MCP global pour Dust.tt (niveau workspace)
app.get('/mcp', async (req, res) => {
	console.log(`[MCP-DUST] Connexion MCP globale depuis Dust.tt`);
	
	// Pour Dust.tt, on utilise un utilisateur de démonstration ou le premier utilisateur disponible
	// TODO: Implémenter l'authentification Dust.tt appropriée
	const demoUserId = "df07fc29133a08605492e76941c54606"; // Votre USER_ID de test
	
	// Vérifier si l'utilisateur existe
	let userSession = multiTenantManager.getUserSession(demoUserId);
	
	// Si pas de session, essayer de récupérer depuis les services directs
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

	// Si aucun service connecté, retourner un serveur MCP minimal
	if (connectedServices.length === 0) {
		console.log('[MCP-DUST] Aucun service connecté, serveur MCP minimal');
	}

	let transport: SSEServerTransport | undefined = undefined;
	let sessionId: string | undefined = undefined;

	try {
		req.socket.setTimeout(0);
		req.socket.setNoDelay(true);
		req.socket.setKeepAlive(true);

		// Créer le transport pour Dust.tt
		transport = new SSEServerTransport(`/mcp/message`, res);
		sessionId = transport.sessionId;

		// Créer le serveur MCP pour Dust.tt
		const server = new McpServer({
			name: "Wesype MCP Server",
			version: "2.0.0",
		});

		// Enregistrer les outils de tous les services connectés
		for (const serviceName of connectedServices) {
			const service = serviceRegistry.getService(serviceName);
			const serviceSession = multiTenantManager.getServiceSession(demoUserId, serviceName);

			if (service && serviceSession) {
				console.log(`[MCP-DUST] Enregistrement des outils ${serviceName}...`);
				service.registerTools(server, serviceSession);
			}
		}

		// Si aucun service, ajouter des outils de démonstration
		if (connectedServices.length === 0) {
			server.tool(
				"wesype_status",
				"Obtenir le statut du serveur Wesype",
				{},
				async () => {
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
				}
			);
		}

		// Connecter le transport au serveur
		multiTenantManager.setActiveMcpSession(sessionId, transport);

		server.connect(transport).then(() => {
			console.log(`[MCP-DUST] Serveur MCP connecté pour Dust.tt`);
		});

	} catch (error) {
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

// Route pour traiter les messages MCP depuis Dust.tt
app.post('/mcp/message', async (req, res) => {
	const sessionId = req.query.sessionId as string;
	
	console.log(`[MCP] Message global reçu, session: ${sessionId}`);
	console.log(`[MCP] Body global:`, JSON.stringify(req.body, null, 2));

	const transport = multiTenantManager.getActiveMcpSession(sessionId);
	if (!transport) {
		console.error(`[MCP] Session MCP globale introuvable: ${sessionId}`);
		res.status(404).json({ error: 'Session MCP not found' });
		return;
	}

	try {
		console.log(`[MCP] Traitement du message global`);
		transport.handlePostMessage(req, res);
	} catch (error) {
		console.error(`[MCP] Erreur traitement message global:`, error);
		res.status(500).json({ error: 'Internal server error' });
	}
});

// Endpoint pour les métadonnées MCP générales
app.get('/api/mcp/metadata', async (req, res) => {
	res.json({
		name: "Wesype MCP Server",
		version: "1.0.0",
		description: "Multi-service MCP server supporting Gmail and Axonaut",
		capabilities: ["gmail", "axonaut"],
		endpoint: `${BASE_URL}/mcp`
	});
});

// Route MCP unifiée par utilisateur - SIMPLIFIÉE pour compatibilité Dust.tt
app.get('/:userId/mcp/sse', async (req, res) => {
	const userId = req.params.userId;
	console.log(`[MCP] GET SSE - Connexion pour l'utilisateur ${userId}`);

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

	// Si toujours pas de session, créer une session par défaut (pour Dust.tt)
	if (!userSession) {
		console.log(`[MCP] GET SSE - Création session pour ${userId}`);
		multiTenantManager.createUserSession(userId);
		userSession = multiTenantManager.getUserSession(userId);
	}

	if (!userSession) {
		console.error(`[MCP] GET SSE - Impossible de créer session pour ${userId}`);
		res.status(404).send('User session not found');
		return;
	}

	const connectedServices = multiTenantManager.getConnectedServices(userId);
	console.log(`[MCP] GET SSE - Services connectés: ${connectedServices.join(', ') || 'aucun'}`);

	// Définir le nom du serveur
	let serverName = "MCP";
	if (connectedServices.length === 1) {
		const serviceName = connectedServices[0];
		const service = serviceRegistry.getService(serviceName);
		serverName = `MCP ${service?.displayName || serviceName}`;
	} else if (connectedServices.length > 1) {
		serverName = "MCP Multi-Services";
	} else {
		serverName = "MCP Wesype";
	}

	let transport: SSEServerTransport | undefined = undefined;
	let sessionId: string | undefined = undefined;

	try {
		req.socket.setTimeout(0);
		req.socket.setNoDelay(true);
		req.socket.setKeepAlive(true);

		// 1. CRÉER LE TRANSPORT (comme l'ancien code)
		transport = new SSEServerTransport(`/${userId}/mcp/message`, res);
		sessionId = transport.sessionId;
		console.log(`[MCP] GET SSE - Transport créé, sessionId: ${sessionId}`);

		// 2. CRÉER LE SERVEUR MCP (avec informations complètes comme le SDK)
		const server = new McpServer(
			{
				name: serverName,
				version: "2.0.0",
			},
			{
				capabilities: {
					tools: {},
					resources: {},
					logging: {}
				}
			}
		);

		// 3. ENREGISTRER LES OUTILS
		for (const serviceName of connectedServices) {
			const service = serviceRegistry.getService(serviceName);
			const serviceSession = multiTenantManager.getServiceSession(userId, serviceName);

			if (service && serviceSession) {
				console.log(`[MCP] GET SSE - Enregistrement outils ${serviceName}...`);
				service.registerTools(server, serviceSession);
			}
		}

		// Si aucun service connecté, ajouter des outils de base
		if (connectedServices.length === 0) {
			server.tool(
				"wesype_status",
				"Obtenir le statut du serveur Wesype MCP",
				{
					type: "object",
					properties: {},
				},
				async () => {
					return {
						content: [
							{
								type: "text",
								text: `🔧 **Serveur Wesype MCP**\n\nUtilisateur: ${userId}\nServices disponibles: Gmail, Axonaut\nServices connectés: ${connectedServices.length}\n\nPour connecter des services:\n• Gmail: ${BASE_URL}/pages/gmail.html\n• Axonaut: ${BASE_URL}/pages/axonaut.html`
							}
						]
					};
				}
			);
		}

		// 4. CONNECTER LE SERVEUR ET LE TRANSPORT (comme les exemples SDK)
		console.log(`[MCP] GET SSE - Connexion du serveur MCP...`);
		await server.connect(transport);
		console.log(`[MCP] GET SSE - ✅ Serveur MCP connecté et prêt pour Dust.tt`);

		// 5. STOCKER LA SESSION ACTIVE (comme l'ancien code)
		multiTenantManager.setActiveMcpSession(sessionId, transport);
		console.log(`[MCP] GET SSE - Session stockée: ${sessionId}`);

		// NOUVEAU: Gérer les événements de connexion pour Dust.tt
		req.on('close', () => {
			console.log(`[MCP] GET SSE - Connexion fermée pour ${userId}`);
			if (sessionId) {
				multiTenantManager.removeActiveMcpSession(sessionId);
			}
		});

		req.on('error', (error) => {
			console.error(`[MCP] GET SSE - Erreur connexion pour ${userId}:`, error);
			if (sessionId) {
				multiTenantManager.removeActiveMcpSession(sessionId);
			}
		});

		// 5. CONNECTER LE TRANSPORT (version simplifiée comme l'ancien code)
		server.connect(transport).then(() => {
			console.log(`[MCP] GET SSE - ✅ Serveur MCP connecté pour ${userId}`);
			console.log(`[MCP] GET SSE - Services: ${connectedServices.join(', ') || 'aucun'}`);
			console.log(`[MCP] GET SSE - Session ID: ${sessionId}`);
			
			// NOUVEAU: Envoyer un signal de "ready" pour Dust.tt
			try {
				// Envoyer un événement de confirmation à Dust.tt
				res.write('event: connected\ndata: {"status":"ready","services":' + JSON.stringify(connectedServices) + '}\n\n');
				console.log(`[MCP] GET SSE - Signal "ready" envoyé à Dust.tt pour ${userId}`);
			} catch (signalError) {
				console.warn(`[MCP] GET SSE - Erreur envoi signal ready:`, signalError);
			}
		}).catch((error) => {
			console.error(`[MCP] GET SSE - ❌ Erreur connexion pour ${userId}:`, error);
			if (sessionId) {
				multiTenantManager.removeActiveMcpSession(sessionId);
			}
			if (transport) {
				transport.close();
			}
		});

	} catch (error) {
		console.error(`[MCP] GET SSE - Erreur pour ${userId}:`, error);
		if (sessionId) {
			multiTenantManager.removeActiveMcpSession(sessionId);
		}
		if (transport) {
			transport.close();
		}
		res.status(500).send('Internal server error');
	}
});

// Route pour traiter les messages MCP - SIMPLIFIÉE pour compatibilité Dust.tt
app.post('/:userId/mcp/message', async (req, res) => {
	const userId = req.params.userId;
	const sessionId = req.query.sessionId as string;
	
	console.log(`[MCP] POST MESSAGE - Message pour ${userId}, session: ${sessionId}`);

	const transport = multiTenantManager.getActiveMcpSession(sessionId);
	if (!transport) {
		console.error(`[MCP] POST MESSAGE - Session introuvable: ${sessionId}`);
		res.status(404).json({ error: 'Session MCP not found' });
		return;
	}

	try {
		console.log(`[MCP] POST MESSAGE - Traitement message pour ${userId}`);
		transport.handlePostMessage(req, res);
	} catch (error) {
		console.error(`[MCP] POST MESSAGE - Erreur:`, error);
		res.status(500).json({ error: 'Message processing error' });
	}
});

// Endpoint POST pour SSE - SIMPLIFIÉ (pour compatibilité avec certains clients)
app.post('/:userId/mcp/sse', async (req, res) => {
	const userId = req.params.userId;
	console.log(`[MCP] POST SSE - Redirection vers GET pour ${userId}`);
	
	// Rediriger vers la route GET standard
	res.redirect(301, `/${userId}/mcp/sse`);
});

// COMPATIBILITÉ AVEC L'ANCIENNE ROUTE GMAIL
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

// MIDDLEWARES
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ROUTES FRONTEND
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

// API ROUTES
// Vérifier les connexions MCP existantes pour un utilisateur
app.get('/api/user/:userId/connections', async (req, res) => {
	try {
		const userId = req.params.userId;

		if (!userId) {
			return res.status(400).json({ error: 'UserId manquant' });
		}

		// Récupérer l'utilisateur pour obtenir son email
		const user = await userManager.getUser(userId);
		console.log(`[CONNECTIONS API] Utilisateur trouvé:`, user ? `Email: ${user.email}` : 'Utilisateur non trouvé');

		// Récupérer les connexions MCP de l'utilisateur
		const connections = await database.getUserMCPConnections(userId);

		// Vérifier spécifiquement la connexion Gmail
		const gmailConnection = connections.find(conn => conn.service_name === 'gmail');

		if (gmailConnection && gmailConnection.is_connected) {
			// Générer l'URL MCP pour Gmail
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
		} else {
			return res.json({
				success: true,
				connections: {
					gmail: {
						isConnected: false
					}
				}
			});
		}

	} catch (error) {
		console.error('Erreur lors de la vérification des connexions:', error);
		res.status(500).json({ error: 'Erreur serveur' });
	}
});

// Déconnecter un service MCP
app.post('/api/user/:userId/disconnect/:serviceName', async (req, res) => {
	try {
		const userId = req.params.userId;
		const serviceName = req.params.serviceName;

		if (!userId || !serviceName) {
			return res.status(400).json({ error: 'Paramètres manquants' });
		}

		// Vérifier que le service est valide
		if (!['gmail', 'axonaut', 'notion'].includes(serviceName)) {
			return res.status(400).json({ error: 'Service non valide' });
		}

		// Déconnecter le service
		const success = await database.disconnectMCPService(userId, serviceName as 'gmail' | 'axonaut' | 'notion');

		if (success) {
			// Supprimer aussi la session du service en mémoire si elle existe
			if (serviceName === 'gmail') {
				gmailService.removeSession(userId);
			} else if (serviceName === 'axonaut') {
				axonautService.removeSession(userId);
			}

			res.json({
				success: true,
				message: `Service ${serviceName} déconnecté avec succès`
			});
		} else {
			res.status(404).json({
				success: false,
				error: 'Service non trouvé ou déjà déconnecté'
			});
		}

	} catch (error) {
		console.error('Erreur lors de la déconnexion:', error);
		res.status(500).json({ error: 'Erreur serveur' });
	}
});

// Supprimer complètement un service MCP
app.delete('/api/user/:userId/delete-mcp/:serviceName', async (req, res) => {
	try {
		const userId = req.params.userId;
		const serviceName = req.params.serviceName;

		console.log(`[DELETE MCP] Tentative de suppression - UserId: ${userId}, Service: ${serviceName}`);

		if (!userId || !serviceName) {
			return res.status(400).json({ error: 'Paramètres manquants' });
		}

		// Vérifier que le service est valide
		if (!['gmail', 'axonaut', 'notion'].includes(serviceName)) {
			return res.status(400).json({ error: 'Service non valide' });
		}

		// Supprimer complètement le service
		const success = await database.deleteMCPService(userId, serviceName as 'gmail' | 'axonaut' | 'notion');

		console.log(`[DELETE MCP] Résultat suppression - Success: ${success}`);

		if (success) {
			// Supprimer aussi la session du service en mémoire si elle existe
			if (serviceName === 'gmail') {
				gmailService.removeSession(userId);
			} else if (serviceName === 'axonaut') {
				axonautService.removeSession(userId);
			}

			res.json({
				success: true,
				message: `MCP ${serviceName} supprimé avec succès`
			});
		} else {
			res.status(404).json({
				success: false,
				error: 'Service non trouvé ou déjà supprimé'
			});
		}

	} catch (error) {
		console.error('Erreur lors de la suppression du MCP:', error);
		res.status(500).json({ error: 'Erreur serveur' });
	}
});

// Récupérer la session actuelle
app.get('/api/session/current', async (req, res) => {
	try {
		// Essayer de récupérer l'userId depuis différents endroits

		// 1. Depuis les paramètres de requête
		let userId = req.query.userId as string;

		// 2. Depuis l'authentification Google (si disponible)
		if (!userId) {
			const authHeader = req.headers.authorization;
			if (authHeader && authHeader.startsWith('Bearer ')) {
				// TODO: Implémenter la validation du token Google si nécessaire
			}
		}

		// 3. Depuis les sessions Redis (si disponible)
		if (!userId) {
			// Essayer de récupérer depuis Redis si configuré
			try {
				const redisPersistence = (global as any).redisPersistence;
				if (redisPersistence && redisPersistence.isAvailable) {
					// TODO: Implémenter la récupération depuis Redis si nécessaire
				}
			} catch (e) {
				// Ignorer les erreurs Redis
			}
		}

		if (userId) {
			res.json({
				success: true,
				userId: userId
			});
		} else {
			res.json({
				success: false,
				error: 'Aucune session active trouvée'
			});
		}

	} catch (error) {
		console.error('Erreur lors de la récupération de session:', error);
		res.status(500).json({ error: 'Erreur serveur' });
	}
});

// NOUVELLES ROUTES API POUR LA GESTION MULTI-SERVICES

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

// Route pour obtenir le client ID Google (nécessaire côté client)
app.get('/api/google/client-id', (req, res) => {
	res.json({
		clientId: GOOGLE_CLIENT_ID
	});
});

// Route pour initier l'authentification Google (GET pour la page d'accueil)
app.get('/api/auth/google', async (req, res) => {
	try {
		const authUrl = userManager.getAuthUrl();
		res.json({
			success: true,
			authUrl
		});
	} catch (error) {
		console.error('❌ Erreur génération URL auth Google:', error);
		res.status(500).json({
			success: false,
			error: 'Erreur lors de la génération de l\'URL d\'authentification'
		});
	}
});

// Route pour initier l'authentification Google (POST pour compatibilité)
app.post('/api/auth/google/start', async (req, res) => {
	try {
		const { OAuth2Client } = await import('google-auth-library');
		const oauth2Client = new OAuth2Client(
			GOOGLE_CLIENT_ID,
			GOOGLE_CLIENT_SECRET,
			`${BASE_URL}/auth/google/callback`
		);

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
	} catch (error) {
		console.error('❌ Erreur génération URL auth Google:', error);
		res.status(500).json({
			success: false,
			error: 'Erreur lors de la génération de l\'URL d\'authentification'
		});
	}
});

// Route de callback pour l'authentification Google (pour les comptes utilisateur)
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

		// Authentifier l'utilisateur avec Google
		const authResult = await userManager.authenticateWithGoogle(code as string);
		const { userId, user } = authResult;
        
		if (!user) {
			console.error('❌ Utilisateur non trouvé après authentification');
			return res.redirect('/?error=user_not_found');
		}

		// Créer une session sécurisée
		const sessionId = await httpSessionManager.createSession({
			userId: user.user_id,
			email: user.email,
			name: user.name,
			picture: user.picture
		});

		// Définir le cookie de session sécurisé
		setSecureCookie(res, 'mcp-session', sessionId);
        
		// Rediriger vers la page des services
		res.redirect('/pages/services.html?auth=success');
	} catch (error) {
		console.error('❌ Erreur callback Google:', error);
		res.redirect('/?error=callback_error');
	}
});

// === CALLBACKS OAUTH POUR SERVICES MCP ===

// Callback pour connexion Gmail MCP
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

		// Récupérer l'userId depuis le state OAuth
		let userId: string | null = null;
		if (state) {
			const stateParams = new URLSearchParams(state as string);
			userId = stateParams.get('userId');
		}

		if (!userId) {
			console.error('❌ UserId manquant dans le state OAuth');
			return res.redirect('/pages/gmail.html?error=invalid_state');
		}

		// Récupérer l'utilisateur depuis la base de données
		const user = await userManager.getUser(userId);
		if (!user) {
			console.error('❌ Utilisateur non trouvé:', userId);
			return res.redirect('/?error=user_not_found');
		}

		// Authentifier Gmail avec le code OAuth
		const authResult = await gmailService.handleCallback(code as string);

		if (authResult.success && authResult.userId) {
			const gmailSession = (gmailService as any).gmailSessions.get(authResult.userId);
			if (gmailSession) {
				// Enregistrer la connexion Gmail directement avec le nouveau système
				await userManager.connectGmailService(
					userId,
					gmailSession.encryptedRefreshToken || '',
					gmailSession.encryptedAccessToken || '',
					authResult.userEmail || '',
					undefined // tokenExpiresAt
				);

				return res.redirect(`/pages/gmail.html?success=true&userId=${userId}&email=${encodeURIComponent(authResult.userEmail || '')}`);
			} else {
				return res.redirect('/pages/gmail.html?error=session_not_found');
			}
		} else {
			return res.redirect('/pages/gmail.html?error=auth_failed');
		}

	} catch (error) {
		console.error('❌ Erreur callback Gmail:', error);
		return res.redirect('/pages/gmail.html?error=server_error');
	}
});

// Callback pour connexion Axonaut (si OAuth dans le futur)
app.get('/auth/axonaut/callback', async (req, res) => {
	try {
		// Pour l'instant Axonaut utilise API key, mais on peut prévoir OAuth
		return res.redirect('/pages/axonaut.html?auth=success');
	} catch (error) {
		console.error('❌ Erreur callback Axonaut:', error);
		return res.redirect('/pages/axonaut.html?error=server_error');
	}
});

// Route pour récupérer les informations de l'utilisateur connecté
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

// Route pour déconnexion
app.post('/api/auth/logout', async (req, res) => {
	const sessionId = req.cookies['mcp-session'];
	if (sessionId) {
		await httpSessionManager.deleteSession(sessionId);
	}
	
	// Supprimer le cookie
	res.setHeader('Set-Cookie', 'mcp-session=; Max-Age=0; Path=/; HttpOnly');
	
	res.json({
		success: true,
		message: 'Déconnexion réussie'
	});
});

// ROUTES D'AUTHENTIFICATION GOOGLE UTILISATEUR
app.post('/auth/google/callback', async (req, res) => {
	try {
		const { code } = req.body;
		
		if (!code) {
			return res.status(400).json({
				success: false,
				error: 'Code Google manquant'
			});
		}
		
		// Authentifier l'utilisateur avec Google
		const userId = await userManager.authenticateWithGoogle(code);
		
		res.json({
			success: true,
			userId,
			redirectUrl: `/pages/services.html?userId=${userId}`
		});
	} catch (error) {
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
		
		// Authentifier l'utilisateur avec Google
		const userId = await userManager.authenticateWithGoogle(googleCode);
		
		res.json({
			success: true,
			userId,
			redirectUrl: `/pages/services.html?userId=${userId}`
		});
	} catch (error) {
		console.error('❌ Erreur authentification Google:', error);
		res.status(401).json({
			success: false,
			error: 'Authentification Google échouée'
		});
	}
});

// Route pour obtenir les informations du compte
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
		
		// Obtenir les services connectés depuis le PersistentUserManager
		const connectedServices = [];
		const mcpConnections = await userManager.getUserMCPConnections(userId);
		
		if (mcpConnections) {
			// Rechercher Gmail
			const gmailConnection = mcpConnections.find(c => c.service_name === 'gmail' && c.is_connected);
			if (gmailConnection) {
				connectedServices.push({
					name: 'gmail',
					displayName: 'Gmail',
					connectedAt: gmailConnection.connected_at,
					lastUsed: gmailConnection.last_used
				});
			}
			
			// Rechercher Axonaut
			const axonautConnection = mcpConnections.find(c => c.service_name === 'axonaut' && c.is_connected);
			if (axonautConnection) {
				connectedServices.push({
					name: 'axonaut',
					displayName: 'Axonaut',
					connectedAt: axonautConnection.connected_at,
					lastUsed: axonautConnection.last_used
				});
			}
			
			// Rechercher Notion
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
	} catch (error) {
		console.error('❌ Erreur récupération compte:', error);
		res.status(500).json({
			success: false,
			error: 'Erreur serveur'
		});
	}
});

// Route pour déconnecter un service spécifique
app.post('/api/account/:userId/disconnect/:serviceName', async (req, res) => {
	try {
		const { userId, serviceName } = req.params;
		
		// Vérifier que l'utilisateur existe
		const user = await userManager.getUser(userId);
		if (!user) {
			return res.status(404).json({
				success: false,
				error: 'Utilisateur non trouvé'
			});
		}
		
		// Déconnecter le service MCP
		const success = await userManager.disconnectMCPService(userId, serviceName as 'gmail' | 'axonaut' | 'notion');
		const removed = multiTenantManager.removeServiceSession(userId, serviceName);
		
		if (success && removed) {
			// Supprimer aussi du gestionnaire de services
			if (serviceName === 'gmail') {
				gmailService.removeSession(userId);
			} else if (serviceName === 'axonaut') {
				axonautService.removeSession(userId);
			}
			
			res.json({
				success: true,
				message: `Service ${serviceName} déconnecté avec succès`
			});
		} else {
			res.status(404).json({
				success: false,
				error: 'Service non trouvé ou déjà déconnecté'
			});
		}
	} catch (error) {
		console.error('❌ Erreur déconnexion service:', error);
		res.status(500).json({
			success: false,
			error: 'Erreur lors de la déconnexion'
		});
	}
});

// Route pour supprimer complètement un compte utilisateur
app.delete('/api/account/:userId/delete', async (req, res) => {
	try {
		const { userId } = req.params;
		
		// Vérifier que l'utilisateur existe
		const user = await userManager.getUser(userId);
		if (!user) {
			return res.status(404).json({
				success: false,
				error: 'Utilisateur non trouvé'
			});
		}
		
		// Supprimer toutes les sessions de services
		const userSession = multiTenantManager.getUserSession(userId);
		if (userSession) {
			if (userSession.services.gmail) {
				gmailService.removeSession(userId);
			}
			if (userSession.services.axonaut) {
				axonautService.removeSession(userId);
			}
		}
		
		// Supprimer la session utilisateur
		multiTenantManager.getUserSessionsMap().delete(userId);
		
		// Supprimer l'utilisateur et toutes ses sessions MCP
		await userManager.deleteUser(userId);
		
		res.json({
			success: true,
			message: 'Compte supprimé avec succès'
		});
	} catch (error) {
		console.error('❌ Erreur suppression compte:', error);
		res.status(500).json({
			success: false,
			error: 'Erreur lors de la suppression du compte'
		});
	}
});

// === ROUTES D'ADMINISTRATION ===

// Route pour les statistiques d'administration
app.get('/api/admin/stats', async (req, res) => {
	try {
		const stats = await userManager.getUsageStats();
		res.json(stats);
	} catch (error) {
		console.error('❌ Erreur récupération statistiques admin:', error);
		res.status(500).json({
			success: false,
			error: 'Erreur serveur'
		});
	}
});

// Route pour lister tous les utilisateurs avec leurs connexions
app.get('/api/admin/users', async (req, res) => {
	try {
		const allUsers = await database.getAllUsers();
		
		// Enrichir avec les connexions MCP pour chaque utilisateur
		const usersWithConnections = await Promise.all(
			allUsers.map(async (user: any) => {
				const mcpConnections = await userManager.getUserMCPConnections(user.user_id);
				return {
					...user,
					mcpConnections
				};
			})
		);

		res.json(usersWithConnections);
	} catch (error) {
		console.error('❌ Erreur récupération utilisateurs admin:', error);
		res.status(500).json({
			success: false,
			error: 'Erreur serveur'
		});
	}
});

// Page d'administration
app.get('/admin', (req, res) => {
	res.sendFile(path.join(__dirname, '../public/pages/admin.html'));
});

// ROUTES OAUTH (CONSERVÉES POUR LA COMPATIBILITÉ)
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

// Route spécifique pour l'authentification Gmail MCP
app.post('/api/oauth/gmail', async (req, res) => {
	console.log('🚀 [API-OAUTH-GMAIL] Route appelée');
	console.log('🍪 [API-OAUTH-GMAIL] Cookies:', req.cookies);
	
	try {
		// Vérifier la session utilisateur
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
		
		// Passer l'userId dans l'état OAuth pour le récupérer au callback
		const state = `flow=gmail&userId=${session.userId}`;
		const authUrl = gmailService.createAuthUrl(state);
		console.log('🔗 [API-OAUTH-GMAIL] URL générée avec userId dans state:', authUrl);
		
		res.json({
			success: true,
			authUrl: authUrl,
			service: 'gmail'
		});
	} catch (error) {
		console.error('❌ [API-OAUTH-GMAIL] Erreur création URL:', error);
		res.status(500).json({
			success: false,
			error: 'Erreur lors de la génération de l\'URL d\'authentification Gmail'
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
			
			// Créer/récupérer la session utilisateur
			let userSession = multiTenantManager.getUserSession(authResult.userId);
			if (!userSession) {
				multiTenantManager.createUserSession(authResult.userId);
				userSession = multiTenantManager.getUserSession(authResult.userId);
			}

			// Ajouter la session Gmail à la session utilisateur
			const gmailSession = gmailService.getGmailSession(authResult.userId);
			if (userSession && gmailSession) {
				multiTenantManager.addServiceSession(authResult.userId, 'gmail', gmailSession);
				console.log(`[Gmail] Session ajoutée à l'utilisateur ${authResult.userId}`);
			}
			
			// ✅ Session Gmail maintenant persistée automatiquement en PostgreSQL
			console.log(`✅ Session Gmail ${authResult.userId} sauvegardée en PostgreSQL`);
			
			res.redirect(`/pages/gmail.html?success=true&userId=${authResult.userId}&email=${encodeURIComponent(authResult.userEmail || '')}&service=gmail`);
		} else {
			throw new Error(authResult.error || 'Erreur inconnue');
		}
	} catch (error) {
		console.error('[OAuth] Erreur traitement callback:', error);
		res.redirect(`/pages/gmail.html?error=${encodeURIComponent('Erreur lors de l\'authentification')}`);
	}
});

// ROUTES AXONAUT 
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

		// Vérifier que l'utilisateur existe déjà (il devrait être connecté via Google)
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
			// Récupérer la session créée par le service
			const axonautSession = axonautService.getAxonautSession(authResult.userId);

			if (!axonautSession) {
				throw new Error('Session Axonaut non trouvée après création');
			}

			// 🔄 Sauvegarder dans PostgreSQL - l'utilisateur existe déjà
			const mcpSession = await userManager.connectAxonautService(
				userId,
				apiKey,
				baseUrl,
				authResult.userEmail || existingUser.email
			);

			// Créer/récupérer la session utilisateur (pour compatibilité)
			let userSession = multiTenantManager.getUserSession(userId);
			if (!userSession) {
				multiTenantManager.createUserSession(userId);
				userSession = multiTenantManager.getUserSession(userId);
			}

			// Ajouter la session Axonaut (pour compatibilité avec l'ancien système)
			if (userSession) {
				multiTenantManager.addServiceSession(userId, 'axonaut', axonautSession);
				console.log(`[Axonaut] Authentification réussie pour ${userId}`);

				// ✅ Session Axonaut maintenant persistée en PostgreSQL
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
			} else {
				throw new Error('Erreur lors de la création de la session utilisateur');
			}
		} else {
			res.status(401).json({
				success: false,
				error: authResult.error || 'Erreur d\'authentification Axonaut'
			});
		}
	} catch (error) {
		console.error('[Axonaut] Erreur authentification:', error);
		res.status(500).json({
			success: false,
			error: 'Erreur lors de l\'authentification Axonaut'
		});
	}
});

//  API DE DÉCONNEXION
app.post('/api/disconnect/:userId/:serviceName', async (req, res) => {
	const { userId, serviceName } = req.params;

	try {
		console.log(`[Disconnect] Tentative de déconnexion ${serviceName} pour l'utilisateur ${userId}`);

		// Vérifier que le service existe
		const service = serviceRegistry.getService(serviceName);
		if (!service) {
			return res.status(404).json({
				success: false,
				error: `Service ${serviceName} non trouvé`
			});
		}

		// Vérifier que l'utilisateur a une session pour ce service
		let hasSession = multiTenantManager.hasServiceSession(userId, serviceName);

		// Pour Gmail, vérifier aussi directement dans le service Gmail
		if (!hasSession && serviceName === 'gmail') {
			const gmailSession = gmailService.getGmailSession(userId);
			hasSession = !!gmailSession;
			console.log(`[Disconnect] Session Gmail trouvée directement dans GmailService: ${!!gmailSession}`);
		}

		// Pour Axonaut, vérifier aussi directement dans le service Axonaut
		if (!hasSession && serviceName === 'axonaut') {
			const axonautSession = axonautService.getAxonautSession(userId);
			hasSession = !!axonautSession;
			console.log(`[Disconnect] Session Axonaut trouvée directement dans AxonautService: ${!!axonautSession}`);
		}

		// Vérifier aussi s'il y a une connexion en base de données
		let hasDatabaseConnection = false;
		try {
			const connections = await database.getUserMCPConnections(userId);
			hasDatabaseConnection = connections.some(conn => conn.service_name === serviceName && conn.is_connected);
			console.log(`[Disconnect] Connexion ${serviceName} trouvée en base de données: ${hasDatabaseConnection}`);
		} catch (dbError) {
			console.warn(`[Disconnect] Erreur vérification base de données:`, dbError);
		}

		if (!hasSession && !hasDatabaseConnection) {
			console.log(`[Disconnect] Aucune session ${serviceName} active ni connexion en base pour l'utilisateur ${userId}`);
			return res.status(404).json({
				success: false,
				error: `Aucune session active ${serviceName} trouvée pour l'utilisateur ${userId}`
			});
		}

		// Supprimer la session du service
		let removed = false;
		let serviceSpecificRemoved = false;
		let databaseDisconnected = false;

		try {
			// Supprimer la session du MultiTenantManager
			removed = multiTenantManager.removeServiceSession(userId, serviceName);
			console.log(`[Disconnect] Session ${serviceName} supprimée du MultiTenantManager: ${removed}`);

			// Nettoyer aussi dans le service spécifique
			if (serviceName === 'gmail') {
				serviceSpecificRemoved = gmailService.removeSession(userId);
				console.log(`[Disconnect] Session Gmail supprimée du service: ${serviceSpecificRemoved}`);
			} else if (serviceName === 'axonaut') {
				serviceSpecificRemoved = axonautService.removeSession(userId);
				console.log(`[Disconnect] Session Axonaut supprimée du service: ${serviceSpecificRemoved}`);
			}

			// Supprimer aussi la connexion de la base de données si elle existe
			if (hasDatabaseConnection) {
				databaseDisconnected = await database.disconnectMCPService(userId, serviceName);
				console.log(`[Disconnect] Connexion ${serviceName} supprimée de la base de données: ${databaseDisconnected}`);
			}

			// Considérer la suppression réussie si au moins une des trois a fonctionné
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
			} else {
				console.warn(`[Disconnect] Aucune session trouvée à supprimer pour ${userId}/${serviceName}`);
				res.json({
					success: true,
					message: `Aucune session active à supprimer pour ${serviceName}`,
					userId,
					service: serviceName
				});
			}
		} catch (cleanupError) {
			console.error(`[Disconnect] Erreur lors du nettoyage:`, cleanupError);
			// Même si le nettoyage échoue, on peut considérer que la déconnexion a réussi
			res.json({
				success: true,
				message: `Déconnexion ${serviceName} effectuée (avec avertissements)`,
				userId,
				service: serviceName,
				warning: 'Nettoyage partiel'
			});
		}

	} catch (error) {
		console.error(`[Disconnect] Erreur déconnexion ${serviceName}:`, error);
		res.status(500).json({
			success: false,
			error: 'Erreur lors de la déconnexion'
		});
	}
});

//  API DE STATUT AMÉLIORÉE
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

//  HEALTH CHECK POUR RAILWAY
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

//  ROUTE 404
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

//  DÉMARRAGE SERVEUR
app.listen(PORT, () => {
	console.log(`🚀 Multi-Service MCP Server running on port ${PORT}`);
	console.log(`🌐 Base URL: ${BASE_URL}`);
	console.log(`📱 Interface: ${BASE_URL}`);
	console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
	console.log(`📋 Services activés: ${serviceRegistry.getEnabledServices().map(s => s.displayName).join(', ')}`);
	console.log(`📡 Endpoint MCP: ${BASE_URL}/:userId/mcp/sse`);
	console.log(`💾 Persistance Redis activée avec utilisateurs persistants`);
});
