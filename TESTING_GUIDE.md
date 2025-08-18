# 🧪 Guide de Test - Gmail MCP Server

## ✅ Tests Locaux Réussis

Votre serveur MCP Gmail a passé tous les tests locaux ! Voici un résumé des vérifications effectuées :

### 🔍 Tests Automatiques Passés

- ✅ **Health Check** - Endpoint `/health` répond correctement
- ✅ **API Status** - Endpoint `/api/status` retourne les informations du serveur  
- ✅ **Interface Web** - Page d'accueil se charge correctement
- ✅ **OAuth Start** - Génération d'URL OAuth fonctionnelle
- ✅ **Compilation TypeScript** - Code compile sans erreurs
- ✅ **Configuration** - Tous les fichiers requis présents

## 🚂 Prêt pour Railway

### Configuration Google Cloud Console

Avant de déployer sur Railway, assurez-vous que :

1. **Credentials OAuth créés** dans Google Cloud Console
2. **APIs activées** : Gmail API
3. **URLs de redirection autorisées** configurées :
   - `http://localhost:3000/oauth/callback` (pour les tests locaux)
   - `https://VOTRE-DOMAINE.railway.app/oauth/callback` (à ajouter après déploiement)

### Variables d'Environnement Railway

Configurez ces variables dans Railway :

```
GOOGLE_CLIENT_ID=votre_client_id
GOOGLE_CLIENT_SECRET=votre_client_secret
NODE_ENV=production
```

## 🧪 Tests Post-Déploiement

Après le déploiement sur Railway, testez dans cet ordre :

### 1. Tests de Base

```bash
# Remplacez YOUR_DOMAIN par votre domaine Railway
curl https://YOUR_DOMAIN.railway.app/health
curl https://YOUR_DOMAIN.railway.app/api/status
```

### 2. Test Interface Web

1. Ouvrez `https://YOUR_DOMAIN.railway.app` dans un navigateur
2. Vérifiez que l'interface se charge
3. Cliquez sur "Se connecter avec Google"
4. Vérifiez que l'OAuth fonctionne

### 3. Test Authentification Complète

1. **Authentification OAuth** :
   - Cliquez sur "Se connecter" 
   - Autorisez l'accès à Gmail
   - Vérifiez que vous obtenez un endpoint MCP personnel

2. **Test Endpoint MCP** :
   ```bash
   # Testez l'endpoint SSE (remplacez USER_ID par votre ID utilisateur)
   curl https://YOUR_DOMAIN.railway.app/USER_ID/gmail/sse
   ```

### 4. Test avec DUST AI

1. **Copier l'endpoint MCP** depuis l'interface web
2. **Ajouter dans DUST** :
   - Aller dans DUST AI
   - Ajouter un nouveau connector MCP
   - Coller votre endpoint personnel
   - Tester la connexion

### 5. Test des Fonctionnalités Gmail

Une fois connecté via DUST, testez ces commandes :

```
# Obtenir le profil Gmail
get_profile

# Lister les emails récents
list_emails

# Rechercher des emails
search_emails avec fromEmail: "exemple@gmail.com"

# Envoyer un email (optionnel)
send_email avec to: "test@example.com", subject: "Test", body: "Ceci est un test"
```

## 🐛 Dépannage

### Erreurs Courantes

1. **OAuth Error** :
   - Vérifiez les URLs de redirection dans Google Cloud Console
   - Assurez-vous que les variables d'environnement sont correctes

2. **Session Not Found** :
   - L'utilisateur doit d'abord s'authentifier via l'interface web
   - Chaque utilisateur a un endpoint MCP unique

3. **API Errors** :
   - Vérifiez que Gmail API est activée
   - Vérifiez les permissions OAuth

### Logs Railway

Surveillez les logs Railway pour diagnostiquer les problèmes :

```bash
railway logs
```

## 📊 Monitoring

### Endpoints de Monitoring

- **Health Check** : `GET /health`
- **Status API** : `GET /api/status` 
- **Sessions Actives** : Visible dans `/api/status`

### Métriques Importantes

- Nombre de sessions utilisateur actives
- Erreurs d'authentification OAuth
- Erreurs d'API Gmail
- Temps de réponse des endpoints

## 🔒 Sécurité

### Points de Vigilance

1. **Variables d'environnement** : Ne jamais exposer les secrets dans le code
2. **Sessions utilisateur** : Nettoyage automatique après 24h d'inactivité
3. **Rate Limiting** : Gmail API a des limites, surveillez l'utilisation
4. **HTTPS** : Railway fournit automatiquement HTTPS

## 🎉 Félicitations !

Si tous les tests passent, votre serveur MCP Gmail est prêt pour la production !

**Prochaines étapes** :
1. Déployez sur Railway
2. Configurez les variables d'environnement
3. Mettez à jour Google Cloud Console avec la nouvelle URL
4. Testez avec DUST AI
5. Partagez votre endpoint avec les utilisateurs

---

**Need help?** Consultez la documentation Railway et les logs pour diagnostiquer les problèmes.
