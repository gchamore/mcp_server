import axios from 'axios';

// Test de l'API Axonaut avec différents formats d'authentification
async function testAxonautAPI() {
  // Votre clé API Axonaut
  const API_KEY = '595664367051943950c90bf785b9336c49c9159566';
  
  console.log('🔍 Test de l\'API Axonaut...\n');
  
  // Test 1: Header userApiKey (format actuel)
  console.log('1️⃣ Test avec header userApiKey:');
  try {
    const response1 = await axios.get('https://axonaut.com/api/v2/me', {
      headers: {
        'userApiKey': API_KEY,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
    console.log('✅ Succès avec userApiKey:', response1.status);
    console.log('📊 Données:', JSON.stringify(response1.data, null, 2));
  } catch (error) {
    console.log('❌ Erreur avec userApiKey:', error.response?.status, error.response?.statusText);
    console.log('📄 Détails:', error.response?.data);
  }
  
  console.log('\n');
  
  // Test 2: Header Authorization Bearer
  console.log('2️⃣ Test avec Authorization Bearer:');
  try {
    const response2 = await axios.get('https://axonaut.com/api/v2/me', {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
    console.log('✅ Succès avec Bearer:', response2.status);
    console.log('📊 Données:', JSON.stringify(response2.data, null, 2));
  } catch (error) {
    console.log('❌ Erreur avec Bearer:', error.response?.status, error.response?.statusText);
    console.log('📄 Détails:', error.response?.data);
  }
  
  console.log('\n');
  
  // Test 3: Header X-API-Key
  console.log('3️⃣ Test avec X-API-Key:');
  try {
    const response3 = await axios.get('https://axonaut.com/api/v2/me', {
      headers: {
        'X-API-Key': API_KEY,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
    console.log('✅ Succès avec X-API-Key:', response3.status);
    console.log('📊 Données:', JSON.stringify(response3.data, null, 2));
  } catch (error) {
    console.log('❌ Erreur avec X-API-Key:', error.response?.status, error.response?.statusText);
    console.log('📄 Détails:', error.response?.data);
  }
  
  console.log('\n');
  
  // Test 4: Query parameter
  console.log('4️⃣ Test avec query parameter:');
  try {
    const response4 = await axios.get(`https://axonaut.com/api/v2/me?api_key=${API_KEY}`, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
    console.log('✅ Succès avec query param:', response4.status);
    console.log('📊 Données:', JSON.stringify(response4.data, null, 2));
  } catch (error) {
    console.log('❌ Erreur avec query param:', error.response?.status, error.response?.statusText);
    console.log('📄 Détails:', error.response?.data);
  }
}

// Test de connectivité de base
async function testConnectivity() {
  console.log('🌐 Test de connectivité de base...\n');
  
  try {
    const response = await axios.get('https://axonaut.com', {
      timeout: 5000
    });
    console.log('✅ Site Axonaut accessible:', response.status);
  } catch (error) {
    console.log('❌ Site Axonaut inaccessible:', error.message);
  }
}

// Exécution des tests
async function runTests() {
  await testConnectivity();
  console.log('\n' + '='.repeat(50) + '\n');
  await testAxonautAPI();
}

runTests().catch(console.error);
