import { google } from 'googleapis';
import { v4 as uuidv4 } from 'uuid';
import { z } from "zod";
import { BaseService } from "../../core/BaseService.js";
import { encrypt, decrypt, maskApiKey } from "../../utils/encryption.js";
export class GmailService extends BaseService {
    serviceName = 'gmail';
    displayName = 'Gmail';
    requiredScopes = [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.modify'
    ];
    gmailSessions = new Map();
    constructor(clientId, clientSecret, baseUrl) {
        super({
            clientId,
            clientSecret,
            redirectUri: `${baseUrl}/oauth/callback`,
            scopes: [
                'https://www.googleapis.com/auth/gmail.readonly',
                'https://www.googleapis.com/auth/gmail.send',
                'https://www.googleapis.com/auth/gmail.modify'
            ]
        });
    }
    isConfigured() {
        return this.validateOAuthConfig();
    }
    createAuthUrl() {
        const oauth2Client = new google.auth.OAuth2(this.oauthConfig.clientId, this.oauthConfig.clientSecret, this.oauthConfig.redirectUri);
        return oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: this.requiredScopes,
        });
    }
    async handleCallback(code) {
        try {
            const oauth2Client = new google.auth.OAuth2(this.oauthConfig.clientId, this.oauthConfig.clientSecret, this.oauthConfig.redirectUri);
            const { tokens } = await oauth2Client.getToken(code);
            const userId = await this.createGmailSession(tokens);
            return {
                success: true,
                userId,
                userEmail: this.gmailSessions.get(userId)?.userEmail
            };
        }
        catch (error) {
            console.error('❌ Erreur OAuth Gmail:', error);
            return {
                success: false,
                error: `Erreur OAuth: ${error}`
            };
        }
    }
    async createGmailSession(tokens) {
        const userId = uuidv4();
        const oauth2Client = new google.auth.OAuth2(this.oauthConfig.clientId, this.oauthConfig.clientSecret, this.oauthConfig.redirectUri);
        oauth2Client.setCredentials(tokens);
        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
        const profile = await gmail.users.getProfile({ userId: 'me' });
        const userEmail = profile.data.emailAddress;
        if (!userEmail) {
            throw new Error('Email utilisateur manquant dans la réponse Gmail');
        }
        const gmailSession = {
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
        console.log(`🔐 Tokens chiffrés: refresh=${!!gmailSession.encryptedRefreshToken}, access=${!!gmailSession.encryptedAccessToken}`);
        return userId;
    }
    getDecryptedRefreshToken(session) {
        try {
            return session.encryptedRefreshToken ? decrypt(session.encryptedRefreshToken) : null;
        }
        catch (error) {
            console.error('❌ Erreur déchiffrement refresh token:', error);
            return null;
        }
    }
    getDecryptedAccessToken(session) {
        try {
            return session.encryptedAccessToken ? decrypt(session.encryptedAccessToken) : null;
        }
        catch (error) {
            console.error('❌ Erreur déchiffrement access token:', error);
            return null;
        }
    }
    async refreshTokens(session) {
        try {
            const refreshToken = this.getDecryptedRefreshToken(session);
            if (!refreshToken) {
                console.error('❌ Refresh token manquant ou impossible à déchiffrer');
                return false;
            }
            session.oauth2Client.setCredentials({ refresh_token: refreshToken });
            const newTokens = await session.oauth2Client.refreshAccessToken();
            session.oauth2Client.setCredentials(newTokens.credentials);
            if (newTokens.credentials.access_token) {
                session.encryptedAccessToken = encrypt(newTokens.credentials.access_token);
            }
            session.lastAccessed = new Date();
            console.log(`🔄 Tokens Gmail refreshés pour ${maskApiKey(session.userId)}`);
            return true;
        }
        catch (error) {
            console.error(`❌ Erreur refresh token Gmail:`, error);
            return false;
        }
    }
    registerTools(server, userSession) {
        server.tool("gmail_get_profile", "Obtenir le profil Gmail", {}, async () => {
            try {
                const profile = await userSession.gmail.users.getProfile({ userId: 'me' });
                return {
                    content: [{
                            type: "text",
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
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify({
                                success: false,
                                error: error.message,
                                service: 'gmail'
                            })
                        }],
                    isError: true
                };
            }
        });
        server.tool("gmail_list_emails", "Lister les emails Gmail", {
            query: z.string().optional().describe("Requête de recherche Gmail"),
            maxResults: z.number().optional().default(10).describe("Nombre maximum de résultats")
        }, async ({ query, maxResults = 10 }) => {
            try {
                const searchParams = {
                    userId: 'me',
                    maxResults: Math.min(maxResults, 20)
                };
                if (query) {
                    searchParams.q = query;
                }
                const results = await userSession.gmail.users.messages.list(searchParams);
                const messages = results.data.messages || [];
                if (messages.length === 0) {
                    return {
                        content: [{
                                type: "text",
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
                const detailedEmails = [];
                for (const msg of messages) {
                    try {
                        const msgDetail = await userSession.gmail.users.messages.get({
                            userId: 'me',
                            id: msg.id,
                            format: 'metadata',
                            metadataHeaders: ['From', 'Subject', 'Date']
                        });
                        const headers = msgDetail.data.payload?.headers || [];
                        const emailData = {
                            id: msg.id,
                            subject: headers.find(h => h.name === 'Subject')?.value || 'Pas de sujet',
                            from: headers.find(h => h.name === 'From')?.value || 'Expéditeur inconnu',
                            date: headers.find(h => h.name === 'Date')?.value || 'Date inconnue',
                            snippet: msgDetail.data.snippet || '',
                            is_unread: msgDetail.data.labelIds?.includes('UNREAD') || false
                        };
                        detailedEmails.push(emailData);
                    }
                    catch (error) {
                        continue;
                    }
                }
                return {
                    content: [{
                            type: "text",
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
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify({
                                success: false,
                                error: error.message,
                                service: 'gmail'
                            })
                        }],
                    isError: true
                };
            }
        });
        server.tool("gmail_send_email", "Envoyer un email Gmail", {
            to: z.string().describe("Destinataire"),
            subject: z.string().describe("Sujet"),
            body: z.string().describe("Corps de l'email")
        }, async ({ to, subject, body }) => {
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
                    requestBody: {
                        raw: encodedMessage
                    }
                });
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify({
                                success: true,
                                message: "Email envoyé avec succès",
                                email_sent: {
                                    id: sendResult.data.id,
                                    to: to,
                                    subject: subject,
                                    from: userSession.userEmail
                                },
                                user: userSession.userEmail,
                                service: 'gmail'
                            })
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify({
                                success: false,
                                error: error.message,
                                service: 'gmail'
                            })
                        }],
                    isError: true
                };
            }
        });
        server.tool("gmail_search_emails", "Recherche avancée d'emails Gmail", {
            fromEmail: z.string().optional().describe("Email de l'expéditeur"),
            subjectContains: z.string().optional().describe("Contenu du sujet"),
            isUnread: z.boolean().optional().describe("Emails non lus seulement"),
            maxResults: z.number().optional().default(10).describe("Nombre maximum de résultats")
        }, async ({ fromEmail, subjectContains, isUnread, maxResults = 10 }) => {
            try {
                const queryParts = [];
                if (fromEmail) {
                    queryParts.push(`from:${fromEmail}`);
                }
                if (subjectContains) {
                    queryParts.push(`subject:${subjectContains}`);
                }
                if (isUnread === true) {
                    queryParts.push("is:unread");
                }
                else if (isUnread === false) {
                    queryParts.push("is:read");
                }
                const searchQuery = queryParts.length > 0 ? queryParts.join(" ") : undefined;
                const searchParams = {
                    userId: 'me',
                    maxResults: Math.min(maxResults, 20)
                };
                if (searchQuery) {
                    searchParams.q = searchQuery;
                }
                const results = await userSession.gmail.users.messages.list(searchParams);
                const messages = results.data.messages || [];
                const detailedEmails = [];
                for (const msg of messages) {
                    try {
                        const msgDetail = await userSession.gmail.users.messages.get({
                            userId: 'me',
                            id: msg.id,
                            format: 'metadata',
                            metadataHeaders: ['From', 'Subject', 'Date']
                        });
                        const headers = msgDetail.data.payload?.headers || [];
                        const emailData = {
                            id: msg.id,
                            subject: headers.find(h => h.name === 'Subject')?.value || 'Pas de sujet',
                            from: headers.find(h => h.name === 'From')?.value || 'Expéditeur inconnu',
                            date: headers.find(h => h.name === 'Date')?.value || 'Date inconnue',
                            snippet: msgDetail.data.snippet || '',
                            is_unread: msgDetail.data.labelIds?.includes('UNREAD') || false
                        };
                        detailedEmails.push(emailData);
                    }
                    catch (error) {
                        continue;
                    }
                }
                return {
                    content: [{
                            type: "text",
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
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify({
                                success: false,
                                error: error.message,
                                service: 'gmail'
                            })
                        }],
                    isError: true
                };
            }
        });
        server.tool("gmail_get_email_content", "Obtenir le contenu complet d'un email Gmail", {
            messageId: z.string().describe("ID du message Gmail")
        }, async ({ messageId }) => {
            try {
                const message = await userSession.gmail.users.messages.get({
                    userId: 'me',
                    id: messageId,
                    format: 'full'
                });
                const headers = message.data.payload?.headers || [];
                let emailContent = '';
                if (message.data.payload?.body?.data) {
                    emailContent = Buffer.from(message.data.payload.body.data, 'base64').toString('utf-8');
                }
                else if (message.data.payload?.parts) {
                    for (const part of message.data.payload.parts) {
                        if (part.mimeType === 'text/plain' && part.body?.data) {
                            emailContent = Buffer.from(part.body.data, 'base64').toString('utf-8');
                            break;
                        }
                    }
                }
                return {
                    content: [{
                            type: "text",
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
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify({
                                success: false,
                                error: error.message,
                                service: 'gmail'
                            })
                        }],
                    isError: true
                };
            }
        });
    }
    cleanupExpiredSessions() {
        console.log('🔒 Nettoyage Gmail désactivé - sessions préservées pour MCP');
        const activeGmailSessions = this.gmailSessions.size;
        console.log(`📧 Sessions Gmail actives: ${activeGmailSessions}`);
        this.refreshExpiredTokens();
    }
    async refreshExpiredTokens() {
        let refreshedCount = 0;
        for (const [userId, session] of this.gmailSessions) {
            try {
                const refreshed = await this.refreshTokens(session);
                if (refreshed) {
                    refreshedCount++;
                }
            }
            catch (error) {
                console.warn(`⚠️ Impossible de refresh les tokens pour ${userId}:`, error);
            }
        }
        if (refreshedCount > 0) {
            console.log(`🔄 ${refreshedCount} tokens Gmail refreshés`);
        }
    }
    forceCleanupOldSessions(daysOld = 30) {
        const now = new Date();
        const EXPIRY_TIME = daysOld * 24 * 60 * 60 * 1000;
        let cleanedCount = 0;
        for (const [userId, session] of this.gmailSessions) {
            const timeSinceLastAccess = now.getTime() - session.lastAccessed.getTime();
            if (timeSinceLastAccess > EXPIRY_TIME) {
                this.gmailSessions.delete(userId);
                cleanedCount++;
                console.log(`🗑️ Session Gmail très ancienne supprimée: ${userId} (${Math.round(timeSinceLastAccess / (24 * 60 * 60 * 1000))} jours)`);
            }
        }
        console.log(`🧹 Nettoyage Gmail forcé: ${cleanedCount} sessions supprimées`);
        return cleanedCount;
    }
    removeSession(userId) {
        const sessionExists = this.gmailSessions.has(userId);
        if (sessionExists) {
            this.gmailSessions.delete(userId);
            console.log(`🗑️ Session Gmail supprimée pour l'utilisateur: ${userId}`);
            return true;
        }
        console.log(`⚠️ Aucune session Gmail trouvée pour l'utilisateur: ${userId}`);
        return false;
    }
    getAllSessions() {
        return Array.from(this.gmailSessions.values());
    }
    getSessionCount() {
        return this.gmailSessions.size;
    }
    getGmailSession(userId) {
        const session = this.gmailSessions.get(userId);
        if (session) {
            session.lastAccessed = new Date();
        }
        return session || null;
    }
}
