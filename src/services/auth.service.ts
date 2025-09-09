import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';

export interface UserRegistrationData {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
}

export interface UserLoginData {
  email: string;
  password: string;
}

export class AuthService {
  private static readonly JWT_SECRET = process.env.JWT_SECRET || (() => {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET must be set in production environment');
    }
    console.warn('⚠️  Using fallback JWT secret - UNSAFE for production!');
    return 'dev-fallback-secret-key-' + Math.random().toString(36);
  })();
  private static readonly SALT_ROUNDS = 12;
  private static readonly TOKEN_EXPIRY = '7d';

  static async registerUser(userData: UserRegistrationData) {
    try {
      // Vérifier si l'utilisateur existe déjà
      const existingUser = await prisma.user.findUnique({
        where: { email: userData.email }
      });

      if (existingUser) {
        throw new Error('Un utilisateur avec cet email existe déjà');
      }

      // Hasher le mot de passe
      const hashedPassword = await bcrypt.hash(userData.password, this.SALT_ROUNDS);

      // Créer l'utilisateur
      const user = await prisma.user.create({
        data: {
          email: userData.email,
          password: hashedPassword,
          firstName: userData.firstName,
          lastName: userData.lastName,
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          createdAt: true,
          isActive: true,
        }
      });

      // Générer le token JWT
      const token = this.generateToken(user.id);

      return {
        user,
        token,
        message: 'Utilisateur créé avec succès'
      };

    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Erreur lors de l'inscription: ${error.message}`);
      }
      throw new Error('Erreur inconnue lors de l\'inscription');
    }
  }

  static async loginUser(loginData: UserLoginData) {
    try {
      // Trouver l'utilisateur
      const user = await prisma.user.findUnique({
        where: { email: loginData.email }
      });

      if (!user || !user.isActive) {
        throw new Error('Email ou mot de passe incorrect');
      }

      // Vérifier le mot de passe
      const isPasswordValid = await bcrypt.compare(loginData.password, user.password);

      if (!isPasswordValid) {
        throw new Error('Email ou mot de passe incorrect');
      }

      // Générer le token JWT
      const token = this.generateToken(user.id);

      return {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          createdAt: user.createdAt,
          isActive: user.isActive,
        },
        token,
        message: 'Connexion réussie'
      };

    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Erreur lors de la connexion: ${error.message}`);
      }
      throw new Error('Erreur inconnue lors de la connexion');
    }
  }

  static async getUserById(userId: string) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          createdAt: true,
          isActive: true,
        }
      });

      if (!user) {
        throw new Error('Utilisateur introuvable');
      }

      return user;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Erreur lors de la récupération de l'utilisateur: ${error.message}`);
      }
      throw new Error('Erreur inconnue lors de la récupération de l\'utilisateur');
    }
  }

  private static generateToken(userId: string): string {
    return jwt.sign(
      { 
        userId,
        iat: Math.floor(Date.now() / 1000),
        type: 'access'
      },
      this.JWT_SECRET,
      { 
        expiresIn: this.TOKEN_EXPIRY,
        issuer: 'mcp-wesype',
        audience: 'mcp-wesype-users'
      }
    );
  }

  static verifyToken(token: string): { userId: string } {
    try {
      const decoded = jwt.verify(token, this.JWT_SECRET) as { userId: string };
      return decoded;
    } catch (error) {
      throw new Error('Token invalide');
    }
  }

  static async deleteUser(userId: string) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId }
      });

      if (!user) {
        throw new Error('Utilisateur introuvable');
      }

      await prisma.user.delete({
        where: { id: userId }
      });

      return {
        message: 'Utilisateur supprimé avec succès'
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Erreur lors de la suppression de l'utilisateur: ${error.message}`);
      }
      throw new Error('Erreur inconnue lors de la suppression de l\'utilisateur');
    }
  }
}
