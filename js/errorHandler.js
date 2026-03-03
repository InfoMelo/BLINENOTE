// ================================
// Error Handling & Retry Logic Utilities
// ================================

class ErrorHandler {
    constructor() {
        this.errorHistory = [];
        this.maxHistorySize = 100;
        this.retryDefaults = {
            maxRetries: 3,
            baseDelay: 1000,
            maxDelay: 10000,
            backoffFactor: 2
        };
    }

    // Retry with exponential backoff
    async retryWithExponentialBackoff(fn, options = {}) {
        const config = { ...this.retryDefaults, ...options };
        let lastError;

        for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
            try {
                const result = await fn();
                if (attempt > 0) {
                    console.log(`✅ Operation succeeded on attempt ${attempt + 1}`);
                }
                return result;
            } catch (error) {
                lastError = error;
                
                if (attempt === config.maxRetries) {
                    console.error(`❌ Operation failed after ${config.maxRetries + 1} attempts:`, error);
                    break;
                }

                const delay = Math.min(
                    config.baseDelay * Math.pow(config.backoffFactor, attempt),
                    config.maxDelay
                );

                console.warn(`⚠️ Attempt ${attempt + 1} failed, retrying in ${delay}ms:`, error.message);
                await this.sleep(delay);
            }
        }

        throw lastError;
    }

    // Sleep utility
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Handle with retry - alias for retryWithExponentialBackoff for compatibility
    async handleWithRetry(fn, options = {}) {
        return await this.retryWithExponentialBackoff(fn, options);
    }

    // Log error with context
    logError(error, context = {}) {
        const errorInfo = {
            message: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString(),
            context,
            userAgent: navigator.userAgent,
            url: window.location.href,
            memory: this.getMemoryInfo()
        };

        this.errorHistory.push(errorInfo);
        
        // Keep history size manageable
        if (this.errorHistory.length > this.maxHistorySize) {
            this.errorHistory = this.errorHistory.slice(-this.maxHistorySize);
        }

        console.error('🚨 Error logged:', errorInfo);
        return errorInfo;
    }

    // Get memory info for error context
    getMemoryInfo() {
        if (performance.memory) {
            return {
                used: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024),
                total: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024)
            };
        }
        return null;
    }

    // Show user-friendly error message
    showUserError(message, type = 'error', duration = 5000) {
        const errorContainer = document.createElement('div');
        errorContainer.className = `fixed top-4 right-4 z-50 max-w-sm p-4 rounded-lg shadow-lg transition-all duration-300 ${this.getErrorStyles(type)}`;
        
        errorContainer.innerHTML = `
            <div class="flex items-start gap-3">
                <div class="flex-shrink-0">
                    ${this.getErrorIcon(type)}
                </div>
                <div class="flex-grow">
                    <p class="text-sm font-medium">${message}</p>
                </div>
                <button class="flex-shrink-0 text-gray-400 hover:text-gray-600 js-close-error">
                    <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"/>
                    </svg>
                </button>
            </div>
        `;

        document.body.appendChild(errorContainer);

        const closeButton = errorContainer.querySelector('.js-close-error');
        if (closeButton) {
            closeButton.addEventListener('click', () => errorContainer.remove());
        }

        // Auto remove after duration
        setTimeout(() => {
            if (errorContainer.parentElement) {
                errorContainer.style.opacity = '0';
                errorContainer.style.transform = 'translateX(100%)';
                setTimeout(() => errorContainer.remove(), 300);
            }
        }, duration);

        return errorContainer;
    }

    getErrorStyles(type) {
        const styles = {
            error: 'bg-red-50 border border-red-200 text-red-800',
            warning: 'bg-yellow-50 border border-yellow-200 text-yellow-800',
            info: 'bg-blue-50 border border-blue-200 text-blue-800',
            success: 'bg-green-50 border border-green-200 text-green-800'
        };
        return styles[type] || styles.error;
    }

    getErrorIcon(type) {
        const icons = {
            error: `<svg class="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/>
            </svg>`,
            warning: `<svg class="w-5 h-5 text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
            </svg>`,
            info: `<svg class="w-5 h-5 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/>
            </svg>`,
            success: `<svg class="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
            </svg>`
        };
        return icons[type] || icons.error;
    }

    // Get error history
    getErrorHistory() {
        return [...this.errorHistory];
    }

    // Clear error history
    clearErrorHistory() {
        this.errorHistory = [];
    }

    // Network error handling
    async handleNetworkError(fn, fallback = null) {
        try {
            return await this.retryWithExponentialBackoff(fn, {
                maxRetries: 2,
                baseDelay: 1000
            });
        } catch (error) {
            if (!navigator.onLine) {
                this.showUserError('Tidak ada koneksi internet. Aplikasi bekerja dalam mode offline.', 'warning');
                return fallback ? await fallback() : null;
            }
            
            this.logError(error, { type: 'network' });
            this.showUserError('Terjadi kesalahan jaringan. Silakan coba lagi.', 'error');
            throw error;
        }
    }

    // Firebase error handling
    handleFirebaseError(error) {
        const firebaseErrorMessages = {
            'auth/invalid-email': 'Format email tidak valid',
            'auth/user-disabled': 'Akun telah dinonaktifkan',
            'auth/user-not-found': 'Email tidak terdaftar',
            'auth/wrong-password': 'Password salah',
            'auth/invalid-credential': 'Email atau password salah',
            'auth/email-already-in-use': 'Email sudah terdaftar',
            'auth/weak-password': 'Password terlalu lemah (minimal 6 karakter)',
            'auth/network-request-failed': 'Gagal terhubung ke server',
            'permission-denied': 'Akses ditolak',
            'unavailable': 'Layanan sedang tidak tersedia'
        };

        const friendlyMessage = firebaseErrorMessages[error.code] || 
                               `Terjadi kesalahan: ${error.message}`;
        
        this.logError(error, { type: 'firebase', code: error.code });
        this.showUserError(friendlyMessage, 'error');
        
        return friendlyMessage;
    }
}

// Export singleton instance
export const errorHandler = new ErrorHandler();

console.log('🚨 Error Handler initialized');