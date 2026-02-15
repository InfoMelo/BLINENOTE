// ================================
// BLineNote - Firebase Configuration
// ================================

// Environment Detection
const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const isProduction = !isDevelopment;

// Firebase Configuration - Safe for client-side
// Note: These are public Firebase config values, not secret keys
export const firebaseConfig = {
    apiKey: "AIzaSyDiXX1SVzJnNHx6GnDMUZZIpje2-1mmQzI",
    authDomain: "catatanapp-ba45e.firebaseapp.com", 
    projectId: "catatanapp-ba45e",
    storageBucket: "catatanapp-ba45e.appspot.com",
    messagingSenderId: "304510983013",
    appId: "1:304510983013:web:0635fcb9a6b248aa515f8c"
};

// Application Constants
export const APP_CONFIG = {
    name: "BLineNote",
    version: "1.0.0",
    description: "Aplikasi Catatan Suara AI",
    speechLang: "id-ID",
    maxNotesLength: 10000,
    autoSaveDelay: 2000,
    environment: isDevelopment ? 'development' : 'production',
    debug: isDevelopment,
    // Production optimizations
    enableLogging: isDevelopment,
    enableOfflineSupport: true,
    enableAnalytics: isProduction,
    // Auto URL detection settings
    autoDetectURLs: true,
    urlDetectionDelay: 1500,
    showUrlNotifications: true,
    // Premium features
    enableImageUpload: false
};