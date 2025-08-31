// MCP Wesype - Version progressive qui fonctionne
console.log('🚀 MCP Wesype Frontend chargé');

document.addEventListener('DOMContentLoaded', function() {
    console.log('✅ DOM chargé');
    
    // Test simple des boutons UNIQUEMENT
    const loginBtn = document.getElementById('loginBtn');
    const registerBtn = document.getElementById('registerBtn');
    
    console.log('loginBtn:', loginBtn);
    console.log('registerBtn:', registerBtn);
    
    if (loginBtn) {
        loginBtn.addEventListener('click', function(e) {
            e.preventDefault();
            console.log('🖱️ Clic login détecté');
            openModal('loginModal');
        });
    }
    
    if (registerBtn) {
        registerBtn.addEventListener('click', function(e) {
            e.preventDefault();
            console.log('🖱️ Clic register détecté');
            openModal('registerModal');
        });
    }
    function handleAdminPanel() {
    console.log('⚙️ Ouverture du panneau admin...');
    
    // Fermer la modal des paramètres
    closeModal('settingsModal');
    
    // Ouvrir la modal admin
    openModal('adminModal');
    
    console.log('👑 Panneau admin ouvert');
}

// Fonctions de gestion des outils admin
function handleN8nRedirect() {
    console.log('🔗 Redirection vers N8N...');
    
    const config = window.ADMIN_CONFIG?.n8n;
    const n8nUrl = config?.url || 'http://localhost:5678';
    
    // Confirmation avant redirection
    const confirmation = confirm(
        `🔗 Redirection vers N8N\n\n` +
        `Vous allez être redirigé vers la plateforme N8N :\n` +
        `${n8nUrl}\n\n` +
        `Continuer ?`
    );
    
    if (confirmation) {
        console.log('✅ Redirection N8N confirmée');
        window.open(n8nUrl, '_blank');
        closeModal('adminModal');
        showMessage('🔗 Ouverture de N8N dans un nouvel onglet', 'success');
    } else {
        console.log('❌ Redirection N8N annulée');
    }
}

function handleDatabaseAccess() {
    console.log('💾 Accès base de données...');
    
    const config = window.ADMIN_CONFIG?.prismaStudio;
    const prismaUrl = config?.url || 'http://localhost:5555';
    
    showMessage('💾 Ouverture de Prisma Studio...', 'info');
    window.open(prismaUrl, '_blank');
    closeModal('adminModal');
}

function handleUsersManagement() {
    console.log('👥 Gestion des utilisateurs...');
    
    // Pour l'instant, message d'information
    showMessage('👥 Gestion utilisateurs - Fonctionnalité en développement', 'info');
    
    // Ici vous pourriez implémenter :
    // - Liste de tous les utilisateurs
    // - Statistiques d'inscription
    // - Gestion des permissions
    // - Activation/désactivation de comptes
}

function handleServerStats() {
    console.log('📈 Statistiques serveur...');
    
    showMessage('📈 Statistiques serveur - Fonctionnalité en développement', 'info');
    
    // Ici vous pourriez implémenter :
    // - Utilisation CPU/RAM
    // - Nombre de connexions actives
    // - Statistiques de base de données
    // - Performance des API
}

function handleSystemConfig() {
    console.log('⚙️ Configuration système...');
    
    showMessage('⚙️ Configuration système - Fonctionnalité en développement', 'info');
    
    // Ici vous pourriez implémenter :
    // - Variables d'environnement
    // - Configuration de la base de données
    // - Paramètres de sécurité
    // - Configuration des services externes
}

function handleBackup() {
    console.log('💿 Sauvegarde...');
    
    showMessage('💿 Sauvegarde - Fonctionnalité en développement', 'info');
    
    // Ici vous pourriez implémenter :
    // - Sauvegarde automatique de la DB
    // - Export des données utilisateurs
    // - Backup des configurations
    // - Restoration de sauvegardes
}

function handleLogs() {
    console.log('📋 Logs système...');
    
    showMessage('📋 Logs système - Fonctionnalité en développement', 'info');
    
    // Ici vous pourriez implémenter :
    // - Affichage des logs en temps réel
    // - Filtrage par niveau (error, warn, info)
    // - Recherche dans les logs
    // - Export des logs
}entListener('click', function(e) {
            e.preventDefault();
            console.log('🖱️ Clic login détecté');
            openModal('loginModal');
        });
    }
    
    if (registerBtn) {
        registerBtn.addEventListener('click', function(e) {
            e.preventDefault();
            console.log('🖱️ Clic register détecté');
            openModal('registerModal');
        });
    }
    
    // Fermeture des modales
    document.querySelectorAll('.close').forEach(closeBtn => {
        closeBtn.addEventListener('click', function() {
            const modalId = this.getAttribute('data-modal');
            closeModal(modalId);
        });
    });
    
    // Fermeture modale en cliquant en dehors
    window.addEventListener('click', function(event) {
        if (event.target.classList.contains('modal')) {
            event.target.style.display = 'none';
        }
    });
    
    // Gestion des boutons dashboard
    const logoutBtn = document.getElementById('logoutBtn');
    const deleteAccountBtn = document.getElementById('deleteAccountBtn');
    const adminPanelBtn = document.getElementById('adminPanelBtn');
    const settingsBtn = document.getElementById('settingsBtn');
    
    if (logoutBtn) {
        console.log('✅ logoutBtn trouvé');
        logoutBtn.addEventListener('click', function(e) {
            e.preventDefault();
            console.log('🚪 Clic déconnexion détecté');
            handleLogout();
        });
    }
    
    if (settingsBtn) {
        console.log('✅ settingsBtn trouvé');
        settingsBtn.addEventListener('click', function(e) {
            e.preventDefault();
            console.log('⚙️ Clic paramètres détecté');
            openModal('settingsModal');
        });
    }
    
    if (deleteAccountBtn) {
        console.log('✅ deleteAccountBtn trouvé');
        deleteAccountBtn.addEventListener('click', function(e) {
            e.preventDefault();
            console.log('🗑️ Clic suppression compte détecté');
            handleDeleteAccount();
        });
    }
    
    if (adminPanelBtn) {
        console.log('✅ adminPanelBtn trouvé');
        adminPanelBtn.addEventListener('click', function(e) {
            e.preventDefault();
            console.log('⚙️ Clic panneau admin détecté');
            handleAdminPanel();
        });
    }
    
    // Gestion des boutons dans la modal admin
    const n8nBtn = document.getElementById('n8nBtn');
    const databaseBtn = document.getElementById('databaseBtn');
    const usersManagementBtn = document.getElementById('usersManagementBtn');
    const serverStatsBtn = document.getElementById('serverStatsBtn');
    const systemConfigBtn = document.getElementById('systemConfigBtn');
    const backupBtn = document.getElementById('backupBtn');
    const logsBtn = document.getElementById('logsBtn');
    
    if (n8nBtn) {
        n8nBtn.addEventListener('click', handleN8nRedirect);
    }
    
    if (databaseBtn) {
        databaseBtn.addEventListener('click', handleDatabaseAccess);
    }
    
    if (usersManagementBtn) {
        usersManagementBtn.addEventListener('click', handleUsersManagement);
    }
    
    if (serverStatsBtn) {
        serverStatsBtn.addEventListener('click', handleServerStats);
    }
    
    if (systemConfigBtn) {
        systemConfigBtn.addEventListener('click', handleSystemConfig);
    }
    
    if (backupBtn) {
        backupBtn.addEventListener('click', handleBackup);
    }
    
    if (logsBtn) {
        logsBtn.addEventListener('click', handleLogs);
    }
    
    // Gestion des formulaires
    const loginForm = document.getElementById('loginForm');
    const registrationForm = document.getElementById('registrationForm');
    
    if (loginForm) {
        console.log('✅ loginForm trouvé');
        loginForm.addEventListener('submit', handleLogin);
    }
    
    if (registrationForm) {
        console.log('✅ registrationForm trouvé');
        registrationForm.addEventListener('submit', handleRegistration);
    }
    
    // Vérifier si l'utilisateur est déjà connecté
    checkAuthStatus();
});

function checkAuthStatus() {
    const token = localStorage.getItem('authToken');
    const userData = localStorage.getItem('userData');
    
    if (token && userData) {
        try {
            const user = JSON.parse(userData);
            console.log('👤 Utilisateur déjà connecté:', user.firstName);
            showDashboard(user);
        } catch (error) {
            console.error('❌ Erreur parsing user data:', error);
            localStorage.clear();
        }
    }
}

function showDashboard(user) {
    console.log('📊 Affichage dashboard pour:', user.firstName);
    
    // Cacher la page d'accueil
    const landingPage = document.getElementById('landingPage');
    const dashboardPage = document.getElementById('dashboardPage');
    
    if (landingPage) landingPage.style.display = 'none';
    if (dashboardPage) {
        dashboardPage.style.display = 'block';
        
        // Mettre à jour les informations utilisateur
        const userNameElement = document.querySelector('.user-name');
        const userEmailElement = document.querySelector('.user-email');
        
        if (userNameElement) {
            userNameElement.textContent = `${user.firstName} ${user.lastName}`;
        }
        if (userEmailElement) {
            userEmailElement.textContent = user.email;
        }
        
        // Vérifier si l'utilisateur est privilégié et afficher le bouton admin
        const adminPanelBtn = document.getElementById('adminPanelBtn');
        if (adminPanelBtn && typeof isPrivilegedUser === 'function') {
            if (isPrivilegedUser(user.email)) {
                adminPanelBtn.style.display = 'flex';
                console.log('👑 Utilisateur privilégié détecté - Bouton admin affiché');
            } else {
                adminPanelBtn.style.display = 'none';
                console.log('👤 Utilisateur standard - Bouton admin masqué');
            }
        }
        
        console.log('✅ Dashboard affiché');
    }
}

function showLandingPage() {
    console.log('🏠 Retour page d\'accueil');
    
    const landingPage = document.getElementById('landingPage');
    const dashboardPage = document.getElementById('dashboardPage');
    
    if (landingPage) landingPage.style.display = 'block';
    if (dashboardPage) dashboardPage.style.display = 'none';
}

// Fonction de gestion du login
async function handleLogin(event) {
    event.preventDefault();
    console.log('🔐 Tentative de connexion...');
    
    const form = event.target;
    const submitBtn = form.querySelector('.submit-btn');
    const originalText = submitBtn.innerHTML;
    
    const formData = {
        email: form.querySelector('#loginEmail').value.trim(),
        password: form.querySelector('#loginPassword').value
    };
    
    console.log('📧 Email:', formData.email);
    
    if (!formData.email || !formData.password) {
        console.error('❌ Champs manquants');
        showMessage('Tous les champs sont requis', 'error');
        return;
    }
    
    submitBtn.innerHTML = '<span class="button-text">Connexion...</span><div class="button-icon">⏳</div>';
    submitBtn.disabled = true;
    
    try {
        console.log('🌐 Envoi requête login...');
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData)
        });
        
        const data = await response.json();
        console.log('📨 Réponse serveur:', data);
        
        if (response.ok && data.success) {
            localStorage.setItem('authToken', data.token);
            localStorage.setItem('userData', JSON.stringify(data.user));
            
            closeModal('loginModal');
            showDashboard(data.user);
            showMessage(`Bienvenue ${data.user.firstName}!`, 'success');
            form.reset();
            console.log('✅ Connexion réussie');
        } else {
            throw new Error(data.error || 'Erreur lors de la connexion');
        }
        
    } catch (error) {
        console.error('❌ Erreur login:', error);
        showMessage(error.message || 'Erreur lors de la connexion', 'error');
    } finally {
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
    }
}

// Fonction de gestion de l'inscription
async function handleRegistration(event) {
    event.preventDefault();
    console.log('📝 Tentative d\'inscription...');
    
    const form = event.target;
    const submitBtn = form.querySelector('.submit-btn');
    const originalText = submitBtn.innerHTML;
    
    const formData = {
        firstName: form.querySelector('#firstName').value.trim(),
        lastName: form.querySelector('#lastName').value.trim(),
        email: form.querySelector('#email').value.trim(),
        password: form.querySelector('#password').value
    };
    
    console.log('👤 Inscription:', formData.firstName, formData.lastName, formData.email);
    
    if (!formData.firstName || !formData.lastName || !formData.email || !formData.password) {
        showMessage('Tous les champs sont requis', 'error');
        return;
    }
    
    if (formData.password.length < 6) {
        showMessage('Le mot de passe doit contenir au moins 6 caractères', 'error');
        return;
    }
    
    submitBtn.innerHTML = '<span class="button-text">Inscription...</span><div class="button-icon">⏳</div>';
    submitBtn.disabled = true;
    
    try {
        console.log('🌐 Envoi requête inscription...');
        const response = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData)
        });
        
        const data = await response.json();
        console.log('📨 Réponse serveur:', data);
        
        if (response.ok && data.success) {
            localStorage.setItem('authToken', data.token);
            localStorage.setItem('userData', JSON.stringify(data.user));
            
            closeModal('registerModal');
            showDashboard(data.user);
            showMessage(`Bienvenue ${data.user.firstName}! Compte créé avec succès.`, 'success');
            form.reset();
            console.log('✅ Inscription réussie');
        } else {
            throw new Error(data.error || 'Erreur lors de l\'inscription');
        }
        
    } catch (error) {
        console.error('❌ Erreur inscription:', error);
        showMessage(error.message || 'Erreur lors de l\'inscription', 'error');
    } finally {
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
    }
}

function openModal(modalId) {
    console.log('🔓 Ouverture modal:', modalId);
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'block';
        console.log('✅ Modal ouvert');
    } else {
        console.error('❌ Modal non trouvé:', modalId);
    }
}

function closeModal(modalId) {
    console.log('🔒 Fermeture modal:', modalId);
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'none';
        console.log('✅ Modal fermé');
    }
}

function showMessage(message, type = 'info') {
    console.log(`📢 Message ${type}:`, message);
    
    // Supprimer les anciennes notifications
    const existingNotifications = document.querySelectorAll('.notification');
    existingNotifications.forEach(notif => {
        if (notif.parentNode) {
            notif.parentNode.removeChild(notif);
        }
    });
    
    // Créer la nouvelle notification
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <div class="notification-content">
            <span class="notification-icon">${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}</span>
            <span class="notification-message">${message}</span>
        </div>
    `;
    
    // Style inline pour s'assurer que ça marche
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%) translateY(-100%);
        padding: 15px 20px;
        background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
        color: white;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 10000;
        opacity: 0;
        transition: all 0.3s ease;
        max-width: 400px;
        word-wrap: break-word;
        text-align: center;
    `;
    
    document.body.appendChild(notification);
    
    // Animation d'entrée
    setTimeout(() => {
        notification.style.opacity = '1';
        notification.style.transform = 'translateX(-50%) translateY(0)';
    }, 100);
    
    // Animation de sortie après 5 secondes
    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transform = 'translateX(-50%) translateY(-100%)';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 5000);
}

function handleLogout() {
    console.log('🚪 Déconnexion en cours...');
    
    // Supprimer les données locales
    localStorage.removeItem('authToken');
    localStorage.removeItem('userData');
    
    // Retourner à la page d'accueil
    showLandingPage();
    
    // Afficher message de confirmation
    showMessage('Vous avez été déconnecté avec succès', 'success');
    
    console.log('✅ Déconnexion réussie');
}

async function handleDeleteAccount() {
    console.log('🗑️ Demande de suppression de compte...');
    
    // Confirmation de suppression
    const confirmation = confirm('⚠️ ATTENTION ⚠️\n\nÊtes-vous sûr de vouloir supprimer définitivement votre compte ?\n\nCette action est irréversible et supprimera toutes vos données.');
    
    if (!confirmation) {
        console.log('❌ Suppression annulée par l\'utilisateur');
        return;
    }
    
    const token = localStorage.getItem('authToken');
    if (!token) {
        showMessage('Session expirée, veuillez vous reconnecter', 'error');
        handleLogout();
        return;
    }
    
    try {
        console.log('🌐 Envoi requête suppression...');
        const response = await fetch('/api/auth/account', {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await response.json();
        console.log('📨 Réponse serveur:', data);
        
        if (response.ok && data.success) {
            // Supprimer les données locales
            localStorage.removeItem('authToken');
            localStorage.removeItem('userData');
            
            // Fermer la modal des paramètres
            closeModal('settingsModal');
            
            // Retourner à la page d'accueil
            showLandingPage();
            
            // Afficher message de confirmation
            showMessage('Votre compte a été supprimé définitivement', 'success');
            
            console.log('✅ Compte supprimé avec succès');
        } else {
            throw new Error(data.error || 'Erreur lors de la suppression du compte');
        }
        
    } catch (error) {
        console.error('❌ Erreur suppression compte:', error);
        showMessage(error.message || 'Erreur lors de la suppression du compte', 'error');
    }
}

function handleAdminPanel() {
    console.log('⚙️ Ouverture du panneau admin...');
    
    // Fermer la modal des paramètres
    closeModal('settingsModal');
    
    // Pour l'instant, on affiche juste un message
    // Vous pouvez ici rediriger vers une page admin ou ouvrir une modale
    showMessage('� Panneau Admin - Fonctionnalité en développement', 'info');
    
    // Exemple d'actions admin possibles :
    // - Voir tous les utilisateurs
    // - Gérer les permissions
    // - Statistiques du serveur
    // - Configuration système
    
    console.log('👑 Accès admin autorisé pour cet utilisateur');
}
