#!/usr/bin/env node

// Test direct de l'API Axonaut
const apiKey = '595664367051943950c90bf785b9336c49c9159566';
const baseUrl = 'https://axonaut.com';

async function testAxonautAPI() {
  console.log('🧪 Test direct de l\'API Axonaut...');
  console.log(`🔑 Clé API: ${apiKey.substring(0, 10)}...`);
  console.log(`🌐 URL: ${baseUrl}`);
  
  try {
    // Test de l'endpoint contacts
    console.log('\n📋 Test endpoint /api/v2/contacts...');
    const response = await fetch(`${baseUrl}/api/v2/contacts?limit=1`, {
      headers: {
        'userApiKey': apiKey,
        'Accept': 'application/json'
      }
    });
    
    console.log(`📊 Status: ${response.status} ${response.statusText}`);
    console.log(`📄 Headers:`, Object.fromEntries(response.headers.entries()));
    
    if (!response.ok) {
      const errorText = await response.text();
      console.log(`❌ Erreur: ${errorText}`);
      return false;
    }
    
    const data = await response.json();
    console.log(`✅ Succès! Données reçues:`, JSON.stringify(data, null, 2));
    return true;
    
  } catch (error) {
    console.error('❌ Erreur réseau:', error.message);
    return false;
  }
}

// Test de différents endpoints
async function testMultipleEndpoints() {
  const endpoints = [
    '/api/v2/contacts?limit=1',
    '/api/v2/invoices?limit=1',
    '/api/v2/account'
  ];
  
  for (const endpoint of endpoints) {
    console.log(`\n🔍 Test ${endpoint}...`);
    try {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        headers: {
          'userApiKey': apiKey,
          'Accept': 'application/json'
        }
      });
      
      console.log(`📊 ${endpoint}: ${response.status} ${response.statusText}`);
      
      if (response.ok) {
        const data = await response.json();
        console.log(`✅ Succès: ${JSON.stringify(data).substring(0, 200)}...`);
      } else {
        const errorText = await response.text();
        console.log(`❌ Erreur: ${errorText.substring(0, 200)}`);
      }
    } catch (error) {
      console.log(`❌ Erreur réseau: ${error.message}`);
    }
  }
}

// Exécution des tests
(async () => {
  console.log('🚀 Démarrage des tests API Axonaut\n');
  
  const basicTest = await testAxonautAPI();
  
  if (basicTest) {
    console.log('\n🔍 Tests des endpoints multiples...');
    await testMultipleEndpoints();
  }
  
  console.log('\n🏁 Tests terminés');
})();
