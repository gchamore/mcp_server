import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { prisma, withRetry } from '../lib/prisma.js';
import { AuthService } from './auth.service.js';

export interface GoogleProfile {
  id: string;
  emails: Array<{ value: string; verified: boolean }>;
  name: {
    givenName: string;
    familyName: string;
  };
  photos: Array<{ value: string }>;
}

export class OAuthService {
  private static readonly GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  private static readonly GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

  static async initializePassport() {
    if (!this.GOOGLE_CLIENT_ID || !this.GOOGLE_CLIENT_SECRET) {
      console.warn('⚠️  Google OAuth non configuré - GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET requis');
      return;
    }

    // Importer config dynamiquement après l'initialisation
    const { config } = await import('../config/app.js');
    const callbackUrl = process.env.GOOGLE_CALLBACK_URL || `${config.BASE_URL}/api/auth/google/callback`;

    passport.use(
      new GoogleStrategy(
        {
          clientID: this.GOOGLE_CLIENT_ID,
          clientSecret: this.GOOGLE_CLIENT_SECRET,
          callbackURL: callbackUrl,
          scope: ['profile', 'email']
        },
        async (accessToken, refreshToken, profile, done) => {
          try {
            const result = await this.handleGoogleCallback(profile as GoogleProfile);
            return done(null, result);
          } catch (error) {
            console.error('Erreur OAuth Google:', error);
            return done(error, false);
          }
        }
      )
    );

    passport.serializeUser((user: any, done) => {
      done(null, user.userId || user.id);
    });

    passport.deserializeUser(async (id: string, done) => {
      try {
        const user = await AuthService.getUserById(id);
        done(null, user);
      } catch (error) {
        done(error, null);
      }
    });

    console.log('✅ Passport Google OAuth initialisé');
  }

  static async handleGoogleCallback(profile: GoogleProfile) {
    try {
      const email = profile.emails[0]?.value;
      const firstName = profile.name?.givenName;
      const lastName = profile.name?.familyName;
      const picture = profile.photos[0]?.value;
      const googleId = profile.id;

      if (!email) {
        throw new Error('Email non disponible dans le profil Google');
      }

      console.log(`🔍 Tentative de connexion Google: ${email}`);

      // Chercher un utilisateur existant par Google ID ou email avec retry
      let user = await withRetry(async () => {
        return await prisma.user.findFirst({
          where: {
            OR: [
              { googleId },
              { email }
            ]
          }
        });
      });

      if (user) {
        // Utilisateur existant - mettre à jour avec les infos Google si nécessaire
        if (!user.googleId && googleId) {
          user = await withRetry(async () => {
            return await prisma.user.update({
              where: { id: user!.id },
              data: {
                googleId,
                picture,
                provider: 'google'
              }
            });
          });
        }
        console.log(`✅ Connexion Google réussie pour utilisateur existant: ${email}`);
      } else {
        // Créer un nouvel utilisateur avec retry
        user = await withRetry(async () => {
          return await prisma.user.create({
            data: {
              email,
              firstName,
              lastName,
              googleId,
              picture,
              provider: 'google'
              // password est optionnel pour les utilisateurs OAuth
            }
          });
        });
        console.log(`✅ Nouvel utilisateur créé via Google OAuth: ${email}`);
      }

      // Générer un token JWT
      const token = AuthService.generatePublicToken(user.id);

      return {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          picture: user.picture,
          provider: user.provider
        },
        token,
        message: 'Connexion Google réussie'
      };

    } catch (error) {
      console.error('Erreur lors du traitement du callback Google:', error);
      throw error;
    }
  }

  static isConfigured(): boolean {
    return !!(this.GOOGLE_CLIENT_ID && this.GOOGLE_CLIENT_SECRET);
  }

  static getAuthUrl(): string {
    if (!this.isConfigured()) {
      throw new Error('Google OAuth non configuré');
    }
    return '/api/auth/google';
  }
}
