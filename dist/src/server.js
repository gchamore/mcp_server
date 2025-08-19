import 'dotenv/config';
import express from "express";
import path from "path";
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { google } from 'googleapis';
import { z } from "zod";
import { v4 as uuidv4 } from 'uuid';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PORT = process.env.PORT || 3000;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const BASE_URL = process.env.BASE_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN
        ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
        : `http://localhost:${PORT}`);
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    console.error('❌ Variables d\'environnement Google OAuth manquantes');
    console.error('Configurez GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET dans Railway');
    process.exit(1);
}
const SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.modify'
];
class MultiTenantGmailManager {
    userSessions = new Map();
    activeMcpSessions = new Map();
    async createUserSession(tokens) {
        const userId = uuidv4();
        const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, `${BASE_URL}/oauth/callback`);
        oauth2Client.setCredentials(tokens);
        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
        const profile = await gmail.users.getProfile({ userId: 'me' });
        const userEmail = profile.data.emailAddress;
        if (!userEmail) {
            throw new Error('Email utilisateur manquant dans la réponse Gmail');
        }
        this.userSessions.set(userId, {
            userId,
            gmail,
            userEmail,
            oauth2Client,
            createdAt: new Date(),
            lastAccessed: new Date()
        });
        console.log(`✅ Session créée pour ${userEmail}: ${userId}`);
        return userId;
    }
    getUserSession(userId) {
        const session = this.userSessions.get(userId);
        if (session) {
            session.lastAccessed = new Date();
        }
        return session || null;
    }
    createAuthUrl() {
        const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, `${BASE_URL}/oauth/callback`);
        return oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: SCOPES,
        });
    }
    async handleOAuthCallback(code) {
        const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, `${BASE_URL}/oauth/callback`);
        const { tokens } = await oauth2Client.getToken(code);
        const userId = await this.createUserSession(tokens);
        return userId;
    }
    cleanupExpiredSessions() {
        const now = new Date();
        const EXPIRY_TIME = 24 * 60 * 60 * 1000;
        for (const [userId, session] of this.userSessions) {
            const timeSinceLastAccess = now.getTime() - session.lastAccessed.getTime();
            if (timeSinceLastAccess > EXPIRY_TIME) {
                this.userSessions.delete(userId);
                console.log(`🗑️ Session expirée supprimée: ${userId}`);
            }
        }
    }
}
const gmailManager = new MultiTenantGmailManager();
setInterval(() => {
    gmailManager.cleanupExpiredSessions();
}, 60 * 60 * 1000);
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});
app.post('/api/auth/start', async (req, res) => {
    try {
        const authUrl = gmailManager.createAuthUrl();
        res.json({
            success: true,
            authUrl: authUrl
        });
    }
    catch (error) {
        res.json({
            success: false,
            error: error.message
        });
    }
});
app.get('/oauth/callback', async (req, res) => {
    const code = req.query.code;
    const error = req.query.error;
    if (error || !code) {
        res.send(`
      <html>
        <body style="font-family: Arial; text-align: center; padding: 2rem;">
          <h1>❌ Erreur OAuth</h1>
          <p>Erreur: ${error || 'Code manquant'}</p>
          <script>setTimeout(() => window.close(), 3000);</script>
        </body>
      </html>
    `);
        return;
    }
    try {
        const userId = await gmailManager.handleOAuthCallback(code);
        const userEndpoint = `${BASE_URL}/${userId}/gmail/sse`;
        res.send(`
      <html>
        <head><title>OAuth Réussi</title></head>
        <body style="font-family: Arial; text-align: center; padding: 2rem; background: #f0fff4;">
          <h1 style="color: #27ae60;">✅ Authentification réussie!</h1>
          <p>Votre endpoint MCP personnel :</p>
          <div style="background: #263238; color: #4fc3f7; padding: 1rem; margin: 1rem 0; border-radius: 8px; word-break: break-all; font-family: monospace;">
            ${userEndpoint}
          </div>
          <button onclick="copyEndpoint()" style="background: #3498db; color: white; border: none; padding: 0.5rem 1rem; border-radius: 5px; cursor: pointer;">
            Copier pour Dust
          </button>
          <p style="margin-top: 1rem; color: #666;">
            Copiez cette URL dans Dust pour connecter votre Gmail
          </p>
          <script>
            function copyEndpoint() {
              navigator.clipboard.writeText('${userEndpoint}');
              alert('Endpoint copié dans le presse-papiers !');
            }
          </script>
        </body>
      </html>
    `);
    }
    catch (error) {
        console.error('❌ Erreur callback OAuth:', error);
        res.send(`
      <html>
        <body style="font-family: Arial; text-align: center; padding: 2rem;">
          <h1>❌ Erreur lors du traitement</h1>
          <p>Erreur: ${error.message}</p>
          <script>setTimeout(() => window.close(), 3000);</script>
        </body>
      </html>
    `);
    }
});
app.get('/:userId/gmail/sse', async (req, res) => {
    const userId = req.params.userId;
    const userSession = gmailManager.getUserSession(userId);
    if (!userSession) {
        res.status(404).send('User session not found');
        return;
    }
    console.log(`[MCP] Connection pour ${userSession.userEmail} (${userId})`);
    let transport = undefined;
    let sessionId = undefined;
    try {
        req.socket.setTimeout(0);
        req.socket.setNoDelay(true);
        req.socket.setKeepAlive(true);
        transport = new SSEServerTransport(`/${userId}/gmail/message`, res);
        sessionId = transport.sessionId;
        const server = new McpServer({
            name: `Gmail Assistant - ${userSession.userEmail}`,
            version: "1.0.0",
        });
        server.tool("get_profile", "Obtenir le profil Gmail", {}, async () => {
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
                                user: userSession.userEmail
                            })
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify({ success: false, error: error.message })
                        }],
                    isError: true
                };
            }
        });
        server.tool("list_emails", "Lister les emails Gmail", {
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
                                    user: userSession.userEmail
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
                                user: userSession.userEmail
                            })
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify({ success: false, error: error.message })
                        }],
                    isError: true
                };
            }
        });
        server.tool("send_email", "Envoyer un email", {
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
                                user: userSession.userEmail
                            })
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify({ success: false, error: error.message })
                        }],
                    isError: true
                };
            }
        });
        server.tool("search_emails", "Recherche avancée d'emails", {
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
                                user: userSession.userEmail
                            })
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify({ success: false, error: error.message })
                        }],
                    isError: true
                };
            }
        });
        server.tool("get_email_content", "Obtenir le contenu complet d'un email", {
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
                                email: {
                                    id: messageId,
                                    subject: headers.find(h => h.name === 'Subject')?.value || 'Pas de sujet',
                                    from: headers.find(h => h.name === 'From')?.value || 'Expéditeur inconnu',
                                    to: headers.find(h => h.name === 'To')?.value || 'Destinataire inconnu',
                                    date: headers.find(h => h.name === 'Date')?.value || 'Date inconnue',
                                    content: emailContent,
                                    snippet: message.data.snippet || ''
                                },
                                user: userSession.userEmail
                            })
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify({ success: false, error: error.message })
                        }],
                    isError: true
                };
            }
        });
        await server.connect(transport);
    }
    catch (error) {
        console.error("[MCP] Error:", error);
        if (!res.headersSent) {
            res.status(500).end("Failed to establish SSE connection.");
        }
    }
});
app.post('/:userId/gmail/message', async (req, res) => {
    const userId = req.params.userId;
    const sessionId = req.query.sessionId;
    console.log(`🎯 Route /${userId}/gmail/message appelée !`);
    console.log('📦 Body:', JSON.stringify(req.body, null, 2));
    const userSession = gmailManager.getUserSession(userId);
    if (!userSession) {
        res.status(404).send('User session not found');
        return;
    }
    if (!sessionId) {
        res.status(400).send("Missing sessionId query parameter");
        return;
    }
    console.log(`✅ [MCP] Message traité pour ${userSession.userEmail}`);
    res.status(200).json({ success: true });
});
app.get('/api/status', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        baseUrl: BASE_URL,
        activeSessions: gmailManager['userSessions'].size,
        version: '1.0.0'
    });
});
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        baseUrl: BASE_URL,
        environment: process.env.NODE_ENV || 'development'
    });
});
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Route not found',
        message: `${req.method} ${req.originalUrl} not found`
    });
});
app.listen(PORT, () => {
    console.log(`🚀 Gmail MCP SaaS running on port ${PORT}`);
    console.log(`🌐 Base URL: ${BASE_URL}`);
    console.log(`📱 Interface: ${BASE_URL}`);
    console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
});
