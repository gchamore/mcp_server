#!/usr/bin/env node

// Script de validation pré-déploiement
const fs = require('fs');
const path = require('path');

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

function checkFile(filePath, description) {
  if (fs.existsSync(filePath)) {
    log(colors.green, `✅ ${description}: ${filePath}`);
    return true;
  } else {
    log(colors.red, `❌ ${description}: ${filePath} - MANQUANT`);
    return false;
  }
}

function checkPackageJson() {
  try {
    const packagePath = './package.json';
    if (!fs.existsSync(packagePath)) {
      log(colors.red, '❌ package.json manquant');
      return false;
    }

    const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    
    log(colors.yellow, '\n📦 Vérification package.json:');
    
    // Vérifier les scripts
    const requiredScripts = ['start', 'build', 'dev'];
    let scriptsOk = true;
    
    for (const script of requiredScripts) {
      if (pkg.scripts && pkg.scripts[script]) {
        log(colors.green, `✅ Script "${script}": ${pkg.scripts[script]}`);
      } else {
        log(colors.red, `❌ Script "${script}" manquant`);
        scriptsOk = false;
      }
    }
    
    // Vérifier les dépendances critiques
    const requiredDeps = [
      '@modelcontextprotocol/sdk',
      'express',
      'googleapis',
      'google-auth-library',
      'uuid',
      'zod',
      'dotenv'
    ];
    
    let depsOk = true;
    for (const dep of requiredDeps) {
      if (pkg.dependencies && pkg.dependencies[dep]) {
        log(colors.green, `✅ Dépendance "${dep}": ${pkg.dependencies[dep]}`);
      } else {
        log(colors.red, `❌ Dépendance "${dep}" manquante`);
        depsOk = false;
      }
    }
    
    return scriptsOk && depsOk;
    
  } catch (error) {
    log(colors.red, `❌ Erreur lecture package.json: ${error.message}`);
    return false;
  }
}

function checkEnvFile() {
  try {
    const envPath = './.env';
    if (!fs.existsSync(envPath)) {
      log(colors.yellow, '⚠️  Fichier .env manquant (OK pour Railway, variables via Dashboard)');
      return true;
    }

    const envContent = fs.readFileSync(envPath, 'utf8');
    
    log(colors.yellow, '\n🔐 Vérification .env:');
    
    const requiredVars = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];
    let envOk = true;
    
    for (const varName of requiredVars) {
      if (envContent.includes(varName)) {
        const line = envContent.split('\n').find(l => l.startsWith(varName));
        const value = line ? line.split('=')[1] : '';
        if (value && value.length > 10) {
          log(colors.green, `✅ ${varName}: ${value.substring(0, 20)}...`);
        } else {
          log(colors.red, `❌ ${varName}: valeur vide ou trop courte`);
          envOk = false;
        }
      } else {
        log(colors.red, `❌ ${varName}: non trouvé dans .env`);
        envOk = false;
      }
    }
    
    return envOk;
    
  } catch (error) {
    log(colors.red, `❌ Erreur lecture .env: ${error.message}`);
    return false;
  }
}

function checkTypeScriptConfig() {
  try {
    const tsconfigPath = './tsconfig.json';
    if (!fs.existsSync(tsconfigPath)) {
      log(colors.red, '❌ tsconfig.json manquant');
      return false;
    }

    const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8'));
    
    log(colors.yellow, '\n🔧 Vérification TypeScript:');
    
    if (tsconfig.compilerOptions) {
      const opts = tsconfig.compilerOptions;
      
      // Vérifications importantes pour Railway
      const checks = [
        { key: 'target', expected: 'ES2022', current: opts.target },
        { key: 'module', expected: 'ESNext', current: opts.module },
        { key: 'outDir', expected: './dist', current: opts.outDir }
      ];
      
      let configOk = true;
      for (const check of checks) {
        if (check.current === check.expected) {
          log(colors.green, `✅ ${check.key}: ${check.current}`);
        } else {
          log(colors.yellow, `⚠️  ${check.key}: ${check.current} (recommandé: ${check.expected})`);
        }
      }
      
      return configOk;
    }
    
    return false;
    
  } catch (error) {
    log(colors.red, `❌ Erreur lecture tsconfig.json: ${error.message}`);
    return false;
  }
}

function checkBuildOutput() {
  log(colors.yellow, '\n🏗️  Vérification build:');
  
  const distPath = './dist';
  if (!fs.existsSync(distPath)) {
    log(colors.red, '❌ Dossier dist/ manquant - Lancez "npm run build"');
    return false;
  }
  
  const serverJs = './dist/src/server.js';
  if (!fs.existsSync(serverJs)) {
    log(colors.red, '❌ dist/src/server.js manquant - Lancez "npm run build"');
    return false;
  }
  
  log(colors.green, '✅ Build présent: dist/src/server.js');
  
  // Vérifier la taille du fichier
  const stats = fs.statSync(serverJs);
  const fileSizeKB = Math.round(stats.size / 1024);
  
  if (fileSizeKB > 10) {
    log(colors.green, `✅ Taille du build: ${fileSizeKB}KB`);
    return true;
  } else {
    log(colors.red, `❌ Build trop petit: ${fileSizeKB}KB - Possible erreur de compilation`);
    return false;
  }
}

async function main() {
  log(colors.blue, '🔍 VALIDATION PRE-DEPLOIEMENT RAILWAY\n');
  
  const checks = [
    () => checkFile('./src/server.ts', 'Fichier source TypeScript'),
    () => checkFile('./public/index.html', 'Interface frontend'),
    () => checkFile('./railway.toml', 'Configuration Railway'),
    () => checkPackageJson(),
    () => checkEnvFile(),
    () => checkTypeScriptConfig(),
    () => checkBuildOutput()
  ];
  
  let allPassed = true;
  
  for (const check of checks) {
    const result = check();
    if (!result) {
      allPassed = false;
    }
    console.log('');
  }
  
  // Résumé final
  log(colors.blue, '📋 RÉSUMÉ DE VALIDATION:');
  
  if (allPassed) {
    log(colors.green, '🎉 Tous les checks sont passés !');
    log(colors.blue, '\n🚀 Votre projet est prêt pour Railway:');
    log(colors.blue, '1. Committez vos changements: git add . && git commit -m "Ready for Railway"');
    log(colors.blue, '2. Connectez à Railway: railway login && railway link');
    log(colors.blue, '3. Configurez les variables d\'environnement dans Railway Dashboard');
    log(colors.blue, '4. Déployez: railway up');
    log(colors.blue, '5. Testez avec: node test-railway.cjs <votre-url-railway>');
    
  } else {
    log(colors.red, '⚠️  Certains checks ont échoué');
    log(colors.blue, '\n🔧 Actions recommandées:');
    log(colors.blue, '1. Corrigez les erreurs ci-dessus');
    log(colors.blue, '2. Lancez "npm run build" si nécessaire');
    log(colors.blue, '3. Relancez cette validation');
  }
  
  log(colors.yellow, '\n💡 Rappel: Configurez les variables d\'environnement dans Railway Dashboard');
  log(colors.yellow, '   GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET');
}

main().catch(console.error);
