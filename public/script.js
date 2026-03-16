function enterAsGuest() {
    // Generate a unique guest ID
    const guestId = 'Guest_' + Math.random().toString(36).substr(2, 9);
    // Store guest status and ID
    localStorage.setItem('userType', 'guest');
    localStorage.setItem('username', guestId);
    window.location.href = 'game-mode.html';
}

function showLoginForm(fromAccountCreation = false) {
    const loginModal = document.getElementById('loginModal');
    if (loginModal) {
        // Check if we need to show the success message
        const existingMessage = loginModal.querySelector('.success-message');
        if (fromAccountCreation && !existingMessage) {
            const message = document.createElement('div');
            message.className = 'success-message';
            message.textContent = 'Account created successfully! Please login.';
            loginModal.querySelector('.modal-content').insertBefore(
                message, 
                loginModal.querySelector('form')
            );
        }

        loginModal.classList.remove('hidden');
        // Add fade-in animation
        loginModal.style.opacity = 0;
        setTimeout(() => {
            loginModal.style.transition = 'opacity 0.3s ease-in-out';
            loginModal.style.opacity = 1;
        }, 10);
    }
}

function showCreateAccount() {
    const createAccountModal = document.getElementById('createAccountModal');
    if (createAccountModal) {
        createAccountModal.classList.remove('hidden');
        // Add fade-in animation
        createAccountModal.style.opacity = 0;
        setTimeout(() => {
            createAccountModal.style.transition = 'opacity 0.3s ease-in-out';
            createAccountModal.style.opacity = 1;
        }, 10);
    }
}

function showGameModeSelection() {
    const registrationForm = document.getElementById('registrationForm');
    const gameModeSelection = document.getElementById('gameModeSelection');
    
    registrationForm.classList.add('hidden');
    gameModeSelection.classList.remove('hidden');
    
    // Add fade-in animation
    gameModeSelection.style.opacity = 0;
    setTimeout(() => {
        gameModeSelection.style.transition = 'opacity 0.5s ease-in-out';
        gameModeSelection.style.opacity = 1;
    }, 100);
}

function selectGameMode(mode) {
    if (mode === 'single') {
        window.location.href = 'single-player.html';
    } else if (mode === 'multiplayer') {
        window.location.href = 'lobby.html';
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        // Remove success message if it exists
        const successMessage = modal.querySelector('.success-message');
        if (successMessage) {
            successMessage.remove();
        }

        // Add fade-out animation
        modal.style.opacity = 0;
        setTimeout(() => {
            modal.classList.add('hidden');
            // Reset opacity for next opening
            modal.style.opacity = 1;
        }, 300);
    }
}

function togglePassword(inputId, button) {
    const passwordInput = document.getElementById(inputId);
    if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
        button.textContent = '👁️‍🗨️';
    } else {
        passwordInput.type = 'password';
        button.textContent = '👁️';
    }
}

// Update the event listener setup to wait for DOM content to load
document.addEventListener('DOMContentLoaded', function() {
    addLoginStyles();

    // Button click handlers (replacing inline onclick attributes)
    var guestBtn = document.getElementById('guestBtn');
    if (guestBtn) guestBtn.addEventListener('click', enterAsGuest);

    var loginBtn = document.getElementById('loginBtn');
    if (loginBtn) loginBtn.addEventListener('click', function() { showLoginForm(); });

    var createAccountBtn = document.getElementById('createAccountBtn');
    if (createAccountBtn) createAccountBtn.addEventListener('click', showCreateAccount);

    var singlePlayerBtn = document.getElementById('singlePlayerBtn');
    if (singlePlayerBtn) singlePlayerBtn.addEventListener('click', function() { selectGameMode('single'); });

    var multiplayerBtn = document.getElementById('multiplayerBtn');
    if (multiplayerBtn) multiplayerBtn.addEventListener('click', function() { selectGameMode('multiplayer'); });

    var backBtn = document.getElementById('backBtn');
    if (backBtn) backBtn.addEventListener('click', goBack);

    var toggleLoginPassword = document.getElementById('toggleLoginPassword');
    if (toggleLoginPassword) toggleLoginPassword.addEventListener('click', function() { togglePassword('loginPassword', this); });

    var toggleCreatePassword = document.getElementById('toggleCreatePassword');
    if (toggleCreatePassword) toggleCreatePassword.addEventListener('click', function() { togglePassword('createPassword', this); });

    var cancelLoginBtn = document.getElementById('cancelLoginBtn');
    if (cancelLoginBtn) cancelLoginBtn.addEventListener('click', function() { closeModal('loginModal'); });

    var cancelCreateBtn = document.getElementById('cancelCreateBtn');
    if (cancelCreateBtn) cancelCreateBtn.addEventListener('click', function() { closeModal('createAccountModal'); });

    // Form submission handlers
    const loginForm = document.getElementById('loginForm');
    const createAccountForm = document.getElementById('createAccountForm');

    if (loginForm) {
        loginForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            const username = document.getElementById('loginUsername').value;
            const password = document.getElementById('loginPassword').value;
            
            try {
                const response = await fetch('/api/login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ username, password })
                });

                const data = await response.json();
                
                if (response.ok) {
                    // Store token, username and user type
                    localStorage.setItem('token', data.token);
                    localStorage.setItem('username', data.username);
                    localStorage.setItem('userType', 'registered');

                    // Clear any localStorage theme preferences from guest sessions
                    localStorage.removeItem('boardTheme');
                    localStorage.removeItem('singlePlayerTheme');

                    closeModal('loginModal');
                    // Redirect to game mode selection page
                    window.location.href = 'game-mode.html';
                } else {
                    showLoginError(data.message);
                }
            } catch (error) {
                console.error('Login error:', error);
                showLoginError('Error during login. Please try again.');
            }
        });
    }

    if (createAccountForm) {
        createAccountForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            const username = document.getElementById('createUsername').value;
            const password = document.getElementById('createPassword').value;
            
            try {
                const response = await fetch('/api/register', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ username, password })
                });

                const data = await response.json();
                
                if (response.ok) {
                    createAccountForm.reset();
                    closeModal('createAccountModal');
                    setTimeout(() => {
                        document.getElementById('loginUsername').value = username;
                        showLoginForm(true);
                    }, 400);
                } else {
                    // Show error in the create account form
                    showCreateAccountError(data.message);
                }
            } catch (error) {
                console.error('Registration error:', error);
                showCreateAccountError('Error during registration. Please try again.');
            }
        });
    }
});

// Improve modal outside click handling
window.addEventListener('click', function(event) {
    const modals = document.getElementsByClassName('modal');
    for (let modal of modals) {
        if (event.target === modal) {
            closeModal(modal.id);
        }
    }
});

// Add this new function
function goBack() {
    const registrationForm = document.getElementById('registrationForm');
    const gameModeSelection = document.getElementById('gameModeSelection');
    
    // Fade out game mode selection
    gameModeSelection.style.opacity = 0;
    
    setTimeout(() => {
        gameModeSelection.classList.add('hidden');
        registrationForm.classList.remove('hidden');
        
        // Fade in registration form
        registrationForm.style.opacity = 0;
        registrationForm.style.transition = 'opacity 0.5s ease-in-out';
        
        setTimeout(() => {
            registrationForm.style.opacity = 1;
        }, 10);
    }, 300);
}

// Add this new function for showing login errors
function showLoginError(message) {
    const loginForm = document.getElementById('loginForm');
    
    // Remove existing error message if any
    const existingError = loginForm.querySelector('.error-message');
    if (existingError) {
        existingError.remove();
    }
    
    // Create and show new error message
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = message;
    
    // Insert error message before the form buttons
    const modalButtons = loginForm.querySelector('.modal-buttons');
    loginForm.insertBefore(errorDiv, modalButtons);
    
    // Shake animation for the form
    loginForm.style.animation = 'shake 0.5s';
    setTimeout(() => {
        loginForm.style.animation = '';
    }, 500);
}

// Add this new function for showing create account errors
function showCreateAccountError(message) {
    const createAccountForm = document.getElementById('createAccountForm');
    
    // Remove existing error message if any
    const existingError = createAccountForm.querySelector('.error-message');
    if (existingError) {
        existingError.remove();
    }
    
    // Create and show new error message
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = message;
    
    // Insert error message before the form buttons
    const modalButtons = createAccountForm.querySelector('.modal-buttons');
    createAccountForm.insertBefore(errorDiv, modalButtons);
    
    // Shake animation for the form
    createAccountForm.style.animation = 'shake 0.5s';
    setTimeout(() => {
        createAccountForm.style.animation = '';
    }, 500);
}

// Add this to your existing CSS
function addLoginStyles() {
    const style = document.createElement('style');
    style.textContent = `
        .error-message {
            background: rgba(255, 0, 0, 0.1);
            color: #ff4444;
            padding: 10px;
            margin-bottom: 20px;
            border: 1px solid #ff4444;
            border-radius: 5px;
            text-align: center;
            animation: fadeIn 0.5s ease-in-out;
        }

        @keyframes shake {
            0%, 100% { transform: translateX(0); }
            25% { transform: translateX(-10px); }
            75% { transform: translateX(10px); }
        }
    `;
    document.head.appendChild(style);
}
 