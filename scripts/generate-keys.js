import crypto from 'crypto';

console.log('🔐 Génération des clés de sécurité pour Railway\n');

// Génération de la clé de chiffrement (32 bytes = 64 caractères hex)
const encryptionKey = crypto.randomBytes(32).toString('hex');
console.log('📋 ENCRYPTION_KEY (à copier dans Railway Variables):');
console.log(encryptionKey);

console.log('\n' + '='.repeat(80) + '\n');

// Génération du secret de session (64 bytes = 128 caractères hex)
const sessionSecret = crypto.randomBytes(64).toString('hex');
console.log('📋 SESSION_SECRET (à copier dans Railway Variables):');
console.log(sessionSecret);

console.log('\n' + '='.repeat(80) + '\n');

console.log('📝 Instructions:');
console.log('1. Copiez ENCRYPTION_KEY et ajoutez-la dans Railway → Settings → Variables');
console.log('2. Copiez SESSION_SECRET et ajoutez-la dans Railway → Settings → Variables');
console.log('3. Assurez-vous que NODE_ENV=production est aussi configuré');

console.log('\n🔒 Ces clés sont uniques et sécurisées. Gardez-les privées !');
