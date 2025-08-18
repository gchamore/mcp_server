// src/gmail-mcp-server.ts - Version avec 2 serveurs et tous les outils
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import type { Request, Response } from "express";
import express from "express";
import http from "http";
import { z } from "zod";
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import * as fs from 'fs';
import * as path from 'path';

// ✅ INTERFACES
interface EmailData {
  id: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  is_unread: boolean;
}

interface GmailHeader {
  name: string;
  value: string;
}

// ✅ CONFIGURATION
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify'
];

const GOOGLE_TOKEN_PATH = process.env.GOOGLE_TOKEN_PATH || './token.json';
const GOOGLE_CREDENTIALS_PATH = process.env.GOOGLE_CREDENTIALS_PATH || './credentials.json';

// ✅ PORTS SÉPARÉS
const WEB_PORT = 8000;  // Interface web OAuth
const MCP_PORT = 8001;  // Serveur MCP pour Dust

// ✅ CLASSE GMAIL SERVICE
class GmailService {
  private gmail: any = null;
  private userEmail: string | null = null;
  private oauth2Client: OAuth2Client | null = null;

  constructor() {}

  createAuthUrl(): string {
    const credentials = JSON.parse(fs.readFileSync(GOOGLE_CREDENTIALS_PATH, 'utf8'));
    const { client_secret, client_id } = credentials.installed || credentials.web;
    
    const redirectUri = `http://localhost:${WEB_PORT}/oauth/callback`;
    this.oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri);

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
    });
  }

  async handleOAuthCallback(code: string): Promise<void> {
    if (!this.oauth2Client) {
      throw new Error('OAuth client non initialisé');
    }

    try {
      const { tokens } = await this.oauth2Client.getToken(code);
      this.oauth2Client.setCredentials(tokens);
      
      const tokenPath = path.resolve(GOOGLE_TOKEN_PATH);
      const tokenDir = path.dirname(tokenPath);
      
      if (!fs.existsSync(tokenDir)) {
        fs.mkdirSync(tokenDir, { recursive: true });
      }
      
      fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));
      console.log('✅ Token sauvegardé:', tokenPath);

      this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
      const profile = await this.gmail.users.getProfile({ userId: 'me' });
      this.userEmail = profile.data.emailAddress;
      
      console.log(`✅ Gmail connecté: ${this.userEmail}`);

    } catch (error) {
      console.error('❌ Erreur callback OAuth:', error);
      throw error;
    }
  }

  async initializeService() {
    try {
      const tokenPath = path.resolve(GOOGLE_TOKEN_PATH);
      const credentialsPath = path.resolve(GOOGLE_CREDENTIALS_PATH);

      if (!fs.existsSync(credentialsPath)) {
        throw new Error(`❌ Fichier credentials manquant: ${credentialsPath}`);
      }

      const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
      const { client_secret, client_id } = credentials.installed || credentials.web;
      
      const redirectUri = `http://localhost:${WEB_PORT}/oauth/callback`;
      this.oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri);

      if (fs.existsSync(tokenPath)) {
        try {
          const token = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
          this.oauth2Client.setCredentials(token);
          console.log("✅ Token existant chargé");

          if (token.refresh_token) {
            try {
              const { credentials: refreshedToken } = await this.oauth2Client.refreshAccessToken();
              
              if (refreshedToken.access_token !== token.access_token) {
                console.log("🔄 Token rafraîchi automatiquement");
                fs.writeFileSync(tokenPath, JSON.stringify(refreshedToken, null, 2));
                this.oauth2Client.setCredentials(refreshedToken);
              }
            } catch (refreshError) {
              console.log("⚠️ Échec du refresh automatique, OAuth nécessaire");
              throw refreshError;
            }
          }

          this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
          const profile = await this.gmail.users.getProfile({ userId: 'me' });
          this.userEmail = profile.data.emailAddress;
          console.log(`✅ Gmail connecté avec token existant: ${this.userEmail}`);
          return;
          
        } catch (error) {
          console.log("⚠️ Token existant invalide, nouveau OAuth nécessaire");
          if (fs.existsSync(tokenPath)) {
            fs.unlinkSync(tokenPath);
            console.log("🗑️ Ancien token supprimé");
          }
        }
      }

      console.log("🔐 Aucun token valide trouvé, OAuth nécessaire via l'interface web");
      
    } catch (error) {
      console.error(`❌ Erreur initialisation Gmail: ${error}`);
      throw error;
    }
  }

  getService() {
    if (!this.gmail) {
      throw new Error("Gmail service not initialized. Call initializeService() first.");
    }
    return this.gmail;
  }

  getUserEmail(): string | null {
    return this.userEmail;
  }

  isConnected(): boolean {
    return this.gmail !== null && this.userEmail !== null;
  }
}

const gmailService = new GmailService();

// ✅ SERVEUR 1: INTERFACE WEB OAUTH (Port 8000)
async function startWebServer(): Promise<void> {
  const app = express();
  
  app.use(express.static('public'));
  app.use(express.json());

  // Route statut
  app.get('/api/status', (req: Request, res: Response) => {
    const isConnected = gmailService.isConnected();
    res.json({
      connected: isConnected,
      userEmail: gmailService.getUserEmail(),
      mcpEndpoint: `http://localhost:${MCP_PORT}/sse`,
      webInterface: `http://localhost:${WEB_PORT}`,
      error: isConnected ? null : "Gmail non initialisé - OAuth requis"
    });
  });

  // Route démarrage OAuth
  app.post('/api/auth/start', async (req: Request, res: Response) => {
    try {
      if (!fs.existsSync('./credentials.json')) {
        return res.json({
          success: false,
          error: "Fichier credentials.json manquant"
        });
      }

      const authUrl = gmailService.createAuthUrl();
      res.json({
        success: true,
        authUrl: authUrl
      });

    } catch (error) {
      res.json({
        success: false,
        error: (error as Error).message
      });
    }
  });

  // Callback OAuth
  app.get('/oauth/callback', async (req: Request, res: Response) => {
    const code = req.query.code as string;
    const error = req.query.error as string;

    if (error) {
      res.send(`
        <html>
          <head><title>Erreur OAuth</title></head>
          <body style="font-family: Arial; text-align: center; padding: 2rem;">
            <h1>❌ Erreur d'authentification</h1>
            <p>Erreur: ${error}</p>
            <p>Veuillez fermer cette fenêtre et réessayer.</p>
            <script>setTimeout(() => window.close(), 3000);</script>
          </body>
        </html>
      `);
      return;
    }

    if (!code) {
      res.send(`
        <html>
          <body style="font-family: Arial; text-align: center; padding: 2rem;">
            <h1>❌ Code OAuth manquant</h1>
            <p>Veuillez fermer cette fenêtre et réessayer.</p>
            <script>setTimeout(() => window.close(), 3000);</script>
          </body>
        </html>
      `);
      return;
    }

    try {
      await gmailService.handleOAuthCallback(code);

      res.send(`
        <html>
          <head><title>OAuth Réussi</title></head>
          <body style="font-family: Arial; text-align: center; padding: 2rem; background: #f0fff4;">
            <h1 style="color: #27ae60;">✅ Authentification réussie!</h1>
            <p>Token sauvegardé automatiquement.</p>
            <p>Le serveur MCP est maintenant opérationnel sur le port ${MCP_PORT}.</p>
            <p>Vous pouvez fermer cette fenêtre et retourner à l'interface principale.</p>
            <script>setTimeout(() => window.close(), 2000);</script>
          </body>
        </html>
      `);

    } catch (error) {
      console.error('❌ Erreur callback OAuth:', error);
      res.send(`
        <html>
          <body style="font-family: Arial; text-align: center; padding: 2rem;">
            <h1>❌ Erreur lors du traitement</h1>
            <p>Erreur: ${(error as Error).message}</p>
            <p>Veuillez fermer cette fenêtre et réessayer.</p>
            <script>setTimeout(() => window.close(), 3000);</script>
          </body>
        </html>
      `);
    }
  });

  // Page d'accueil
  app.get('/', (req: Request, res: Response) => {
    res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
  });

  const webServer = http.createServer(app);
  
  return new Promise((resolve, reject) => {
    webServer.once("error", (err: Error & { code?: string }) => {
      if (err.code === "EADDRINUSE") {
        reject(new Error(`Port ${WEB_PORT} est déjà utilisé pour l'interface web.`));
      } else {
        reject(err);
      }
    });

    webServer.listen(WEB_PORT, () => {
      console.log(`🌐 Interface Web OAuth démarrée: http://localhost:${WEB_PORT}`);
      resolve();
    });
  });
}

// ✅ SERVEUR 2: MCP POUR DUST (Port 8001) AVEC TOUS LES OUTILS
async function startMcpServer(): Promise<void> {
  const app = express();
  
  const activeSessions = new Map<
    string,
    { server: McpServer; transport: SSEServerTransport }
  >();

  // ✅ ENDPOINT MCP AVEC TOUS LES OUTILS
  app.get("/sse", async (req: Request, res: Response) => {
    console.error(`[MCP] Connection request from ${req.ip} for ${req.originalUrl}`);

    let transport: SSEServerTransport | undefined = undefined;
    let sessionId: string | undefined = undefined;

    try {
      req.socket.setTimeout(0);
      req.socket.setNoDelay(true);
      req.socket.setKeepAlive(true);

      transport = new SSEServerTransport("/message", res);
      sessionId = transport.sessionId;

      console.error(`[MCP] Session ${sessionId} created`);

      const server = new McpServer({
        name: "Gmail Assistant",
        version: "1.0.0",
      });

      // ✅ OUTIL 1: GET_PROFILE
      server.tool(
        "get_profile",
        "Obtenir le profil Gmail",
        {},
        async () => {
          try {
            if (!gmailService.isConnected()) {
              return {
                content: [{
                  type: "text",
                  text: JSON.stringify({ 
                    success: false, 
                    error: "Gmail service non initialisé. Configurez OAuth via http://localhost:8000" 
                  })
                }],
                isError: true
              };
            }

            const gmail = gmailService.getService();
            const profile = await gmail.users.getProfile({ userId: 'me' });
            
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  success: true,
                  profile: {
                    email: profile.data.emailAddress,
                    messages_total: profile.data.messagesTotal,
                    threads_total: profile.data.threadsTotal
                  }
                })
              }]
            };
          } catch (error) {
            return {
              content: [{
                type: "text",
                text: JSON.stringify({ success: false, error: (error as Error).message })
              }],
              isError: true
            };
          }
        }
      );

      // ✅ OUTIL 2: LIST_EMAILS
      server.tool(
        "list_emails",
        "Lister les emails Gmail",
        {
          query: z.string().optional().describe("Requête de recherche Gmail"),
          maxResults: z.number().optional().default(10).describe("Nombre maximum de résultats")
        },
        async ({ query, maxResults = 10 }) => {
          try {
            if (!gmailService.isConnected()) {
              return {
                content: [{
                  type: "text",
                  text: JSON.stringify({ 
                    success: false, 
                    error: "Gmail service non initialisé. Configurez OAuth via http://localhost:8000" 
                  })
                }],
                isError: true
              };
            }

            const gmail = gmailService.getService();
            
            const searchParams: any = {
              userId: 'me',
              maxResults: Math.min(maxResults, 20)
            };
            
            if (query) {
              searchParams.q = query;
            }
            
            const results = await gmail.users.messages.list(searchParams);
            const messages = results.data.messages || [];
            
            if (messages.length === 0) {
              return {
                content: [{
                  type: "text",
                  text: JSON.stringify({
                    success: true,
                    message: `Aucun email trouvé${query ? ` pour: ${query}` : ''}`,
                    count: 0,
                    emails: []
                  })
                }]
              };
            }
            
            const detailedEmails: EmailData[] = [];
            
            for (const msg of messages) {
              try {
                const msgDetail = await gmail.users.messages.get({
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
                  emails: detailedEmails
                })
              }]
            };
            
          } catch (error) {
            return {
              content: [{
                type: "text",
                text: JSON.stringify({ success: false, error: (error as Error).message })
              }],
              isError: true
            };
          }
        }
      );

      // ✅ OUTIL 3: SEND_EMAIL
      server.tool(
        "send_email",
        "Envoyer un email",
        {
          to: z.string().describe("Destinataire"),
          subject: z.string().describe("Sujet"),
          body: z.string().describe("Corps de l'email")
        },
        async ({ to, subject, body }) => {
          try {
            if (!gmailService.isConnected()) {
              return {
                content: [{
                  type: "text",
                  text: JSON.stringify({ 
                    success: false, 
                    error: "Gmail service non initialisé. Configurez OAuth via http://localhost:8000" 
                  })
                }],
                isError: true
              };
            }

            const gmail = gmailService.getService();
            const userEmail = gmailService.getUserEmail();
            
            const email = [
              `To: ${to}`,
              `From: ${userEmail}`,
              `Subject: ${subject}`,
              '',
              body
            ].join('\r\n');
            
            const encodedMessage = Buffer.from(email)
              .toString('base64')
              .replace(/\+/g, '-')
              .replace(/\//g, '_')
              .replace(/=+$/, '');
            
            const sendResult = await gmail.users.messages.send({
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
                    from: userEmail
                  }
                })
              }]
            };
            
          } catch (error) {
            return {
              content: [{
                type: "text",
                text: JSON.stringify({ success: false, error: (error as Error).message })
              }],
              isError: true
            };
          }
        }
      );

      // ✅ OUTIL 4: SEARCH_EMAILS
      server.tool(
        "search_emails",
        "Recherche avancée d'emails",
        {
          fromEmail: z.string().optional().describe("Email de l'expéditeur"),
          subjectContains: z.string().optional().describe("Contenu du sujet"),
          isUnread: z.boolean().optional().describe("Emails non lus seulement"),
          maxResults: z.number().optional().default(10).describe("Nombre maximum de résultats")
        },
        async ({ fromEmail, subjectContains, isUnread, maxResults = 10 }) => {
          try {
            if (!gmailService.isConnected()) {
              return {
                content: [{
                  type: "text",
                  text: JSON.stringify({ 
                    success: false, 
                    error: "Gmail service non initialisé. Configurez OAuth via http://localhost:8000" 
                  })
                }],
                isError: true
              };
            }

            const queryParts: string[] = [];
            
            if (fromEmail) {
              queryParts.push(`from:${fromEmail}`);
            }
            if (subjectContains) {
              queryParts.push(`subject:${subjectContains}`);
            }
            if (isUnread === true) {
              queryParts.push("is:unread");
            } else if (isUnread === false) {
              queryParts.push("is:read");
            }
            
            const searchQuery = queryParts.length > 0 ? queryParts.join(" ") : undefined;
            
            const gmail = gmailService.getService();
            const searchParams: any = {
              userId: 'me',
              maxResults: Math.min(maxResults, 20)
            };
            
            if (searchQuery) {
              searchParams.q = searchQuery;
            }
            
            const results = await gmail.users.messages.list(searchParams);
            const messages = results.data.messages || [];
            
            const detailedEmails: EmailData[] = [];
            
            for (const msg of messages) {
              try {
                const msgDetail = await gmail.users.messages.get({
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
                  emails: detailedEmails
                })
              }]
            };
            
          } catch (error) {
            return {
              content: [{
                type: "text",
                text: JSON.stringify({ success: false, error: (error as Error).message })
              }],
              isError: true
            };
          }
        }
      );

      if (sessionId) {
        activeSessions.set(sessionId, { server, transport });
      }

      res.on("close", () => {
        if (sessionId) {
          console.error(`[MCP] Connection closed for session ${sessionId}`);
          activeSessions.delete(sessionId);
        }
      });

      await server.connect(transport);
      console.error(`[MCP] Server connected for session ${sessionId}`);

    } catch (error) {
      console.error("[MCP] Error handling connection:", error);
      
      if (!res.headersSent) {
        res.status(500).end("Failed to establish SSE connection.");
      } else {
        res.end();
      }

      if (sessionId) {
        activeSessions.delete(sessionId);
      }
    }
  });

  app.post("/message", async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string;

    try {
      if (!sessionId) {
        res.status(400).send("Missing sessionId query parameter");
        return;
      }

      const session = activeSessions.get(sessionId);

      if (!session) {
        res.status(404).send(`Session not found: ${sessionId}`);
        return;
      }

      session.transport.handlePostMessage(req, res).catch((handlerError) => {
        console.error(`[MCP] Error handling message for session ${sessionId}:`, handlerError);
        if (!res.headersSent) {
          res.status(500).send("Error processing message");
        }
      });

    } catch (error) {
      console.error(`[MCP] Error handling message for session ${sessionId}:`, error);
      if (!res.headersSent) {
        res.status(500).send("Error processing message");
      }
    }
  });

  const mcpServer = http.createServer(app);
  
  return new Promise((resolve, reject) => {
    mcpServer.once("error", (err: Error & { code?: string }) => {
      if (err.code === "EADDRINUSE") {
        reject(new Error(`Port ${MCP_PORT} est déjà utilisé pour le serveur MCP.`));
      } else {
        reject(err);
      }
    });

    mcpServer.listen(MCP_PORT, () => {
      console.log(`🚀 Serveur MCP démarré: http://localhost:${MCP_PORT}/sse`);
      resolve();
    });
  });
}

// ✅ FONCTION PRINCIPALE
export async function startGmailMcpServer(
  onServerStart: (url: string) => void,
  requestedPort?: number
): Promise<void> {
  
  console.log("🔐 Initialisation OAuth Gmail...");
  
  // Initialisation Gmail en arrière-plan
  gmailService.initializeService()
    .then(() => {
      console.log("✅ Gmail service prêt !");
    })
    .catch((error) => {
      console.error("❌ Erreur initialisation Gmail:", error);
      console.log(`⚠️ Configurez OAuth via http://localhost:${WEB_PORT}`);
    });

  try {
    // Démarrer les deux serveurs
    await startWebServer();
    await startMcpServer();
    
    const mcpUrl = `http://localhost:${MCP_PORT}/sse`;
    console.log(`\n🎯 CONFIGURATION POUR DUST:`);
    console.log(`📱 Interface OAuth: http://localhost:${WEB_PORT}`);
    console.log(`🔗 Endpoint MCP: ${mcpUrl}`);
    console.log(`🌍 Ngrok: /snap/bin/ngrok http ${MCP_PORT}`);
    
    onServerStart(mcpUrl);

  } catch (error) {
    console.error("Fatal server error:", error);
    throw error;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startGmailMcpServer((url) => {
    console.log(`Gmail MCP Server started at: ${url}`);
  }).catch(console.error);
}