// Test de fonctionnalité des sessions Gmail restaurées
import Redis from 'ioredis';
import dotenv from 'dotenv';
import { decrypt } from './dist/src/utils/encryption.js';
import { google } from 'googleapis';

dotenv.config();

const redis = new Redis(process.env.REDIS_URL);

async function testGmailSessions() {
    try {
        console.log('🧪 Test des sessions Gmail restaurées...\n');
        
        // Charger toutes les sessions Gmail
        const gmailKeys = await redis.keys('gmail:*');
        console.log(`📧 ${gmailKeys.length} sessions Gmail trouvées\n`);
        
        for (const gmailKey of gmailKeys) {
            console.log(`\n🔍 Test de ${gmailKey}:`);
            
            const sessionData = await redis.hget(gmailKey, 'data');
            if (!sessionData) {
                console.log('   ❌ Pas de données trouvées');
                continue;
            }
            
            const session = JSON.parse(sessionData);
            console.log(`   👤 Email: ${session.userEmail}`);
            console.log(`   🆔 UserId: ${session.userId}`);
            console.log(`   🔐 Refresh Token: ${session.encryptedRefreshToken ? '✅ Présent' : '❌ Manquant'}`);
            console.log(`   🔑 Access Token: ${session.encryptedAccessToken ? '✅ Présent' : '❌ Manquant'}`);
            
            // Test de déchiffrement des tokens
            let refreshToken = null;
            let accessToken = null;
            
            if (session.encryptedRefreshToken) {
                try {
                    refreshToken = decrypt(session.encryptedRefreshToken);
                    console.log(`   🔓 Refresh Token: Déchiffrable (${refreshToken.substring(0, 20)}...)`);
                } catch (error) {
                    console.log(`   ❌ Refresh Token: Erreur déchiffrement - ${error.message}`);
                }
            }
            
            if (session.encryptedAccessToken) {
                try {
                    accessToken = decrypt(session.encryptedAccessToken);
                    console.log(`   🔓 Access Token: Déchiffrable (${accessToken.substring(0, 20)}...)`);
                } catch (error) {
                    console.log(`   ❌ Access Token: Erreur déchiffrement - ${error.message}`);
                }
            }
            
            // Test d'utilisation avec l'API Gmail
            if (accessToken || refreshToken) {
                console.log('   🔄 Test de l\'API Gmail...');
                
                try {
                    const oauth2Client = new google.auth.OAuth2(
                        process.env.GOOGLE_CLIENT_ID,
                        process.env.GOOGLE_CLIENT_SECRET,
                        process.env.BASE_URL + '/oauth/callback'
                    );
                    
                    // Configurer les credentials
                    const credentials = {};
                    if (refreshToken) credentials.refresh_token = refreshToken;
                    if (accessToken) credentials.access_token = accessToken;
                    
                    oauth2Client.setCredentials(credentials);
                    
                    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
                    
                    // Test simple : récupérer le profil
                    const profile = await gmail.users.getProfile({ userId: 'me' });
                    console.log(`   ✅ API Gmail fonctionne ! Email: ${profile.data.emailAddress}`);
                    
                    // Test : compter les messages
                    const messages = await gmail.users.messages.list({ 
                        userId: 'me',
                        maxResults: 1 
                    });
                    console.log(`   📬 Messages disponibles: ${messages.data.resultSizeEstimate || 0}`);
                    
                } catch (apiError) {
                    console.log(`   ❌ API Gmail échoue: ${apiError.message}`);
                    
                    if (apiError.message.includes('invalid_token') || apiError.message.includes('invalid_grant')) {
                        console.log('   🔄 Token expiré, une nouvelle authentification est nécessaire');
                    }
                }
            }
        }
        
    } catch (error) {
        console.error('❌ Erreur test:', error.message);
    } finally {
        await redis.disconnect();
        console.log('\n🔌 Connexion fermée');
    }
}

testGmailSessions();
