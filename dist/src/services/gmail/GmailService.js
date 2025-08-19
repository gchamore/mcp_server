import { google } from 'googleapis';
import { v4 as uuidv4 } from 'uuid';
import { z } from "zod";
import { BaseService } from "../../core/BaseService.js";
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
            refreshToken: tokens.refresh_token,
            accessToken: tokens.access_token
        };
        this.gmailSessions.set(userId, gmailSession);
        console.log(`✅ Session Gmail créée pour ${userEmail}: ${userId}`);
        return userId;
    }
    getGmailSession(userId) {
        const session = this.gmailSessions.get(userId);
        if (session) {
            session.lastAccessed = new Date();
        }
        return session || null;
    }
    async refreshTokens(session) {
        try {
            const newTokens = await session.oauth2Client.refreshAccessToken();
            session.oauth2Client.setCredentials(newTokens.credentials);
            session.accessToken = newTokens.credentials.access_token || session.accessToken;
            session.lastAccessed = new Date();
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
        const now = new Date();
        const EXPIRY_TIME = 24 * 60 * 60 * 1000;
        for (const [userId, session] of this.gmailSessions) {
            const timeSinceLastAccess = now.getTime() - session.lastAccessed.getTime();
            if (timeSinceLastAccess > EXPIRY_TIME) {
                this.gmailSessions.delete(userId);
                console.log(`🗑️ Session Gmail expirée supprimée: ${userId}`);
            }
        }
    }
    getAllSessions() {
        return Array.from(this.gmailSessions.values());
    }
    getSessionCount() {
        return this.gmailSessions.size;
    }
}
