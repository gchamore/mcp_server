// MCP Wesype - Configuration des utilisateurs privilégiés
const PRIVILEGED_EMAILS = [
    'gregoire.chamorel@outlook.fr',  // Votre adresse email
    'admin@wesype.com',
    'dev@wesype.com',
];

function isPrivilegedUser(email) {
    return PRIVILEGED_EMAILS.includes(email.toLowerCase());
}

// Exposer les fonctions globalement
window.PRIVILEGED_EMAILS = PRIVILEGED_EMAILS;
window.isPrivilegedUser = isPrivilegedUser;
