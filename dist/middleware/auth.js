import { AuthService } from '../services/auth.service.js';
export function requireAuth(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                error: 'Token d\'authentification requis',
                code: 'MISSING_AUTH_TOKEN'
            });
        }
        const token = authHeader.substring(7);
        if (!token) {
            return res.status(401).json({
                success: false,
                error: 'Token manquant',
                code: 'EMPTY_TOKEN'
            });
        }
        const decoded = AuthService.verifyToken(token);
        req.mcpUser = {
            userId: decoded.userId,
            email: '',
        };
        next();
    }
    catch (error) {
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
export async function requireAdmin(req, res, next) {
    try {
        if (!req.mcpUser) {
            return res.status(401).json({
                success: false,
                error: 'Authentification requise',
                code: 'AUTH_REQUIRED'
            });
        }
        const user = await AuthService.getUserById(req.mcpUser.userId);
        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Utilisateur non trouvé',
                code: 'USER_NOT_FOUND'
            });
        }
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
    }
    catch (error) {
        console.error('Erreur vérification admin:', error);
        return res.status(500).json({
            success: false,
            error: 'Erreur interne',
            code: 'INTERNAL_ERROR'
        });
    }
}
