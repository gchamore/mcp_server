// src/core/MultiTenantManager.ts - Gestionnaire multi-tenant refactorisé

import { v4 as uuidv4 } from 'uuid';
import { UserSession, BaseServiceSession, AuthResult } from "../types/index.js";
import { ServiceRegistry } from "./ServiceRegistry.js";

export class MultiTenantManager {
  private userSessions = new Map<string, UserSession>();
  private activeMcpSessions = new Map<string, any>();
  private serviceRegistry: ServiceRegistry;
  
  constructor(serviceRegistry: ServiceRegistry) {
    this.serviceRegistry = serviceRegistry;
  }
  
  // Créer une nouvelle session utilisateur
  createUserSession(userId?: string): string {
    const sessionId = userId || uuidv4();
    
    const userSession: UserSession = {
      userId: sessionId,
      createdAt: new Date(),
      lastAccessed: new Date(),
      services: {}
    };
    
    this.userSessions.set(sessionId, userSession);
    console.log(`✅ Session utilisateur créée: ${sessionId}`);
    
    return sessionId;
  }
  
  // Récupérer une session utilisateur
  getUserSession(userId: string): UserSession | null {
    const session = this.userSessions.get(userId);
    if (session) {
      session.lastAccessed = new Date();
    }
    return session || null;
  }
  
  // Ajouter une session de service à un utilisateur
  addServiceSession(userId: string, serviceName: string, serviceSession: BaseServiceSession): boolean {
    const userSession = this.getUserSession(userId);
    if (!userSession) {
      console.error(`❌ Session utilisateur introuvable: ${userId}`);
      return false;
    }
    
    // Typage sécurisé pour Gmail
    if (serviceName === 'gmail') {
      userSession.services.gmail = serviceSession as any; // Cast nécessaire pour le moment
    }
    // Ici on ajoutera d'autres services plus tard
    
    console.log(`✅ Service ${serviceName} ajouté à la session ${userId}`);
    return true;
  }
  
  // Supprimer une session de service
  removeServiceSession(userId: string, serviceName: string): boolean {
    const userSession = this.getUserSession(userId);
    if (!userSession) {
      return false;
    }
    
    if (serviceName === 'gmail') {
      delete userSession.services.gmail;
    }
    
    console.log(`🗑️ Service ${serviceName} supprimé de la session ${userId}`);
    return true;
  }
  
  // Vérifier si un utilisateur a un service connecté
  hasServiceSession(userId: string, serviceName: string): boolean {
    const userSession = this.getUserSession(userId);
    if (!userSession) return false;
    
    if (serviceName === 'gmail') {
      return !!userSession.services.gmail?.isAuthenticated;
    }
    
    return false;
  }
  
  // Obtenir une session de service spécifique
  getServiceSession(userId: string, serviceName: string): BaseServiceSession | null {
    const userSession = this.getUserSession(userId);
    if (!userSession) return null;
    
    if (serviceName === 'gmail') {
      return userSession.services.gmail || null;
    }
    
    return null;
  }
  
  // Lister tous les services connectés pour un utilisateur
  getConnectedServices(userId: string): string[] {
    const userSession = this.getUserSession(userId);
    if (!userSession) return [];
    
    const connectedServices: string[] = [];
    
    if (userSession.services.gmail?.isAuthenticated) {
      connectedServices.push('gmail');
    }
    
    return connectedServices;
  }
  
  // Authentifier un service pour un utilisateur
  async authenticateService(userId: string, serviceName: string, authCode: string): Promise<AuthResult> {
    const service = this.serviceRegistry.getService(serviceName);
    if (!service) {
      return {
        success: false,
        error: `Service ${serviceName} non trouvé`
      };
    }
    
    try {
      const authResult = await service.handleCallback(authCode);
      
      if (authResult.success && authResult.userId) {
        // Le service a créé sa propre session, on la récupère
        // Pour Gmail, cela devrait fonctionner avec l'implémentation existante
        return authResult;
      }
      
      return authResult;
    } catch (error) {
      console.error(`❌ Erreur authentification ${serviceName}:`, error);
      return {
        success: false,
        error: `Erreur lors de l'authentification: ${error}`
      };
    }
  }
  
  // Nettoyage des sessions expirées
  cleanupExpiredSessions() {
    const now = new Date();
    const EXPIRY_TIME = 24 * 60 * 60 * 1000; // 24 heures
    
    for (const [userId, session] of this.userSessions) {
      const timeSinceLastAccess = now.getTime() - session.lastAccessed.getTime();
      if (timeSinceLastAccess > EXPIRY_TIME) {
        this.userSessions.delete(userId);
        console.log(`🗑️ Session expirée supprimée: ${userId}`);
      }
    }
  }
  
  // Statistiques
  getStats() {
    const stats = {
      totalUsers: this.userSessions.size,
      activeMcpSessions: this.activeMcpSessions.size,
      serviceStats: {} as Record<string, number>
    };
    
    // Compter les utilisateurs par service
    for (const serviceName of this.serviceRegistry.getServiceNames()) {
      stats.serviceStats[serviceName] = 0;
    }
    
    for (const session of this.userSessions.values()) {
      if (session.services.gmail?.isAuthenticated) {
        stats.serviceStats.gmail++;
      }
    }
    
    return stats;
  }
  
  // Gérer les sessions MCP actives
  setActiveMcpSession(sessionId: string, transport: any) {
    this.activeMcpSessions.set(sessionId, transport);
  }
  
  getActiveMcpSession(sessionId: string) {
    return this.activeMcpSessions.get(sessionId);
  }
  
  removeActiveMcpSession(sessionId: string) {
    this.activeMcpSessions.delete(sessionId);
  }
}
