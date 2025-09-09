import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service.js';

// Extension de l'interface Request pour inclure user
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        email: string;
        firstName?: string;
        lastName?: string;
      };
    }
  }
}

/**
 * Middleware d'authentification JWT
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Token d\'authentification requis',
        code: 'MISSING_AUTH_TOKEN'
      });
    }

    const token = authHeader.substring(7); // Remove "Bearer "
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Token manquant',
        code: 'EMPTY_TOKEN'
      });
    }

    // Vérifier le token
    const decoded = AuthService.verifyToken(token);
    
    // Ajouter les informations utilisateur à la requête
    req.user = {
      userId: decoded.userId,
      email: '', // Sera rempli si nécessaire
    };

    next();
  } catch (error) {
    console.error('Erreur authentification:', error);
    
    if (error instanceof Error) {
      if (error.message.includes('expired')) {
        return res.status(401).json({
          success: false,
          error: 'Token expiré',
          code: 'TOKEN_EXPIRED'
        });
      }
      if (error.message.includes('invalid')) {
        return res.status(401).json({
          success: false,
          error: 'Token invalide',
          code: 'INVALID_TOKEN'
        });
      }
    }
    
    return res.status(401).json({
      success: false,
      error: 'Erreur d\'authentification',
      code: 'AUTH_ERROR'
    });
  }
}

/**
 * Middleware pour vérifier les permissions d'admin
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentification requise',
        code: 'AUTH_REQUIRED'
      });
    }

    // Récupérer les informations complètes de l'utilisateur
    const user = await AuthService.getUserById(req.user.userId);
    
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Utilisateur non trouvé',
        code: 'USER_NOT_FOUND'
      });
    }

    // Vérifier si l'utilisateur est admin (vous devrez adapter selon votre logique)
    const isAdmin = user.email === 'gregoire.chamorel@outlook.fr' || 
                    user.email === 'admin@wesype.com' ||
                    user.email === 'dev@wesype.com';

    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Permissions administrateur requises',
        code: 'ADMIN_REQUIRED'
      });
    }

    next();
  } catch (error) {
    console.error('Erreur vérification admin:', error);
    return res.status(500).json({
      success: false,
      error: 'Erreur interne',
      code: 'INTERNAL_ERROR'
    });
  }
}
