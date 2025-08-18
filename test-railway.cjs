#!/usr/bin/env node

// Script de test post-déploiement Railway
const https = require('https');

// Configuration - Remplacez par votre vraie URL Railway
const RAILWAY_URL = process.argv[2] || 'https://votre-app-production.up.railway.app';

if (RAILWAY_URL.includes('votre-app-production')) {
  console.log('❌ Veuillez fournir l\'URL Railway réelle :');
  console.log('   node test-railway.cjs https://votre-vraie-url.up.railway.app');
  process.exit(1);
}

// Couleurs pour les logs
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

function log(color, message) {
  console.log(`${color}${message}${colors.reset}`);
}

// Fonction pour faire des requêtes HTTPS
function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: data
        });
      });
    });
    
    req.on('error', (err) => {
      reject(err);
    });
    
    if (options.body) {
      req.write(options.body);
    }
    
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
    
    req.end();
  });
}

// Tests à effectuer sur Railway
const tests = [
  {
    name: 'Health Check',
    url: `${RAILWAY_URL}/health`,
    method: 'GET',
    expectedKeys: ['status', 'timestamp', 'baseUrl', 'environment']
  },
  {
    name: 'API Status',
    url: `${RAILWAY_URL}/api/status`,
    method: 'GET',
    expectedKeys: ['status', 'timestamp', 'baseUrl', 'activeSessions', 'version']
  },
  {
    name: 'Frontend Index',
    url: `${RAILWAY_URL}/`,
    method: 'GET',
    contentCheck: 'Gmail MCP Server'
  },
  {
    name: 'OAuth Start',
    url: `${RAILWAY_URL}/api/auth/start`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    expectedKeys: ['success', 'authUrl']
  }
];

// Fonction principale de test
async function runTests() {
  log(colors.blue, `🧪 Tests Railway pour: ${RAILWAY_URL}\n`);

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      log(colors.yellow, `⏳ Test: ${test.name}`);
      
      const options = {
        method: test.method || 'GET',
        headers: test.headers || {}
      };
      
      if (test.body) {
        options.body = test.body;
      }

      const response = await makeRequest(test.url, options);
      
      if (response.status >= 200 && response.status < 400) {
        log(colors.green, `✅ ${test.name} - Status: ${response.status}`);
        
        // Vérifications spécifiques
        if (test.expectedKeys && response.data) {
          try {
            const data = JSON.parse(response.data);
            const missingKeys = test.expectedKeys.filter(key => !(key in data));
            
            if (missingKeys.length === 0) {
              log(colors.green, `   📊 Toutes les clés présentes`);
              
              // Afficher des détails spécifiques
              if (test.name === 'API Status') {
                log(colors.blue, `   🌐 Base URL: ${data.baseUrl}`);
                log(colors.blue, `   📱 Sessions: ${data.activeSessions}`);
                log(colors.blue, `   📦 Version: ${data.version}`);
              }
              
              if (test.name === 'Health Check') {
                log(colors.blue, `   🏥 Environnement: ${data.environment}`);
              }
              
            } else {
              log(colors.red, `   ❌ Clés manquantes: ${missingKeys.join(', ')}`);
            }
          } catch (e) {
            log(colors.yellow, `   ⚠️  Réponse non-JSON valide`);
          }
        }
        
        if (test.contentCheck && response.data) {
          if (response.data.includes(test.contentCheck)) {
            log(colors.green, `   📄 Contenu attendu trouvé`);
          } else {
            log(colors.red, `   ❌ Contenu "${test.contentCheck}" non trouvé`);
          }
        }
        
        if (test.name === 'OAuth Start' && response.data) {
          try {
            const data = JSON.parse(response.data);
            if (data.success && data.authUrl && data.authUrl.includes('accounts.google.com')) {
              log(colors.green, `   🔗 URL OAuth Google valide`);
            } else {
              log(colors.red, `   ❌ URL OAuth invalide`);
            }
          } catch (e) {
            log(colors.red, `   ❌ Erreur parsing OAuth response`);
          }
        }
        
        passed++;
      } else {
        log(colors.red, `❌ ${test.name} - Status: ${response.status}`);
        if (response.data) {
          log(colors.red, `   Erreur: ${response.data.substring(0, 200)}`);
        }
        failed++;
      }
    } catch (error) {
      log(colors.red, `❌ ${test.name} - Erreur: ${error.message}`);
      failed++;
    }
    
    console.log(''); // Ligne vide pour la lisibilité
  }

  // Test supplémentaire : Vérifier SSL
  try {
    log(colors.yellow, `⏳ Test: SSL Certificate`);
    const response = await makeRequest(RAILWAY_URL);
    log(colors.green, `✅ SSL Certificate - Connexion HTTPS réussie`);
    passed++;
  } catch (error) {
    log(colors.red, `❌ SSL Certificate - ${error.message}`);
    failed++;
  }

  console.log('');

  // Résumé
  log(colors.blue, '📋 RÉSUMÉ DES TESTS RAILWAY:');
  log(colors.green, `✅ Tests réussis: ${passed}`);
  log(colors.red, `❌ Tests échoués: ${failed}`);
  
  if (failed === 0) {
    log(colors.green, '\n🎉 Tous les tests Railway sont passés !');
    log(colors.blue, '\n📝 Prochaines étapes:');
    log(colors.blue, '1. Tester l\'OAuth dans un navigateur');
    log(colors.blue, '2. Mettre à jour Google Cloud Console avec les nouvelles URLs');
    log(colors.blue, '3. Tester un cycle complet d\'authentification');
    log(colors.blue, '4. Intégrer avec Dust ou votre client MCP');
    
    log(colors.yellow, '\n🔗 URLs importantes:');
    log(colors.blue, `   Interface: ${RAILWAY_URL}`);
    log(colors.blue, `   Health: ${RAILWAY_URL}/health`);
    log(colors.blue, `   OAuth Callback: ${RAILWAY_URL}/oauth/callback`);
    
  } else {
    log(colors.red, '\n⚠️  Certains tests ont échoué. Vérifiez:');
    log(colors.blue, '1. Les variables d\'environnement dans Railway');
    log(colors.blue, '2. Les logs Railway avec: railway logs');
    log(colors.blue, '3. La configuration du build');
  }
}

// Point d'entrée
async function main() {
  await runTests();
}

main().catch(console.error);
