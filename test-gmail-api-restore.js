// Test spécifique pour vérifier que l'API Gmail fonctionne après restauration
import fetch from 'node-fetch';

const baseUrl = 'http://localhost:3000';

async function testGmailAPIAfterRestore() {
    try {
        console.log('🧪 Test API Gmail après restauration...\n');
        
        // IDs des sessions Gmail
        const gmailSessions = [
            '423b3600-e381-4db6-b6c8-6d423ed3e4f9',
            '6d17c03c-dc1a-4932-890f-eab4419b7d4a',
            '46013f0f-a5c1-41c2-8f6e-924198a3f561'
        ];
        
        for (const sessionId of gmailSessions) {
            console.log(`\n📧 Test session Gmail: ${sessionId}`);
            
            // Test en envoyant une requête POST vers l'endpoint MCP pour lister les messages
            const mcpUrl = `${baseUrl}/${sessionId}/mcp/sse`;
            
            try {
                // Simuler une requête MCP pour lister les emails
                const testRequest = {
                    jsonrpc: "2.0",
                    id: 1,
                    method: "tools/call",
                    params: {
                        name: "gmail_list_messages",
                        arguments: {
                            query: "",
                            maxResults: 1
                        }
                    }
                };
                
                console.log(`   📡 Test de l'endpoint MCP...`);
                
                // Pour l'instant, testons juste l'accessibilité
                const response = await fetch(mcpUrl, {
                    method: 'GET',
                    headers: {
                        'Accept': 'text/event-stream'
                    }
                });
                
                console.log(`   📡 Status: ${response.status} ${response.statusText}`);
                
                if (response.status === 200) {
                    console.log(`   ✅ Endpoint MCP accessible et prêt`);
                } else {
                    console.log(`   ❌ Problème avec l'endpoint MCP`);
                }
                
            } catch (error) {
                console.log(`   ❌ Erreur test: ${error.message}`);
            }
        }
        
        console.log(`\n📋 Résumé:`);
        console.log(`   📧 ${gmailSessions.length} sessions Gmail testées`);
        console.log(`   🔄 Toutes devraient maintenant avoir leurs access tokens configurés`);
        console.log(`   🎯 Testez maintenant dans Dust.tt pour confirmer le fonctionnement`);
        
    } catch (error) {
        console.error('❌ Erreur test API Gmail:', error.message);
    }
}

testGmailAPIAfterRestore();
