import { Request, Response, NextFunction } from 'express';
import passport from 'passport';
import { OAuthService } from '../services/oauth.service.js';
import { config } from '../config/app.js';

export class OAuthController {
  /**
   * Initier l'authentification Google
   */
  static initiateGoogleAuth(req: Request, res: Response, next: NextFunction) {
    if (!OAuthService.isConfigured()) {
      return res.status(500).json({
        success: false,
        error: 'Google OAuth non configuré sur le serveur',
        code: 'OAUTH_NOT_CONFIGURED'
      });
    }

    passport.authenticate('google', {
      scope: ['profile', 'email']
    })(req, res, next);
  }

  /**
   * Gérer le callback Google OAuth
   */
  static handleGoogleCallback(req: Request, res: Response, next: NextFunction) {
    passport.authenticate('google', { 
      session: false,
      failureRedirect: '/?error=oauth_failed'
    }, (err: any, user: any) => {
      if (err) {
        console.error('Erreur OAuth callback:', err);
        return res.redirect('/?error=oauth_error');
      }

      if (!user) {
        console.log('OAuth callback: utilisateur non trouvé');
        return res.redirect('/?error=oauth_failed');
      }

      try {
        // Redirection avec le token en paramètre pour que le frontend puisse le récupérer
        const redirectUrl = `/?oauth_success=true&token=${encodeURIComponent(user.token)}&user=${encodeURIComponent(JSON.stringify(user.user))}`;
        res.redirect(redirectUrl);
      } catch (error) {
        console.error('Erreur lors de la redirection OAuth:', error);
        res.redirect('/?error=oauth_error');
      }
    })(req, res, next);
  }

  /**
   * Vérifier le statut de la configuration OAuth
   */
  static getOAuthStatus(req: Request, res: Response) {
    res.json({
      success: true,
      oauth: {
        google: {
          configured: OAuthService.isConfigured(),
          authUrl: OAuthService.isConfigured() ? '/api/auth/google' : null
        }
      },
      environment: config.NODE_ENV
    });
  }

  /**
   * Déconnexion OAuth (similaire à la déconnexion normale)
   */
  static logout(req: Request, res: Response) {
    res.json({
      success: true,
      message: 'Déconnexion réussie'
    });
  }
}
