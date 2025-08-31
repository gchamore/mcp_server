#!/bin/bash

# Script de build optimisé pour Railway
echo "🏗️  Démarrage du build optimisé..."

# Augmenter la limite de mémoire pour Node.js
export NODE_OPTIONS="--max-old-space-size=1024"


# Nettoyer le dossier dist s'il existe
if [ -d "dist" ]; then
    echo "🧹 Nettoyage du dossier dist existant..."
    rm -rf dist
fi

# Créer le dossier dist
mkdir -p dist

echo "📦 Compilation TypeScript avec options optimisées..."

# Compiler avec options optimisées
npx tsc \
    --incremental false \
    --declaration false \
    --sourceMap false \
    --removeComments true \
    --skipLibCheck true

if [ $? -ne 0 ]; then
    echo "❌ Erreur lors du build TypeScript"
    exit 1
fi

# Vérifier que le fichier principal compilé existe
if [ -f "dist/server.js" ]; then
    echo "✅ Fichier dist/server.js généré ($(du -h dist/server.js | cut -f1))"
else
    echo "❌ Fichier dist/server.js manquant"
    echo "Vérifiez que l'entrée 'main' dans package.json et 'outDir' dans tsconfig.json sont cohérents."
    exit 1
fi

# Copier les fichiers statiques
if [ -d "public" ]; then
    cp -r public dist/
    echo "✅ Fichiers publics copiés vers dist/"
else
    echo "⚠️  Dossier public/ introuvable, rien à copier."
fi

echo "🎉 Build terminé avec succès !"
