// Simple test for speech recognition in Electron
console.log('Testing speech recognition APIs...');
console.log('SpeechRecognition available:', 'SpeechRecognition' in window);
console.log('webkitSpeechRecognition available:', 'webkitSpeechRecognition' in window);
console.log('getUserMedia available:', navigator.mediaDevices && 'getUserMedia' in navigator.mediaDevices);

// Test microphone access
if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
            console.log('✅ Microphone access granted');
            stream.getTracks().forEach(track => track.stop());
        })
        .catch(err => {
            console.error('❌ Microphone access denied:', err);
        });
}

// Test speech recognition
if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    try {
        const recognition = new SpeechRecognition();
        console.log('✅ Speech recognition initialized');
    } catch (error) {
        console.error('❌ Speech recognition failed:', error);
    }
} else {
    console.warn('❌ Speech recognition not available');
}