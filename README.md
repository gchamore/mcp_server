# Gmail MCP Server - Multi-Tenant SaaS

Un serveur MCP (Model Context Protocol) pour Gmail qui permet une intégration multi-utilisateur avec OAuth 2.0. Chaque utilisateur obtient son propre endpoint MCP personnel après authentification.

## 🚀 Fonctionnalités

- **Multi-tenant** : Chaque utilisateur a son propre endpoint MCP
- **OAuth 2.0** : Authentification sécurisée via Google
- **Interface Web** : Dashboard pour l'authentification
- **5 Outils MCP** :
  - `get_profile` : Obtenir le profil Gmail
  - `list_emails` : Lister les emails
  - `search_emails` : Recherche avancée
  - `send_email` : Envoyer des emails
  - `get_email_content` : Obtenir le contenu complet d'un email

## 📦 Installation

```bash
# Cloner le projet
git clone <votre-repo>
cd mcp_server

# Installer les dépendances
npm install

# Configurer les variables d'environnement
cp .env.example .env
# Éditer .env avec vos clés Google OAuth
```

## ⚙️ Configuration

### 1. Google Cloud Console

1. Créer un projet sur [Google Cloud Console](https://console.cloud.google.com/)
2. Activer l'API Gmail
3. Créer des identifiants OAuth 2.0
4. Configurer les URLs autorisées :
   - **Local** : `http://localhost:3000/oauth/callback`
   - **Production** : `https://votre-domaine.com/oauth/callback`

### 2. Variables d'environnement

```env
GOOGLE_CLIENT_ID=votre-client-id
GOOGLE_CLIENT_SECRET=votre-client-secret
```

## 🛠 Développement

```bash
# Développement avec rechargement automatique
npm run dev

# Tests locaux
npm test

# Validation pré-déploiement
npm run validate

# Build pour production
npm run build

# Démarrage production
npm start
```

## 🧪 Tests

### Tests Locaux
```bash
npm test
```

### Tests Railway (après déploiement)
```bash
npm run test:railway https://votre-app.up.railway.app
```

### Validation Pré-déploiement
```bash
npm run validate
```

## 🚀 Déploiement Railway

### 1. Préparation
```bash
npm run validate  # Vérifier que tout est prêt
```

### 2. Déploiement
```bash
# Installation Railway CLI
npm install -g @railway/cli

# Login et déploiement
railway login
railway link
railway up
```

### 3. Configuration Post-déploiement

1. **Variables d'environnement dans Railway Dashboard** :
   ```
   NODE_ENV=production
   GOOGLE_CLIENT_ID=votre-client-id
   GOOGLE_CLIENT_SECRET=votre-client-secret
   ```

2. **Mettre à jour Google OAuth** avec l'URL Railway :
   ```
   https://votre-app.up.railway.app/oauth/callback
   ```

3. **Tester le déploiement** :
   ```bash
   npm run test:railway https://votre-app.up.railway.app
   ```

## 📡 Utilisation

### 1. Authentification

1. Aller sur l'interface web : `https://votre-app.up.railway.app`
2. Cliquer "Se connecter avec Google"
3. Autoriser l'accès Gmail
4. Récupérer l'endpoint MCP personnel

### 2. Intégration MCP

L'endpoint MCP personnel a le format :
```
https://votre-app.up.railway.app/{userId}/gmail/sse
```

### 3. Outils disponibles

```typescript
// Obtenir le profil Gmail
await mcp.call("get_profile", {});

// Lister les emails
await mcp.call("list_emails", { 
  query: "is:unread", 
  maxResults: 10 
});

// Recherche avancée
await mcp.call("search_emails", {
  fromEmail: "example@gmail.com",
  subjectContains: "urgent",
  isUnread: true,
  maxResults: 5
});

// Envoyer un email
await mcp.call("send_email", {
  to: "destinataire@example.com",
  subject: "Test",
  body: "Contenu de l'email"
});

// Obtenir le contenu d'un email
await mcp.call("get_email_content", {
  messageId: "message-id-gmail"
});
```

## 🔧 Architecture

```
src/
├── server.ts           # Serveur principal
public/
├── index.html          # Interface web OAuth
dist/                   # Code compilé
├── src/
    └── server.js
```

### Composants principaux

1. **MultiTenantGmailManager** : Gestion des sessions utilisateurs
2. **Express Server** : API REST et interface web
3. **MCP Server** : Endpoints MCP par utilisateur
4. **OAuth Flow** : Authentification Google

## 📊 Monitoring

### Endpoints de santé
- `/health` : Health check
- `/api/status` : Statut détaillé avec nombre de sessions

### Logs
```bash
# Logs Railway
railway logs

# Logs locaux
npm run dev  # Affiche les logs en temps réel
```

## 🔒 Sécurité

- **OAuth 2.0** : Authentification sécurisée Google
- **Session isolation** : Chaque utilisateur a sa propre session isolée
- **Token management** : Gestion automatique des tokens d'accès
- **HTTPS** : Communication chiffrée en production

## 🛠 Dépannage

### Variables d'environnement manquantes
```bash
❌ Variables d'environnement Google OAuth manquantes
```
**Solution** : Vérifier les variables dans Railway Dashboard ou .env local

### OAuth redirect_uri_mismatch
```bash
❌ Erreur OAuth: redirect_uri_mismatch
```
**Solution** : Mettre à jour les URLs autorisées dans Google Cloud Console

### Port déjà utilisé (local)
```bash
❌ EADDRINUSE: address already in use :::3000
```
**Solution** : 
```bash
# Tuer les processus Node.js
pkill -f node
# Ou changer le port
PORT=3001 npm run dev
```

## 📋 Checklist de Déploiement

- [ ] Tests locaux passés (`npm test`)
- [ ] Validation passée (`npm run validate`)
- [ ] Variables configurées dans Railway
- [ ] Google OAuth mis à jour
- [ ] Déploiement effectué (`railway up`)
- [ ] Tests Railway passés (`npm run test:railway`)
- [ ] Test OAuth complet dans le navigateur

## 🤝 Contribution

1. Fork le projet
2. Créer une branche feature (`git checkout -b feature/amazing-feature`)
3. Commit les changements (`git commit -m 'Add amazing feature'`)
4. Push vers la branche (`git push origin feature/amazing-feature`)
5. Ouvrir une Pull Request

## 📄 Licence

MIT License - voir le fichier [LICENSE](LICENSE) pour les détails.

## 🔗 Liens Utiles

- [Documentation MCP](https://modelcontextprotocol.io/)
- [Railway Documentation](https://docs.railway.app/)
- [Google OAuth 2.0](https://developers.google.com/identity/protocols/oauth2)
- [Gmail API](https://developers.google.com/gmail/api)

---

**Note** : Ce serveur est conçu pour être déployé sur Railway, mais peut être adapté pour d'autres plateformes (Vercel, Heroku, etc.) avec des modifications mineures.
