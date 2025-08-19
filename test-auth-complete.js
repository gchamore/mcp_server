#!/usr/bin/env node

// Test d'authentification complète via notre serveur MCP
const fetch = require('node-fetch');

const apiKey = '595664367051943950c90bf785b9336c49c9159566';
const serverUrl = 'http://localhost:3000';

async function testAuthAxonaut() {
  console.log('🧪 Test d\'authentification Axonaut via notre serveur MCP...');
  
  try {
    // Créer un ID utilisateur unique
    const userId = 'test-user-' + Date.now();
    
    const response = await fetch(`${serverUrl}/api/axonaut/auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        userId: userId,
        baseUrl: 'https://axonaut.com',
        apiKey: apiKey,
        userEmail: 'test@example.com'
      })
    });
    
    const result = await response.json();
    
    console.log(`📊 Status: ${response.status} ${response.statusText}`);
    console.log(`📄 Réponse:`, JSON.stringify(result, null, 2));
    
    if (result.success) {
      console.log(`✅ Authentification réussie !`);
      console.log(`🔗 URL MCP: ${serverUrl}/${userId}/mcp/sse`);
      
      // Test de déconnexion
      console.log('\n🔌 Test de déconnexion...');
      const disconnectResponse = await fetch(`${serverUrl}/api/disconnect/${userId}/axonaut`, {
        method: 'POST'
      });
      
      const disconnectResult = await disconnectResponse.json();
      console.log(`📊 Déconnexion: ${disconnectResponse.status} ${disconnectResponse.statusText}`);
      console.log(`📄 Réponse:`, JSON.stringify(disconnectResult, null, 2));
      
    } else {
      console.log(`❌ Authentification échouée: ${result.error}`);
    }
    
  } catch (error) {
    console.error('❌ Erreur:', error.message);
  }
}

testAuthAxonaut();
