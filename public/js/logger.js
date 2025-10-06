// ================================
// BLineNote - Logger Utility
// Production-Safe Logging
// ================================

import { APP_CONFIG } from './config.js';

class Logger {
    constructor() {
        this.isProduction = APP_CONFIG.environment === 'production';
        this.enableLogging = APP_CONFIG.enableLogging;
    }

    // Safe console.log that respects environment
    log(message, ...args) {
        if (this.enableLogging) {
            console.log(message, ...args);
        }
    }

    // Safe console.error - always enabled for debugging
    error(message, ...args) {
        console.error(message, ...args);
    }

    // Safe console.warn that respects environment  
    warn(message, ...args) {
        if (this.enableLogging) {
            console.warn(message, ...args);
        }
    }

    // Safe console.info that respects environment
    info(message, ...args) {
        if (this.enableLogging) {
            console.info(message, ...args);
        }
    }

    // Debug logging - only in development
    debug(message, ...args) {
        if (this.enableLogging && !this.isProduction) {
            console.log('🐛 DEBUG:', message, ...args);
        }
    }

    // Performance logging - only in development
    time(label) {
        if (this.enableLogging && !this.isProduction) {
            console.time(label);
        }
    }

    timeEnd(label) {
        if (this.enableLogging && !this.isProduction) {
            console.timeEnd(label);
        }
    }
}

// Export singleton instance
export const logger = new Logger();

// Legacy support - gradually replace console.* calls with logger.*
export default logger;