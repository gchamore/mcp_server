import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import session from 'express-session';
import passport from 'passport';
import { OAuthService } from '../services/oauth.service.js';

// Configuration pour ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Charger les variables d'environnement
dotenv.config();

// Détection automatique de l'environnement
const isRailway = process.env.RAILWAY_ENVIRONMENT !== undefined;
const isProduction = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3000;

// Configuration automatique de l'URL
let BASE_URL: string;
if (isRailway) {
  // Sur Railway, utilise l'URL fournie par Railway ou génère une URL basée sur le service
  BASE_URL = process.env.RAILWAY_PUBLIC_DOMAIN 
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : process.env.BASE_URL || `https://mcp-wesype-server-production.up.railway.app`;
} else {
  // En local, utilise localhost
  BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
}

export const config = {
  PORT,
  NODE_ENV: process.env.NODE_ENV || 'development',
  BASE_URL,
  isRailway,
  isProduction,
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_SECRET: process.env.JWT_SECRET || 'fallback-secret-key',
  __dirname,
  __filename
};

export function setupMiddleware(app: express.Application) {
  // Configuration des sessions Express (nécessaire pour Passport)
  if (!process.env.SESSION_SECRET && isProduction) {
    throw new Error('SESSION_SECRET must be set in production environment');
  }
  
  app.use(session({
    secret: process.env.SESSION_SECRET || (() => {
      if (isProduction) {
        throw new Error('SESSION_SECRET must be set in production environment');
      }
      console.warn('⚠️  Using fallback session secret - UNSAFE for production!');
      return 'dev-fallback-session-secret-' + Math.random().toString(36);
    })(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: isProduction, // HTTPS en production
      maxAge: 24 * 60 * 60 * 1000 // 24 heures
    }
  }));

  // Initialisation de Passport
  app.use(passport.initialize());
  app.use(passport.session());

  // Initialiser OAuth Service de manière asynchrone
  OAuthService.initializePassport().catch(error => {
    console.warn('⚠️  Échec de l\'initialisation OAuth:', error.message);
  });

  // Middleware pour servir les fichiers statiques
  app.use(express.static(path.join(__dirname, '../../public')));
  
  // Middleware pour parser le JSON
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  
  // Middleware de logging simple pour le développement
  if (config.NODE_ENV === 'development') {
    app.use((req, res, next) => {
      console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
      next();
    });
  }
}

export function setupErrorHandling(app: express.Application) {
  // Middleware de gestion d'erreur
  app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error(`Error: ${err.message}`);
    console.error(err.stack);
    res.status(500).json({ 
      error: 'Something went wrong!',
      ...(config.NODE_ENV === 'development' && { details: err.message })
    });
  });

  // Route 404
  app.use('*', (req, res) => {
    res.status(404).json({ 
      error: 'Route not found',
      path: req.originalUrl 
    });
  });
}
