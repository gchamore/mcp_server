/**
 * Service pour valider les clés API des différents outils
 */
export class ApiValidationService {
  
  /**
   * Valider une clé API Axonaut (validation basique seulement)
   */
  static async validateAxonautKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
    console.log('🔍 Validation basique de la clé API Axonaut...');
    
    // Validation de base de la clé (format)
    if (!apiKey || apiKey.trim().length < 5) {
      console.log('❌ Clé API trop courte');
      return { valid: false, error: 'La clé API doit contenir au moins 5 caractères' };
    }

    console.log('✅ Clé API Axonaut acceptée (format valide)');
    return { valid: true };
  }

  /**
   * Valider une clé API Gmail (validation basique seulement)
   */
  static async validateGmailKey(accessToken: string): Promise<{ valid: boolean; error?: string }> {
    console.log('🔍 Validation basique du token Gmail...');
    
    if (!accessToken || accessToken.trim().length < 10) {
      console.log('❌ Token Gmail trop court');
      return { valid: false, error: 'Le token Gmail doit contenir au moins 10 caractères' };
    }

    console.log('✅ Token Gmail accepté (format valide)');
    return { valid: true };
  }

  /**
   * Valider une clé API selon le type d'outil
   */
  static async validateApiKey(toolName: string, apiKey: string): Promise<{ valid: boolean; error?: string }> {
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
