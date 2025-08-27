// src/services/gmail/GmailService.ts - Service Gmail optimisé et corrigé
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { v4 as uuidv4 } from 'uuid';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { BaseService } from "../../core/BaseService.js";
import { GmailSession, EmailData, GmailHeader, AuthResult } from "../../types/index.js";
import { encrypt, decrypt, maskApiKey } from "../../utils/encryption.js";

export class GmailService extends BaseService {
	public readonly serviceName = 'gmail';
	public readonly displayName = 'Gmail';
	public readonly requiredScopes = [
		'https://www.googleapis.com/auth/gmail.readonly',
		'https://www.googleapis.com/auth/gmail.send',
		'https://www.googleapis.com/auth/gmail.modify'
	];

	private gmailSessions = new Map<string, GmailSession>();

	constructor(clientId: string, clientSecret: string, baseUrl: string) {
		super({
			clientId,
			clientSecret,
			redirectUri: `${baseUrl}/auth/google/callback/gmail`,
			scopes: [
				'https://www.googleapis.com/auth/gmail.readonly',
				'https://www.googleapis.com/auth/gmail.send',
				'https://www.googleapis.com/auth/gmail.modify'
			]
		});
	}

	isConfigured(): boolean {
		return this.validateOAuthConfig();
	}

	createAuthUrl(state: string = 'flow=gmail'): string {
		const oauth2Client = new google.auth.OAuth2(
			this.oauthConfig.clientId,
			this.oauthConfig.clientSecret,
			this.oauthConfig.redirectUri
		);

		return oauth2Client.generateAuthUrl({
			access_type: 'offline',
			prompt: 'consent',
			include_granted_scopes: true,
			scope: this.requiredScopes,
			state
		});
	}

	async handleCallback(code: string): Promise<AuthResult> {
		try {
			const oauth2Client = new google.auth.OAuth2(
				this.oauthConfig.clientId,
				this.oauthConfig.clientSecret,
				this.oauthConfig.redirectUri
			);

			const { tokens } = await oauth2Client.getToken(code);
			const userId = await this.createGmailSession(tokens);

			return {
				success: true,
				userId,
				userEmail: this.gmailSessions.get(userId)?.userEmail
			};
		} catch (error) {
			console.error('❌ Erreur OAuth Gmail:', error);
			return {
				success: false,
				error: `Erreur OAuth: ${error}`
			};
		}
	}

	private async createGmailSession(tokens: any): Promise<string> {
		const userId = uuidv4();
		const oauth2Client = new google.auth.OAuth2(
			this.oauthConfig.clientId,
			this.oauthConfig.clientSecret,
			this.oauthConfig.redirectUri
		);

		oauth2Client.setCredentials(tokens);
		const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

		// Obtenir l'email utilisateur
		const profile = await gmail.users.getProfile({ userId: 'me' });
		const userEmail = profile.data.emailAddress as string;

		if (!userEmail) {
			throw new Error('Email utilisateur manquant dans la réponse Gmail');
		}

		// Créer la session avec chiffrement des tokens
		const gmailSession: GmailSession = {
			serviceName: 'gmail',
			userId,
			userEmail,
			isAuthenticated: true,
			createdAt: new Date(),
			lastAccessed: new Date(),
			gmail,
			oauth2Client,
			encryptedRefreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : undefined,
			encryptedAccessToken: tokens.access_token ? encrypt(tokens.access_token) : undefined
		};

		this.gmailSessions.set(userId, gmailSession);
		console.log(`✅ Session Gmail créée pour ${userEmail}: ${userId}`);

		return userId;
	}

	private getDecryptedToken(encryptedToken: string | undefined): string | null {
		try {
			return encryptedToken ? decrypt(encryptedToken) : null;
		} catch (error) {
			console.error('❌ Erreur déchiffrement token:', error);
			return null;
		}
	}

	async refreshTokens(session: GmailSession): Promise<boolean> {
		try {
			const refreshToken = this.getDecryptedToken(session.encryptedRefreshToken);
			if (!refreshToken) {
				console.error('❌ Refresh token manquant');
				return false;
			}

			session.oauth2Client.setCredentials({ refresh_token: refreshToken });
			const newTokens = await session.oauth2Client.refreshAccessToken();
			session.oauth2Client.setCredentials(newTokens.credentials);

			// Chiffrer le nouveau access token
			if (newTokens.credentials.access_token) {
				session.encryptedAccessToken = encrypt(newTokens.credentials.access_token);
			}

			session.lastAccessed = new Date();
			console.log(`🔄 Tokens Gmail refreshés pour ${maskApiKey(session.userId)}`);
			return true;
		} catch (error) {
			console.error('❌ Erreur refresh token Gmail:', error);
			return false;
		}
	}

	registerTools(server: McpServer, userSession: GmailSession): void {
		// OUTIL 1: GET_PROFILE
		server.tool(
			"gmail_get_profile",
			"Obtenir le profil Gmail",
			{},
			async () => {
				try {
					const profile = await userSession.gmail.users.getProfile({ userId: 'me' });
					return {
						content: [{
							type: "text" as const,
							text: JSON.stringify({
								success: true,
								profile: {
									email: profile.data.emailAddress,
									messages_total: profile.data.messagesTotal,
									threads_total: profile.data.threadsTotal
								},
								user: userSession.userEmail,
								service: 'gmail'
							})
						}]
					};
				} catch (error) {
					return this.createErrorResponse(error);
				}
			}
		);

		// OUTIL 2: LIST_EMAILS
		server.tool(
			"gmail_list_emails",
			"Lister les emails Gmail",
			{
				query: z.string().optional().describe("Requête de recherche Gmail"),
				maxResults: z.number().optional().default(10).describe("Nombre maximum de résultats")
			},
			async (args: { query?: string; maxResults?: number }) => {
				const { query, maxResults = 10 } = args;
				try {
					const searchParams: any = {
						userId: 'me',
						maxResults: Math.min(maxResults, 20)
					};

					if (query) searchParams.q = query;

					const results = await userSession.gmail.users.messages.list(searchParams);
					const messages = results.data.messages || [];

					if (messages.length === 0) {
						return {
							content: [{
								type: "text" as const,
								text: JSON.stringify({
									success: true,
									message: `Aucun email trouvé${query ? ` pour: ${query}` : ''}`,
									count: 0,
									emails: [],
									user: userSession.userEmail,
									service: 'gmail'
								})
							}]
						};
					}

					const detailedEmails = await this.getDetailedEmails(userSession, messages);

					return {
						content: [{
							type: "text" as const,
							text: JSON.stringify({
								success: true,
								message: `${detailedEmails.length} emails trouvés`,
								count: detailedEmails.length,
								emails: detailedEmails,
								user: userSession.userEmail,
								service: 'gmail'
							})
						}]
					};
				} catch (error) {
					return this.createErrorResponse(error);
				}
			}
		);

		// OUTIL 3: SEND_EMAIL
		server.tool(
			"gmail_send_email",
			"Envoyer un email Gmail",
			{
				to: z.string().describe("Destinataire"),
				subject: z.string().describe("Sujet"),
				body: z.string().describe("Corps de l'email")
			},
			async (args: { to: string; subject: string; body: string }) => {
				const { to, subject, body } = args;
				try {
					const email = [
						`To: ${to}`,
						`From: ${userSession.userEmail}`,
						`Subject: ${subject}`,
						'',
						body
					].join('\r\n');

					const encodedMessage = Buffer.from(email)
						.toString('base64')
						.replace(/\+/g, '-')
						.replace(/\//g, '_')
						.replace(/=+$/, '');

					const sendResult = await userSession.gmail.users.messages.send({
						userId: 'me',
						requestBody: { raw: encodedMessage }
					});

					return {
						content: [{
							type: "text" as const,
							text: JSON.stringify({
								success: true,
								message: "Email envoyé avec succès",
								email_sent: {
									id: sendResult.data.id,
									to,
									subject,
									from: userSession.userEmail
								},
								user: userSession.userEmail,
								service: 'gmail'
							})
						}]
					};
				} catch (error) {
					return this.createErrorResponse(error);
				}
			}
		);

		// OUTIL 4: SEARCH_EMAILS
		server.tool(
			"gmail_search_emails",
			"Recherche avancée d'emails Gmail",
			{
				fromEmail: z.string().optional().describe("Email de l'expéditeur"),
				subjectContains: z.string().optional().describe("Contenu du sujet"),
				isUnread: z.boolean().optional().describe("Emails non lus seulement"),
				maxResults: z.number().optional().default(10).describe("Nombre maximum de résultats")
			},
			async (args: { fromEmail?: string; subjectContains?: string; isUnread?: boolean; maxResults?: number }) => {
				const { fromEmail, subjectContains, isUnread, maxResults = 10 } = args;
				try {
					const queryParts: string[] = [];

					if (fromEmail) queryParts.push(`from:${fromEmail}`);
					if (subjectContains) queryParts.push(`subject:${subjectContains}`);
					if (isUnread === true) queryParts.push("is:unread");
					else if (isUnread === false) queryParts.push("is:read");

					const searchQuery = queryParts.length > 0 ? queryParts.join(" ") : undefined;
					const searchParams: any = {
						userId: 'me',
						maxResults: Math.min(maxResults, 20)
					};

					if (searchQuery) searchParams.q = searchQuery;

					const results = await userSession.gmail.users.messages.list(searchParams);
					const messages = results.data.messages || [];
					const detailedEmails = await this.getDetailedEmails(userSession, messages);

					return {
						content: [{
							type: "text" as const,
							text: JSON.stringify({
								success: true,
								message: `${detailedEmails.length} emails trouvés`,
								count: detailedEmails.length,
								emails: detailedEmails,
								user: userSession.userEmail,
								service: 'gmail'
							})
						}]
					};
				} catch (error) {
					return this.createErrorResponse(error);
				}
			}
		);

		// OUTIL 5: GET_EMAIL_CONTENT
		server.tool(
			"gmail_get_email_content",
			"Obtenir le contenu complet d'un email Gmail",
			{
				messageId: z.string().describe("ID du message Gmail")
			},
			async (args: { messageId: string }) => {
				const { messageId } = args;
				try {
					const message = await userSession.gmail.users.messages.get({
						userId: 'me',
						id: messageId,
						format: 'full'
					});

					const headers: GmailHeader[] = message.data.payload?.headers || [];
					let emailContent = '';

					// Extraction du contenu
					if (message.data.payload?.body?.data) {
						emailContent = Buffer.from(message.data.payload.body.data, 'base64').toString('utf-8');
					} else if (message.data.payload?.parts) {
						for (const part of message.data.payload.parts) {
							if (part.mimeType === 'text/plain' && part.body?.data) {
								emailContent = Buffer.from(part.body.data, 'base64').toString('utf-8');
								break;
							}
						}
					}

					return {
						content: [{
							type: "text" as const,
							text: JSON.stringify({
								success: true,
								message: {
									id: messageId,
									subject: headers.find(h => h.name === 'Subject')?.value || 'Pas de sujet',
									from: headers.find(h => h.name === 'From')?.value || 'Expéditeur inconnu',
									date: headers.find(h => h.name === 'Date')?.value || 'Date inconnue',
									content: emailContent,
									labels: message.data.labelIds || []
								},
								user: userSession.userEmail,
								service: 'gmail'
							})
						}]
					};
				} catch (error) {
					return this.createErrorResponse(error);
				}
			}
		);
	}

	// Méthodes utilitaires privées
	private async getDetailedEmails(userSession: GmailSession, messages: any[]): Promise<EmailData[]> {
		const detailedEmails: EmailData[] = [];

		for (const msg of messages) {
			try {
				const msgDetail = await userSession.gmail.users.messages.get({
					userId: 'me',
					id: msg.id,
					format: 'metadata',
					metadataHeaders: ['From', 'Subject', 'Date']
				});

				const headers: GmailHeader[] = msgDetail.data.payload?.headers || [];
				const emailData: EmailData = {
					id: msg.id,
					subject: headers.find(h => h.name === 'Subject')?.value || 'Pas de sujet',
					from: headers.find(h => h.name === 'From')?.value || 'Expéditeur inconnu',
					date: headers.find(h => h.name === 'Date')?.value || 'Date inconnue',
					snippet: msgDetail.data.snippet || '',
					is_unread: msgDetail.data.labelIds?.includes('UNREAD') || false
				};

				detailedEmails.push(emailData);
			} catch (error) {
				continue; // Ignorer les erreurs d'emails individuels
			}
		}

		return detailedEmails;
	}

	private createErrorResponse(error: any) {
		return {
			content: [{
				type: "text" as const,
				text: JSON.stringify({
					success: false,
					error: (error as Error).message,
					service: 'gmail'
				})
			}],
			isError: true
		};
	}

	// Méthodes de gestion des sessions
	cleanupExpiredSessions() {
		console.log('🔒 Nettoyage Gmail désactivé - sessions préservées pour MCP');
		console.log(`📧 Sessions Gmail actives: ${this.gmailSessions.size}`);
		this.refreshExpiredTokens();
	}

	private async refreshExpiredTokens() {
		let refreshedCount = 0;
		
		for (const [userId, session] of this.gmailSessions) {
			try {
				const refreshed = await this.refreshTokens(session);
				if (refreshed) refreshedCount++;
			} catch (error) {
				console.warn(`⚠️ Impossible de refresh les tokens pour ${userId}:`, error);
			}
		}
		
		if (refreshedCount > 0) {
			console.log(`🔄 ${refreshedCount} tokens Gmail refreshés`);
		}
	}

	forceCleanupOldSessions(daysOld: number = 30): number {
		const now = new Date();
		const EXPIRY_TIME = daysOld * 24 * 60 * 60 * 1000;
		let cleanedCount = 0;

		for (const [userId, session] of this.gmailSessions) {
			const timeSinceLastAccess = now.getTime() - session.lastAccessed.getTime();
			if (timeSinceLastAccess > EXPIRY_TIME) {
				this.gmailSessions.delete(userId);
				cleanedCount++;
				console.log(`🗑️ Session Gmail ancienne supprimée: ${userId} (${Math.round(timeSinceLastAccess / (24 * 60 * 60 * 1000))} jours)`);
			}
		}

		console.log(`🧹 Nettoyage Gmail forcé: ${cleanedCount} sessions supprimées`);
		return cleanedCount;
	}

	removeSession(userId: string): boolean {
		const sessionExists = this.gmailSessions.has(userId);
		if (sessionExists) {
			this.gmailSessions.delete(userId);
			console.log(`🗑️ Session Gmail supprimée: ${userId}`);
		}
		return sessionExists;
	}

	// Getters
	getAllSessions(): GmailSession[] {
		return Array.from(this.gmailSessions.values());
	}

	getSessionCount(): number {
		return this.gmailSessions.size;
	}

	getGmailSession(userId: string): GmailSession | null {
		const session = this.gmailSessions.get(userId);
		if (session) {
			session.lastAccessed = new Date();
		}
		return session || null;
	}

	getGmailSessionsMap(): Map<string, GmailSession> {
		return this.gmailSessions;
	}
}