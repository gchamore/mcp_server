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
import { AxonautService } from "./services/axonaut/AxonautService.js";
import { UserSession, GmailSession, AxonautSession } from "./types/index.js";
import { redisPersistence as sessionPersistence } from "./utils/redis-persistence.js";
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

// 2. Créer le gestionnaire multi-tenant
const multiTenantManager = new MultiTenantManager(serviceRegistry);

// 3. Initialiser le service Gmail
const gmailService = new GmailService(
	GOOGLE_CLIENT_ID,
	GOOGLE_CLIENT_SECRET,
	BASE_URL
);

// 4. Initialiser le service Axonaut
const axonautService = new AxonautService();

// 5. Enregistrer les services
serviceRegistry.registerService(gmailService);
serviceRegistry.registerService(axonautService);

console.log('Architecture initialisée avec les services:', serviceRegistry.getServiceNames());

// ❌ SUPPRIMÉ : Nettoyage automatique des sessions (peut interrompre les connexions MCP)
// setInterval(() => {
//     multiTenantManager.cleanupExpiredSessions();
//     gmailService.cleanupExpiredSessions();
//     axonautService.cleanupExpiredSessions();
// }, 60 * 60 * 1000);

console.log('📌 Sessions permanentes activées - pas de suppression automatique');

// 🔄 INITIALISATION DE LA PERSISTANCE REDIS
console.log('💾 Initialisation du système de persistance Redis...');
await sessionPersistence.initialize();

// Redis se connecte de manière asynchrone via les event listeners
console.log('📝 Redis configuré - connexion automatique en arrière-plan');

// Restaurer les sessions depuis Redis (si disponible)
console.log('🔄 Restauration des sessions depuis Redis...');
await restoreAllSessionsFromRedis();

async function restoreAllSessionsFromRedis() {
	try {
		// Restaurer sessions utilisateur
		const userSessions = await sessionPersistence.loadUserSessions();
		for (const persistentSession of userSessions) {
			const userSession: UserSession = {
				userId: persistentSession.userId,
				createdAt: new Date(persistentSession.createdAt),
				lastAccessed: new Date(persistentSession.lastAccessed),
				services: {}
			};
			multiTenantManager.getUserSessionsMap().set(persistentSession.userId, userSession);
		}
		console.log(`✅ ${userSessions.length} sessions utilisateur restaurées depuis Redis`);

		// Restaurer sessions Gmail
		const gmailSessions = await sessionPersistence.loadGmailSessions();
		for (const persistentSession of gmailSessions) {
			const oauth2Client = new google.auth.OAuth2(
				GOOGLE_CLIENT_ID,
				GOOGLE_CLIENT_SECRET,
				`${BASE_URL}/oauth/callback`
			);
			const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

			const gmailSession: GmailSession = {
				serviceName: 'gmail' as const,
				userId: persistentSession.userId,
				userEmail: persistentSession.userEmail,
				isAuthenticated: persistentSession.isAuthenticated,
				createdAt: new Date(persistentSession.createdAt),
				lastAccessed: new Date(persistentSession.lastAccessed),
				gmail,
				oauth2Client,
				encryptedRefreshToken: persistentSession.encryptedRefreshToken,
				encryptedAccessToken: persistentSession.encryptedAccessToken
			};

			if (persistentSession.encryptedRefreshToken) {
				try {
					const refreshToken = decrypt(persistentSession.encryptedRefreshToken);
					oauth2Client.setCredentials({ refresh_token: refreshToken });
				} catch (error) {
					console.warn(`⚠️ Impossible de déchiffrer le refresh token pour ${persistentSession.userId}`);
				}
			}

			gmailService.getGmailSessionsMap().set(persistentSession.userId, gmailSession);
		}
		console.log(`✅ ${gmailSessions.length} sessions Gmail restaurées depuis Redis`);

		// Restaurer sessions Axonaut
		const axonautSessions = await sessionPersistence.loadAxonautSessions();
		for (const persistentSession of axonautSessions) {
			const axonautClient = {
				request: async (endpoint: string, options: any = {}) => {
					const url = `${persistentSession.baseUrl}/api/v2${endpoint}`;
					const apiKey = decrypt(persistentSession.encryptedApiKey);

					const response = await fetch(url, {
						...options,
						headers: {
							'userApiKey': apiKey,
							'Accept': 'application/json',
							'Content-Type': 'application/json',
							...options.headers
						}
					});

					if (!response.ok) {
						const errorText = await response.text();
						throw new Error(`API Axonaut error: ${response.status} ${response.statusText}: ${errorText}`);
					}

					return response.json();
				}
			};

			const axonautSession: AxonautSession = {
				serviceName: 'axonaut' as const,
				userId: persistentSession.userId,
				userEmail: persistentSession.userEmail,
				isAuthenticated: persistentSession.isAuthenticated,
				createdAt: new Date(persistentSession.createdAt),
				lastAccessed: new Date(persistentSession.lastAccessed),
				encryptedApiKey: persistentSession.encryptedApiKey,
				baseUrl: persistentSession.baseUrl,
				axonautClient
			};

			axonautService.getAxonautSessionsMap().set(persistentSession.userId, axonautSession);
		}
		console.log(`✅ ${axonautSessions.length} sessions Axonaut restaurées depuis Redis`);

	} catch (error) {
		console.error('❌ Erreur restauration depuis Redis:', error);
	}
}

// Reconnecter les sessions de services aux sessions utilisateur
console.log('🔗 Reconnexion des sessions de services...');
await reconnectServiceSessions();

async function reconnectServiceSessions() {
	try {
		// Récupérer toutes les sessions Gmail et les rattacher aux bonnes sessions utilisateur
		const gmailSessions = gmailService.getGmailSessionsMap();
		for (const [gmailUserId, gmailSession] of gmailSessions) {
			const userSession = multiTenantManager.getUserSession(gmailUserId);
			if (userSession && !userSession.services.gmail) {
				userSession.services.gmail = gmailSession;
				console.log(`🔗 Session Gmail ${gmailUserId} reconnectée`);
			}
		}

		// Récupérer toutes les sessions Axonaut et les rattacher aux bonnes sessions utilisateur
		const axonautSessions = axonautService.getAxonautSessionsMap();
		for (const [axonautUserId, axonautSession] of axonautSessions) {
			const userSession = multiTenantManager.getUserSession(axonautUserId);
			if (userSession && !userSession.services.axonaut) {
				userSession.services.axonaut = axonautSession;
				console.log(`🔗 Session Axonaut ${axonautUserId} reconnectée`);
			}
		}

		console.log('✅ Reconnexion des sessions terminée');
	} catch (error) {
		console.error('❌ Erreur lors de la reconnexion des sessions:', error);
	}
}

// Sauvegarde périodique des sessions (DÉSACTIVÉE - sauvegarde à la création)
const SAVE_INTERVAL = 5 * 60 * 1000; // 5 minutes
// setInterval(async () => {
// 	try {
// 		console.log('💾 Sauvegarde périodique des sessions...');
// 		await sessionPersistence.saveAllSessions(
// 			multiTenantManager.getUserSessionsMap(),
// 			gmailService.getGmailSessionsMap(),
// 			axonautService.getAxonautSessionsMap()
// 		);
// 	} catch (error) {
// 		console.error('❌ Erreur sauvegarde périodique:', error);
// 	}
// }, SAVE_INTERVAL);

console.log('📝 Sauvegarde périodique désactivée - sauvegarde à la création uniquement');

// Sauvegarde lors de l'arrêt du serveur
const gracefulShutdown = async (signal: string) => {
	console.log(`\n📡 Signal ${signal} reçu, arrêt en cours...`);
	
	try {
		console.log('💾 Sauvegarde finale des sessions...');
		await sessionPersistence.saveAllSessions(
			multiTenantManager.getUserSessionsMap(),
			gmailService.getGmailSessionsMap(),
			axonautService.getAxonautSessionsMap()
		);
		
		await sessionPersistence.disconnect();
		console.log('✅ Sauvegarde terminée');
	} catch (error) {
		console.error('❌ Erreur lors de la sauvegarde finale:', error);
	}
	
	process.exit(0);
};

// Écouter les signaux d'arrêt
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2')); // nodemon

// APPLICATION EXPRESS UNIFIÉE
const app = express();

// Juste trust proxy pour Railway (utile pour req.ip)
app.set('trust proxy', 1);

// Headers de sécurité légers (optionnel)
app.use((req, res, next) => {
	res.setHeader('X-Content-Type-Options', 'nosniff');
	res.setHeader('X-Frame-Options', 'DENY');
	next();
});

// NOUVELLES ROUTES MULTI-SERVICES

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

		// 1. CRÉER LE TRANSPORT
		transport = new SSEServerTransport(`/${userId}/mcp/message`, res);
		sessionId = transport.sessionId;

		// 2. CRÉER LE SERVEUR MCP MULTI-SERVICES
		// Nom dynamique basé sur les services connectés
		let serverName = "MCP";
		if (connectedServices.length === 1) {
			// Un seul service : "MCP Gmail"
			const serviceName = connectedServices[0];
			const service = serviceRegistry.getService(serviceName);
			serverName = `MCP ${service?.displayName || serviceName}`;
		} else if (connectedServices.length > 1) {
			// Plusieurs services : "MCP Multi-Services"
			serverName = "MCP Multi-Services";
		} else {
			// Aucun service : "MCP Wesype"
			serverName = "MCP Wesype";
		}

		const server = new McpServer({
			name: serverName,
			version: "2.0.0",
		});

		// 3. ENREGISTRER LES OUTILS DE TOUS LES SERVICES CONNECTÉS
		for (const serviceName of connectedServices) {
			const service = serviceRegistry.getService(serviceName);
			const serviceSession = multiTenantManager.getServiceSession(userId, serviceName);

			if (service && serviceSession) {
				console.log(`[MCP] Enregistrement des outils ${serviceName}...`);
				service.registerTools(server, serviceSession);
			}
		}

		// 4. CONNECTER LE TRANSPORT AU SERVEUR
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
			
			// 💾 Sauvegarde immédiate dans Redis
			try {
				// Sauvegarder la session Gmail + session utilisateur
				const newGmailSession = gmailService.getGmailSession(authResult.userId);
				if (newGmailSession) {
					const tempGmailMap = new Map();
					tempGmailMap.set(authResult.userId, newGmailSession);
					await sessionPersistence.saveGmailSessions(tempGmailMap);
					
					// Sauvegarder aussi la session utilisateur correspondante
					const userSession = multiTenantManager.getUserSession(authResult.userId);
					if (userSession) {
						const tempUserMap = new Map();
						tempUserMap.set(authResult.userId, userSession);
						await sessionPersistence.saveUserSessions(tempUserMap);
					}
					
					console.log(`💾 Session Gmail ${authResult.userId} + session utilisateur sauvegardées immédiatement`);
				}
			} catch (error) {
				console.error('❌ Erreur sauvegarde immédiate Gmail:', error);
			}
			
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
	const { userId, apiKey, baseUrl, userEmail } = req.body;

	if (!userId || !apiKey || !baseUrl) {
		return res.status(400).json({
			success: false,
			error: 'userId, apiKey et baseUrl sont requis'
		});
	}

	try {
		console.log(`[Axonaut] Tentative d'authentification pour l'utilisateur ${userId}`);

		const authResult = await axonautService.authenticateWithApiKey(apiKey, baseUrl, userEmail);

		if (authResult.success && authResult.userId) {
			// Récupérer la session créée par le service
			const axonautSession = axonautService.getAxonautSession(authResult.userId);

			if (!axonautSession) {
				throw new Error('Session Axonaut non trouvée après création');
			}

			// Créer/récupérer la session utilisateur
			let userSession = multiTenantManager.getUserSession(userId);
			if (!userSession) {
				multiTenantManager.createUserSession(userId);
				userSession = multiTenantManager.getUserSession(userId);
			}

			// Ajouter la session Axonaut
			if (userSession) {
				multiTenantManager.addServiceSession(userId, 'axonaut', axonautSession);
				console.log(`[Axonaut] Authentification réussie pour ${userId}`);

				// 💾 Sauvegarde immédiate dans Redis
				try {
					// Sauvegarder seulement la nouvelle session Axonaut + session utilisateur
					const tempAxonautMap = new Map();
					tempAxonautMap.set(authResult.userId, axonautSession);
					await sessionPersistence.saveAxonautSessions(tempAxonautMap);
					
					const tempUserMap = new Map();
					tempUserMap.set(userId, userSession);
					await sessionPersistence.saveUserSessions(tempUserMap);
					
					console.log(`💾 Session Axonaut ${authResult.userId} sauvegardée immédiatement`);
				} catch (error) {
					console.error('❌ Erreur sauvegarde immédiate Axonaut:', error);
				}

				res.json({
					success: true,
					message: 'Authentification Axonaut réussie',
					userId,
					service: 'axonaut',
					userEmail: authResult.userEmail,
					mcpEndpoint: `${BASE_URL}/${userId}/mcp/sse`
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

		if (!hasSession) {
			console.log(`[Disconnect] Aucune session ${serviceName} active pour l'utilisateur ${userId}`);
			return res.status(404).json({
				success: false,
				error: `Aucune session active ${serviceName} trouvée pour l'utilisateur ${userId}`
			});
		}

		// Supprimer la session du service
		let removed = false;
		let serviceSpecificRemoved = false;

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

			// Considérer la suppression réussie si au moins une des deux a fonctionné
			const overallSuccess = removed || serviceSpecificRemoved;

			if (overallSuccess) {
				console.log(`[Disconnect] Déconnexion ${serviceName} réussie pour l'utilisateur ${userId}`);
				res.json({
					success: true,
					message: `Déconnexion ${serviceName} réussie`,
					userId,
					service: serviceName,
					details: {
						multiTenantManager: removed,
						serviceSpecific: serviceSpecificRemoved
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
	const redisHealth = await sessionPersistence.healthCheck();
	const redisStats = await sessionPersistence.getStats();
	
	res.json({
		status: 'OK',
		timestamp: new Date().toISOString(),
		baseUrl: BASE_URL,
		environment: process.env.NODE_ENV || 'development',
		version: '2.0.0',
		architecture: 'multi-services',
		redis: {
			connected: redisHealth,
			url_configured: !!process.env.REDIS_URL,
			stats: redisStats
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
	console.log(`💾 Persistance Redis activée avec sauvegarde toutes les ${SAVE_INTERVAL / 60000} minutes`);
});
