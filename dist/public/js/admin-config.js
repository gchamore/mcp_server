// Configuration N8N et autres services
const ADMIN_CONFIG = {
    n8n: {
        url: 'http://localhost:5678', // Changez cette URL selon votre configuration N8N
        name: 'N8N Automation Platform',
        description: 'Plateforme d\'automatisation self-hosted'
    },
    prismaStudio: {
        url: 'http://localhost:5555',
        name: 'Prisma Studio',
        description: 'Interface de gestion de base de données'
    }
};

// Exposer la configuration globalement
window.ADMIN_CONFIG = ADMIN_CONFIG;
