import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function debugApiKey() {
  try {
    console.log('🔍 Recherche des sessions MCP Axonaut...\n');
    
    // Récupérer toutes les sessions Axonaut
    const sessions = await prisma.mcpSession.findMany({
      where: {
        toolName: 'axonaut'
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 5
    });
    
    console.log(`📊 Nombre de sessions trouvées: ${sessions.length}\n`);
    
    for (const session of sessions) {
      console.log(`🔧 Session ID: ${session.id}`);
      console.log(`📧 Email: ${session.email}`);
      console.log(`🗓️  Créée le: ${session.createdAt}`);
      console.log(`🔑 API Key (premiers 10 chars): ${session.apiKey?.substring(0, 10)}...`);
      console.log(`🔑 API Key (longueur): ${session.apiKey?.length || 0} caractères`);
      console.log(`🌐 URL MCP: ${session.mcpUrl || 'N/A'}`);
      console.log('---');
    }
    
    // Test avec la première session trouvée
    if (sessions.length > 0) {
      const firstSession = sessions[0];
      console.log(`\n🧪 Test avec la session ${firstSession.id}:`);
      console.log(`🔑 Clé API complète: "${firstSession.apiKey}"`);
      console.log(`📏 Longueur exacte: ${firstSession.apiKey?.length}`);
      
      // Vérifier s'il y a des espaces ou caractères cachés
      if (firstSession.apiKey) {
        const cleanKey = firstSession.apiKey.trim();
        console.log(`🧹 Clé nettoyée: "${cleanKey}"`);
        console.log(`📏 Longueur après nettoyage: ${cleanKey.length}`);
        console.log(`🔍 Caractères en début/fin: [${firstSession.apiKey.charCodeAt(0)}] ... [${firstSession.apiKey.charCodeAt(firstSession.apiKey.length - 1)}]`);
      }
    }
    
  } catch (error) {
    console.error('❌ Erreur:', error);
  } finally {
    await prisma.$disconnect();
  }
}

debugApiKey();
