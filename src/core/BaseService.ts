// src/core/BaseService.ts - Interface de base pour tous les services

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ServiceOAuthConfig, BaseServiceSession, AuthResult } from "../types/index.js";

export abstract class BaseService {
	// Propriétés de base que chaque service doit définir
	abstract readonly serviceName: string;
	abstract readonly displayName: string;
	abstract readonly requiredScopes: string[];

	// Configuration OAuth du service
	protected oauthConfig: ServiceOAuthConfig;

	constructor(oauthConfig: ServiceOAuthConfig) {
		this.oauthConfig = oauthConfig;
	}

	// Méthodes abstraites que chaque service doit implémenter
	abstract createAuthUrl(): string;
	abstract handleCallback(code: string): Promise<AuthResult>;
	abstract registerTools(server: McpServer, userSession: BaseServiceSession): void;
	abstract isConfigured(): boolean;
	abstract refreshTokens(session: BaseServiceSession): Promise<boolean>;

	// Méthodes communes
	isEnabled(): boolean {
		return this.isConfigured();
	}

	getDisplayInfo() {
		return {
			name: this.serviceName,
			displayName: this.displayName,
			isEnabled: this.isEnabled(),
			scopes: this.requiredScopes
		};
	}

	// Validation de la configuration OAuth
	protected validateOAuthConfig(): boolean {
		const { clientId, clientSecret, redirectUri, scopes } = this.oauthConfig;
		return !!(clientId && clientSecret && redirectUri && scopes.length > 0);
	}

	// Méthode utilitaire pour gérer les erreurs
	protected createError(code: string, message: string, userId?: string) {
		return {
			service: this.serviceName,
			code,
			message,
			userId
		};
	}
}
