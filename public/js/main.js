// MCP Wesype - JavaScript principal
console.log('🚀 MCP Wesype Frontend chargé');

document.addEventListener('DOMContentLoaded', function() {
    console.log('✅ DOM chargé');
    
    // Initialisation
    initializeButtons();
    initializeModals();
    initializeForms();
    checkAuthStatus();

    // MCP TOOLS BUTTONS - Show tool page in-app
    const MCP_TOOLS = {
        axonaut: {
            logo: 'https://www.axonaut.com/favicon.ico',
            name: 'Axonaut',
            desc: 'Synchronisez vos données Axonaut pour une gestion intelligente avec MCP Wesype.'
        },
        gmail: {
            logo: 'https://ssl.gstatic.com/ui/v1/icons/mail/rfr/gmail.ico',
            name: 'Gmail',
            desc: 'Connectez votre boîte Gmail pour automatiser vos emails avec MCP Wesype.'
        }
    };
    const axonautBtn = document.getElementById('axonautBtn');
    const gmailBtn = document.getElementById('gmailBtn');
    const toolPage = document.getElementById('toolPage');
    const toolLogo = document.getElementById('toolLogo');
    const toolTitle = document.getElementById('toolTitle');
    const toolDesc = document.getElementById('toolDesc');
    const toolSetupBtn = document.getElementById('toolSetupBtn');
    function showToolPage(toolKey) {
        const tool = MCP_TOOLS[toolKey];
        if (!tool) return;
        // Masquer tout le dashboard sauf la page tool
        const dashboardContent = document.querySelector('.dashboard-content');
        if (dashboardContent) dashboardContent.style.display = 'none';
        if (toolPage) {
            toolLogo.src = tool.logo;
            toolTitle.textContent = `MCP ${tool.name} Wesype`;
            toolDesc.textContent = tool.desc;
            toolPage.style.display = 'block';
        }
    }

    // Permet de revenir au dashboard (optionnel, à ajouter si besoin)
    window.showDashboardContent = function() {
        const dashboardContent = document.querySelector('.dashboard-content');
        if (dashboardContent) dashboardContent.style.display = '';
        if (toolPage) toolPage.style.display = 'none';
    };
    if (axonautBtn) {
        axonautBtn.addEventListener('click', function() {
            window.location.href = '/axonaut.html';
        });
    }
    if (gmailBtn) {
        gmailBtn.addEventListener('click', function() {
            window.location.href = '/gmail.html';
        });
    }
    if (toolSetupBtn) {
        toolSetupBtn.addEventListener('click', function() {
            // Setup action à venir
        });
    }
    
    console.log('⚡ Application initialisée');
});

// === GESTION DES BOUTONS ===
function initializeButtons() {
    // Bouton N8N (si présent)
    const n8nBtn = document.getElementById('n8nBtn');
    if (n8nBtn) {
        n8nBtn.addEventListener('click', function(e) {
            e.preventDefault();
            window.open('https://n8n.gchamore.com', '_blank');
        });
    }
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
    // Mettre à jour le nom affiché
    const userNameSpan = document.querySelector('.user-name');
    if (userNameSpan) {
        if (user.firstName && user.lastName) {
            userNameSpan.textContent = user.firstName + ' ' + user.lastName;
        } else if (user.firstName) {
            userNameSpan.textContent = user.firstName;
        } else {
            userNameSpan.textContent = user.email;
        }
    }
    
    // Vérifier si l'utilisateur est privilégié
    if (window.isPrivilegedUser && window.isPrivilegedUser(user.email)) {
        const adminBtn = document.getElementById('adminPanelBtn');
        if (adminBtn) {
            adminBtn.style.display = 'block';
        }
    }
        // Masquer le bouton panneau admin si l'utilisateur n'est pas privilégié
        const adminBtn = document.getElementById('adminPanelBtn');
        if (adminBtn && typeof window.isPrivilegedUser === 'function') {
            if (!window.isPrivilegedUser(user.email)) {
                adminBtn.style.display = 'none';
            } else {
                adminBtn.style.display = '';
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
    
    // Fermer toutes les modales ouvertes
    ['settingsModal', 'adminModal', 'loginModal', 'registerModal'].forEach(modalId => {
        const modal = document.getElementById(modalId);
        if (modal && modal.style.display === 'block') {
            closeModal(modalId);
        }
    });
    
    // Supprimer les données de session
    localStorage.removeItem('authToken');
    localStorage.removeItem('userData');
    
    showMessage('👋 Déconnexion réussie', 'info');
    
    // Attendre un peu pour que les modales se ferment puis afficher la landing page
    setTimeout(() => {
        showLandingPage();
    }, 400);
}

async function handleDeleteAccount() {
    // Empêcher les clics multiples
    const deleteBtn = document.getElementById('deleteAccountBtn');
    if (deleteBtn && deleteBtn.disabled) {
        console.log('🚫 Suppression déjà en cours...');
        return;
    }
    
    const confirmation = confirm('⚠️ Êtes-vous sûr de vouloir supprimer votre compte ? Cette action est irréversible.');
    
    if (!confirmation) return;
    
    // Désactiver le bouton pendant le traitement
    if (deleteBtn) {
        deleteBtn.disabled = true;
        deleteBtn.innerHTML = '<span class="button-text">Suppression...</span><div class="button-icon">⏳</div>';
    }
    
    try {
        const token = localStorage.getItem('authToken');
        if (!token) {
            showMessage('❌ Non connecté', 'error');
            return;
        }
        
        const response = await fetch('/api/auth/account', {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Fermer la modal des paramètres avant la déconnexion
            closeModal('settingsModal');
            
            // Nettoyer les données de session sans notification
            localStorage.removeItem('authToken');
            localStorage.removeItem('userData');
            
            // Attendre un peu pour que la modal se ferme
            setTimeout(() => {
                showMessage('✅ Compte supprimé avec succès', 'success');
                
                // Fermer toutes les modales et revenir à la landing page
                setTimeout(() => {
                    ['adminModal', 'loginModal', 'registerModal'].forEach(modalId => {
                        const modal = document.getElementById(modalId);
                        if (modal && modal.style.display === 'block') {
                            closeModal(modalId);
                        }
                    });
                    showLandingPage();
                }, 1000);
            }, 300);
        } else {
            showMessage(`❌ ${data.error}`, 'error');
        }
    } catch (error) {
        console.error('Erreur suppression compte:', error);
        showMessage('❌ Erreur lors de la suppression', 'error');
    } finally {
        // Réactiver le bouton
        if (deleteBtn) {
            deleteBtn.disabled = false;
            deleteBtn.innerHTML = '<span class="button-text">Supprimer le compte</span><div class="button-icon">🗑️</div>';
        }
    }
}

function handleAdminPanel() {
    console.log('👑 Ouverture panneau admin...');
    closeModal('settingsModal');
    openModal('adminModal');
}

// === SYSTÈME DE MESSAGES ===
let activeNotifications = [];

function showMessage(message, type = 'info') {
    console.log(`💬 Message ${type}:`, message);
    
    // Supprimer les notifications existantes du même type
    activeNotifications.forEach(notification => {
        if (notification.classList.contains(`notification-${type}`)) {
            notification.style.opacity = '0';
            notification.style.transform = 'translateX(-50%) translateY(-20px)';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                    activeNotifications = activeNotifications.filter(n => n !== notification);
                }
            }, 300);
        }
    });
    
    // Créer un élément de notification
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    
    // Styles pour la notification
    notification.style.cssText = `
        position: fixed;
        top: ${20 + (activeNotifications.length * 70)}px;
        left: 50%;
        transform: translateX(-50%) translateY(-20px);
        padding: 16px 24px;
        border-radius: 12px;
        color: white;
        font-weight: 500;
        z-index: 1000;
        opacity: 0;
        transition: all 0.3s ease;
        max-width: 400px;
        word-wrap: break-word;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        text-align: center;
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
    
    // Ajouter au DOM et à la liste des notifications actives
    document.body.appendChild(notification);
    activeNotifications.push(notification);
    
    // Animation d'entrée
    setTimeout(() => {
        notification.style.opacity = '1';
        notification.style.transform = 'translateX(-50%) translateY(0)';
    }, 100);
    
    // Suppression automatique
    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transform = 'translateX(-50%) translateY(-20px)';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
                activeNotifications = activeNotifications.filter(n => n !== notification);
                
                // Réorganiser les notifications restantes
                activeNotifications.forEach((notif, index) => {
                    notif.style.top = `${20 + (index * 70)}px`;
                });
            }
        }, 300);
    }, 4000);
}

console.log('⚡ JavaScript principal chargé et prêt !');
