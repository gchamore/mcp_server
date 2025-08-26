// src/types/index.ts - Types communs pour l'architecture multi-services

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { OAuth2Client } from 'google-auth-library';

// Types de base pour tous les services
export interface BaseServiceSession {
	serviceName: string;
	userId: string;
	userEmail: string;
	isAuthenticated: boolean;
	createdAt: Date;
	lastAccessed: Date;
	refreshToken?: string;
	accessToken?: string;
}

// Session Gmail sécurisée
export interface GmailSession extends BaseServiceSession {
	serviceName: 'gmail';
	gmail: any;
	oauth2Client: OAuth2Client;
	// Tokens chiffrés
	encryptedRefreshToken?: string;
	encryptedAccessToken?: string;
}

// Session Axonaut sécurisée
export interface AxonautSession extends BaseServiceSession {
	serviceName: 'axonaut';
	encryptedApiKey: string; // Clé API chiffrée
	baseUrl: string;
	axonautClient: any;
}

// Utilisateur authentifié via Google OAuth
export interface AuthenticatedUser {
	userId: string;           // ID stable basé sur l'email Google
	email: string;            // Email Google
	name: string;             // Nom Google
	picture?: string;         // Photo de profil Google
	googleRefreshToken: string; // Token Google chiffré
	createdAt: Date;
	lastLoginAt: Date;
	connectedServices: string[];
}

// Session utilisateur multi-services
export interface UserSession {
	userId: string;
	authenticatedUser?: AuthenticatedUser; // Utilisateur authentifié
	createdAt: Date;
	lastAccessed: Date;
	services: {
		gmail?: GmailSession;
		axonaut?: AxonautSession;
		// outlook?: OutlookSession;    // Pour plus tard
		// notion?: NotionSession;      // Pour plus tard
	};
}

// Configuration OAuth pour un service
export interface ServiceOAuthConfig {
	clientId: string;
	clientSecret: string;
	redirectUri: string;
	scopes: string[];
}

// Interface pour les données d'email (Gmail)
export interface EmailData {
	id: string;
	subject: string;
	from: string;
	date: string;
	snippet: string;
	is_unread: boolean;
}

export interface GmailHeader {
	name: string;
	value: string;
}

// Interface pour les données Axonaut
export interface AxonautContact {
	id: string;
	name: string;
	email: string;
	company?: string;
	phone?: string;
}

export interface AxonautInvoice {
	id: string;
	number?: string;
	contact_id?: string;
	amount?: number;
	total_amount?: number;
	status?: string;
	date?: string;
	creation_date?: string;
	// Autres champs possibles selon l'API Axonaut
	[key: string]: any;
}

export interface AxonautApiConfig {
	apiKey: string;
	baseUrl: string;
}

// Résultat d'authentification
export interface AuthResult {
	success: boolean;
	userId?: string;
	error?: string;
	userEmail?: string;
}

// Configuration de service
export interface ServiceConfig {
	name: string;
	displayName: string;
	isEnabled: boolean;
	oauthConfig?: ServiceOAuthConfig;
}

// Types pour la gestion des erreurs
export interface ServiceError {
	service: string;
	code: string;
	message: string;
	userId?: string;
}
