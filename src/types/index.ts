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

// Session Gmail spécifique
export interface GmailSession extends BaseServiceSession {
  serviceName: 'gmail';
  gmail: any; // Google Gmail API instance
  oauth2Client: OAuth2Client;
}

// Session utilisateur multi-services
export interface UserSession {
  userId: string;
  createdAt: Date;
  lastAccessed: Date;
  services: {
    gmail?: GmailSession;
    // outlook?: OutlookSession;    // Pour plus tard
    // notion?: NotionSession;      // Pour plus tard
    // axonaut?: AxonautSession;    // Pour plus tard
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
