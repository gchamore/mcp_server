#!/usr/bin/env node

// Test pré-déploiement Railway
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

// Vérifications pré-déploiement
function preDeploymentChecks() {
  log(colors.blue, '🚂 VÉRIFICATIONS PRÉ-DÉPLOIEMENT RAILWAY\n');

  const fs = require('fs');
  const path = require('path');

  let allGood = true;

  // 1. Vérifier les fichiers essentiels
  const requiredFiles = [
    'package.json',
    'railway.toml',
    'tsconfig.json',
    'src/server.ts',
    'public/index.html',
    '.env'
  ];

  log(colors.yellow, '📁 Vérification des fichiers requis:');
  for (const file of requiredFiles) {
    if (fs.existsSync(file)) {
      log(colors.green, `✅ ${file}`);
    } else {
      log(colors.red, `❌ ${file} manquant`);
      allGood = false;
    }
  }

  // 2. Vérifier package.json
  log(colors.yellow, '\n📦 Vérification package.json:');
  try {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    
    if (pkg.type === 'module') {
      log(colors.green, '✅ Type: module configuré');
    } else {
      log(colors.red, '❌ Type module manquant');
      allGood = false;
    }

    if (pkg.scripts && pkg.scripts.start && pkg.scripts.build) {
      log(colors.green, '✅ Scripts start et build définis');
    } else {
      log(colors.red, '❌ Scripts start ou build manquants');
      allGood = false;
    }

    // Vérifier les dépendances importantes
    const requiredDeps = [
      '@modelcontextprotocol/sdk',
      'express',
      'googleapis',
      'google-auth-library',
      'dotenv'
    ];

    for (const dep of requiredDeps) {
      if (pkg.dependencies && pkg.dependencies[dep]) {
        log(colors.green, `✅ Dépendance: ${dep}`);
      } else {
        log(colors.red, `❌ Dépendance manquante: ${dep}`);
        allGood = false;
      }
    }

  } catch (error) {
    log(colors.red, '❌ Erreur lecture package.json');
    allGood = false;
  }

  // 3. Vérifier railway.toml
  log(colors.yellow, '\n🚂 Vérification railway.toml:');
  try {
    const railway = fs.readFileSync('railway.toml', 'utf8');
    if (railway.includes('startCommand')) {
      log(colors.green, '✅ startCommand défini dans railway.toml');
    } else {
      log(colors.red, '❌ startCommand manquant dans railway.toml');
      allGood = false;
    }

    if (railway.includes('NODE_ENV')) {
      log(colors.green, '✅ NODE_ENV configuré');
    }
  } catch (error) {
    log(colors.red, '❌ Erreur lecture railway.toml');
    allGood = false;
  }

  // 4. Vérifier les variables d'environnement
  log(colors.yellow, '\n🔐 Vérification variables d\'environnement:');
  try {
    const env = fs.readFileSync('.env', 'utf8');
    if (env.includes('GOOGLE_CLIENT_ID') && env.includes('GOOGLE_CLIENT_SECRET')) {
      log(colors.green, '✅ Credentials Google OAuth configurés localement');
      log(colors.blue, '   💡 N\'oubliez pas de configurer ces variables dans Railway');
    } else {
      log(colors.red, '❌ Variables Google OAuth manquantes dans .env');
      allGood = false;
    }
  } catch (error) {
    log(colors.red, '❌ Fichier .env manquant');
    allGood = false;
  }

  // 5. Test de compilation
  log(colors.yellow, '\n🔨 Test de compilation TypeScript:');
  try {
    const { execSync } = require('child_process');
    execSync('npm run build', { stdio: 'pipe' });
    log(colors.green, '✅ Compilation TypeScript réussie');
    
    // Vérifier que les fichiers compilés existent
    if (fs.existsSync('dist/src/server.js')) {
      log(colors.green, '✅ Fichier server.js compilé présent');
    } else {
      log(colors.red, '❌ Fichier server.js compilé manquant');
      allGood = false;
    }
  } catch (error) {
    log(colors.red, '❌ Erreur de compilation TypeScript');
    console.error(error.toString());
    allGood = false;
  }

  // Résumé final
  log(colors.blue, '\n📋 RÉSUMÉ PRÉ-DÉPLOIEMENT:');
  if (allGood) {
    log(colors.green, '🎉 Toutes les vérifications sont passées !');
    log(colors.blue, '\n🚀 ÉTAPES SUIVANTES POUR RAILWAY:');
    log(colors.blue, '1. Connectez votre repo GitHub à Railway');
    log(colors.blue, '2. Configurez les variables d\'environnement:');
    log(colors.blue, '   - GOOGLE_CLIENT_ID');
    log(colors.blue, '   - GOOGLE_CLIENT_SECRET');
    log(colors.blue, '3. Déployez !');
    log(colors.blue, '\n🔧 Commandes Railway utiles:');
    log(colors.blue, '   railway login');
    log(colors.blue, '   railway deploy');
    log(colors.blue, '   railway open');
  } else {
    log(colors.red, '⚠️  Certaines vérifications ont échoué.');
    log(colors.red, 'Corrigez les erreurs ci-dessus avant de déployer.');
  }

  return allGood;
}

// Checklist déploiement Railway
function railwayDeploymentChecklist() {
  log(colors.blue, '\n📋 CHECKLIST DÉPLOIEMENT RAILWAY:\n');
  
  const checklist = [
    '□ Code pushé sur GitHub',
    '□ Projet Railway créé et connecté au repo',
    '□ Variables d\'environnement configurées dans Railway:',
    '  □ GOOGLE_CLIENT_ID',
    '  □ GOOGLE_CLIENT_SECRET',
    '□ Console Google Cloud configurée:',
    '  □ Credentials OAuth créés',
    '  □ URLs de redirection autorisées: https://votredomaine.railway.app/oauth/callback',
    '□ Test du déploiement',
    '□ Test de l\'authentification OAuth',
    '□ Test des endpoints MCP'
  ];

  checklist.forEach(item => {
    log(colors.blue, item);
  });

  log(colors.yellow, '\n⚠️  IMPORTANT: Mettez à jour les URLs OAuth dans Google Cloud Console');
  log(colors.yellow, 'avec votre domaine Railway après le déploiement !');
}

// Point d'entrée
function main() {
  const isReady = preDeploymentChecks();
  railwayDeploymentChecklist();
  
  process.exit(isReady ? 0 : 1);
}

main();
