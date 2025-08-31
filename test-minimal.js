import axios from 'axios';

// Test exact comme celui qui a fonctionné
async function testExact() {
  const API_KEY = '595664367051943950c90bf785b9336c49c9159566';
  
  console.log('🧪 Test exact reproduction du cas qui fonctionne...\n');
  
  try {
    const response = await axios.get('https://axonaut.com/api/v2/me', {
      headers: {
        'userApiKey': API_KEY,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
    
    console.log('✅ Status:', response.status);
    console.log('📊 Data:', JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error('❌ Erreur:', error.response?.status, error.response?.statusText);
    console.error('📄 Headers envoyés:', JSON.stringify(error.config?.headers, null, 2));
    console.error('🌐 URL complète:', error.config?.url);
    console.error('📄 Détails:', error.response?.data);
  }
}

testExact();
