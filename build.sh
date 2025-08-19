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

if [ $? -eq 0 ]; then
    echo "✅ Build réussi !"
    
    # Vérifier que les fichiers sont bien générés
    if [ -f "dist/src/server.js" ]; then
        echo "✅ Fichier server.js généré ($(du -h dist/src/server.js | cut -f1))"
    else
        echo "❌ Fichier server.js manquant"
        exit 1
    fi
    
    # Copier les fichiers statiques
    if [ -d "public" ]; then
        cp -r public dist/
        echo "✅ Fichiers publics copiés vers dist/"
    fi
    
    echo "🎉 Build terminé avec succès !"
else
    echo "❌ Erreur lors du build"
    exit 1
fi
