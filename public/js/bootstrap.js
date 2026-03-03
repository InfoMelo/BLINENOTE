window.addEventListener('error', (e) => {
    console.error('🚨 Global Error:', {
        message: e.message,
        source: e.filename,
        line: e.lineno,
        column: e.colno,
        error: e.error
    });

    const errorDiv = document.createElement('div');
    errorDiv.innerHTML = `
        <div class="error-notification">
            <strong>⚠️ Error Detected</strong><br>
            <small>${e.message}</small><br>
            <button class="notification-close-btn js-close-notification">Tutup</button>
        </div>
    `;

    document.body.appendChild(errorDiv);

    const closeButton = errorDiv.querySelector('.js-close-notification');
    if (closeButton) {
        closeButton.addEventListener('click', () => errorDiv.remove());
    }

    setTimeout(() => {
        if (errorDiv.parentElement) {
            errorDiv.remove();
        }
    }, 10000);
});

window.addEventListener('unhandledrejection', (e) => {
    console.error('🚨 Unhandled Promise Rejection:', e.reason);

    const errorDiv = document.createElement('div');
    errorDiv.innerHTML = `
        <div class="warning-notification">
            <strong>⚠️ Connection Issue</strong><br>
            <small>Ada masalah koneksi atau konfigurasi</small><br>
            <button class="notification-close-btn js-close-notification">Tutup</button>
        </div>
    `;

    document.body.appendChild(errorDiv);

    const closeButton = errorDiv.querySelector('.js-close-notification');
    if (closeButton) {
        closeButton.addEventListener('click', () => errorDiv.remove());
    }

    setTimeout(() => {
        if (errorDiv.parentElement) {
            errorDiv.remove();
        }
    }, 10000);
});

document.addEventListener('DOMContentLoaded', () => {
    const testConnectionBtn = document.getElementById('test-connection-btn');
    if (testConnectionBtn) {
        testConnectionBtn.classList.add('hidden');
    }
});

window.testFirebaseConnection = async function() {
    console.log('⚠️ Application loading... Please wait and try again.');
};

window.quickConnectivityTest = async function() {
    console.log('⚠️ Application loading... Please wait and try again.');
};

window.showDebugInfo = function() {
    console.log('⚠️ Application loading... Please wait and try again.');
};

window.showHelp = function() {
    console.log('❓ BLineNote Development Tools - Application still loading...');
};
