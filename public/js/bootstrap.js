window.addEventListener('error', (e) => {
    console.error('🚨 Global Error:', {
        message: e.message,
        source: e.filename,
        line: e.lineno,
        column: e.colno,
        error: e.error
    });

    const errorDiv = document.createElement('div');
    const notification = document.createElement('div');
    notification.className = 'error-notification';

    const title = document.createElement('strong');
    title.textContent = '⚠️ Error Detected';

    const titleBreak = document.createElement('br');

    const message = document.createElement('small');
    message.textContent = e.message || 'Unknown error';

    const messageBreak = document.createElement('br');

    const closeButton = document.createElement('button');
    closeButton.className = 'notification-close-btn js-close-notification';
    closeButton.textContent = 'Tutup';

    notification.appendChild(title);
    notification.appendChild(titleBreak);
    notification.appendChild(message);
    notification.appendChild(messageBreak);
    notification.appendChild(closeButton);
    errorDiv.appendChild(notification);

    document.body.appendChild(errorDiv);

    closeButton.addEventListener('click', () => errorDiv.remove());

    setTimeout(() => {
        if (errorDiv.parentElement) {
            errorDiv.remove();
        }
    }, 10000);
});

window.addEventListener('unhandledrejection', (e) => {
    console.error('🚨 Unhandled Promise Rejection:', e.reason);

    const errorDiv = document.createElement('div');
    const notification = document.createElement('div');
    notification.className = 'warning-notification';

    const title = document.createElement('strong');
    title.textContent = '⚠️ Connection Issue';

    const titleBreak = document.createElement('br');

    const message = document.createElement('small');
    message.textContent = 'Ada masalah koneksi atau konfigurasi';

    const messageBreak = document.createElement('br');

    const closeButton = document.createElement('button');
    closeButton.className = 'notification-close-btn js-close-notification';
    closeButton.textContent = 'Tutup';

    notification.appendChild(title);
    notification.appendChild(titleBreak);
    notification.appendChild(message);
    notification.appendChild(messageBreak);
    notification.appendChild(closeButton);
    errorDiv.appendChild(notification);

    document.body.appendChild(errorDiv);

    closeButton.addEventListener('click', () => errorDiv.remove());

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
