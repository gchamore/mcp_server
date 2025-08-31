/**
 * Interface de base pour tous les outils MCP
 */
export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
  execute(args: any, apiKey: string): Promise<any>;
}

/**
 * Interface pour un client API
 */
export interface ApiClient {
  new (apiKey: string): any;
}

/**
 * Configuration d'un serveur MCP
 */
export interface McpServerConfig {
  name: string;
  version: string;
  description: string;
  tools: McpTool[];
  apiKeyRequired: boolean;
}

/**
 * Interface pour les sessions MCP actives
 */
export interface ActiveMcpSession {
  sessionId: string;
  userId: string;
  toolName: string;
  apiKey: string;
  server: any;
  createdAt: Date;
}
