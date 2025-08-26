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
            userSession?: import('./core/SessionManager.js').UserSession;
        }
    }
}

// Import des nouvelles classes
import { ServiceRegistry } from "./core/ServiceRegistry.js";
import { MultiTenantManager } from "./core/MultiTenantManager.js";
import { DatabaseUserManager } from "./core/DatabaseUserManager.js";
import { DatabaseManager } from "./database/DatabaseManager.js";
import { SessionManager } from "./core/SessionManager.js";
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

// 2. Initialiser PostgreSQL
const database = new DatabaseManager();
await database.initialize();

// 3. Créer le gestionnaire utilisateur avec PostgreSQL
const userManager = new DatabaseUserManager(
	GOOGLE_CLIENT_ID,
	GOOGLE_CLIENT_SECRET,
	`${BASE_URL}/auth/google/callback`,
	database
);

// 3. Créer le gestionnaire de sessions sécurisées
const sessionManager = new SessionManager();

// 4. Créer le gestionnaire multi-tenant
const multiTenantManager = new MultiTenantManager(serviceRegistry);

// 5. Initialiser le service Gmail
const gmailService = new GmailService(
	GOOGLE_CLIENT_ID,
	GOOGLE_CLIENT_SECRET,
	BASE_URL
);

// 6. Initialiser le service Axonaut
const axonautService = new AxonautService();

// 6. Enregistrer les services
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

// APPLICATION EXPRESS UNIFIÉE
const app = express();

// Juste trust proxy pour Railway (utile pour req.ip)
app.set('trust proxy', 1);

// Configuration des cookies et sessions
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
		const session = await sessionManager.getSession(sessionId);
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
		const userId = await userManager.authenticateWithGoogle(code as string);
		const user = await userManager.getUser(userId);
        
		if (!user) {
			console.error('❌ Utilisateur non trouvé après authentification');
			return res.redirect('/?error=user_not_found');
		}

		// Créer une session sécurisée
		const sessionId = await sessionManager.createSession({
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
				// Enregistrer la connexion MCP en base avec les informations Gmail
				await userManager.connectMCPService(userId, 'gmail', {
					externalUserId: authResult.userId,
					userEmail: authResult.userEmail,
					encryptedAccessToken: gmailSession.encryptedAccessToken,
					encryptedRefreshToken: gmailSession.encryptedRefreshToken
				});

				return res.redirect(`/pages/gmail.html?success=true&userId=${authResult.userId}&email=${encodeURIComponent(authResult.userEmail || '')}`);
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
		await sessionManager.deleteSession(sessionId);
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
		
		// Supprimer de Redis
		await sessionPersistence.deleteUserSession(userId);
		
		// Supprimer l'utilisateur du gestionnaire persistant
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

		const session = await sessionManager.getSession(sessionId);
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
			
			// 💾 Sauvegarde immédiate dans Redis
			try {
				// Sauvegarder la session Gmail + session utilisateur
				const newGmailSession = gmailService.getGmailSession(authResult.userId);
				if (newGmailSession && userSession) {
					const tempGmailMap = new Map();
					tempGmailMap.set(authResult.userId, newGmailSession);
					await sessionPersistence.saveGmailSessions(tempGmailMap);
					
					// Sauvegarder aussi la session utilisateur correspondante
					const tempUserMap = new Map();
					tempUserMap.set(authResult.userId, userSession);
					await sessionPersistence.saveUserSessions(tempUserMap);
					
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

		const authResult = await axonautService.authenticateWithApiKey(apiKey, baseUrl, userEmail, userId);

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
					tempAxonautMap.set(userId, axonautSession);
					await sessionPersistence.saveAxonautSessions(tempAxonautMap);
					
					const tempUserMap = new Map();
					tempUserMap.set(userId, userSession);
					await sessionPersistence.saveUserSessions(tempUserMap);
					
					console.log(`💾 Session Axonaut ${userId} sauvegardée immédiatement`);
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
	console.log(`💾 Persistance Redis activée avec utilisateurs persistants`);
});
