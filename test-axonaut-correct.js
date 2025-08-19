#!/usr/bin/env node

// Test des endpoints corrects Axonaut
const apiKey = '595664367051943950c90bf785b9336c49c9159566';
const baseUrl = 'https://axonaut.com';

async function testEndpointWithAuth(endpoint, authType = 'userApiKey') {
  console.log(`🔍 Test ${endpoint} avec ${authType}...`);
  
  const headers = {
    'Accept': 'application/json'
  };
  
  if (authType === 'userApiKey') {
    headers['userApiKey'] = apiKey;
  } else if (authType === 'bearer') {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  
  try {
    const response = await fetch(`${baseUrl}/api/v2${endpoint}`, { headers });
    console.log(`📊 Status: ${response.status} ${response.statusText}`);
    
    if (response.ok) {
      const data = await response.json();
      console.log(`✅ Succès:`, JSON.stringify(data, null, 2).substring(0, 300) + '...');
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

(async () => {
  console.log('🚀 Test des endpoints Axonaut corrects\n');
  
  const endpoints = ['/me', '/companies', '/invoices', '/employees'];
  const authTypes = ['userApiKey', 'bearer'];
  
  for (const endpoint of endpoints) {
    console.log(`\n📋 Test endpoint: ${endpoint}`);
    
    for (const authType of authTypes) {
      const success = await testEndpointWithAuth(endpoint, authType);
      if (success) {
        console.log(`🎯 SUCCÈS avec ${authType} sur ${endpoint}!`);
        break; // Passer au prochain endpoint si on trouve un type d'auth qui marche
      }
    }
  }
  
  console.log('\n🏁 Tests terminés');
})();
