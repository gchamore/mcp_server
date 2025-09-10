import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { EmailService } from './email.service.js';
import { config } from '../config/app.js';
export class PasswordService {
    static async requestPasswordReset(email) {
        try {
            const user = await prisma.user.findUnique({
                where: { email: email.toLowerCase() }
            });
            if (!user) {
                return {
                    success: true,
                    message: 'Si un compte existe avec cet email, vous recevrez un lien de réinitialisation.'
                };
            }
            if (user.provider !== 'local' || !user.password) {
                return {
                    success: false,
                    message: 'Ce compte utilise une authentification externe (Google). Veuillez vous connecter via Google.'
                };
            }
            await prisma.passwordResetToken.deleteMany({
                where: {
                    userId: user.id,
                    OR: [
                        { used: true },
                        { expiresAt: { lt: new Date() } }
                    ]
                }
            });
            const token = crypto.randomBytes(32).toString('hex');
            const expiresAt = new Date();
            expiresAt.setHours(expiresAt.getHours() + this.TOKEN_EXPIRY_HOURS);
            await prisma.passwordResetToken.create({
                data: {
                    userId: user.id,
                    token,
                    expiresAt
                }
            });
            console.log(`🔐 Token de réinitialisation créé pour ${email}: ${token}`);
            const resetUrl = `${config.BASE_URL}/reset-password?token=${token}`;
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
            }
            else {
                console.error(`❌ Erreur envoi email: ${emailResult.error}`);
            }
            return {
                success: true,
                message: 'Un lien de réinitialisation a été envoyé à votre adresse email.',
                ...(process.env.NODE_ENV === 'development' && {
                    devToken: token,
                    devResetUrl: resetUrl,
                    emailSent: emailResult.success,
                    previewUrl: emailResult.previewUrl
                })
            };
        }
        catch (error) {
            console.error('Erreur lors de la demande de réinitialisation:', error);
            return {
                success: false,
                message: 'Erreur lors de la demande de réinitialisation'
            };
        }
    }
    static async verifyResetToken(token) {
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
        }
        catch (error) {
            console.error('Erreur lors de la vérification du token:', error);
            return { valid: false, message: 'Erreur lors de la vérification' };
        }
    }
    static async resetPasswordWithToken(data) {
        try {
            const { token, newPassword } = data;
            const verification = await this.verifyResetToken(token);
            if (!verification.valid || !verification.userId) {
                return {
                    success: false,
                    message: verification.message || 'Token invalide'
                };
            }
            if (newPassword.length < 6) {
                return {
                    success: false,
                    message: 'Le mot de passe doit contenir au moins 6 caractères'
                };
            }
            const hashedPassword = await bcrypt.hash(newPassword, this.SALT_ROUNDS);
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
            try {
                const user = await prisma.user.findUnique({
                    where: { id: verification.userId },
                    select: { email: true, firstName: true }
                });
                if (user) {
                    await EmailService.sendPasswordChangeConfirmation(user.email, user.firstName || undefined);
                }
            }
            catch (emailError) {
                console.error('Erreur envoi email de confirmation:', emailError);
            }
            return {
                success: true,
                message: 'Mot de passe réinitialisé avec succès'
            };
        }
        catch (error) {
            console.error('Erreur lors de la réinitialisation:', error);
            return {
                success: false,
                message: 'Erreur lors de la réinitialisation du mot de passe'
            };
        }
    }
    static async changePassword(data) {
        try {
            const { userId, currentPassword, newPassword } = data;
            const user = await prisma.user.findUnique({
                where: { id: userId }
            });
            if (!user) {
                return {
                    success: false,
                    message: 'Utilisateur non trouvé'
                };
            }
            if (user.provider !== 'local' || !user.password) {
                return {
                    success: false,
                    message: 'Ce compte utilise une authentification externe. Impossible de changer le mot de passe.'
                };
            }
            const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
            if (!isCurrentPasswordValid) {
                return {
                    success: false,
                    message: 'Mot de passe actuel incorrect'
                };
            }
            if (newPassword.length < 6) {
                return {
                    success: false,
                    message: 'Le nouveau mot de passe doit contenir au moins 6 caractères'
                };
            }
            const isSamePassword = await bcrypt.compare(newPassword, user.password);
            if (isSamePassword) {
                return {
                    success: false,
                    message: 'Le nouveau mot de passe doit être différent de l\'ancien'
                };
            }
            const hashedPassword = await bcrypt.hash(newPassword, this.SALT_ROUNDS);
            await prisma.user.update({
                where: { id: userId },
                data: { password: hashedPassword }
            });
            console.log(`🔐 Mot de passe changé pour l'utilisateur ${userId}`);
            try {
                await EmailService.sendPasswordChangeConfirmation(user.email, user.firstName || undefined);
            }
            catch (emailError) {
                console.error('Erreur envoi email de confirmation:', emailError);
            }
            return {
                success: true,
                message: 'Mot de passe changé avec succès'
            };
        }
        catch (error) {
            console.error('Erreur lors du changement de mot de passe:', error);
            return {
                success: false,
                message: 'Erreur lors du changement de mot de passe'
            };
        }
    }
    static async cleanupExpiredTokens() {
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
        }
        catch (error) {
            console.error('Erreur lors du nettoyage des tokens:', error);
            return 0;
        }
    }
}
PasswordService.TOKEN_EXPIRY_HOURS = 1;
PasswordService.SALT_ROUNDS = 12;
