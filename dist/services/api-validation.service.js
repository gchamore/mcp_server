export class ApiValidationService {
    static async validateAxonautKey(apiKey) {
        console.log('🔍 Validation basique de la clé API Axonaut...');
        if (!apiKey || apiKey.trim().length < 5) {
            console.log('❌ Clé API trop courte');
            return { valid: false, error: 'La clé API doit contenir au moins 5 caractères' };
        }
        console.log('✅ Clé API Axonaut acceptée (format valide)');
        return { valid: true };
    }
    static async validateGmailKey(accessToken) {
        console.log('🔍 Validation basique du token Gmail...');
        if (!accessToken || accessToken.trim().length < 10) {
            console.log('❌ Token Gmail trop court');
            return { valid: false, error: 'Le token Gmail doit contenir au moins 10 caractères' };
        }
        console.log('✅ Token Gmail accepté (format valide)');
        return { valid: true };
    }
    static async validateApiKey(toolName, apiKey) {
        switch (toolName.toLowerCase()) {
            case 'axonaut':
                return this.validateAxonautKey(apiKey);
            case 'gmail':
                return this.validateGmailKey(apiKey);
            default:
                return { valid: false, error: 'Outil non supporté' };
        }
    }
}
