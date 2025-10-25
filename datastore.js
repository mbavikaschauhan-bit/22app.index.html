// Wait for Supabase to be loaded from CDN (loaded in index.html head)
(function() {
    'use strict';
    
    // Wait for Supabase global to be available
    function initializeDataStore() {
        if (typeof supabase === 'undefined' && typeof window.supabase === 'undefined') {
            // Supabase not loaded yet, wait a bit
            setTimeout(initializeDataStore, 50);
            return;
        }

        // Use the global createClient from Supabase CDN
        const { createClient } = supabase;

        // --- Supabase Client Initialization ---
        const supabaseUrl = "https://pedhqcyudanorjewtdiy.supabase.co"; 
        const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBlZGhxY3l1ZGFub3JqZXd0ZGl5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk0OTE1ODAsImV4cCI6MjA3NTA2NzU4MH0.5-5t2Z3gosmTmaFlLKKTm7jHYB7HDESt7h9wH5VAHWk"; 

        const supabaseClient = createClient(supabaseUrl, supabaseAnonKey);

        // --- Backend Adapter (Inlined) ---
        const auth = {
            onAuthStateChanged: (callback) => {
                return supabaseClient.auth.onAuthStateChange((event, session) => {
                    const user = session?.user || null;
                    if (user) {
                        user.uid = user.id;
                        user.displayName = user.user_metadata?.name || user.email;
                    }
                    callback(user);
                });
            },
            signIn: async (email, password) => {
                try {
                    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
                    if (error) throw error;
                    return { user: data.user, session: data.session };
                } catch (error) {
                    console.error('Sign in error:', error);
                    throw error;
                }
            },
            signUp: async (email, password) => {
                try {
                    const { data, error } = await supabaseClient.auth.signUp({ email, password });
                    if (error) throw error;
                    // Optional: Create a profile entry upon sign-up
                    if (data.user) {
                        try {
                            await supabaseClient.from('profiles').insert({ id: data.user.id, name: 'New User', email: data.user.email });
                        } catch (profileError) {
                            console.warn('Profile creation failed:', profileError);
                            // Continue without throwing - profile creation is optional
                        }
                    }
                    return { user: data.user, session: data.session };
                } catch (error) {
                    console.error('Sign up error:', error);
                    throw error;
                }
            },
            updateProfile: async (user, profileData) => {
                try {
                    const { data, error } = await supabaseClient.auth.updateUser({
                        data: { name: profileData.displayName }
                    });
                    if (error) throw error;
                    return data;
                } catch (error) {
                    console.error('Update profile error:', error);
                    throw error;
                }
            },
            signOut: async () => {
                try {
                    await supabaseClient.auth.signOut();
                } catch (error) {
                    console.error('Sign out error:', error);
                    // Don't throw - logout should always succeed from UI perspective
                }
            },
            getUser: async () => {
                const { data, error } = await supabaseClient.auth.getSession();
                if (error) {
                    console.error("Error getting supabase session:", error);
                    return null;
                }
                return data?.session?.user || null;
            }
        };

        // === Small helper services for trades and files ===
        async function addTrade(trade) {
          // trade: { user_id, asset, entryPrice, exitPrice, quantity, entryDate, exitDate, pnl, ... }
          const { data, error } = await supabaseClient.from('trades').insert([trade]).select();
          if (error) throw error;
          return data[0];
        }

        async function uploadAttachment(userId, file) {
          // `file` is an input File object. Place in 'attachments' bucket.
          const filename = `${userId}/${Date.now()}_${file.name}`;
          const { error: uploadErr } = await supabaseClient.storage.from('attachments').upload(filename, file);
          if (uploadErr) throw uploadErr;
          const { data: { publicUrl } } = supabaseClient.storage.from('attachments').getPublicUrl(filename);
          return { publicUrl, path: filename };
        }

        async function getTradesForCalendar(userId, startDateISO, endDateISO) {
          const { data, error } = await supabaseClient
            .from('trades')
            .select('*')
            .eq('user_id', userId)
            .gte('exit_date', startDateISO)
            .lte('exit_date', endDateISO)
            .order('exit_date', { ascending: true });
          if (error) throw error;
          return data;
        }

        // --- State variables for dataStore ---
        let supabaseConnectionStatus = 'unknown';
        let lastSyncTime = null;
        // Operation queuing to prevent race conditions
        const operationQueue = new Map();
        const pendingOperations = new Set();

        // --- Helper functions for dataStore ---

        // Helper function to show connection status
        const updateConnectionStatus = (status, message = '') => {
            supabaseConnectionStatus = status;
            const statusIndicator = document.getElementById('connection-status');
            if (statusIndicator) {
                statusIndicator.className = `connection-status ${status}`;
                statusIndicator.textContent = message || (status === 'connected' ? 'Synced' : status === 'disconnected' ? 'Offline' : 'Syncing...');
            }
        };

        // Helper function to show sync notifications
        const showSyncNotification = (message, type = 'info') => {
            console.log(`[SYNC] ${message}`);
            // You can add toast notifications here if you have a toast system
            if (window.showToast) {
                showToast(message, type);
            }
        };

        // Helper function to add timeout to Supabase operations
        const withTimeout = (promise, timeoutMs = 10000, operation = 'operation') => {
            return Promise.race([
                promise,
                new Promise((_, reject) => {
                    setTimeout(() => {
                        reject(new Error(`${operation} timed out after ${timeoutMs}ms`));
                    }, timeoutMs);
                })
            ]);
        };

        // Helper function to retry operations with exponential backoff
        const retryOperation = async (operationFn, maxRetries = 3, baseDelay = 1000) => {
            let lastError;
            
            for (let attempt = 0; attempt <= maxRetries; attempt++) {
                try {
                    return await operationFn();
                } catch (error) {
                    lastError = error;
                    
                    // Don't retry on timeout or authentication errors
                    if (error.message.includes('timed out') || 
                        error.message.includes('auth') || 
                        error.message.includes('permission')) {
                        throw error;
                    }
                    
                    // Don't retry on the last attempt
                    if (attempt === maxRetries) {
                        throw error;
                    }
                    
                    // Calculate delay with exponential backoff
                    const delay = baseDelay * Math.pow(2, attempt);
                    console.log(`Operation failed, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
                    
                    // Wait before retrying
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
            
            throw lastError;
        };

        // Helper function to queue operations and prevent race conditions
        const queueOperation = async (operationKey, operationFn) => {
            // If operation is already pending, wait for it to complete
            if (pendingOperations.has(operationKey)) {
                return new Promise((resolve, reject) => {
                    const queue = operationQueue.get(operationKey) || [];
                    queue.push({ resolve, reject });
                    operationQueue.set(operationKey, queue);
                });
            }
            
            // Mark operation as pending
            pendingOperations.add(operationKey);
            
            try {
                const result = await retryOperation(operationFn);
                
                // Resolve all queued operations with the same result
                const queue = operationQueue.get(operationKey) || [];
                queue.forEach(({ resolve }) => resolve(result));
                operationQueue.delete(operationKey);
                
                return result;
            } catch (error) {
                // Reject all queued operations with the same error
                const queue = operationQueue.get(operationKey) || [];
                queue.forEach(({ reject: queueReject }) => queueReject(error));
                operationQueue.delete(operationKey);
                
                throw error;
            } finally {
                // Remove from pending operations
                pendingOperations.delete(operationKey);
            }
        };

        // Clean localStorage function to remove unwanted data
        const cleanLocalStorage = () => {
            // Keep only essential UI preferences
            const theme = localStorage.getItem('theme');
            const currentPage = localStorage.getItem('currentPage');
            
            // Clear all data storage
            localStorage.removeItem('trades');
            localStorage.removeItem('ledger');
            
            // Clear partial exits
            Object.keys(localStorage).forEach(key => {
                if (key.startsWith('partial_exits_')) {
                    localStorage.removeItem(key);
                }
            });
            
            // Restore only UI preferences
            if (theme) localStorage.setItem('theme', theme);
            if (currentPage) localStorage.setItem('currentPage', currentPage);
            
            console.log('localStorage cleaned - removed all data, kept UI preferences');
        };

        // --- Main DataStore Object ---
        const dataStore = {
            async getTrades() {
                let retryCount = 0;
                const maxRetries = 3;
                
                while (retryCount < maxRetries) {
                    try {
                        if (supabaseClient) {
                            const supabasePromise = supabaseClient.from('trades').select('*').order('entry_date', { ascending: true });
                            const { data, error } = await withTimeout(supabasePromise, 10000, 'Fetch trades');
                            
                            if (!error) {
                                updateConnectionStatus('connected');
                                lastSyncTime = new Date();
                                const remote = data || [];
                                
                                // Use only Supabase data - no localStorage sync
                                
                                return remote; // Return only Supabase data
                            } else {
                                console.warn(`Supabase getTrades error (attempt ${retryCount + 1}):`, error);
                                if (retryCount < maxRetries - 1) {
                                    console.log(`Retrying in 2 seconds... (attempt ${retryCount + 1}/${maxRetries})`);
                                    await new Promise(resolve => setTimeout(resolve, 2000));
                                    retryCount++;
                                    continue;
                                } else {
                                    showSyncNotification('Unable to load trades - please check your connection', 'error');
                                    updateConnectionStatus('disconnected');
                                }
                            }
                        }
                    } catch (error) {
                        if (retryCount < maxRetries - 1) {
                            if (error.message && error.message.includes('timed out')) {
                                console.warn(`Supabase getTrades timeout (attempt ${retryCount + 1}):`, error);
                            } else {
                                console.warn(`Supabase connection failed (attempt ${retryCount + 1}):`, error);
                            }
                            console.log(`Retrying in 2 seconds... (attempt ${retryCount + 1}/${maxRetries})`);
                            await new Promise(resolve => setTimeout(resolve, 2000));
                            retryCount++;
                            continue;
                        } else {
                            if (error.message && error.message.includes('timed out')) {
                                console.warn('Supabase getTrades timeout after all retries:', error);
                                showSyncNotification('Connection timeout - please try again', 'error');
                            } else {
                                console.warn('Supabase connection failed after all retries:', error);
                                showSyncNotification('Connection issue - please try again', 'error');
                            }
                            updateConnectionStatus('disconnected');
                        }
                    }
                }
                
                // Return empty array if all retries failed
                return [];
            },
            async upsertTrade(trade) {
                const operationKey = `upsert-trade-${trade.id}`;
                
                return queueOperation(operationKey, async () => {
                    let retryCount = 0;
                    const maxRetries = 3;
                    
                    while (retryCount < maxRetries) {
                        try {
                            if (supabaseClient) {
                                // Sanitize payload for Supabase: omit fields not present in DB schema
                                const tradeForDb = { ...trade };
                                delete tradeForDb.status; // UI-derived; not a DB column
                                const supabasePromise = supabaseClient.from('trades').upsert(tradeForDb);
                                const { error } = await withTimeout(supabasePromise, 10000, 'Save trade');
                                
                                if (!error) {
                                    updateConnectionStatus('connected');
                                    lastSyncTime = new Date();
                                    showSyncNotification('Trade saved successfully', 'success');
                                    return true;
                                } else {
                                    console.warn(`Supabase upsert error (attempt ${retryCount + 1}):`, error);
                                    if (retryCount < maxRetries - 1) {
                                        console.log(`Retrying in 2 seconds... (attempt ${retryCount + 1}/${maxRetries})`);
                                        await new Promise(resolve => setTimeout(resolve, 2000));
                                        retryCount++;
                                        continue;
                                    } else {
                                        showSyncNotification('Failed to save trade - please try again', 'error');
                                        updateConnectionStatus('disconnected');
                                        throw new Error(`Database error: ${error.message}`);
                                    }
                                }
                            }
                        } catch (error) {
                            if (retryCount < maxRetries - 1) {
                                if (error.message.includes('timed out')) {
                                    console.warn(`Supabase upsert timeout (attempt ${retryCount + 1}):`, error);
                                } else {
                                    console.warn(`Supabase connection failed (attempt ${retryCount + 1}):`, error);
                                }
                                console.log(`Retrying in 2 seconds... (attempt ${retryCount + 1}/${maxRetries})`);
                                await new Promise(resolve => setTimeout(resolve, 2000));
                                retryCount++;
                                continue;
                            } else {
                                if (error.message.includes('timed out')) {
                                    console.warn('Supabase upsert timeout after all retries:', error);
                                    showSyncNotification('Connection timeout - please try again', 'error');
                                } else {
                                    console.warn('Supabase connection failed after all retries:', error);
                                    showSyncNotification('Connection issue - please try again', 'error');
                                }
                                updateConnectionStatus('disconnected');
                                throw error;
                            }
                        }
                    }
                });
            },
            async deleteTrade(id) {
                const operationKey = `delete-trade-${id}`;
                
                return queueOperation(operationKey, async () => {
                    try {
                        if (supabaseClient) {
                            const supabasePromise = supabaseClient.from('trades').delete().eq('id', id);
                            const { error } = await withTimeout(supabasePromise, 10000, 'Delete trade');
                            
                            if (!error) {
                                updateConnectionStatus('connected');
                                lastSyncTime = new Date();
                                showSyncNotification('Trade deleted successfully', 'success');
                            } else {
                                console.warn('Supabase delete error:', error);
                                showSyncNotification('Failed to delete trade - please try again', 'error');
                                updateConnectionStatus('disconnected');
                                throw new Error(`Database error: ${error.message}`);
                            }
                        }
                    } catch (error) {
                        if (error.message.includes('timed out')) {
                            console.warn('Supabase delete timeout:', error);
                            showSyncNotification('Connection timeout - please try again', 'error');
                        } else {
                            console.warn('Supabase connection failed:', error);
                            showSyncNotification('Connection issue - please try again', 'error');
                        }
                        updateConnectionStatus('disconnected');
                        throw error;
                    }
                });
            },
            async deleteMultipleTrades(ids) {
                if (!ids || ids.length === 0) {
                    throw new Error('No trade IDs provided for deletion');
                }

                try {
                    if (supabaseClient) {
                        const { error } = await supabaseClient.from('trades').delete().in('id', ids);
                        if (error) {
                            console.error('Supabase bulk delete error:', error);
                            throw new Error(`Database error: ${error.message}`);
                        }
                        return true;
                    } else {
                        throw new Error('No database connection available');
                    }
                } catch (error) {
                    console.error('deleteMultipleTrades failed:', error);
                    throw error;
                }
            },
            async deleteAllTrades() {
                try {
                    if (supabaseClient) {
                        const { error } = await supabaseClient.from('trades').delete().neq('id', '');
                        if (error) {
                            console.error('Supabase delete all error:', error);
                            throw new Error(`Database error: ${error.message}`);
                        }
                        return true;
                    } else {
                        throw new Error('No database connection available');
                    }
                } catch (error) {
                    console.error('deleteAllTrades failed:', error);
                    throw error;
                }
            },
            async getLedger() {
                let retryCount = 0;
                const maxRetries = 3;
                
                while (retryCount < maxRetries) {
                    try {
                        if (supabaseClient) {
                            const supabasePromise = supabaseClient.from('ledger').select('*').order('date', { ascending: true });
                            const { data, error } = await withTimeout(supabasePromise, 10000, 'Fetch ledger');
                            
                            if (!error) {
                                updateConnectionStatus('connected');
                                lastSyncTime = new Date();
                                const remote = data || [];
                                
                                // Use only Supabase data - no localStorage sync
                                
                                return remote; // Return only Supabase data
                            } else {
                                console.warn(`Supabase getLedger error (attempt ${retryCount + 1}):`, error);
                                if (retryCount < maxRetries - 1) {
                                    console.log(`Retrying in 2 seconds... (attempt ${retryCount + 1}/${maxRetries})`);
                                    await new Promise(resolve => setTimeout(resolve, 2000));
                                    retryCount++;
                                    continue;
                                } else {
                                    showSyncNotification('Unable to load ledger - please check your connection', 'error');
                                    updateConnectionStatus('disconnected');
                                }
                            }
                        }
                    } catch (error) {
                        if (retryCount < maxRetries - 1) {
                            if (error.message.includes('timed out')) {
                                console.warn(`Supabase getLedger timeout (attempt ${retryCount + 1}):`, error);
                            } else {
                                console.warn(`Supabase connection failed (attempt ${retryCount + 1}):`, error);
                            }
                            console.log(`Retrying in 2 seconds... (attempt ${retryCount + 1}/${maxRetries})`);
                            await new Promise(resolve => setTimeout(resolve, 2000));
                            retryCount++;
                            continue;
                        } else {
                            if (error.message.includes('timed out')) {
                                console.warn('Supabase getLedger timeout after all retries:', error);
                                showSyncNotification('Connection timeout - please try again', 'error');
                            } else {
                                console.warn('Supabase connection failed after all retries:', error);
                                showSyncNotification('Connection issue - please try again', 'error');
                            }
                            updateConnectionStatus('disconnected');
                        }
                    }
                }
                
                // Return empty array if all retries failed
                return [];
            },
            async upsertLedger(entry) {
                const operationKey = `upsert-ledger-${entry.id}`;
                
                return queueOperation(operationKey, async () => {
                    try {
                        if (supabaseClient) {
                            const supabasePromise = supabaseClient.from('ledger').upsert(entry);
                            const { error } = await withTimeout(supabasePromise, 10000, 'Save ledger entry');
                            
                            if (!error) {
                                updateConnectionStatus('connected');
                                lastSyncTime = new Date();
                                showSyncNotification('Ledger entry saved successfully', 'success');
                                return true;
                            } else {
                                console.warn('Supabase ledger upsert error:', error);
                                showSyncNotification('Failed to save ledger entry - please try again', 'error');
                                updateConnectionStatus('disconnected');
                                throw new Error(`Database error: ${error.message}`);
                            }
                        }
                    } catch (error) {
                        if (error.message.includes('timed out')) {
                            console.warn('Supabase ledger upsert timeout:', error);
                            showSyncNotification('Connection timeout - please try again', 'error');
                        } else {
                            console.warn('Supabase connection failed:', error);
                            showSyncNotification('Connection issue - please try again', 'error');
                        }
                        updateConnectionStatus('disconnected');
                        throw error;
                    }
                });
            },
            async deleteLedger(id) {
                try {
                    if (supabaseClient) {
                        const { error } = await supabaseClient.from('ledger').delete().eq('id', id);
                        if (error) {
                            console.error('Supabase ledger delete error:', error);
                            throw new Error(`Database error: ${error.message}`);
                        }
                        return true;
                    } else {
                        throw new Error('No database connection available');
                    }
                } catch (error) {
                    console.error('deleteLedger failed:', error);
                    throw error;
                }
            },
            async upsertChallenge(challenge) {
                const operationKey = `upsert-challenge-${challenge.id}`;
                
                return queueOperation(operationKey, async () => {
                    try {
                        if (supabaseClient) {
                            // Add user_id to challenge and exclude completed field (not in DB schema)
                            // Get appState from window if available
                            const appState = window.appState || {};
                            const challengeForDb = {
                                id: challenge.id,
                                title: challenge.title,
                                description: challenge.description,
                                timeframe: challenge.timeframe,
                                maxRisk: challenge.maxRisk,
                                startDate: challenge.startDate,
                                endDate: challenge.endDate,
                                createdAt: challenge.createdAt,
                                success: challenge.success,
                                startingCapital: challenge.startingCapital,
                                targetCapital: challenge.targetCapital,
                                user_id: appState.user?.id || 'anonymous',
                                status: challenge.completed ? 'completed' : 'active'
                            };
                            
                            const supabasePromise = supabaseClient.from('challenges').upsert(challengeForDb);
                            const { error } = await withTimeout(supabasePromise, 10000, 'Save challenge');
                            
                            if (!error) {
                                updateConnectionStatus('connected');
                                lastSyncTime = new Date();
                                showSyncNotification('Challenge saved successfully', 'success');
                                return true;
                            } else {
                                console.warn('Supabase challenge upsert error:', error);
                                showSyncNotification('Failed to save challenge - please try again', 'error');
                                updateConnectionStatus('disconnected');
                                throw new Error(`Database error: ${error.message}`);
                            }
                        } else {
                            throw new Error('No database connection available');
                        }
                    } catch (error) {
                        if (error.message.includes('timed out')) {
                            console.warn('Supabase challenge upsert timeout:', error);
                            showSyncNotification('Connection timeout - please try again', 'error');
                        } else {
                            console.warn('Supabase connection failed:', error);
                            showSyncNotification('Connection issue - please try again', 'error');
                        }
                        updateConnectionStatus('disconnected');
                        throw error;
                    }
                });
            },
            async getChallenges() {
                try {
                    if (supabaseClient) {
                        // Get appState from window if available
                        const appState = window.appState || {};
                        const { data, error } = await withTimeout(
                            supabaseClient.from('challenges').select('*').eq('user_id', appState.user?.id).order('createdAt', { ascending: false }),
                            10000, 'Fetch challenges'
                        );
                        
                        if (!error) {
                            updateConnectionStatus('connected');
                            lastSyncTime = new Date();
                            return data || [];
                        } else {
                            console.warn('Supabase getChallenges error:', error);
                            showSyncNotification('Unable to load challenges - please check your connection', 'error');
                            updateConnectionStatus('disconnected');
                        }
                    }
                } catch (error) {
                    if (error.message.includes('timed out')) {
                        console.warn('Supabase getChallenges timeout:', error);
                        showSyncNotification('Connection timeout - please try again', 'error');
                    } else {
                        console.warn('Supabase connection failed:', error);
                        showSyncNotification('Connection issue - please try again', 'error');
                    }
                    updateConnectionStatus('disconnected');
                }
                
                return [];
            },
            async getPartialExits(tradeId) {
                try {
                    if (supabaseClient) {
                        // Get appState from window if available
                        const appState = window.appState || {};
                        if (!appState.user?.id) return [];
                        
                        const { data, error } = await withTimeout(
                            supabaseClient.from('partial_exits').select('*').eq('trade_id', tradeId).eq('user_id', appState.user.id).order('exit_date', { ascending: true }),
                            5000, 'Fetch partial exits'
                        );
                        
                        if (!error) {
                            return data || [];
                        } else {
                            console.warn('Supabase getPartialExits error:', error);
                        }
                    }
                } catch (error) {
                    console.warn('Supabase getPartialExits failed:', error);
                }
                
                return [];
            },
            async savePartialExit(partialExit) {
                try {
                    if (supabaseClient) {
                        // Get appState from window if available
                        const appState = window.appState || {};
                        if (!appState.user?.id) {
                            throw new Error('User not authenticated');
                        }
                        
                        const partialExitData = {
                            ...partialExit,
                            user_id: appState.user.id
                        };
                        
                        const { data, error } = await withTimeout(
                            supabaseClient.from('partial_exits').insert([partialExitData]).select(),
                            5000, 'Save partial exit'
                        );
                        
                        if (!error) {
                            return data[0];
                        } else {
                            console.warn('Supabase savePartialExit error:', error);
                            throw error;
                        }
                    }
                } catch (error) {
                    console.warn('Supabase savePartialExit failed:', error);
                    throw error;
                }
            },
            async deletePartialExit(partialExitId) {
                try {
                    if (supabaseClient) {
                        // Get appState from window if available
                        const appState = window.appState || {};
                        if (!appState.user?.id) {
                            throw new Error('User not authenticated');
                        }
                        
                        const { error } = await withTimeout(
                            supabaseClient.from('partial_exits').delete().eq('id', partialExitId).eq('user_id', appState.user.id),
                            5000, 'Delete partial exit'
                        );
                        
                        if (!error) {
                            return true;
                        } else {
                            console.warn('Supabase deletePartialExit error:', error);
                            throw error;
                        }
                    }
                } catch (error) {
                    console.warn('Supabase deletePartialExit failed:', error);
                    throw error;
                }
            },
            async deleteChallenge(challengeId) {
                try {
                    if (supabaseClient) {
                        // Get appState from window if available
                        const appState = window.appState || {};
                        if (!appState.user?.id) {
                            throw new Error('User not authenticated');
                        }
                        
                        const { error } = await withTimeout(
                            supabaseClient.from('challenges').delete().eq('id', challengeId).eq('user_id', appState.user.id),
                            5000, 'Delete challenge'
                        );
                        
                        if (!error) {
                            return true;
                        } else {
                            console.warn('Supabase deleteChallenge error:', error);
                            throw error;
                        }
                    }
                } catch (error) {
                    console.warn('Supabase deleteChallenge failed:', error);
                    throw error;
                }
            }
        };

        // Export all necessary objects and functions to window for global access
        window.supabase = supabaseClient;
        window.auth = auth;
        window.dataStore = dataStore;
        window.addTrade = addTrade;
        window.uploadAttachment = uploadAttachment;
        window.getTradesForCalendar = getTradesForCalendar;
        window.cleanLocalStorage = cleanLocalStorage;
        
        console.log('DataStore initialized successfully');
    }
    
    // Start initialization when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeDataStore);
    } else {
        initializeDataStore();
    }
})();
