import { PasswordService } from '../services/password.service.js';
import { EmailService } from '../services/email.service.js';
import { AuthService } from '../services/auth.service.js';
export class PasswordController {
    static async requestReset(req, res) {
        try {
            const { email } = req.body;
            const result = await PasswordService.requestPasswordReset(email.toLowerCase());
            res.json({
                success: true,
                message: result.message,
                ...(process.env.NODE_ENV === 'development' && result.devToken && {
                    devToken: result.devToken,
                    devResetUrl: result.devResetUrl,
                    emailSent: result.emailSent,
                    previewUrl: result.previewUrl,
                    devMessage: 'Informations de développement - ne pas utiliser en production'
                })
            });
        }
        catch (error) {
            console.error('Erreur demande de réinitialisation:', error);
            res.status(500).json({
                success: false,
                error: 'Erreur interne du serveur',
                code: 'INTERNAL_ERROR'
            });
        }
    }
    static async verifyResetToken(req, res) {
        try {
            const { token } = req.params;
            if (!token) {
                return res.status(400).json({
                    success: false,
                    error: 'Token requis',
                    code: 'MISSING_TOKEN'
                });
            }
            const verification = await PasswordService.verifyResetToken(token);
            if (!verification.valid) {
                return res.status(400).json({
                    success: false,
                    error: verification.message || 'Token invalide',
                    code: 'INVALID_TOKEN'
                });
            }
            res.json({
                success: true,
                message: 'Token valide',
                valid: true
            });
        }
        catch (error) {
            console.error('Erreur vérification token:', error);
            res.status(500).json({
                success: false,
                error: 'Erreur interne du serveur',
                code: 'INTERNAL_ERROR'
            });
        }
    }
    static async resetPassword(req, res) {
        try {
            const { token, newPassword } = req.body;
            const result = await PasswordService.resetPasswordWithToken({
                token,
                newPassword
            });
            if (!result.success) {
                return res.status(400).json({
                    success: false,
                    error: result.message,
                    code: 'RESET_FAILED'
                });
            }
            res.json({
                success: true,
                message: result.message
            });
        }
        catch (error) {
            console.error('Erreur réinitialisation mot de passe:', error);
            res.status(500).json({
                success: false,
                error: 'Erreur interne du serveur',
                code: 'INTERNAL_ERROR'
            });
        }
    }
    static async changePassword(req, res) {
        try {
            const { currentPassword, newPassword } = req.body;
            const userId = req.mcpUser.userId;
            const result = await PasswordService.changePassword({
                userId,
                currentPassword,
                newPassword
            });
            if (!result.success) {
                return res.status(400).json({
                    success: false,
                    error: result.message,
                    code: 'CHANGE_FAILED'
                });
            }
            res.json({
                success: true,
                message: result.message
            });
        }
        catch (error) {
            console.error('Erreur changement mot de passe:', error);
            res.status(500).json({
                success: false,
                error: 'Erreur interne du serveur',
                code: 'INTERNAL_ERROR'
            });
        }
    }
    static async getPasswordInfo(req, res) {
        try {
            const userId = req.mcpUser.userId;
            const user = await AuthService.getUserById(userId);
            if (!user) {
                return res.status(404).json({
                    success: false,
                    error: 'Utilisateur non trouvé',
                    code: 'USER_NOT_FOUND'
                });
            }
            const emailStatus = EmailService.getStatus();
            res.json({
                success: true,
                passwordInfo: {
                    hasPassword: !!user.password,
                    provider: user.provider,
                    canChangePassword: user.provider === 'local' && !!user.password,
                    lastUpdated: user.updatedAt
                },
                emailService: {
                    configured: emailStatus.configured,
                    provider: emailStatus.provider
                }
            });
        }
        catch (error) {
            console.error('Erreur récupération info mot de passe:', error);
            res.status(500).json({
                success: false,
                error: 'Erreur interne du serveur',
                code: 'INTERNAL_ERROR'
            });
        }
    }
    static async getEmailServiceStatus(req, res) {
        try {
            const emailStatus = EmailService.getStatus();
            res.json({
                success: true,
                emailService: {
                    configured: emailStatus.configured,
                    provider: emailStatus.provider,
                    available: emailStatus.configured
                }
            });
        }
        catch (error) {
            console.error('Erreur récupération statut email:', error);
            res.status(500).json({
                success: false,
                error: 'Erreur interne du serveur',
                code: 'INTERNAL_ERROR'
            });
        }
    }
}
