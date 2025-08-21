// Analyse comparative détaillée des sessions
import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const redis = new Redis(process.env.REDIS_URL);

async function compareSessionDetails() {
    try {
        console.log('🔍 Analyse comparative détaillée des sessions...\n');
        
        // Récupérer toutes les clés
        const keys = await redis.keys('*');
        
        const gmailSessions = [];
        const axonautSessions = [];
        const userSessions = [];
        
        // Classifier les sessions
        for (const key of keys) {
            const data = await redis.hget(key, 'data');
            if (data) {
                const session = JSON.parse(data);
                
                if (key.startsWith('gmail:')) {
                    gmailSessions.push({ key, session });
                } else if (key.startsWith('axonaut:')) {
                    axonautSessions.push({ key, session });
                } else if (key.startsWith('user:')) {
                    userSessions.push({ key, session });
                }
            }
        }
        
        console.log(`📊 Sessions trouvées:`);
        console.log(`   📧 Gmail: ${gmailSessions.length}`);
        console.log(`   📊 Axonaut: ${axonautSessions.length}`);
        console.log(`   👤 User: ${userSessions.length}\n`);
        
        // Analyse des sessions Gmail
        console.log('📧 ANALYSE SESSIONS GMAIL:');
        console.log('=' .repeat(50));
        
        gmailSessions.forEach((item, index) => {
            const { key, session } = item;
            console.log(`\n📧 Session Gmail #${index + 1}:`);
            console.log(`   🔑 Clé: ${key}`);
            console.log(`   🆔 UserId: ${session.userId}`);
            console.log(`   👤 Email: ${session.userEmail}`);
            console.log(`   📅 Créée: ${new Date(session.createdAt).toLocaleString()}`);
            console.log(`   📅 Dernière access: ${new Date(session.lastAccessed).toLocaleString()}`);
            console.log(`   🔐 Refresh Token: ${session.encryptedRefreshToken ? '✅ Présent' : '❌ Manquant'}`);
            console.log(`   🔑 Access Token: ${session.encryptedAccessToken ? '✅ Présent' : '❌ Manquant'}`);
            console.log(`   ✅ Authentifié: ${session.isAuthenticated}`);
            
            // Chercher la session utilisateur correspondante
            const userSession = userSessions.find(u => u.session.userId === session.userId);
            if (userSession) {
                console.log(`   🔗 Session user associée: ✅ Trouvée`);
                console.log(`   🔗 Services dans user: ${JSON.stringify(userSession.session.services)}`);
            } else {
                console.log(`   🔗 Session user associée: ❌ Manquante`);
            }
        });
        
        // Analyse des sessions Axonaut
        console.log('\n\n📊 ANALYSE SESSIONS AXONAUT:');
        console.log('=' .repeat(50));
        
        axonautSessions.forEach((item, index) => {
            const { key, session } = item;
            console.log(`\n📊 Session Axonaut #${index + 1}:`);
            console.log(`   🔑 Clé: ${key}`);
            console.log(`   🆔 UserId: ${session.userId}`);
            console.log(`   👤 Email: ${session.userEmail}`);
            console.log(`   📅 Créée: ${new Date(session.createdAt).toLocaleString()}`);
            console.log(`   📅 Dernière access: ${new Date(session.lastAccessed).toLocaleString()}`);
            console.log(`   🔐 API Key: ${session.encryptedApiKey ? '✅ Présent' : '❌ Manquant'}`);
            console.log(`   🌐 Base URL: ${session.baseUrl}`);
            console.log(`   ✅ Authentifié: ${session.isAuthenticated}`);
            
            // Chercher la session utilisateur correspondante
            const userSession = userSessions.find(u => u.session.userId === session.userId);
            if (userSession) {
                console.log(`   🔗 Session user associée: ✅ Trouvée`);
                console.log(`   🔗 Services dans user: ${JSON.stringify(userSession.session.services)}`);
            } else {
                console.log(`   🔗 Session user associée: ❌ Manquante`);
            }
        });
        
        // Analyse des sessions utilisateur orphelines
        console.log('\n\n👤 ANALYSE SESSIONS UTILISATEUR:');
        console.log('=' .repeat(50));
        
        userSessions.forEach((item, index) => {
            const { key, session } = item;
            console.log(`\n👤 Session User #${index + 1}:`);
            console.log(`   🔑 Clé: ${key}`);
            console.log(`   🆔 UserId: ${session.userId}`);
            console.log(`   📅 Créée: ${new Date(session.createdAt).toLocaleString()}`);
            console.log(`   📅 Dernière access: ${new Date(session.lastAccessed).toLocaleString()}`);
            console.log(`   🔗 Services: ${JSON.stringify(session.services)}`);
            
            // Vérifier si les services existent vraiment
            if (session.services) {
                if (session.services.gmail) {
                    const gmailExists = gmailSessions.find(g => g.session.userId === session.services.gmail);
                    console.log(`     📧 Gmail ${session.services.gmail}: ${gmailExists ? '✅ Existe' : '❌ Manquant'}`);
                }
                if (session.services.axonaut) {
                    const axonautExists = axonautSessions.find(a => a.session.userId === session.services.axonaut);
                    console.log(`     📊 Axonaut ${session.services.axonaut}: ${axonautExists ? '✅ Existe' : '❌ Manquant'}`);
                }
            }
        });
        
        // Résumé des problèmes détectés
        console.log('\n\n🚨 RÉSUMÉ DES PROBLÈMES DÉTECTÉS:');
        console.log('=' .repeat(50));
        
        let problems = [];
        
        // Vérifier les refresh tokens Gmail manquants
        const missingRefreshTokens = gmailSessions.filter(item => !item.session.encryptedRefreshToken);
        if (missingRefreshTokens.length > 0) {
            problems.push(`❌ ${missingRefreshTokens.length} sessions Gmail sans refresh token`);
        }
        
        // Vérifier les associations user/service manquantes
        const orphanedGmail = gmailSessions.filter(item => 
            !userSessions.find(u => u.session.userId === item.session.userId)
        );
        if (orphanedGmail.length > 0) {
            problems.push(`❌ ${orphanedGmail.length} sessions Gmail sans session user associée`);
        }
        
        const orphanedAxonaut = axonautSessions.filter(item => 
            !userSessions.find(u => u.session.userId === item.session.userId)
        );
        if (orphanedAxonaut.length > 0) {
            problems.push(`❌ ${orphanedAxonaut.length} sessions Axonaut sans session user associée`);
        }
        
        if (problems.length === 0) {
            console.log('✅ Aucun problème détecté !');
        } else {
            problems.forEach(problem => console.log(problem));
        }
        
    } catch (error) {
        console.error('❌ Erreur analyse:', error.message);
    } finally {
        await redis.disconnect();
        console.log('\n🔌 Connexion fermée');
    }
}

compareSessionDetails();
