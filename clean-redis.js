// Nettoyage Redis pour tests propres
import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const redis = new Redis(process.env.REDIS_URL);

async function cleanRedis() {
    console.log('🧹 Nettoyage Redis...');
    
    try {
        // Lister toutes les clés
        const keys = await redis.keys('*');
        console.log(`📋 Clés trouvées: ${keys.length}`);
        
        if (keys.length > 0) {
            console.log('   -', keys);
            
            // Supprimer toutes les clés
            await redis.del(...keys);
            console.log('✅ Toutes les clés supprimées');
        } else {
            console.log('✅ Redis déjà vide');
        }
        
    } catch (error) {
        console.error('❌ Erreur:', error.message);
    } finally {
        await redis.disconnect();
        console.log('🔌 Connexion fermée');
    }
}

cleanRedis();
