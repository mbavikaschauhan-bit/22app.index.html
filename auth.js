// Authentication UI and handlers
(function() {
    'use strict';
    
    // Wait for required dependencies
    function initAuth() {
        if (typeof window.auth === 'undefined' || 
            typeof window.appState === 'undefined' || 
            typeof window.utils === 'undefined' ||
            typeof window.updateLiveClock === 'undefined' ||
            typeof window.setupSupabaseListeners === 'undefined' ||
            typeof window.loadUserDataOnly === 'undefined' ||
            typeof window.navigateTo === 'undefined' ||
            typeof window.applyTheme === 'undefined' ||
            typeof window.loadProfileData === 'undefined') {
            setTimeout(initAuth, 50);
            return;
        }
        
        console.log('Initializing auth UI...');
        
        const auth = window.auth;
        const appState = window.appState;
        const showToast = window.utils.showToast;
        const toggleSpinner = window.utils.toggleSpinner;
        
        // Get required DOM elements
        const authContainer = document.getElementById('auth-container');
        const appContainer = document.getElementById('app-container');
        const authForm = document.getElementById('auth-form');
        const authTitle = document.getElementById('auth-title');
        const authSubmitBtn = document.getElementById('auth-submit-btn').querySelector('.btn-text');
        const authToggleLink = document.getElementById('auth-toggle-link');
        const authMessage = document.getElementById('auth-message');
        
        // Track previous session to detect real login vs token refresh
        let previousSession = null;
        let isInitialLoad = true;
        let authMode = 'signin'; // 'signin' or 'signup'

        // --- AUTH FORM TOGGLE (Signin/Signup) ---
        authToggleLink.addEventListener('click', (e) => {
            e.preventDefault();
            authMode = authMode === 'signin' ? 'signup' : 'signin';
            authMessage.textContent = '';
            if (authMode === 'signin') {
                authTitle.textContent = 'Sign In';
                authSubmitBtn.textContent = 'Sign In';
                authToggleLink.textContent = "Don't have an account? Sign up";
            } else {
                authTitle.textContent = 'Sign Up';
                authSubmitBtn.textContent = 'Create Account';
                authToggleLink.textContent = "Already have an account? Sign in";
            }
        });

        // --- AUTH FORM SUBMIT ---
        authForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('auth-email').value;
            const password = document.getElementById('auth-password').value;
            const button = document.getElementById('auth-submit-btn');
            
            toggleSpinner(button, true);
            authMessage.textContent = '';

            try {
                if (authMode === 'signin') {
                    await auth.signIn(email, password);
                } else {
                    await auth.signUp(email, password);
                    showToast('Welcome! Please check your email to confirm your account.', 'success');
                }
            } catch (error) {
                console.error('Auth form error:', error);
                authMessage.textContent = error.message || 'Authentication failed. Please try again.';
                authMessage.style.color = 'red';
            } finally {
                toggleSpinner(button, false);
            }
        });

        // --- AUTHENTICATION STATE CHANGE HANDLER ---
        auth.onAuthStateChanged(async (user) => {
            console.log('Auth state changed:', user ? 'User logged in' : 'User logged out');
            
            if (user) {
                // Check if this is a real login or just token refresh
                const isRealLogin = !previousSession || isInitialLoad;
                
                if (isRealLogin) {
                    console.log('Real login detected - running full initialization');
                    
                    appState.user = user;
                    
                    // Show loading state to prevent jitter - will be updated when profile data loads
                    document.getElementById('user-display-name').textContent = 'Loading...';
                    console.log('User logged in - showing app container');
                    
                    // Switch containers immediately for smoother transition
                    authContainer.classList.remove('show');
                    appContainer.classList.add('show');
                    
                    appState.unsubscribeTrades();
                    appState.unsubscribeLedger();
                    appState.unsubscribeProfile();
                    appState.unsubscribeChallenge();
                    appState.unsubscribeChallengeHistory();

                    if (appState.clockIntervalId) clearInterval(appState.clockIntervalId);
                    
                    // Call functions from global scope
                    window.updateLiveClock();
                    appState.clockIntervalId = setInterval(window.updateLiveClock, 1000);

                    window.setupSupabaseListeners();
                    
                    // Get the saved page first
                    const savedPage = localStorage.getItem('currentPage') || 'dashboard';
                    
                    // Set the correct page as active BEFORE loading data to prevent flicker
                    const pages = document.querySelectorAll('.page');
                    const navItems = document.querySelectorAll('.nav-item');
                    
                    // Set the correct page as active immediately
                    pages.forEach(p => p.classList.remove('active'));
                    const targetPage = document.getElementById(savedPage);
                    if (targetPage) targetPage.classList.add('active');
                    
                    // Set the correct nav item as active
                    navItems.forEach(item => item.classList.remove('active'));
                    const activeNavItem = document.querySelector(`.nav-item[data-page="${savedPage}"]`);
                    if (activeNavItem) activeNavItem.classList.add('active');
                    
                    // Load all user data including challenges (without rendering all pages)
                    await window.loadUserDataOnly();
                    
                    // Navigate to the saved page (this will trigger page-specific logic)
                    window.navigateTo(savedPage);
                    window.applyTheme();
                    
                    // Load profile data immediately to update header with actual name
                    if (appState.user?.id) {
                        window.loadProfileData();
                    }
                } else {
                    console.log('Token refresh detected - skipping initialization to prevent auto refresh');
                    // Silent token refresh - no visual changes, no data reloading
                    // Just update the user reference silently
                    appState.user = user;
                }
                
                // Update session tracking
                previousSession = user;
                isInitialLoad = false;
            } else {
                appState.user = null;
                appContainer.classList.remove('show');
                authContainer.classList.add('show');
                console.log('User logged out - showing auth container');
                if (appState.clockIntervalId) clearInterval(appState.clockIntervalId);
                appState.clockIntervalId = null;
                
                // Reset session tracking
                previousSession = null;
                isInitialLoad = true;
            }
        });

        // --- LOGOUT BUTTON HANDLER ---
        document.querySelectorAll('.logout-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                console.log('Logout button clicked');
                try {
                    await auth.signOut();
                    console.log('Supabase signOut completed');
                } catch (error) {
                    console.error('Supabase signOut error:', error);
                }
                
                // Force UI update to ensure proper logout state
                console.log('Forcing UI logout state');
                appState.user = null;
                
                // Force hide app container
                appContainer.classList.remove('show');
                console.log('App container hidden');
                
                // Force show auth container
                authContainer.classList.add('show');
                console.log('Auth container shown');
                
                // Clear intervals
                if (appState.clockIntervalId) clearInterval(appState.clockIntervalId);
                appState.clockIntervalId = null;
                
                // Clear all data
                appState.trades = [];
                appState.ledger = [];
                appState.challenge = null;
                appState.challengeHistory = [];
                
                showToast("You have been signed out.", "info");
                console.log('Logout completed');
            });
        });
        
        console.log('Auth UI initialized successfully');
    }
    
    // Start initialization when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAuth);
    } else {
        initAuth();
    }
})();

