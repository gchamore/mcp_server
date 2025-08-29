# MCP Wesype Server

## 🚀 Description
Serveur TypeScript moderne et modulaire pour la plateforme MCP Wesype, compatible avec Railway.

## 📁 Structure du projet

```
src/
├── server.ts              # Point d'entrée principal (propre et lisible)
├── config/
│   └── app.ts             # Configuration de l'application et middlewares
├── routes/
│   ├── index.ts           # Routes principales (/, /health, /api/info)
│   └── auth.ts            # Routes d'authentification (/api/auth/*)
├── middleware/
│   └── validation.ts      # Middlewares de validation et sécurité
public/
├── index.html             # Interface web élégante
├── css/
│   └── style.css          # Design bleu marine/blanc moderne
└── js/
    └── main.js            # JavaScript côté client
```

## 🎯 Fonctionnalités

### Backend
- ✅ Serveur Express TypeScript modulaire
- ✅ Architecture propre séparée par responsabilités
- ✅ Routes d'authentification structurées
- ✅ Middlewares de validation
- ✅ Gestion d'erreurs centralisée
- ✅ Rate limiting basique
- ✅ Endpoint de santé détaillé

### Frontend
- ✅ Design moderne bleu marine/blanc
- ✅ Interface responsive
- ✅ Bouton Register fonctionnel
- ✅ Animations et effets visuels
- ✅ Indicateur de statut du serveur

## 🔧 Commandes

```bash
# Développement
npm run dev           # Démarre avec rechargement automatique

# Production
npm run build         # Compile TypeScript
npm start            # Lance le serveur compilé

# Nettoyage
npm run clean         # Supprime le dossier dist
npm run build:clean   # Nettoyage + compilation
```

## 📡 Endpoints API

### Routes principales
- `GET /` - Page d'accueil
- `GET /health` - Statut du serveur
- `GET /api/info` - Informations sur l'API

### Authentification
- `POST /api/auth/register` - Inscription utilisateur
- `POST /api/auth/login` - Connexion utilisateur
- `POST /api/auth/logout` - Déconnexion
- `GET /api/auth/me` - Profil utilisateur

## 🛡️ Sécurité
- Validation des emails et mots de passe
- Rate limiting sur les routes d'authentification
- Gestion d'erreurs sécurisée
- Logging des requêtes en développement

## 🚀 Déploiement Railway
Le serveur est configuré pour Railway avec :
- Variables d'environnement automatiques
- Build optimisé
- Démarrage avec `npm start`

## 🔮 Prochaines étapes
- [ ] Base de données (PostgreSQL)
- [ ] JWT Authentication
- [ ] Hashage des mots de passe
- [ ] Tests unitaires
- [ ] Documentation API (Swagger)
- [ ] Docker support
