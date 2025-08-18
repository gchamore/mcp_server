#!/usr/bin/env node

// Script de test local pour le serveur MCP Gmail
const http = require('http');
const https = require('https');

const BASE_URL = 'http://localhost:3000';

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

// Fonction pour faire des requêtes HTTP
function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.request(url, options, (res) => {
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
    
    req.end();
  });
}

// Tests à effectuer
const tests = [
  {
    name: 'Health Check',
    url: `${BASE_URL}/health`,
    method: 'GET'
  },
  {
    name: 'API Status',
    url: `${BASE_URL}/api/status`,
    method: 'GET'
  },
  {
    name: 'Frontend Index',
    url: `${BASE_URL}/`,
    method: 'GET'
  },
  {
    name: 'OAuth Start',
    url: `${BASE_URL}/api/auth/start`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  }
];

// Fonction principale de test
async function runTests() {
  log(colors.blue, '🧪 Démarrage des tests locaux...\n');

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
        
        // Afficher des détails spécifiques pour certains endpoints
        if (test.name === 'API Status' && response.data) {
          try {
            const data = JSON.parse(response.data);
            log(colors.blue, `   📊 Sessions actives: ${data.activeSessions}`);
            log(colors.blue, `   🌐 Base URL: ${data.baseUrl}`);
          } catch (e) {
            // Ignorer les erreurs de parsing
          }
        }
        
        if (test.name === 'OAuth Start' && response.data) {
          try {
            const data = JSON.parse(response.data);
            if (data.success && data.authUrl) {
              log(colors.green, `   🔗 URL OAuth générée avec succès`);
            }
          } catch (e) {
            // Ignorer les erreurs de parsing
          }
        }
        
        passed++;
      } else {
        log(colors.red, `❌ ${test.name} - Status: ${response.status}`);
        if (response.data) {
          log(colors.red, `   Erreur: ${response.data.substring(0, 100)}`);
        }
        failed++;
      }
    } catch (error) {
      log(colors.red, `❌ ${test.name} - Erreur: ${error.message}`);
      failed++;
    }
    
    console.log(''); // Ligne vide pour la lisibilité
  }

  // Résumé
  log(colors.blue, '📋 RÉSUMÉ DES TESTS:');
  log(colors.green, `✅ Tests réussis: ${passed}`);
  log(colors.red, `❌ Tests échoués: ${failed}`);
  
  if (failed === 0) {
    log(colors.green, '\n🎉 Tous les tests sont passés ! Le serveur est prêt pour Railway.');
    log(colors.blue, '\n📝 Prochaines étapes:');
    log(colors.blue, '1. Testez l\'authentification OAuth dans un navigateur');
    log(colors.blue, '2. Vérifiez la console pour les logs');
    log(colors.blue, '3. Déployez sur Railway');
  } else {
    log(colors.red, '\n⚠️  Certains tests ont échoué. Vérifiez les erreurs ci-dessus.');
  }
}

// Vérifier si le serveur est démarré
function checkServer() {
  return makeRequest(`${BASE_URL}/health`)
    .then(() => true)
    .catch(() => false);
}

// Point d'entrée
async function main() {
  const isRunning = await checkServer();
  
  if (!isRunning) {
    log(colors.red, '❌ Le serveur ne semble pas être démarré sur le port 3000');
    log(colors.blue, '💡 Démarrez d\'abord le serveur avec: npm run dev');
    process.exit(1);
  }
  
  await runTests();
}

main().catch(console.error);
