import passport from 'passport';
import { OAuthService } from '../services/oauth.service.js';
import { config } from '../config/app.js';
export class OAuthController {
    static initiateGoogleAuth(req, res, next) {
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
    static handleGoogleCallback(req, res, next) {
        passport.authenticate('google', {
            session: false,
            failureRedirect: '/?error=oauth_failed'
        }, (err, user) => {
            if (err) {
                console.error('Erreur OAuth callback:', err);
                return res.redirect('/?error=oauth_error');
            }
            if (!user) {
                console.log('OAuth callback: utilisateur non trouvé');
                return res.redirect('/?error=oauth_failed');
            }
            try {
                const redirectUrl = `/?oauth_success=true&token=${encodeURIComponent(user.token)}&user=${encodeURIComponent(JSON.stringify(user.user))}`;
                res.redirect(redirectUrl);
            }
            catch (error) {
                console.error('Erreur lors de la redirection OAuth:', error);
                res.redirect('/?error=oauth_error');
            }
        })(req, res, next);
    }
    static getOAuthStatus(req, res) {
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
    static logout(req, res) {
        res.json({
            success: true,
            message: 'Déconnexion réussie'
        });
    }
}
