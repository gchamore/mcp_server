import { Request, Response } from 'express';
import { PasswordService } from '../services/password.service.js';
import { EmailService } from '../services/email.service.js';
import { AuthService } from '../services/auth.service.js';

export class PasswordController {
  /**
   * Demander une réinitialisation de mot de passe
   */
  static async requestReset(req: Request, res: Response) {
    try {
      const { email } = req.body;

      // La validation email est déjà faite par le middleware validateEmail
      const result = await PasswordService.requestPasswordReset(email.toLowerCase());

      // Pour des raisons de sécurité, on retourne toujours un succès
      res.json({
        success: true,
        message: result.message,
        // En développement, on peut inclure des informations supplémentaires
        ...(process.env.NODE_ENV === 'development' && result.devToken && { 
          devToken: result.devToken,
          devResetUrl: result.devResetUrl,
          emailSent: result.emailSent,
          previewUrl: result.previewUrl,
          devMessage: 'Informations de développement - ne pas utiliser en production'
        })
      });

    } catch (error) {
      console.error('Erreur demande de réinitialisation:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur interne du serveur',
        code: 'INTERNAL_ERROR'
      });
    }
  }

  /**
   * Vérifier la validité d'un token de réinitialisation
   */
  static async verifyResetToken(req: Request, res: Response) {
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

    } catch (error) {
      console.error('Erreur vérification token:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur interne du serveur',
        code: 'INTERNAL_ERROR'
      });
    }
  }

  /**
   * Réinitialiser le mot de passe avec un token
   */
  static async resetPassword(req: Request, res: Response) {
    try {
      const { token, newPassword } = req.body;

      // La validation est déjà faite par le middleware validatePasswordReset
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

    } catch (error) {
      console.error('Erreur réinitialisation mot de passe:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur interne du serveur',
        code: 'INTERNAL_ERROR'
      });
    }
  }

  /**
   * Changer le mot de passe pour un utilisateur connecté
   */
  static async changePassword(req: Request, res: Response) {
    try {
      const { currentPassword, newPassword } = req.body;
      
      // Utiliser req.mcpUser fourni par le middleware requireAuth
      const userId = req.mcpUser!.userId;

      // La validation est déjà faite par le middleware validatePasswordChange
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

    } catch (error) {
      console.error('Erreur changement mot de passe:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur interne du serveur',
        code: 'INTERNAL_ERROR'
      });
    }
  }

  /**
   * Obtenir des informations sur la gestion des mots de passe
   */
  static async getPasswordInfo(req: Request, res: Response) {
    try {
      const userId = req.mcpUser!.userId;
      
      // Récupérer les informations de l'utilisateur
      const user = await AuthService.getUserById(userId);
      
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'Utilisateur non trouvé',
          code: 'USER_NOT_FOUND'
        });
      }

      // Récupérer le statut du service d'email
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

    } catch (error) {
      console.error('Erreur récupération info mot de passe:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur interne du serveur',
        code: 'INTERNAL_ERROR'
      });
    }
  }

  /**
   * Obtenir le statut du service d'email (public)
   */
  static async getEmailServiceStatus(req: Request, res: Response) {
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

    } catch (error) {
      console.error('Erreur récupération statut email:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur interne du serveur',
        code: 'INTERNAL_ERROR'
      });
    }
  }
}
