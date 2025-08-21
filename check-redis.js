// Script simple pour vérifier les clés Redis
import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const redis = new Redis(process.env.REDIS_URL);

async function checkRedis() {
    try {
        console.log('🔍 Vérification des clés Redis...');
        
        // Lister toutes les clés
        const keys = await redis.keys('*');
        console.log(`📋 Clés trouvées: ${keys.length}`);
        
        if (keys.length > 0) {
            console.log('\n📝 Clés existantes:');
            for (const key of keys) {
                const type = await redis.type(key);
                const ttl = await redis.ttl(key);
                console.log(`   - ${key} (${type}, TTL: ${ttl === -1 ? 'permanent' : ttl + 's'})`);
                
                // Afficher le contenu si c'est une string courte
                if (type === 'string') {
                    const value = await redis.get(key);
                    const preview = value.length > 100 ? value.substring(0, 100) + '...' : value;
                    console.log(`     Contenu: ${preview}`);
                }
            }
        } else {
            console.log('❌ Aucune clé trouvée dans Redis');
        }
        
    } catch (error) {
        console.error('❌ Erreur:', error.message);
    } finally {
        await redis.disconnect();
        console.log('🔌 Connexion fermée');
    }
}

checkRedis();
