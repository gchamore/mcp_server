#!/usr/bin/env node

// Test des différentes versions de l'API Axonaut
const apiKey = '595664367051943950c90bf785b9336c49c9159566';
const baseUrl = 'https://axonaut.com';

async function testEndpoint(endpoint, description) {
  console.log(`\n🔍 Test ${description}: ${endpoint}`);
  try {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      headers: {
        'userApiKey': apiKey,
        'Accept': 'application/json'
      }
    });
    
    console.log(`📊 Status: ${response.status} ${response.statusText}`);
    
    if (response.ok) {
      const data = await response.json();
      console.log(`✅ Succès: ${JSON.stringify(data, null, 2).substring(0, 300)}...`);
      return true;
    } else {
      const errorText = await response.text();
      console.log(`❌ Erreur: ${errorText.substring(0, 200)}`);
      return false;
    }
  } catch (error) {
    console.log(`❌ Erreur réseau: ${error.message}`);
    return false;
  }
}

// Test de différentes versions et endpoints possibles
(async () => {
  console.log('🚀 Test de découverte de l\'API Axonaut\n');
  
  const endpoints = [
    // API v1
    ['/api/v1/contacts', 'API v1 contacts'],
    ['/api/v1/customers', 'API v1 customers'],
    ['/api/v1/invoices', 'API v1 invoices'],
    ['/api/v1/account', 'API v1 account'],
    ['/api/v1/user', 'API v1 user'],
    
    // API v2
    ['/api/v2/contacts', 'API v2 contacts'],
    ['/api/v2/customers', 'API v2 customers'],
    ['/api/v2/invoices', 'API v2 invoices'],
    ['/api/v2/account', 'API v2 account'],
    ['/api/v2/user', 'API v2 user'],
    
    // Sans version
    ['/api/contacts', 'API contacts (sans version)'],
    ['/api/customers', 'API customers (sans version)'],
    ['/api/invoices', 'API invoices (sans version)'],
    ['/api/account', 'API account (sans version)'],
    ['/api/user', 'API user (sans version)'],
    
    // Racine API
    ['/api', 'API racine'],
    ['/api/', 'API racine avec slash'],
  ];
  
  let foundValidEndpoint = false;
  
  for (const [endpoint, description] of endpoints) {
    const success = await testEndpoint(endpoint, description);
    if (success) {
      foundValidEndpoint = true;
      console.log(`🎯 ENDPOINT VALIDE TROUVÉ: ${endpoint}`);
    }
  }
  
  if (!foundValidEndpoint) {
    console.log('\n❌ Aucun endpoint valide trouvé. Vérifiez:');
    console.log('1. La clé API est-elle correcte?');
    console.log('2. L\'URL de base est-elle correcte?');
    console.log('3. Le header userApiKey est-il correct?');
    
    // Test avec d'autres headers possibles
    console.log('\n🔧 Test avec différents headers...');
    
    const headerVariants = [
      { 'Authorization': `Bearer ${apiKey}` },
      { 'Authorization': `ApiKey ${apiKey}` },
      { 'X-API-Key': apiKey },
      { 'Api-Key': apiKey },
      { 'apikey': apiKey },
    ];
    
    for (const headers of headerVariants) {
      console.log(`\n🧪 Test avec headers:`, headers);
      try {
        const response = await fetch(`${baseUrl}/api/v2/contacts`, {
          headers: {
            ...headers,
            'Accept': 'application/json'
          }
        });
        console.log(`📊 Status: ${response.status} ${response.statusText}`);
        if (response.ok) {
          console.log(`✅ SUCCÈS avec headers:`, headers);
          break;
        }
      } catch (error) {
        console.log(`❌ Erreur: ${error.message}`);
      }
    }
  }
  
  console.log('\n🏁 Tests terminés');
})();
