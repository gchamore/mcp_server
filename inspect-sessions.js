// Script pour vérifier le contenu détaillé des sessions restaurées
import Redis from 'ioredis';
import dotenv from 'dotenv';
import { decrypt } from './dist/src/utils/encryption.js';

dotenv.config();

const redis = new Redis(process.env.REDIS_URL);

async function inspectSessions() {
    try {
        console.log('🔍 Inspection détaillée des sessions Redis...\n');
        
        // Récupérer toutes les clés
        const keys = await redis.keys('*');
        console.log(`📋 Clés trouvées: ${keys.length}\n`);
        
        for (const key of keys) {
            console.log(`\n🔑 Clé: ${key}`);
            const type = await redis.type(key);
            console.log(`   Type: ${type}`);
            
            if (type === 'hash') {
                const data = await redis.hgetall(key);
                console.log('   Contenu:');
                
                for (const [field, value] of Object.entries(data)) {
                    if (field.includes('encrypted') || field.includes('Encrypted')) {
                        try {
                            // Essayer de déchiffrer pour vérifier l'intégrité
                            const decrypted = decrypt(value);
                            console.log(`     ${field}: [CHIFFRÉ - déchiffrable] ${decrypted.substring(0, 20)}...`);
                        } catch (error) {
                            console.log(`     ${field}: [CHIFFRÉ - ERREUR DE DÉCHIFFREMENT] ${error.message}`);
                        }
                    } else if (field.includes('Date') || field.includes('At')) {
                        // Vérifier les dates
                        const date = new Date(value);
                        console.log(`     ${field}: ${value} (${date.toISOString()})`);
                    } else {
                        console.log(`     ${field}: ${value}`);
                    }
                }
            } else if (type === 'string') {
                const value = await redis.get(key);
                console.log(`   Valeur: ${value.substring(0, 100)}${value.length > 100 ? '...' : ''}`);
            }
        }
        
        // Test spécifique : charger les sessions comme le fait le serveur
        console.log('\n\n🔄 Test de chargement comme le serveur...');
        
        // Charger sessions utilisateur
        const userKeys = await redis.keys('user:*');
        console.log(`\n👤 Sessions utilisateur (${userKeys.length}):`);
        for (const userKey of userKeys) {
            const userData = await redis.hgetall(userKey);
            console.log(`   ${userKey}:`);
            console.log(`     userId: ${userData.userId}`);
            console.log(`     userEmail: ${userData.userEmail || 'N/A'}`);
            console.log(`     createdAt: ${userData.createdAt}`);
            console.log(`     lastAccessed: ${userData.lastAccessed}`);
            console.log(`     services: ${userData.services || 'N/A'}`);
        }
        
        // Charger sessions Axonaut
        const axonautKeys = await redis.keys('axonaut:*');
        console.log(`\n📊 Sessions Axonaut (${axonautKeys.length}):`);
        for (const axonautKey of axonautKeys) {
            const axonautData = await redis.hgetall(axonautKey);
            console.log(`   ${axonautKey}:`);
            console.log(`     userId: ${axonautData.userId}`);
            console.log(`     userEmail: ${axonautData.userEmail}`);
            console.log(`     isAuthenticated: ${axonautData.isAuthenticated}`);
            console.log(`     baseUrl: ${axonautData.baseUrl}`);
            console.log(`     serviceName: ${axonautData.serviceName}`);
            
            // Vérifier la clé API chiffrée
            if (axonautData.encryptedApiKey) {
                try {
                    const apiKey = decrypt(axonautData.encryptedApiKey);
                    console.log(`     encryptedApiKey: [DÉCHIFFRABLE] ${apiKey.substring(0, 10)}...`);
                } catch (error) {
                    console.log(`     encryptedApiKey: [ERREUR DÉCHIFFREMENT] ${error.message}`);
                }
            }
        }
        
        // Charger sessions Gmail
        const gmailKeys = await redis.keys('gmail:*');
        console.log(`\n📧 Sessions Gmail (${gmailKeys.length}):`);
        for (const gmailKey of gmailKeys) {
            const gmailData = await redis.hgetall(gmailKey);
            console.log(`   ${gmailKey}:`);
            console.log(`     userId: ${gmailData.userId}`);
            console.log(`     userEmail: ${gmailData.userEmail}`);
            console.log(`     isAuthenticated: ${gmailData.isAuthenticated}`);
            console.log(`     serviceName: ${gmailData.serviceName}`);
            
            // Vérifier les tokens chiffrés
            if (gmailData.encryptedRefreshToken) {
                try {
                    const refreshToken = decrypt(gmailData.encryptedRefreshToken);
                    console.log(`     encryptedRefreshToken: [DÉCHIFFRABLE] ${refreshToken.substring(0, 10)}...`);
                } catch (error) {
                    console.log(`     encryptedRefreshToken: [ERREUR DÉCHIFFREMENT] ${error.message}`);
                }
            }
            
            if (gmailData.encryptedAccessToken) {
                try {
                    const accessToken = decrypt(gmailData.encryptedAccessToken);
                    console.log(`     encryptedAccessToken: [DÉCHIFFRABLE] ${accessToken.substring(0, 10)}...`);
                } catch (error) {
                    console.log(`     encryptedAccessToken: [ERREUR DÉCHIFFREMENT] ${error.message}`);
                }
            }
        }
        
    } catch (error) {
        console.error('❌ Erreur inspection:', error.message);
        console.error('Stack:', error.stack);
    } finally {
        await redis.disconnect();
        console.log('\n🔌 Connexion fermée');
    }
}

inspectSessions();
