# Multi-Service MCP Server

## 🎯 Vue d'ensemble

Ce serveur MCP (Model Context Protocol) a été refactorisé pour supporter plusieurs services de manière modulaire et extensible. Il conserve une compatibilité totale avec l'ancienne version Gmail tout en permettant l'ajout facile de nouveaux services.

## 🏗️ Architecture

```
src/
├── server.ts                 # Serveur principal refactorisé
├── server_old.ts             # Ancienne version sauvegardée
├── core/                     # Composants centraux
│   ├── BaseService.ts        # Interface de base pour tous les services
│   ├── MultiTenantManager.ts # Gestionnaire multi-tenant
│   └── ServiceRegistry.ts    # Registre centralisé des services
├── services/                 # Services modulaires
│   └── gmail/
│       └── GmailService.ts   # Service Gmail extrait
├── types/
│   └── index.ts              # Types TypeScript communs
└── public/
    └── index.html            # Interface web mise à jour
```

## ✨ Fonctionnalités

### Services Actuels
- **Gmail** : Lecture, envoi, recherche d'emails via Google Gmail API

### Services Prêts à Ajouter
- **Outlook** : Microsoft Graph API
- **Notion** : Notion API  
- **Axonaut** : API Axonaut
- **Autres** : Architecture extensible

### Endpoints

#### MCP (Model Context Protocol)
- `GET /:userId/mcp/sse` - Endpoint MCP unifié pour tous les services
- `POST /:userId/mcp/message` - Traitement des messages MCP

#### API de Gestion
- `GET /api/services` - Liste des services disponibles
- `GET /api/users/:userId/services` - Services connectés d'un utilisateur
- `GET /api/status` - Statut détaillé du serveur

#### OAuth & Auth
- `POST /api/auth/start` - Démarrer l'authentification OAuth
- `GET /oauth/callback` - Callback OAuth

#### Compatibilité
- `GET /:userId/gmail/sse` → Redirige vers `/:userId/mcp/sse`

## 🛠️ Outils Gmail Disponibles

| Outil | Description |
|-------|-------------|
| `gmail_get_profile` | Obtenir le profil Gmail de l'utilisateur |
| `gmail_list_emails` | Lister les emails avec filtres optionnels |
| `gmail_send_email` | Envoyer un email |
| `gmail_search_emails` | Recherche avancée d'emails |
| `gmail_get_email_content` | Obtenir le contenu complet d'un email |

## 🚀 Démarrage Rapide

### Installation
```bash
npm install
```

### Configuration
Créez un fichier `.env` :
```bash
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
BASE_URL=http://localhost:3000
```

### Développement
```bash
npm run dev          # Mode développement avec watch
npm run build        # Build de production
npm start           # Démarrer le serveur
```

### Test
```bash
node test-refactored-server.cjs  # Tests complets
```

## 🔧 Ajouter un Nouveau Service

### 1. Créer le Service

Créez `src/services/[service]/[Service]Service.ts` :

```typescript
import { BaseService } from "../../core/BaseService.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export class NewService extends BaseService {
  public readonly serviceName = 'new-service';
  public readonly displayName = 'New Service';
  public readonly requiredScopes = ['scope1', 'scope2'];

  constructor(clientId: string, clientSecret: string, baseUrl: string) {
    super({
      clientId,
      clientSecret,
      redirectUri: `${baseUrl}/oauth/callback`,
      scopes: ['scope1', 'scope2']
    });
  }

  isConfigured(): boolean {
    return this.validateOAuthConfig();
  }

  createAuthUrl(): string {
    // Implémenter la création d'URL OAuth
  }

  async handleCallback(code: string): Promise<AuthResult> {
    // Implémenter le traitement du callback OAuth
  }

  registerTools(server: McpServer, userSession: any): void {
    // Enregistrer les outils MCP pour ce service
    server.tool("new_service_tool", "Description", {}, async () => {
      // Logique de l'outil
    });
  }

  async refreshTokens(session: any): Promise<boolean> {
    // Implémenter le refresh des tokens
  }
}
```

### 2. Ajouter les Types

Dans `src/types/index.ts`, ajoutez :
```typescript
export interface NewServiceSession extends BaseServiceSession {
  serviceName: 'new-service';
  // Propriétés spécifiques au service
}

// Mettre à jour UserSession
export interface UserSession {
  userId: string;
  createdAt: Date;
  lastAccessed: Date;
  services: {
    gmail?: GmailSession;
    newService?: NewServiceSession; // Ajouter ici
  };
}
```

### 3. Enregistrer le Service

Dans `src/server.ts` :
```typescript
import { NewService } from "./services/new-service/NewService.js";

// Initialiser le service
const newService = new NewService(
  process.env.NEW_SERVICE_CLIENT_ID!,
  process.env.NEW_SERVICE_CLIENT_SECRET!,
  BASE_URL
);

// Enregistrer le service
serviceRegistry.registerService(newService);
```

### 4. Variables d'Environnement

Ajoutez dans `.env` :
```bash
NEW_SERVICE_CLIENT_ID=your_client_id
NEW_SERVICE_CLIENT_SECRET=your_client_secret
```

## 📡 Format des Réponses

Toutes les réponses incluent maintenant le champ `service` pour identifier l'origine :

```json
{
  "success": true,
  "service": "gmail",
  "user": "user@example.com",
  "data": { ... }
}
```

## 🔄 Migration depuis l'Ancienne Version

### Compatibilité Totale
- Tous les endpoints existants fonctionnent
- Les redirections automatiques sont en place
- Même configuration OAuth

### Nouveaux Endpoints Recommandés
- Utilisez `/:userId/mcp/sse` au lieu de `/:userId/gmail/sse`
- Les outils sont maintenant préfixés : `gmail_list_emails` au lieu de `list_emails`

## 🧪 Tests

Le projet inclut des tests automatisés :

```bash
# Test complet du serveur
node test-refactored-server.cjs

# Validation pre-déploiement
node validate-deployment.cjs

# Check pre-Railway
node pre-deploy-check.cjs
```

## 🚂 Déploiement Railway

Le serveur est entièrement compatible Railway :

```bash
# Build pour production
npm run build

# Variables d'environnement à configurer dans Railway
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
NODE_ENV=production
```

## 📊 Monitoring

### API Status
```bash
curl http://localhost:3000/api/status
```

Retourne :
```json
{
  "status": "OK",
  "version": "2.0.0",
  "architecture": "multi-services",
  "users": {
    "totalUsers": 0,
    "activeMcpSessions": 0,
    "serviceStats": { "gmail": 0 }
  },
  "services": {
    "total": 1,
    "enabled": 1,
    "services": [{"name": "gmail", "displayName": "Gmail", "isEnabled": true}]
  }
}
```

## 🎯 Prochaines Étapes

1. **Outlook Service** : Intégration Microsoft Graph API
2. **Notion Service** : API Notion pour gestion de documents
3. **Axonaut Service** : CRM et facturation
4. **Interface Admin** : Dashboard de gestion des services
5. **Webhooks** : Notifications en temps réel

## 🤝 Contribution

Pour ajouter un nouveau service :
1. Suivez le template ci-dessus
2. Testez avec `test-refactored-server.cjs`
3. Documentez les nouveaux outils
4. Mettez à jour ce README

## 📝 License

MIT License
