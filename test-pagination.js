import axios from 'axios';

async function testPagination() {
  const API_KEY = '595664367051943950c90bf785b9336c49c9159566';
  
  console.log('🧪 Test de pagination avec header page...\n');
  
  try {
    // Test avec page dans les headers comme demandé par l'API
    const response = await axios.get('https://axonaut.com/api/v2/invoices?limit=10', {
      headers: {
        'userApiKey': API_KEY,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'page': '1'  // Page dans les headers !
      },
      timeout: 10000
    });
    
    console.log('✅ Status:', response.status);
    console.log('📊 Nombre de factures:', Array.isArray(response.data) ? response.data.length : 'Structure inconnue');
    console.log('📋 Premiers éléments:', JSON.stringify(response.data.slice(0, 2), null, 2));
  } catch (error) {
    console.error('❌ Erreur:', error.response?.status, error.response?.statusText);
    console.error('📄 Headers envoyés:', JSON.stringify(error.config?.headers, null, 2));
    console.error('🌐 URL:', error.config?.url);
    console.error('📄 Détails erreur:', error.response?.data);
  }
}

testPagination();
