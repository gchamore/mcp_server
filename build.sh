#!/bin/bash

# Script de build optimisé pour Railway
echo "🏗️  Démarrage du build optimisé..."

# Augmenter la limite de mémoire pour Node.js
export NODE_OPTIONS="--max-old-space-size=1024"

# Vérifier et installer les dépendances si nécessaire
if [ ! -d "node_modules" ] || [ ! -f "node_modules/ioredis/package.json" ]; then
    echo "📦 Installation des dépendances manquantes..."
    npm install
    if [ $? -ne 0 ]; then
        echo "❌ Erreur lors de l'installation des dépendances"
        exit 1
    fi
fi

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
        
        # Convertir les liens symboliques en vrais fichiers pour Railway
        echo "🔗 Conversion des liens symboliques pour Railway..."
        cd dist/public/pages/
        
        # Si axonaut.html est un lien symbolique, le remplacer par le vrai fichier
        if [ -L "axonaut.html" ]; then
            cp coming-soon.html axonaut.html.tmp && mv axonaut.html.tmp axonaut.html
            echo "   ✅ axonaut.html converti"
        fi
        
        # Si notion.html est un lien symbolique, le remplacer par le vrai fichier
        if [ -L "notion.html" ]; then
            cp coming-soon.html notion.html.tmp && mv notion.html.tmp notion.html
            echo "   ✅ notion.html converti"
        fi
        
        # Si outlook.html est un lien symbolique, le remplacer par le vrai fichier
        if [ -L "outlook.html" ]; then
            cp coming-soon.html outlook.html.tmp && mv outlook.html.tmp outlook.html
            echo "   ✅ outlook.html converti"
        fi
        
        cd ../../..
    fi
    
    echo "🎉 Build terminé avec succès !"
else
    echo "❌ Erreur lors du build"
    exit 1
fi
