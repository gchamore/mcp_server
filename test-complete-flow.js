// Test complet de persistence et restauration
import fetch from 'node-fetch';

const baseUrl = 'http://localhost:3000';
const testUserId = 'test-user-' + Date.now();

async function testCompleteFlow() {
    console.log('🧪 Test complet de persistence et restauration\n');
    
    try {
        // 1. Créer une session Axonaut avec userId spécifique
        console.log(`📝 1. Création d'une session Axonaut avec userId: ${testUserId}`);
        
        const authResponse = await fetch(`${baseUrl}/api/axonaut/auth`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                userId: testUserId,  // Utiliser un userId spécifique
                apiKey: '595664367051943950c90bf785b9336c49c9159566',
                baseUrl: 'https://axonaut.com',
                userEmail: 'test@example.com'
            })
        });
        
        if (!authResponse.ok) {
            throw new Error(`Erreur auth: ${authResponse.status}`);
        }
        
        const authResult = await authResponse.json();
        console.log('✅ Session créée:', authResult);
        
        // 2. Attendre la sauvegarde
        console.log('\n⏱️ 2. Attente de la sauvegarde (3 secondes)...');
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // 3. Vérifier les clés Redis
        console.log('\n🔍 3. Vérification des clés Redis...');
        const { exec } = await import('child_process');
        await new Promise((resolve, reject) => {
            exec('node check-redis.js', (error, stdout, stderr) => {
                if (error) {
                    console.error('Erreur check Redis:', error);
                    reject(error);
                } else {
                    console.log(stdout);
                    resolve();
                }
            });
        });
        
        // 4. Test de l'endpoint MCP
        console.log('\n🌐 4. Test de l\'endpoint MCP...');
        const mcpResponse = await fetch(`${baseUrl}/${testUserId}/mcp/sse`, {
            headers: {
                'Accept': 'text/event-stream'
            }
        });
        
        if (mcpResponse.ok) {
            console.log('✅ Endpoint MCP accessible');
        } else {
            console.log('❌ Endpoint MCP non accessible:', mcpResponse.status);
        }
        
        console.log('\n🎯 Test terminé avec succès !');
        console.log(`📋 Pour Railway, utilisez l'endpoint: https://your-railway-url.com/${testUserId}/mcp/sse`);
        
    } catch (error) {
        console.error('❌ Erreur test:', error.message);
    }
}

// Attendre que le serveur soit prêt
setTimeout(testCompleteFlow, 2000);
