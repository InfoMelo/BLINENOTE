// Alternative recording implementation for Electron
class ElectronRecorder {
    constructor() {
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.isRecording = false;
    }

    async initialize() {
        try {
            console.log('🎤 Initializing microphone access...');
            
            // Request microphone permission
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                } 
            });
            
            console.log('✅ Microphone access granted');
            
            // Create MediaRecorder
            this.mediaRecorder = new MediaRecorder(stream);
            
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data);
                }
            };
            
            this.mediaRecorder.onstop = () => {
                console.log('🛑 Recording stopped');
                this.processAudioData();
            };
            
            return true;
        } catch (error) {
            console.error('❌ Failed to initialize recorder:', error);
            return false;
        }
    }

    startRecording() {
        if (this.mediaRecorder && this.mediaRecorder.state === 'inactive') {
            this.audioChunks = [];
            this.mediaRecorder.start();
            this.isRecording = true;
            console.log('🎤 Recording started');
            return true;
        }
        return false;
    }

    stopRecording() {
        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
            this.mediaRecorder.stop();
            this.isRecording = false;
            return true;
        }
        return false;
    }

    processAudioData() {
        if (this.audioChunks.length > 0) {
            const audioBlob = new Blob(this.audioChunks, { type: 'audio/wav' });
            console.log('📼 Audio recorded, size:', audioBlob.size, 'bytes');
            
            // Here you could send the audio to a speech recognition service
            // For now, just show a placeholder message
            const elements = window.elements;
            if (elements && elements.hasilTeksDiv) {
                elements.hasilTeksDiv.innerHTML += '<p><em>[Audio recorded - transcription would happen here]</em></p>';
            }
        }
    }
}

// Make it globally available
window.ElectronRecorder = ElectronRecorder;