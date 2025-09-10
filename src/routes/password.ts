import express from 'express';
import { PasswordController } from '../controllers/password.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit, validateEmail, validatePasswordReset, validatePasswordChange } from '../middleware/validation.js';

const router = express.Router();

/**
 * POST /password/request-reset
 * Demander une réinitialisation de mot de passe
 */
router.post('/request-reset',
  validateEmail, // Validation de l'email via middleware
  rateLimit(3, 300000), // 3 demandes par 5 minutes
  PasswordController.requestReset
);

/**
 * GET /password/verify-token/:token
 * Vérifier la validité d'un token de réinitialisation
 */
router.get('/verify-token/:token',
  rateLimit(10, 300000), // 10 vérifications par 5 minutes
  PasswordController.verifyResetToken
);

/**
 * POST /password/reset
 * Réinitialiser le mot de passe avec un token
 */
router.post('/reset',
  validatePasswordReset, // Validation des champs de reset
  rateLimit(5, 300000), // 5 réinitialisations par 5 minutes
  PasswordController.resetPassword
);

/**
 * POST /password/change
 * Changer le mot de passe pour un utilisateur connecté
 */
router.post('/change',
  requireAuth,
  validatePasswordChange, // Validation des champs de changement
  rateLimit(5, 300000), // 5 changements par 5 minutes
  PasswordController.changePassword
);

/**
 * GET /password/info
 * Obtenir des informations sur la gestion des mots de passe pour l'utilisateur connecté
 */
router.get('/info',
  requireAuth,
  PasswordController.getPasswordInfo
);

/**
 * GET /password/email-status
 * Obtenir le statut du service d'email (public)
 */
router.get('/email-status',
  PasswordController.getEmailServiceStatus
);

export default router;
