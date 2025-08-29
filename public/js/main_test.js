// MCP Wesype - Test JavaScript simple
console.log('🚀 Test JavaScript chargé');

document.addEventListener('DOMContentLoaded', function() {
    console.log('✅ DOM chargé');
    
    // Test simple des boutons
    const loginBtn = document.getElementById('loginBtn');
    const registerBtn = document.getElementById('registerBtn');
    
    console.log('loginBtn:', loginBtn);
    console.log('registerBtn:', registerBtn);
    
    if (loginBtn) {
        loginBtn.addEventListener('click', function(e) {
            e.preventDefault();
            console.log('🖱️ Clic login détecté');
            alert('Login cliqué!');
        });
    }
    
    if (registerBtn) {
        registerBtn.addEventListener('click', function(e) {
            e.preventDefault();
            console.log('🖱️ Clic register détecté');
            alert('Register cliqué!');
        });
    }
});
