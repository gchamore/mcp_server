import express from 'express';
import { AuthController } from '../controllers/auth.controller.js';
import { OAuthController } from '../controllers/oauth.controller.js';
import { validateEmail, validatePassword, validateRegistration, rateLimit } from '../middleware/validation.js';

const router = express.Router();

// Routes d'authentification avec middlewares de validation
router.post('/register', 
  rateLimit(5, 300000), // 5 tentatives par 5 minutes
  validateEmail,
  validatePassword,
  validateRegistration,
  AuthController.register
);

router.post('/login',
  rateLimit(10, 300000), // 10 tentatives par 5 minutes  
  validateEmail,
  validatePassword,
  AuthController.login
);

router.get('/profile', AuthController.getProfile);
router.post('/logout', AuthController.logout);
router.delete('/account', AuthController.deleteAccount);

// Routes OAuth Google
router.get('/google', 
  rateLimit(10, 300000), // 10 tentatives par 5 minutes
  OAuthController.initiateGoogleAuth
);

router.get('/google/callback', 
  rateLimit(10, 300000), // 10 callbacks par 5 minutes
  OAuthController.handleGoogleCallback
);

// Route pour vérifier le statut OAuth
router.get('/oauth/status', OAuthController.getOAuthStatus);

// Route d'information serveur
router.get('/server-info', AuthController.getServerInfo);

export default router;
