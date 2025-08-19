import { v4 as uuidv4 } from 'uuid';
export class MultiTenantManager {
    userSessions = new Map();
    activeMcpSessions = new Map();
    serviceRegistry;
    constructor(serviceRegistry) {
        this.serviceRegistry = serviceRegistry;
    }
    createUserSession(userId) {
        const sessionId = userId || uuidv4();
        const userSession = {
            userId: sessionId,
            createdAt: new Date(),
            lastAccessed: new Date(),
            services: {}
        };
        this.userSessions.set(sessionId, userSession);
        console.log(`✅ Session utilisateur créée: ${sessionId}`);
        return sessionId;
    }
    getUserSession(userId) {
        const session = this.userSessions.get(userId);
        if (session) {
            session.lastAccessed = new Date();
        }
        return session || null;
    }
    addServiceSession(userId, serviceName, serviceSession) {
        const userSession = this.getUserSession(userId);
        if (!userSession) {
            console.error(`❌ Session utilisateur introuvable: ${userId}`);
            return false;
        }
        if (serviceName === 'gmail') {
            userSession.services.gmail = serviceSession;
        }
        else if (serviceName === 'axonaut') {
            userSession.services.axonaut = serviceSession;
        }
        console.log(`✅ Service ${serviceName} ajouté à la session ${userId}`);
        return true;
    }
    removeServiceSession(userId, serviceName) {
        const userSession = this.getUserSession(userId);
        if (!userSession) {
            console.log(`[MultiTenant] Aucune session utilisateur trouvée pour ${userId} lors de la suppression`);
            return false;
        }
        let wasPresent = false;
        if (serviceName === 'gmail') {
            wasPresent = !!userSession.services.gmail;
            if (wasPresent) {
                delete userSession.services.gmail;
                console.log(`🗑️ Service Gmail supprimé de la session ${userId}`);
            }
            else {
                console.log(`[MultiTenant] Aucune session Gmail à supprimer pour ${userId}`);
            }
        }
        else if (serviceName === 'axonaut') {
            wasPresent = !!userSession.services.axonaut;
            if (wasPresent) {
                delete userSession.services.axonaut;
                console.log(`🗑️ Service Axonaut supprimé de la session ${userId}`);
            }
            else {
                console.log(`[MultiTenant] Aucune session Axonaut à supprimer pour ${userId}`);
            }
        }
        return wasPresent;
    }
    hasServiceSession(userId, serviceName) {
        const userSession = this.getUserSession(userId);
        if (!userSession) {
            console.log(`[MultiTenant] Aucune session utilisateur trouvée pour ${userId}`);
            return false;
        }
        if (serviceName === 'gmail') {
            const hasGmail = !!userSession.services.gmail?.isAuthenticated;
            console.log(`[MultiTenant] Session Gmail pour ${userId}: ${hasGmail} (session: ${!!userSession.services.gmail})`);
            return hasGmail;
        }
        if (serviceName === 'axonaut') {
            const hasAxonaut = !!userSession.services.axonaut?.isAuthenticated;
            console.log(`[MultiTenant] Session Axonaut pour ${userId}: ${hasAxonaut} (session: ${!!userSession.services.axonaut})`);
            return hasAxonaut;
        }
        return false;
    }
    getServiceSession(userId, serviceName) {
        const userSession = this.getUserSession(userId);
        if (!userSession)
            return null;
        if (serviceName === 'gmail') {
            return userSession.services.gmail || null;
        }
        if (serviceName === 'axonaut') {
            return userSession.services.axonaut || null;
        }
        return null;
    }
    getConnectedServices(userId) {
        const userSession = this.getUserSession(userId);
        if (!userSession)
            return [];
        const connectedServices = [];
        if (userSession.services.gmail?.isAuthenticated) {
            connectedServices.push('gmail');
        }
        if (userSession.services.axonaut?.isAuthenticated) {
            connectedServices.push('axonaut');
        }
        return connectedServices;
    }
    async authenticateService(userId, serviceName, authCode) {
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
                return authResult;
            }
            return authResult;
        }
        catch (error) {
            console.error(`❌ Erreur authentification ${serviceName}:`, error);
            return {
                success: false,
                error: `Erreur lors de l'authentification: ${error}`
            };
        }
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
    getStats() {
        const stats = {
            totalUsers: this.userSessions.size,
            activeMcpSessions: this.activeMcpSessions.size,
            serviceStats: {}
        };
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
    setActiveMcpSession(sessionId, transport) {
        this.activeMcpSessions.set(sessionId, transport);
    }
    getActiveMcpSession(sessionId) {
        return this.activeMcpSessions.get(sessionId);
    }
    removeActiveMcpSession(sessionId) {
        this.activeMcpSessions.delete(sessionId);
    }
}
