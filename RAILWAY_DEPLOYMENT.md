# Guide de Déploiement Railway - Gmail MCP Server

## ✅ Tests Locaux Réussis

Votre serveur MCP Gmail a passé tous les tests locaux avec succès :

- ✅ Health Check (`/health`)
- ✅ API Status (`/api/status`) 
- ✅ Frontend Interface (`/`)
- ✅ OAuth Start (`/api/auth/start`)
- ✅ Mode Production (compilé)

## 🚀 Étapes de Déploiement sur Railway

### 1. Préparation du Code

Le code est prêt ! Vérifications finales :

```bash
# Compilation TypeScript
npm run build

# Test en mode production
NODE_ENV=production npm start

# Vérification des dépendances
npm audit
```

### 2. Configuration Railway

#### A. Variables d'Environnement à Configurer

Dans Railway Dashboard > Variables :

```env
NODE_ENV=production
GOOGLE_CLIENT_ID=936380386512-d4kim3ee0k742u5e7aocio1th3k4hoeo.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=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
```

#### B. Configuration du Domain

1. Railway va attribuer un domaine automatiquement
2. Le domaine sera accessible via `RAILWAY_PUBLIC_DOMAIN`
3. Format : `https://votre-app-production.up.railway.app`

### 3. Déploiement

#### Option A : Via Git (Recommandé)

```bash
# Initialiser git si pas encore fait
git init
git add .
git commit -m "Initial Railway deployment"

# Connecter à Railway
railway login
railway link
railway up
```

#### Option B : Via Railway CLI

```bash
# Installation Railway CLI
npm install -g @railway/cli

# Login et déploiement
railway login
railway link
railway up
```

### 4. Configuration Google OAuth

Une fois déployé, il faut mettre à jour la configuration OAuth Google :

1. Aller sur [Google Cloud Console](https://console.cloud.google.com/)
2. Sélectionner votre projet
3. APIs & Services > Credentials
4. Éditer "OAuth 2.0 Client ID"
5. Ajouter les URLs autorisées :

**Authorized JavaScript origins:**
```
https://votre-app-production.up.railway.app
```

**Authorized redirect URIs:**
```
https://votre-app-production.up.railway.app/oauth/callback
```

### 5. Vérifications Post-Déploiement

Une fois déployé, testez ces URLs :

```bash
# Health check
curl https://votre-app-production.up.railway.app/health

# API Status
curl https://votre-app-production.up.railway.app/api/status

# Interface web
# Ouvrir dans le navigateur : https://votre-app-production.up.railway.app
```

### 6. Test Complet OAuth

1. Aller sur `https://votre-app-production.up.railway.app`
2. Cliquer "Se connecter avec Google"
3. Autoriser l'accès Gmail
4. Récupérer l'endpoint MCP personnel
5. Tester dans Dust ou autre client MCP

## 🔧 Configuration Railway (`railway.toml`)

Le fichier `railway.toml` est déjà configuré :

```toml
[build]
builder = "NIXPACKS"

[deploy]
startCommand = "npm run build && npm start"

[env]
NODE_ENV = "production"
```

## 📊 Monitoring et Logs

### Vérifier les logs Railway

```bash
railway logs
```

### Endpoints de monitoring

- Health: `/health`
- Status: `/api/status`
- Logs: Console Railway

## 🛠 Dépannage

### Problème : Variables d'environnement

Si erreur "Variables d'environnement Google OAuth manquantes" :
1. Vérifier dans Railway Dashboard > Variables
2. Redéployer après ajout des variables

### Problème : OAuth Redirect

Si erreur "redirect_uri_mismatch" :
1. Vérifier Google Cloud Console
2. S'assurer que l'URL de callback est correcte
3. Attendre la propagation (5-10 minutes)

### Problème : Port binding

Railway gère automatiquement le port via `process.env.PORT`

## 📋 Checklist de Déploiement

- [ ] Code compilé sans erreurs (`npm run build`)
- [ ] Tests locaux passés
- [ ] Variables d'environnement configurées dans Railway
- [ ] Domaine Railway récupéré
- [ ] OAuth Google mis à jour avec nouvelles URLs
- [ ] Déploiement effectué
- [ ] Health check OK
- [ ] Interface web accessible
- [ ] Test OAuth complet réussi
- [ ] Endpoint MCP fonctionnel

## 🎯 URLs Finales

Une fois déployé, vous aurez :

- **Interface Web**: `https://votre-app-production.up.railway.app`
- **API Health**: `https://votre-app-production.up.railway.app/health`
- **OAuth Callback**: `https://votre-app-production.up.railway.app/oauth/callback`
- **Endpoint MCP**: `https://votre-app-production.up.railway.app/{userId}/gmail/sse`

## 💡 Conseils

1. **Logs** : Surveillez les logs Railway pour détecter les erreurs
2. **OAuth** : Testez avec un compte Gmail de test d'abord
3. **Cache** : Railway met en cache les builds, parfois `railway up --detach` aide
4. **Variables** : Les variables d'environnement sont appliquées au redéploiement

Votre serveur est maintenant prêt pour la production sur Railway ! 🚀
