import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { AuthService } from './auth.service.js';
import { EmailService } from './email.service.js';
import { config } from '../config/app.js';

export interface PasswordResetRequest {
  email: string;
}

export interface PasswordResetConfirm {
  token: string;
  newPassword: string;
}

export interface PasswordChange {
  userId: string;
  currentPassword: string;
  newPassword: string;
}

export class PasswordService {
  private static readonly TOKEN_EXPIRY_HOURS = 1; // 1 heure
  private static readonly SALT_ROUNDS = 12;

  /**
   * Demander une réinitialisation de mot de passe
   */
  static async requestPasswordReset(email: string): Promise<{ 
    success: boolean; 
    message: string; 
    devToken?: string;
    devResetUrl?: string;
    emailSent?: boolean;
    previewUrl?: string;
  }> {
    try {
      // Vérifier si l'utilisateur existe
      const user = await prisma.user.findUnique({
        where: { email: email.toLowerCase() }
      });

      if (!user) {
        // Pour des raisons de sécurité, on ne révèle pas si l'email existe ou non
        return {
          success: true,
          message: 'Si un compte existe avec cet email, vous recevrez un lien de réinitialisation.'
        };
      }

      // Vérifier si l'utilisateur utilise un provider externe (Google)
      if (user.provider !== 'local' || !user.password) {
        return {
          success: false,
          message: 'Ce compte utilise une authentification externe (Google). Veuillez vous connecter via Google.'
        };
      }

      // Supprimer les anciens tokens non utilisés pour cet utilisateur
      await prisma.passwordResetToken.deleteMany({
        where: {
          userId: user.id,
          OR: [
            { used: true },
            { expiresAt: { lt: new Date() } }
          ]
        }
      });

      // Générer un token sécurisé
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + this.TOKEN_EXPIRY_HOURS);

      // Sauvegarder le token
      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          token,
          expiresAt
        }
      });

      console.log(`🔐 Token de réinitialisation créé pour ${email}: ${token}`);
      
      // Construire l'URL de réinitialisation
      const resetUrl = `${config.BASE_URL}/reset-password?token=${token}`;
      
      // Envoyer l'email de réinitialisation
      const emailResult = await EmailService.sendPasswordResetEmail({
        email: user.email,
        firstName: user.firstName || undefined,
        resetToken: token,
        resetUrl
      });

      if (emailResult.success) {
        console.log(`📧 Email de réinitialisation envoyé à ${email}`);
        if (emailResult.previewUrl) {
          console.log(`📧 Preview URL (dev): ${emailResult.previewUrl}`);
        }
      } else {
        console.error(`❌ Erreur envoi email: ${emailResult.error}`);
      }
      
      // Retourner le résultat
      return {
        success: true,
        message: 'Un lien de réinitialisation a été envoyé à votre adresse email.',
        // En développement, inclure des infos supplémentaires
        ...(process.env.NODE_ENV === 'development' && {
          devToken: token,
          devResetUrl: resetUrl,
          emailSent: emailResult.success,
          previewUrl: emailResult.previewUrl
        })
      };

    } catch (error) {
      console.error('Erreur lors de la demande de réinitialisation:', error);
      return {
        success: false,
        message: 'Erreur lors de la demande de réinitialisation'
      };
    }
  }

  /**
   * Vérifier la validité d'un token de réinitialisation
   */
  static async verifyResetToken(token: string): Promise<{ valid: boolean; userId?: string; message?: string }> {
    try {
      const resetToken = await prisma.passwordResetToken.findUnique({
        where: { token },
        include: { user: true }
      });

      if (!resetToken) {
        return { valid: false, message: 'Token invalide' };
      }

      if (resetToken.used) {
        return { valid: false, message: 'Ce token a déjà été utilisé' };
      }

      if (resetToken.expiresAt < new Date()) {
        return { valid: false, message: 'Ce token a expiré' };
      }

      if (!resetToken.user.isActive) {
        return { valid: false, message: 'Compte utilisateur désactivé' };
      }

      return { valid: true, userId: resetToken.userId };

    } catch (error) {
      console.error('Erreur lors de la vérification du token:', error);
      return { valid: false, message: 'Erreur lors de la vérification' };
    }
  }

  /**
   * Réinitialiser le mot de passe avec un token
   */
  static async resetPasswordWithToken(data: PasswordResetConfirm): Promise<{ success: boolean; message: string }> {
    try {
      const { token, newPassword } = data;

      // Vérifier le token
      const verification = await this.verifyResetToken(token);
      if (!verification.valid || !verification.userId) {
        return {
          success: false,
          message: verification.message || 'Token invalide'
        };
      }

      // Valider le nouveau mot de passe
      if (newPassword.length < 6) {
        return {
          success: false,
          message: 'Le mot de passe doit contenir au moins 6 caractères'
        };
      }

      // Hasher le nouveau mot de passe
      const hashedPassword = await bcrypt.hash(newPassword, this.SALT_ROUNDS);

      // Mettre à jour le mot de passe et marquer le token comme utilisé
      await prisma.$transaction([
        prisma.user.update({
          where: { id: verification.userId },
          data: { password: hashedPassword }
        }),
        prisma.passwordResetToken.update({
          where: { token },
          data: { used: true }
        })
      ]);

      console.log(`✅ Mot de passe réinitialisé pour l'utilisateur ${verification.userId}`);

      // Envoyer un email de confirmation (optionnel)
      try {
        const user = await prisma.user.findUnique({
          where: { id: verification.userId },
          select: { email: true, firstName: true }
        });
        
        if (user) {
          await EmailService.sendPasswordChangeConfirmation(
            user.email,
            user.firstName || undefined
          );
        }
      } catch (emailError) {
        console.error('Erreur envoi email de confirmation:', emailError);
        // Ne pas faire échouer la réinitialisation pour un problème d'email
      }

      return {
        success: true,
        message: 'Mot de passe réinitialisé avec succès'
      };

    } catch (error) {
      console.error('Erreur lors de la réinitialisation:', error);
      return {
        success: false,
        message: 'Erreur lors de la réinitialisation du mot de passe'
      };
    }
  }

  /**
   * Changer le mot de passe pour un utilisateur connecté
   */
  static async changePassword(data: PasswordChange): Promise<{ success: boolean; message: string }> {
    try {
      const { userId, currentPassword, newPassword } = data;

      // Récupérer l'utilisateur
      const user = await prisma.user.findUnique({
        where: { id: userId }
      });

      if (!user) {
        return {
          success: false,
          message: 'Utilisateur non trouvé'
        };
      }

      // Vérifier si l'utilisateur utilise un provider externe
      if (user.provider !== 'local' || !user.password) {
        return {
          success: false,
          message: 'Ce compte utilise une authentification externe. Impossible de changer le mot de passe.'
        };
      }

      // Vérifier le mot de passe actuel
      const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
      if (!isCurrentPasswordValid) {
        return {
          success: false,
          message: 'Mot de passe actuel incorrect'
        };
      }

      // Valider le nouveau mot de passe
      if (newPassword.length < 6) {
        return {
          success: false,
          message: 'Le nouveau mot de passe doit contenir au moins 6 caractères'
        };
      }

      // Vérifier que le nouveau mot de passe est différent de l'ancien
      const isSamePassword = await bcrypt.compare(newPassword, user.password);
      if (isSamePassword) {
        return {
          success: false,
          message: 'Le nouveau mot de passe doit être différent de l\'ancien'
        };
      }

      // Hasher le nouveau mot de passe
      const hashedPassword = await bcrypt.hash(newPassword, this.SALT_ROUNDS);

      // Mettre à jour le mot de passe
      await prisma.user.update({
        where: { id: userId },
        data: { password: hashedPassword }
      });

      console.log(`🔐 Mot de passe changé pour l'utilisateur ${userId}`);

      // Envoyer un email de confirmation (optionnel)
      try {
        await EmailService.sendPasswordChangeConfirmation(
          user.email,
          user.firstName || undefined
        );
      } catch (emailError) {
        console.error('Erreur envoi email de confirmation:', emailError);
        // Ne pas faire échouer le changement pour un problème d'email
      }

      return {
        success: true,
        message: 'Mot de passe changé avec succès'
      };

    } catch (error) {
      console.error('Erreur lors du changement de mot de passe:', error);
      return {
        success: false,
        message: 'Erreur lors du changement de mot de passe'
      };
    }
  }

  /**
   * Nettoyer les tokens expirés (à appeler périodiquement)
   */
  static async cleanupExpiredTokens(): Promise<number> {
    try {
      const result = await prisma.passwordResetToken.deleteMany({
        where: {
          OR: [
            { expiresAt: { lt: new Date() } },
            { used: true }
          ]
        }
      });

      console.log(`🧹 ${result.count} tokens de réinitialisation nettoyés`);
      return result.count;

    } catch (error) {
      console.error('Erreur lors du nettoyage des tokens:', error);
      return 0;
    }
  }
}
