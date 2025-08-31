import { AxonautClient } from './dist/clients/axonaut.client.js';

async function testOurClient() {
  const API_KEY = '595664367051943950c90bf785b9336c49c9159566';
  
  console.log('🧪 Test de notre client AxonautClient...\n');
  
  try {
    const client = new AxonautClient(API_KEY);
    const result = await client.testConnection();
    
    console.log('📊 Résultat:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('❌ Erreur:', error);
  }
}

testOurClient();
