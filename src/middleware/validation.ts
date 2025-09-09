import { Request, Response, NextFunction } from 'express';

/**
 * Middleware de validation des emails
 */
export function validateEmail(req: Request, res: Response, next: NextFunction) {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({
      success: false,
      error: 'Email requis',
      code: 'MISSING_EMAIL'
    });
  }
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({
      success: false,
      error: 'Format d\'email invalide',
      code: 'INVALID_EMAIL_FORMAT'
    });
  }
  
  next();
}

/**
 * Middleware de validation des mots de passe
 */
export function validatePassword(req: Request, res: Response, next: NextFunction) {
  const { password } = req.body;
  
  if (!password) {
    return res.status(400).json({
      success: false,
      error: 'Mot de passe requis',
      code: 'MISSING_PASSWORD'
    });
  }
  
  if (password.length < 6) {
    return res.status(400).json({
      success: false,
      error: 'Le mot de passe doit contenir au moins 6 caractères',
      code: 'PASSWORD_TOO_SHORT'
    });
  }
  
  next();
}

/**
 * Middleware de validation des données d'inscription
 */
export function validateRegistration(req: Request, res: Response, next: NextFunction) {
  const { firstName, lastName } = req.body;
  
  if (!firstName || !lastName) {
    return res.status(400).json({
      success: false,
      error: 'Prénom et nom requis',
      code: 'MISSING_NAMES'
    });
  }
  
  if (firstName.length < 2 || lastName.length < 2) {
    return res.status(400).json({
      success: false,
      error: 'Le prénom et le nom doivent contenir au moins 2 caractères',
      code: 'NAMES_TOO_SHORT'
    });
  }
  
  next();
}

/**
 * Middleware de logging des erreurs
 */
export function logError(err: Error, req: Request, res: Response, next: NextFunction) {
  console.error(`[${new Date().toISOString()}] Error on ${req.method} ${req.path}:`);
  console.error(err.stack);
  next(err);
}

/**
 * Middleware de limitation du taux de requêtes (amélioré)
 */
const requestCounts = new Map<string, { count: number; resetTime: number; firstRequest: number }>();

export function rateLimit(maxRequests: number = 10, windowMs: number = 60000) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Utiliser IP + User-Agent pour identifier l'utilisateur de manière plus précise
    const identifier = `${req.ip}-${req.headers['user-agent']?.substring(0, 50) || 'unknown'}`;
    const now = Date.now();
    
    const userRequest = requestCounts.get(identifier);
    
    if (!userRequest) {
      // Première requête de cet utilisateur
      requestCounts.set(identifier, { 
        count: 1, 
        resetTime: now + windowMs,
        firstRequest: now
      });
      return next();
    }
    
    if (now > userRequest.resetTime) {
      // Fenêtre expirée, reset
      requestCounts.set(identifier, { 
        count: 1, 
        resetTime: now + windowMs,
        firstRequest: now
      });
      return next();
    }
    
    if (userRequest.count >= maxRequests) {
      // Limite atteinte
      const remainingTime = Math.ceil((userRequest.resetTime - now) / 1000);
      
      console.warn(`⚠️  Rate limit dépassé pour ${req.ip}: ${userRequest.count}/${maxRequests} requêtes`);
      
      return res.status(429).json({
        success: false,
        error: `Trop de requêtes. Réessayez dans ${remainingTime} secondes.`,
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: remainingTime,
        limit: maxRequests,
        remaining: 0
      });
    }
    
    // Incrémenter le compteur
    userRequest.count++;
    requestCounts.set(identifier, userRequest);
    
    // Ajouter des headers informatifs
    res.set({
      'X-RateLimit-Limit': maxRequests.toString(),
      'X-RateLimit-Remaining': (maxRequests - userRequest.count).toString(),
      'X-RateLimit-Reset': new Date(userRequest.resetTime).toISOString()
    });
    
    next();
  };
}
