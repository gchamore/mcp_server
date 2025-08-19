export class BaseService {
    oauthConfig;
    constructor(oauthConfig) {
        this.oauthConfig = oauthConfig;
    }
    isEnabled() {
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
    validateOAuthConfig() {
        const { clientId, clientSecret, redirectUri, scopes } = this.oauthConfig;
        return !!(clientId && clientSecret && redirectUri && scopes.length > 0);
    }
    createError(code, message, userId) {
        return {
            service: this.serviceName,
            code,
            message,
            userId
        };
    }
}
