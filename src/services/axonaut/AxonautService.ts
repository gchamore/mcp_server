// src/services/axonaut/AxonautService.ts - Service Axonaut avec clé API

import { BaseService } from "../../core/BaseService.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import {
	AxonautSession,
	AuthResult,
	AxonautContact,
	AxonautInvoice,
	AxonautApiConfig
} from "../../types/index.js";
import { encrypt, decrypt, maskApiKey } from "../../utils/encryption.js";

export class AxonautService extends BaseService {
	public readonly serviceName = 'axonaut';
	public readonly displayName = 'Axonaut';
	public readonly requiredScopes: string[] = []; // Pas d'OAuth, utilise clé API

	private axonautSessions = new Map<string, AxonautSession>();

	constructor() {
		// Configuration vide car on utilise pas OAuth mais clé API
		super({
			clientId: '',
			clientSecret: '',
			redirectUri: '',
			scopes: []
		});
	}

	isConfigured(): boolean {
		// Le service est toujours configuré car on utilise la clé API de l'utilisateur
		return true;
	}

	createAuthUrl(): string {
		// Pas d'OAuth, retourne une URL vide (sera géré différemment)
		return '';
	}

	async handleCallback(code: string): Promise<AuthResult> {
		// Pour Axonaut, on ne passe pas par un callback OAuth
		return {
			success: false,
			error: 'Axonaut utilise une authentification par clé API, pas OAuth'
		};
	}

	// Méthode spécifique pour Axonaut : authentification par clé API
	async authenticateWithApiKey(apiKey: string, baseUrl: string, userEmail?: string, userId?: string): Promise<AuthResult> {
		try {
			// Utiliser l'userId fourni ou en générer un nouveau
			const sessionUserId = userId || uuidv4();

			// Tester la validité de la clé API (avec la vraie clé)
			const isValid = await this.testApiKey(apiKey, baseUrl);
			if (!isValid) {
				return {
					success: false,
					error: 'Clé API Axonaut invalide ou URL incorrecte'
				};
			}

			// Chiffrer la clé API
			const encryptedApiKey = encrypt(apiKey);

			// Créer le client Axonaut avec la clé chiffrée
			const axonautClient = this.createAxonautClient(apiKey, baseUrl);

			// Créer la session Axonaut sécurisée
			const axonautSession: AxonautSession = {
				serviceName: 'axonaut',
				userId: sessionUserId,
				userEmail: userEmail || 'utilisateur@axonaut.com',
				isAuthenticated: true,
				createdAt: new Date(),
				lastAccessed: new Date(),
				encryptedApiKey, // Clé API chiffrée
				baseUrl,
				axonautClient
			};

			this.axonautSessions.set(sessionUserId, axonautSession);
			console.log(`✅ Session Axonaut créée pour ${userEmail || 'utilisateur'}: ${sessionUserId}`);
			console.log(`🔐 Clé API chiffrée: ${maskApiKey(apiKey)}`);

			// ✅ Plus d'auto-sauvegarde - Redis gère tout

			return {
				success: true,
				userId: sessionUserId,
				userEmail: userEmail || 'utilisateur@axonaut.com'
			};
		} catch (error) {
			console.error('❌ Erreur authentification Axonaut:', error);
			return {
				success: false,
				error: error instanceof Error ? error.message : 'Erreur inconnue'
			};
		}
	}

	// Méthode pour obtenir la clé API déchiffrée
	private getDecryptedApiKey(session: AxonautSession): string {
		try {
			return decrypt(session.encryptedApiKey);
		} catch (error) {
			console.error('❌ Erreur déchiffrement clé API Axonaut:', error);
			throw new Error('Impossible de déchiffrer la clé API');
		}
	}

	private async testApiKey(apiKey: string, baseUrl: string): Promise<boolean> {
		try {
			// Test avec l'endpoint /api/v2/me qui devrait exister selon la doc
			const response = await fetch(`${baseUrl}/api/v2/me`, {
				headers: {
					'userApiKey': apiKey,
					'Accept': 'application/json'
				}
			});

			console.log(`🧪 Test API Axonaut: ${response.status} ${response.statusText}`);

			if (!response.ok) {
				// Essayer avec Authorization: Bearer
				const responseBearer = await fetch(`${baseUrl}/api/v2/me`, {
					headers: {
						'Authorization': `Bearer ${apiKey}`,
						'Accept': 'application/json'
					}
				});

				console.log(`🧪 Test API Axonaut (Bearer): ${responseBearer.status} ${responseBearer.statusText}`);
				return responseBearer.ok;
			}

			return response.ok;
		} catch (error) {
			console.error('❌ Test clé API Axonaut échoué:', error);
			return false;
		}
	}

	private createAxonautClient(encryptedApiKey: string, baseUrl: string) {
		return {
			request: async (endpoint: string, options: any = {}) => {
				const url = `${baseUrl}/api/v2${endpoint}`;

				// Déchiffrer la clé API juste pour cette requête
				const apiKey = decrypt(encryptedApiKey);

				const response = await fetch(url, {
					...options,
					headers: {
						'userApiKey': apiKey, // ✅ Clé déchiffrée temporairement
						'Accept': 'application/json',
						'Content-Type': 'application/json',
						...options.headers
					}
				});

				if (!response.ok) {
					const errorText = await response.text();
					console.error(`❌ API Axonaut error: ${response.status} ${response.statusText} - ${errorText}`);
					throw new Error(`API Axonaut error: ${response.status} ${response.statusText}: ${errorText}`);
				}

				return response.json();
			}
		};
	}

	getAxonautSession(userId: string): AxonautSession | null {
		const session = this.axonautSessions.get(userId);
		if (session) {
			session.lastAccessed = new Date();
		}
		return session || null;
	}

	async refreshTokens(session: AxonautSession): Promise<boolean> {
		try {
			// Pour Axonaut, on teste si la clé API est toujours valide
			const apiKey = this.getDecryptedApiKey(session);
			const isValid = await this.testApiKey(apiKey, session.baseUrl);

			if (isValid) {
				// ✅ Recréer le client avec la clé chiffrée
				session.axonautClient = this.createAxonautClient(session.encryptedApiKey, session.baseUrl);
			}

			return isValid;
		} catch (error) {
			console.error('❌ Erreur refresh Axonaut:', error);
			return false;
		}
	}

	registerTools(server: McpServer, userSession: AxonautSession): void {
		// ✅ Créer le client avec la clé chiffrée
		userSession.axonautClient = this.createAxonautClient(userSession.encryptedApiKey, userSession.baseUrl);

		// OUTIL 1: Lister les entreprises
		server.tool(
			"axonaut_list_companies",
			"Lister les entreprises Axonaut",
			{
				limit: z.number().optional().default(10).describe("Nombre d'entreprises à récupérer"),
				search: z.string().optional().describe("Recherche par nom")
			},
			async ({ limit = 10, search }) => {
				try {
					let endpoint = `/companies?limit=${limit}`;
					if (search) {
						endpoint += `&search=${encodeURIComponent(search)}`;
					}

					const data = await userSession.axonautClient.request(endpoint);

					return {
						content: [
							{
								type: "text",
								text: `📋 **Entreprises Axonaut** (${data.data?.length || 0} résultats)\n\n` +
									(data.data || []).map((company: any) =>
										`• **${company.name}**\n` +
										`  📧 ${company.email || 'N/A'}\n` +
										`  💰 ${company.currency || 'N/A'}\n` +
										`  💬 ${company.comments || 'N/A'}\n`
									).join('\n')
							}
						]
					};
				} catch (error) {
					return {
						content: [
							{
								type: "text",
								text: `❌ Erreur lors de la récupération des contacts: ${error instanceof Error ? error.message : 'Erreur inconnue'}`
							}
						],
						isError: true
					};
				}
			}
		);

		// OUTIL 2: Rechercher une entreprise spécifique
		server.tool(
			"axonaut_search_company",
			"Rechercher une entreprise spécifique par nom",
			{
				query: z.string().describe("Nom ou partie du nom de l'entreprise à rechercher"),
				exactMatch: z.boolean().optional().default(false).describe("Correspondance exacte du nom")
			},
			async ({ query, exactMatch = false }) => {
				try {
					const endpoint = `/companies?search=${encodeURIComponent(query)}`;
					const data = await userSession.axonautClient.request(endpoint);

					let companies = data.data || [];

					// Filtrage pour correspondance exacte si demandé
					if (exactMatch) {
						companies = companies.filter((company: any) =>
							company.name.toLowerCase() === query.toLowerCase()
						);
					}

					if (companies.length === 0) {
						return {
							content: [
								{
									type: "text",
									text: `🔍 **Recherche entreprise: "${query}"**\n\n❌ Aucune entreprise trouvée.`
								}
							]
						};
					}

					return {
						content: [
							{
								type: "text",
								text: `🔍 **Recherche entreprise: "${query}"** (${companies.length} résultat${companies.length > 1 ? 's' : ''})\n\n` +
									companies.map((company: any, index: number) =>
										`${index + 1}. **${company.name}**\n` +
										`   📧 Email: ${company.email || 'N/A'}\n` +
										`   💰 Devise: ${company.currency || 'N/A'}\n` +
										`   📊 Statut: ${company.is_customer ? '👤 Client' : ''}${company.is_prospect ? '🎯 Prospect' : ''}\n` +
										`   💬 Commentaires: ${company.comments || 'N/A'}\n` +
										`   🆔 ID: ${company.id}\n`
									).join('\n')
							}
						]
					};
				} catch (error) {
					return {
						content: [
							{
								type: "text",
								text: `❌ Erreur lors de la recherche d'entreprise: ${error instanceof Error ? error.message : 'Erreur inconnue'}`
							}
						],
						isError: true
					};
				}
			}
		);

		// OUTIL 3: Créer une entreprise
		server.tool(
			"axonaut_create_company",
			"Créer une nouvelle entreprise Axonaut",
			{
				name: z.string().describe("Nom de l'entreprise"),
				currency: z.string().optional().default("EUR").describe("Devise de l'entreprise"),
				comments: z.string().optional().describe("Commentaires sur l'entreprise"),
				isCustomer: z.boolean().optional().describe("Si c'est un client"),
				isProspect: z.boolean().optional().describe("Si c'est un prospect")
			},
			async ({ name, currency, comments, isCustomer, isProspect }) => {
				try {
					const companyData = {
						name,
						currency,
						comments,
						is_customer: isCustomer,
						is_prospect: isProspect
					};

					const result = await userSession.axonautClient.request('/companies', {
						method: 'POST',
						body: JSON.stringify(companyData)
					});

					return {
						content: [
							{
								type: "text",
								text: `✅ **Entreprise créée avec succès !**\n\n` +
									`🏢 **${result.name}**\n` +
									`💰 Devise: ${result.currency}\n` +
									`💬 Commentaires: ${result.comments || 'N/A'}\n` +
									`🆔 ID: ${result.id}`
							}
						]
					};
				} catch (error) {
					return {
						content: [
							{
								type: "text",
								text: `❌ Erreur lors de la création de l'entreprise: ${error instanceof Error ? error.message : 'Erreur inconnue'}`
							}
						],
						isError: true
					};
				}
			}
		);

		// OUTIL 4: Lister les factures
		server.tool(
			"axonaut_list_invoices",
			"Lister les factures Axonaut",
			{
				limit: z.number().optional().default(10).describe("Nombre de factures à récupérer (max 500)"),
				page: z.number().optional().default(1).describe("Page à récupérer"),
				status: z.string().optional().describe("Filtrer par statut (draft, sent, paid, etc.)")
			},
			async ({ limit = 10, page = 1, status }) => {
				try {
					let endpoint = `/invoices?page=${page}`;
					if (status) {
						endpoint += `&status=${encodeURIComponent(status)}`;
					}

					const data = await userSession.axonautClient.request(endpoint, {
						headers: {
							'page': page.toString()
						}
					});

					// Limiter le nombre de résultats côté client si nécessaire
					const invoices = Array.isArray(data) ? data.slice(0, limit) : (data.data || []).slice(0, limit);

					return {
						content: [
							{
								type: "text",
								text: `🧾 **Factures Axonaut** (${invoices.length} résultats, page ${page})\n\n` +
									invoices.map((invoice: AxonautInvoice, index: number) =>
										`${index + 1}. **Facture ${invoice.number || invoice.id}**\n` +
										`   💰 ${invoice.amount || invoice.total_amount || 'N/A'}€\n` +
										`   📅 ${invoice.date || invoice.creation_date || 'N/A'}\n` +
										`   🔔 ${invoice.status || 'N/A'}\n` +
										`   🆔 ${invoice.id}\n`
									).join('\n')
							}
						]
					};
				} catch (error) {
					return {
						content: [
							{
								type: "text",
								text: `❌ Erreur lors de la récupération des factures: ${error instanceof Error ? error.message : 'Erreur inconnue'}`
							}
						],
						isError: true
					};
				}
			}
		);

		// OUTIL 5: Récupérer le détail d'une facture
		server.tool(
			"axonaut_get_invoice_detail",
			"Obtenir le détail complet d'une facture spécifique",
			{
				invoiceId: z.number().describe("ID de la facture à récupérer")
			},
			async ({ invoiceId }) => {
				try {
					const invoice = await userSession.axonautClient.request(`/invoices/${invoiceId}`);

					return {
						content: [
							{
								type: "text",
								text: `🧾 **Détail de la facture ${invoice.number || invoice.id}**\n\n` +
									`📋 **Informations générales:**\n` +
									`   • Numéro: ${invoice.number || 'N/A'}\n` +
									`   • Date: ${invoice.date || invoice.creation_date || 'N/A'}\n` +
									`   • Statut: ${invoice.status || 'N/A'}\n` +
									`   • Montant HT: ${invoice.pre_tax_amount || 'N/A'}€\n` +
									`   • Montant TTC: ${invoice.amount || invoice.total_amount || 'N/A'}€\n\n` +

									`🏢 **Client:**\n` +
									`   • Nom: ${invoice.company?.name || 'N/A'}\n` +
									`   • Email: ${invoice.company?.email || 'N/A'}\n\n` +

									(invoice.invoice_lines && invoice.invoice_lines.length > 0 ?
										`📦 **Lignes de facture:**\n` +
										invoice.invoice_lines.map((line: any, index: number) =>
											`   ${index + 1}. ${line.product_name || line.description || 'Produit'}\n` +
											`      • Quantité: ${line.quantity || 'N/A'}\n` +
											`      • Prix unitaire: ${line.unit_price || 'N/A'}€\n` +
											`      • Total HT: ${line.total_pre_tax_amount || 'N/A'}€\n`
										).join('\n') :
										`📦 **Lignes de facture:** Aucune ligne détectée\n`
									) +

									`\n🆔 **ID:** ${invoice.id}`
							}
						]
					};
				} catch (error) {
					return {
						content: [
							{
								type: "text",
								text: `❌ Erreur lors de la récupération du détail de la facture: ${error instanceof Error ? error.message : 'Erreur inconnue'}`
							}
						],
						isError: true
					};
				}
			}
		);

		// OUTIL 6: Informations du compte
		server.tool(
			"axonaut_get_account_info",
			"Obtenir les informations du compte Axonaut",
			{},
			async () => {
				try {
					const data = await userSession.axonautClient.request('/me');

					return {
						content: [
							{
								type: "text",
								text: `🏢 **Informations du compte Axonaut**\n\n` +
									`📧 Email: ${userSession.userEmail}\n` +
									`🌐 URL: ${userSession.baseUrl}\n` +
									`✅ Connexion active depuis: ${userSession.createdAt.toLocaleString()}\n` +
									`🔄 Dernière activité: ${userSession.lastAccessed.toLocaleString()}`
							}
						]
					};
				} catch (error) {
					return {
						content: [
							{
								type: "text",
								text: `❌ Erreur lors de la récupération des informations: ${error instanceof Error ? error.message : 'Erreur inconnue'}`
							}
						],
						isError: true
					};
				}
			}
		);
	}

	// Méthodes utilitaires
	cleanupExpiredSessions() {
		// ❌ DÉSACTIVÉ : Préservation des sessions Axonaut pour les connexions MCP
		console.log('🔒 Nettoyage Axonaut désactivé - sessions préservées pour MCP');
		
		// Log du nombre de sessions Axonaut actives
		const activeAxonautSessions = this.axonautSessions.size;
		console.log(`📊 Sessions Axonaut actives: ${activeAxonautSessions}`);
		
		// Optionnel : Vérification de la validité des clés API
		this.validateActiveApiKeys();
	}

	// Nouvelle méthode pour valider les clés API actives
	private async validateActiveApiKeys() {
		let validatedCount = 0;
		
		for (const [userId, session] of this.axonautSessions) {
			try {
				// Tester la validité de la clé API
				const isValid = await this.refreshTokens(session);
				if (isValid) {
					validatedCount++;
				} else {
					console.warn(`⚠️ Clé API Axonaut invalide pour ${userId} - session conservée`);
				}
			} catch (error) {
				console.warn(`⚠️ Erreur validation clé API pour ${userId}:`, error);
			}
		}
		
		if (validatedCount > 0) {
			console.log(`✅ ${validatedCount} clés API Axonaut validées`);
		}
	}

	// Nettoyage forcé pour les sessions très anciennes (utilisation manuelle)
	forceCleanupOldSessions(daysOld: number = 30) {
		const now = new Date();
		const EXPIRY_TIME = daysOld * 24 * 60 * 60 * 1000;
		let cleanedCount = 0;

		for (const [userId, session] of this.axonautSessions) {
			const timeSinceLastAccess = now.getTime() - session.lastAccessed.getTime();
			if (timeSinceLastAccess > EXPIRY_TIME) {
				this.axonautSessions.delete(userId);
				cleanedCount++;
				console.log(`🗑️ Session Axonaut très ancienne supprimée: ${userId} (${Math.round(timeSinceLastAccess / (24 * 60 * 60 * 1000))} jours)`);
			}
		}

		console.log(`🧹 Nettoyage Axonaut forcé: ${cleanedCount} sessions supprimées`);
		return cleanedCount;
	}

	removeSession(userId: string): boolean {
		const wasPresent = this.axonautSessions.has(userId);
		if (wasPresent) {
			this.axonautSessions.delete(userId);
			console.log(`✅ Session Axonaut supprimée: ${userId}`);
		}
		return wasPresent;
	}

	getAllSessions(): AxonautSession[] {
		return Array.from(this.axonautSessions.values());
	}

	getSessionCount(): number {
		return this.axonautSessions.size;
	}

	// Méthode pour obtenir les sessions brutes (pour la sauvegarde globale Redis)
	getAxonautSessionsMap(): Map<string, AxonautSession> {
		return this.axonautSessions;
	}
}