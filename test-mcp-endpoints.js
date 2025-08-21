// Test d'accès aux endpoints MCP après restauration
import fetch from 'node-fetch';

const baseUrl = 'http://localhost:3000';

async function testMcpEndpoints() {
    try {
        console.log('🧪 Test des endpoints MCP après restauration...\n');
        
        // IDs des sessions trouvées
        const sessionIds = [
            '423b3600-e381-4db6-b6c8-6d423ed3e4f9', // Gmail récent
            '6d17c03c-dc1a-4932-890f-eab4419b7d4a',  // Gmail 
            '46013f0f-a5c1-41c2-8f6e-924198a3f561',  // Gmail ancien
            'user-1755774722890-4nhmegyw5'           // Axonaut
        ];
        
        for (const sessionId of sessionIds) {
            console.log(`\n🔍 Test session: ${sessionId}`);
            
            // Test de l'endpoint MCP SSE
            const mcpUrl = `${baseUrl}/${sessionId}/mcp/sse`;
            console.log(`   📡 URL MCP: ${mcpUrl}`);
            
            try {
                const response = await fetch(mcpUrl, {
                    method: 'GET',
                    headers: {
                        'Accept': 'text/event-stream',
                        'Cache-Control': 'no-cache'
                    }
                });
                
                console.log(`   📡 Status: ${response.status} ${response.statusText}`);
                
                if (response.status === 200) {
                    console.log(`   ✅ Endpoint MCP accessible`);
                    
                    // Lire quelques données pour voir si ça marche
                    const reader = response.body.getReader();
                    const decoder = new TextDecoder();
                    
                    // Timeout pour éviter d'attendre indéfiniment
                    const timeoutPromise = new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Timeout')), 3000)
                    );
                    
                    try {
                        const readPromise = reader.read();
                        const result = await Promise.race([readPromise, timeoutPromise]);
                        
                        if (result.done) {
                            console.log(`   📝 Connexion SSE fermée immédiatement`);
                        } else {
                            const chunk = decoder.decode(result.value);
                            console.log(`   📝 Données SSE reçues: ${chunk.substring(0, 100)}...`);
                        }
                    } catch (timeoutError) {
                        console.log(`   ⏱️ Connexion SSE active (timeout après 3s)`);
                    } finally {
                        reader.releaseLock();
                    }
                    
                } else {
                    console.log(`   ❌ Endpoint MCP non accessible`);
                }
                
            } catch (error) {
                console.log(`   ❌ Erreur accès endpoint: ${error.message}`);
            }
        }
        
        // Test de l'endpoint de statut du serveur
        console.log(`\n\n🏥 Test statut général du serveur:`);
        try {
            const statusResponse = await fetch(`${baseUrl}/`);
            console.log(`   📡 Status page: ${statusResponse.status} ${statusResponse.statusText}`);
            if (statusResponse.status === 200) {
                console.log(`   ✅ Serveur accessible`);
            }
        } catch (error) {
            console.log(`   ❌ Serveur non accessible: ${error.message}`);
        }
        
    } catch (error) {
        console.error('❌ Erreur test endpoints:', error.message);
    }
}

testMcpEndpoints();
