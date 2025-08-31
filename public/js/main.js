// MCP Wesype - JavaScript principal
console.log('🚀 MCP Wesype Frontend chargé');

document.addEventListener('DOMContentLoaded', function() {
    console.log('✅ DOM chargé');
    
    // Initialisation
    initializeButtons();
    initializeModals();
    initializeForms();
    checkAuthStatus();
    
    console.log('⚡ Application initialisée');
});

// === GESTION DES BOUTONS ===
function initializeButtons() {
    // Boutons principaux
    const loginBtn = document.getElementById('loginBtn');
    const registerBtn = document.getElementById('registerBtn');
    
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
    
    // Boutons dashboard
    const logoutBtn = document.getElementById('logoutBtn');
    const settingsBtn = document.getElementById('settingsBtn');
    const deleteAccountBtn = document.getElementById('deleteAccountBtn');
    const adminPanelBtn = document.getElementById('adminPanelBtn');
    
    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }
    
    if (settingsBtn) {
        settingsBtn.addEventListener('click', function() {
            openModal('settingsModal');
        });
    }
    
    if (deleteAccountBtn) {
        deleteAccountBtn.addEventListener('click', handleDeleteAccount);
    }
    
    if (adminPanelBtn) {
        adminPanelBtn.addEventListener('click', handleAdminPanel);
    }
}

// === GESTION DES MODALES ===
function initializeModals() {
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
            closeModal(event.target.id);
        }
    });
}

function openModal(modalId) {
    console.log(`📱 Ouverture modal: ${modalId}`);
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'block';
        // Animation d'entrée
        setTimeout(() => {
            modal.classList.add('modal-open');
        }, 10);
    }
}

function closeModal(modalId) {
    console.log(`📱 Fermeture modal: ${modalId}`);
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('modal-open');
        setTimeout(() => {
            modal.style.display = 'none';
        }, 300);
    }
}

// === GESTION DES FORMULAIRES ===
function initializeForms() {
    const loginForm = document.getElementById('loginForm');
    const registrationForm = document.getElementById('registrationForm');
    
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }
    
    if (registrationForm) {
        registrationForm.addEventListener('submit', handleRegistration);
    }
}

async function handleLogin(event) {
    event.preventDefault();
    console.log('🔑 Tentative de connexion...');
    
    const form = event.target;
    const email = form.querySelector('#loginEmail').value.trim();
    const password = form.querySelector('#loginPassword').value;
    
    if (!email || !password) {
        showMessage('❌ Veuillez remplir tous les champs', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email, password })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showMessage('✅ Connexion réussie !', 'success');
            localStorage.setItem('authToken', data.token);
            localStorage.setItem('userData', JSON.stringify(data.user));
            closeModal('loginModal');
            showDashboard(data.user);
        } else {
            showMessage(`❌ ${data.error}`, 'error');
        }
    } catch (error) {
        console.error('Erreur connexion:', error);
        showMessage('❌ Erreur de connexion au serveur', 'error');
    }
}

async function handleRegistration(event) {
    event.preventDefault();
    console.log('📝 Tentative d\'inscription...');
    
    const form = event.target;
    const formData = {
        firstName: form.querySelector('#firstName').value.trim(),
        lastName: form.querySelector('#lastName').value.trim(),
        email: form.querySelector('#email').value.trim(),
        password: form.querySelector('#password').value
    };
    
    // Validation côté client
    if (!formData.firstName || !formData.lastName || !formData.email || !formData.password) {
        showMessage('❌ Veuillez remplir tous les champs', 'error');
        return;
    }
    
    if (formData.password.length < 6) {
        showMessage('❌ Le mot de passe doit contenir au moins 6 caractères', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/auth/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(formData)
        });
        
        const data = await response.json();
        
        if (data.success) {
            showMessage('✅ Inscription réussie !', 'success');
            localStorage.setItem('authToken', data.token);
            localStorage.setItem('userData', JSON.stringify(data.user));
            closeModal('registerModal');
            showDashboard(data.user);
        } else {
            showMessage(`❌ ${data.error}`, 'error');
        }
    } catch (error) {
        console.error('Erreur inscription:', error);
        showMessage('❌ Erreur de connexion au serveur', 'error');
    }
}

// === GESTION DU DASHBOARD ===
function checkAuthStatus() {
    const token = localStorage.getItem('authToken');
    const userData = localStorage.getItem('userData');
    
    if (token && userData) {
        try {
            const user = JSON.parse(userData);
            showDashboard(user);
        } catch (error) {
            console.error('Erreur parsing user data:', error);
            localStorage.removeItem('authToken');
            localStorage.removeItem('userData');
        }
    }
}

function showDashboard(user) {
    console.log('📊 Affichage dashboard pour:', user.email);
    
    // Masquer la landing page
    const landingPage = document.getElementById('landingPage');
    const dashboardPage = document.getElementById('dashboardPage');
    
    if (landingPage) landingPage.style.display = 'none';
    if (dashboardPage) dashboardPage.style.display = 'block';
    
    // Mettre à jour les informations utilisateur
    const userEmailSpan = document.querySelector('.user-email');
    if (userEmailSpan) {
        userEmailSpan.textContent = user.email;
    }
    
    // Vérifier si l'utilisateur est privilégié
    if (window.isPrivilegedUser && window.isPrivilegedUser(user.email)) {
        const adminBtn = document.getElementById('adminPanelBtn');
        if (adminBtn) {
            adminBtn.style.display = 'block';
        }
    }
}

function showLandingPage() {
    console.log('🏠 Affichage landing page');
    
    const landingPage = document.getElementById('landingPage');
    const dashboardPage = document.getElementById('dashboardPage');
    
    if (landingPage) landingPage.style.display = 'block';
    if (dashboardPage) dashboardPage.style.display = 'none';
}

function handleLogout() {
    console.log('👋 Déconnexion...');
    
    localStorage.removeItem('authToken');
    localStorage.removeItem('userData');
    
    showMessage('👋 Déconnexion réussie', 'info');
    showLandingPage();
}

async function handleDeleteAccount() {
    const confirmation = confirm('⚠️ Êtes-vous sûr de vouloir supprimer votre compte ? Cette action est irréversible.');
    
    if (!confirmation) return;
    
    try {
        const response = await fetch('/api/auth/account', {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            }
        });
        
        const data = await response.json();
        
        if (data.success) {
            showMessage('✅ Compte supprimé avec succès', 'success');
            handleLogout();
        } else {
            showMessage(`❌ ${data.error}`, 'error');
        }
    } catch (error) {
        console.error('Erreur suppression compte:', error);
        showMessage('❌ Erreur lors de la suppression', 'error');
    }
}

function handleAdminPanel() {
    console.log('👑 Ouverture panneau admin...');
    closeModal('settingsModal');
    openModal('adminModal');
}

// === SYSTÈME DE MESSAGES ===
function showMessage(message, type = 'info') {
    console.log(`💬 Message ${type}:`, message);
    
    // Créer un élément de notification
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    
    // Styles pour la notification
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 16px 24px;
        border-radius: 12px;
        color: white;
        font-weight: 500;
        z-index: 1000;
        opacity: 0;
        transform: translateX(100%);
        transition: all 0.3s ease;
        max-width: 400px;
        word-wrap: break-word;
    `;
    
    // Couleurs selon le type
    switch (type) {
        case 'success':
            notification.style.backgroundColor = '#10b981';
            break;
        case 'error':
            notification.style.backgroundColor = '#ef4444';
            break;
        case 'warning':
            notification.style.backgroundColor = '#f59e0b';
            break;
        default:
            notification.style.backgroundColor = '#3b82f6';
    }
    
    // Ajouter au DOM
    document.body.appendChild(notification);
    
    // Animation d'entrée
    setTimeout(() => {
        notification.style.opacity = '1';
        notification.style.transform = 'translateX(0)';
    }, 100);
    
    // Suppression automatique
    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 4000);
}

console.log('⚡ JavaScript principal chargé et prêt !');
