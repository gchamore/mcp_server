// MCP Wesype - Client-side JavaScript
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 MCP Wesype Frontend loaded');
    
    // Éléments DOM
    const registrationForm = document.getElementById('registrationForm');
    const statusDot = document.querySelector('.status-dot');
    
    // Gestion du formulaire d'inscription
    if (registrationForm) {
        registrationForm.addEventListener('submit', handleRegistration);
    }
    
    // Vérification du statut du serveur
    checkServerStatus();
    
    // Vérification périodique du statut (toutes les 30 secondes)
    setInterval(checkServerStatus, 30000);
});

async function handleRegistration(event) {
    event.preventDefault();
    
    const form = event.target;
    const button = form.querySelector('#registerBtn');
    const originalText = button.innerHTML;
    
    // Récupération des données du formulaire
    const formData = {
        firstName: form.querySelector('#firstName').value.trim(),
        lastName: form.querySelector('#lastName').value.trim(),
        email: form.querySelector('#email').value.trim(),
        password: form.querySelector('#password').value
    };
    
    // Validation côté client
    if (!formData.firstName || !formData.lastName || !formData.email || !formData.password) {
        showMessage('Tous les champs sont requis', 'error');
        return;
    }
    
    if (formData.password.length < 6) {
        showMessage('Le mot de passe doit contenir au moins 6 caractères', 'error');
        return;
    }
    
    // Animation du bouton
    button.innerHTML = '<span class="button-text">Processing...</span><div class="button-icon">⏳</div>';
    button.disabled = true;
    
    try {
        const response = await fetch('/api/auth/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(formData)
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            // Succès
            button.innerHTML = '<span class="button-text">Succès!</span><div class="button-icon">✓</div>';
            button.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
            
            showMessage(`Bienvenue ${data.user.firstName}! Votre compte a été créé avec succès.`, 'success');
            
            // Sauvegarder le token
            if (data.token) {
                localStorage.setItem('authToken', data.token);
                localStorage.setItem('userData', JSON.stringify(data.user));
            }
            
            // Réinitialiser le formulaire après 2 secondes
            setTimeout(() => {
                form.reset();
                button.innerHTML = originalText;
                button.disabled = false;
                button.style.background = '';
            }, 2000);
            
        } else {
            // Erreur
            throw new Error(data.error || 'Erreur lors de l\'inscription');
        }
        
    } catch (error) {
        console.error('Registration error:', error);
        
        // Affichage de l'erreur
        button.innerHTML = '<span class="button-text">Erreur</span><div class="button-icon">⚠️</div>';
        button.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
        
        showMessage(error.message || 'Erreur lors de l\'inscription', 'error');
        
        // Retour à l'état normal après 3 secondes
        setTimeout(() => {
            button.innerHTML = originalText;
            button.disabled = false;
            button.style.background = '';
        }, 3000);
    }
}

function showMessage(message, type = 'info') {
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
            notification.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
            break;
        case 'error':
            notification.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
            break;
        default:
            notification.style.background = 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)';
    }
    
    document.body.appendChild(notification);
    
    // Animation d'entrée
    setTimeout(() => {
        notification.style.opacity = '1';
        notification.style.transform = 'translateX(0)';
    }, 100);
    
    // Suppression automatique après 5 secondes
    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 5000);
}

async function checkServerStatus() {
    try {
        const response = await fetch('/health');
        const data = await response.json();
        
        if (data.status === 'OK') {
            updateStatusIndicator(true);
            console.log('✅ Server status: OK');
        } else {
            updateStatusIndicator(false);
        }
        
    } catch (error) {
        console.error('Health check failed:', error);
        updateStatusIndicator(false);
    }
}

function updateStatusIndicator(isOnline) {
    const statusDot = document.querySelector('.status-dot');
    const statusText = document.querySelector('.status-indicator span:last-child');
    
    if (statusDot && statusText) {
        if (isOnline) {
            statusDot.style.background = '#10b981';
            statusText.textContent = 'Service en ligne';
        } else {
            statusDot.style.background = '#ef4444';
            statusText.textContent = 'Service hors ligne';
        }
    }
}

// Effets visuels supplémentaires
function addInteractiveEffects() {
    // Effet de parallax subtle sur le container
    document.addEventListener('mousemove', function(e) {
        const container = document.querySelector('.container');
        const rect = container.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        
        const deltaX = (e.clientX - centerX) / rect.width;
        const deltaY = (e.clientY - centerY) / rect.height;
        
        container.style.transform = `perspective(1000px) rotateY(${deltaX * 2}deg) rotateX(${-deltaY * 2}deg)`;
    });
    
    // Reset de la transformation quand la souris quitte
    document.addEventListener('mouseleave', function() {
        const container = document.querySelector('.container');
        container.style.transform = 'perspective(1000px) rotateY(0deg) rotateX(0deg)';
    });
}

// Initialiser les effets interactifs
addInteractiveEffects();
