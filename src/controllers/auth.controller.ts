import { Request, Response } from 'express';
import { AuthService } from '../services/auth.service.js';
import { config } from '../config/app.js';

export class AuthController {
  static async register(req: Request, res: Response) {
    try {
      const { email, password, firstName, lastName } = req.body;

      // Validation basique
      if (!email || !password) {
        return res.status(400).json({
          success: false,
          error: 'Email et mot de passe requis',
          code: 'MISSING_FIELDS'
        });
      }

      if (password.length < 6) {
        return res.status(400).json({
          success: false,
          error: 'Le mot de passe doit contenir au moins 6 caractères',
          code: 'PASSWORD_TOO_SHORT'
        });
      }

      const result = await AuthService.registerUser({
        email,
        password,
        firstName,
        lastName
      });

      // Log d'inscription réussie
      console.log(`✅ Nouvel utilisateur inscrit: ${email} (${firstName} ${lastName}) sur ${config.BASE_URL} à ${new Date().toISOString()}`);

      res.status(201).json({
        success: true,
        message: result.message,
        user: result.user,
        token: result.token,
        environment: config.isRailway ? 'railway' : 'local'
      });

    } catch (error) {
      console.error('Erreur inscription:', error);
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Erreur lors de l\'inscription',
        code: 'REGISTRATION_ERROR'
      });
    }
  }

  static async login(req: Request, res: Response) {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({
          success: false,
          error: 'Email et mot de passe requis',
          code: 'MISSING_FIELDS'
        });
      }

      const result = await AuthService.loginUser({ email, password });

      // Log de connexion réussie
      console.log(`🔑 Connexion réussie: ${email} sur ${config.BASE_URL} à ${new Date().toISOString()}`);

      res.json({
        success: true,
        message: result.message,
        user: result.user,
        token: result.token,
        environment: config.isRailway ? 'railway' : 'local'
      });

    } catch (error) {
      console.error('Erreur connexion:', error);
      res.status(401).json({
        success: false,
        error: error instanceof Error ? error.message : 'Erreur lors de la connexion',
        code: 'LOGIN_ERROR'
      });
    }
  }

  static async getProfile(req: Request, res: Response) {
    try {
      const authHeader = req.headers.authorization;
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          success: false,
          error: 'Token d\'authentification requis',
          code: 'MISSING_TOKEN'
        });
      }

      const token = authHeader.substring(7);
      const { userId } = AuthService.verifyToken(token);
      const user = await AuthService.getUserById(userId);

      res.json({
        success: true,
        user,
        environment: config.isRailway ? 'railway' : 'local'
      });

    } catch (error) {
      console.error('Erreur profil:', error);
      res.status(401).json({
        success: false,
        error: error instanceof Error ? error.message : 'Erreur lors de la récupération du profil',
        code: 'PROFILE_ERROR'
      });
    }
  }

  static async getServerInfo(req: Request, res: Response) {
    res.json({
      success: true,
      server: {
        environment: config.NODE_ENV,
        platform: config.isRailway ? 'Railway' : 'Local',
        baseUrl: config.BASE_URL,
        timestamp: new Date().toISOString(),
        version: '1.0.0'
      }
    });
  }

  static async logout(req: Request, res: Response) {
    try {
      const authHeader = req.headers.authorization;
      
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        const { userId } = AuthService.verifyToken(token);
        const user = await AuthService.getUserById(userId);

        // Log de déconnexion
        console.log(`🚪 Déconnexion utilisateur: ${user.email} (ID: ${userId}) sur ${config.BASE_URL} à ${new Date().toISOString()}`);
      }

      res.json({
        success: true,
        message: 'Déconnexion réussie'
      });

    } catch (error) {
      // Même si le token est invalide, on considère la déconnexion comme réussie
      res.json({
        success: true,
        message: 'Déconnexion réussie'
      });
    }
  }

  static async deleteAccount(req: Request, res: Response) {
    try {
      const authHeader = req.headers.authorization;
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          success: false,
          error: 'Token d\'authentification requis',
          code: 'MISSING_TOKEN'
        });
      }

      const token = authHeader.substring(7);
      const { userId } = AuthService.verifyToken(token);
      
      // Récupérer les infos avant suppression pour le log
      const user = await AuthService.getUserById(userId);
      
      // Supprimer l'utilisateur
      await AuthService.deleteUser(userId);

      // Log de suppression de compte
      console.log(`🗑️ Suppression compte utilisateur: ${user.email} (ID: ${userId}) sur ${config.BASE_URL} à ${new Date().toISOString()}`);

      res.json({
        success: true,
        message: 'Compte supprimé avec succès'
      });

    } catch (error) {
      console.error('Erreur suppression compte:', error);
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Erreur lors de la suppression du compte',
        code: 'DELETE_ACCOUNT_ERROR'
      });
    }
  }
}
