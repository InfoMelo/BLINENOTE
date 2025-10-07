// ================================
// BLineNote - Main Application Logic
// ================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getFirestore, collection, onSnapshot, addDoc, doc, updateDoc, deleteDoc, query, orderBy } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

import { firebaseConfig, APP_CONFIG } from './config.js';
import { errorHandler } from './errorHandler.js';

// Production-safe logging
const logger = {
    log: APP_CONFIG.enableLogging ? console.log.bind(console) : () => {},
    error: console.error.bind(console), // Always log errors
    warn: APP_CONFIG.enableLogging ? console.warn.bind(console) : () => {},
    debug: APP_CONFIG.debug ? console.log.bind(console) : () => {}
};

// ================================
// Firebase Initialization
// ================================

const app = initializeApp(firebaseConfig);
// Initialize Firestore with modern cache configuration
const db = getFirestore(app);
const auth = getAuth(app);

// Modern cache configuration (replaces deprecated enableIndexedDbPersistence)
logger.log("✅ Firestore initialized with modern cache configuration.");

// Create HTML element for a note
const createNoteElement = (note) => {
    if (!note || !note.id) {
        console.error('❌ Invalid note data:', note);
        return document.createElement('div'); // Return empty div to prevent errors
    }
    const noteDiv = document.createElement('div');
    noteDiv.className = 'note-card glass-card rounded-lg shadow-lg p-4 mb-4 relative overflow-hidden';
    
    // Format date
    const date = new Date(note.timestamp);
    const formattedDate = date.toLocaleDateString('id-ID', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });

    // Create note content
    noteDiv.innerHTML = `
        <div class="flex justify-between items-start mb-2">
            <div class="flex items-center gap-2">
                ${note.tag ? `<span class="tag-badge">${note.tag}</span>` : ''}
                <span class="text-xs text-slate-500">${formattedDate}</span>
            </div>
        </div>
        <div class="note-content prose prose-slate dark:prose-invert">
            ${note.html}
        </div>
        <div class="flex justify-between items-center mt-3 text-xs text-slate-500">
            <span>${note.wordCount} kata | ${note.characterCount} karakter</span>
            <button class="text-red-500 hover:text-red-600" onclick="deleteNote('${note.id}')">Hapus</button>
        </div>
    `;
    
    return noteDiv;
};

// ================================
// Global State Variables
// ================================

let userId = null;
let unsubscribeNotes = null;
let isRecording = false;
let isPaused = false;
let pausedTranscript = '';
let finalTranscript = '';
let editingNoteId = null;
let noteToDeleteId = null;
let currentlySpeakingNoteId = null;
let currentNoteForAI = null;
let hideMenuTimer;
let allNotes = [];
let activeTagFilter = 'all';
let indonesianVoices = [];
let selectedVoice = null;

// ================================
// DOM Elements
// ================================

const elements = {
    // Containers
    mainContentContainer: document.getElementById('main-content-container'),
    authPageContainer: document.getElementById('auth-page-container'),
    appContainer: document.getElementById('app-container'),
    editorCard: document.getElementById('editor-card'),
    catatanContainer: document.getElementById('catatan-tersimpan-container'),
    
    // Editor elements
    hasilTeksDiv: document.getElementById('hasil-teks'),
    tagInput: document.getElementById('tag-input'),
    statusDiv: document.getElementById('status-div'),
    
    // Buttons (SAVE BUTTONS REMOVED)
    tombolRekam: document.getElementById('tombol-rekam'),
    tombolRekamTeks: document.getElementById('tombol-rekam-teks'),
    tombolPause: document.getElementById('tombol-pause'),
    tombolPauseTeks: document.getElementById('tombol-pause-teks'),
    pauseIcon: document.getElementById('pause-icon'),
    resumeIcon: document.getElementById('resume-icon'),
    fabRekam: document.getElementById('fab-rekam'),
    fabPause: document.getElementById('fab-pause'),
    fabPauseIcon: document.getElementById('fab-pause-icon'),
    fabResumeIcon: document.getElementById('fab-resume-icon'),
    tombolBacaEditor: document.getElementById('tombol-baca-editor'),
    tombolSimpan: document.getElementById('tombol-simpan'),
    tombolSimpanTeks: document.getElementById('tombol-simpan-teks'),
    tombolSimpanMobile: document.getElementById('tombol-simpan-mobile'),
    tombolSimpanMobileTeks: document.getElementById('tombol-simpan-mobile-teks'),
    tombolBatal: document.getElementById('tombol-batal'),
    
    // Search and filters
    searchInput: document.getElementById('search-input'),
    tagFiltersContainer: document.getElementById('tag-filters'),
    
    // Auth elements
    emailLoginInput: document.getElementById('email-login'),
    passwordLoginInput: document.getElementById('password-login'),
    emailDaftarInput: document.getElementById('email-daftar'),
    passwordDaftarInput: document.getElementById('password-daftar'),
    tombolSubmitLogin: document.getElementById('tombol-submit-login'),
    tombolSubmitDaftar: document.getElementById('tombol-submit-daftar'),
    tombolLogout: document.getElementById('tombol-logout'),
    authToggleBtn: document.getElementById('auth-toggle-btn'),
    authToggleBtn2: document.getElementById('auth-toggle-btn-2'),
    authToggleText: document.getElementById('auth-toggle-text'),
    authToggleText2: document.getElementById('auth-toggle-text-2'),
    loginSection: document.getElementById('login-section'),
    signupSection: document.getElementById('signup-section'),
    userInfo: document.getElementById('user-info'),
    userEmail: document.getElementById('user-email'),
    
    // Mobile navigation
    mobileNavToggle: document.getElementById('mobile-nav-toggle'),
    mobileNavOverlay: document.getElementById('mobile-nav-overlay'),
    mobileNavMenu: document.getElementById('mobile-nav-menu'),
    
    // Views
    editorView: document.getElementById('editor-view'),
    notesView: document.getElementById('notes-view'),
    editorNavBtn: document.getElementById('editor-nav-btn'),
    notesNavBtn: document.getElementById('notes-nav-btn')
};

// ================================
// Firebase Functions
// ================================

const setupNotesListener = (currentUserId) => {
    try {
        if (unsubscribeNotes) unsubscribeNotes();
        const notesCollectionPath = collection(db, 'users', currentUserId, 'notes');
        const q = query(notesCollectionPath, orderBy('timestamp', 'desc'));
        
        unsubscribeNotes = onSnapshot(q, (snapshot) => {
            allNotes = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
            renderTagFilters(allNotes);
            applyFilters();
        }, (error) => {
            const errorMsg = errorHandler.logError(error, { context: 'notes_listener' });
            elements.statusDiv.textContent = errorMsg;
        });
    } catch (error) {
        const errorMsg = errorHandler.logError(error, { context: 'setup_notes_listener' });
        elements.statusDiv.textContent = errorMsg;
    }
};

// ================================
// Save Functions - Clean Implementation
// ================================

// Simple save state to prevent double-clicking
let isSaving = false;

const saveNote = async () => {
    console.log('🔍 saveNote() called');
    
    // Prevent double saves
    if (isSaving) {
        console.log('⚠️ Save already in progress');
        return;
    }

    try {
        isSaving = true;
        console.log('🚀 Starting save process...');
        
        // Update UI to show saving state
        updateSaveButtonState('saving');
        elements.statusDiv.textContent = '💾 Menyimpan catatan...';
        
        // Basic validation - get HTML content directly from editor
        const htmlContent = elements.hasilTeksDiv.innerHTML.trim();
        const textContent = elements.hasilTeksDiv.textContent.trim(); // For word count
        const tagContent = elements.tagInput.value.trim();
        
        logger.debug('📝 HTML content length:', htmlContent.length);
        logger.debug('📝 Text content length:', textContent.length);
        logger.debug('📝 HTML preview:', htmlContent.substring(0, 100) + '...');
        logger.debug('🏷️ Tag content:', tagContent);
        logger.debug('👤 User ID:', userId);
        
        if (!textContent) {
            throw new Error('Teks tidak boleh kosong');
        }
        
        if (!userId) {
            elements.statusDiv.textContent = '❌ Silakan login terlebih dahulu';
            return;
        }
        
        // Prepare data
        const noteData = {
            text: textContent, // Plain text for search and word count
            html: htmlContent, // HTML content for display formatting
            tag: tagContent || '',
            wordCount: textContent.split(/\s+/).filter(word => word.length > 0).length,
            characterCount: textContent.length,
            timestamp: new Date().toISOString()
        };
        
        // Check if editing existing note
        if (editingNoteId) {
            // Update existing note
            noteData.updatedAt = new Date().toISOString();
            await updateDoc(doc(db, 'users', userId, 'notes', editingNoteId), noteData);
            elements.statusDiv.textContent = '✅ Catatan berhasil diperbarui!';
        } else {
            // Create new note
            await addDoc(collection(db, 'users', userId, 'notes'), noteData);
            elements.statusDiv.textContent = '✅ Catatan berhasil disimpan!';
        }
        
        // Clear editor after successful save
        clearEditor();
        
        // Switch to notes view on mobile
        if (window.innerWidth < 768) {
            switchView('notes');
        }
        
        console.log('✅ Save completed successfully');
        
    } catch (error) {
        console.error('❌ Save failed:', error);
        
        // Show user-friendly error message
        let errorMessage = '❌ Gagal menyimpan: ';
        if (error.message.includes('tidak boleh kosong')) {
            errorMessage = '⚠️ ' + error.message;
        } else if (error.message.includes('login')) {
            errorMessage = '🔐 ' + error.message;
        } else if (error.code === 'permission-denied') {
            errorMessage = '🚫 Akses ditolak. Silakan login ulang.';
        } else if (error.code === 'unavailable') {
            errorMessage = '📡 Layanan tidak tersedia. Coba lagi nanti.';
        } else {
            errorMessage += 'Coba lagi nanti.';
        }
        
        elements.statusDiv.textContent = errorMessage;
        
    } finally {
        isSaving = false;
        updateSaveButtonState('ready');
        
        // Clear status after 3 seconds
        setTimeout(() => {
            if (elements.statusDiv.textContent.includes('✅') || elements.statusDiv.textContent.includes('❌')) {
                elements.statusDiv.textContent = '';
            }
        }, 3000);
    }
};

const clearEditor = () => {
    // Clear content
    elements.hasilTeksDiv.textContent = '';
    elements.tagInput.value = '';
    
    // Reset states
    editingNoteId = null;
    finalTranscript = '';
    pausedTranscript = '';
    
    // Hide cancel button
    if (elements.tombolBatal) {
        elements.tombolBatal.classList.add('hidden');
    }
    
    // Update button states
    updateSaveButtonState('disabled');
    
    // Clear any editing status
    if (elements.statusDiv.textContent.includes('Mode edit')) {
        elements.statusDiv.textContent = '';
    }
    
    console.log('🧹 Editor cleared');
};

const updateSaveButtonState = (state) => {
    const saveButtons = [elements.tombolSimpan, elements.tombolSimpanMobile];
    const saveTexts = [elements.tombolSimpanTeks, elements.tombolSimpanMobileTeks];
    
    saveButtons.forEach(button => {
        if (!button) return;
        
        switch (state) {
            case 'saving':
                button.disabled = true;
                button.classList.add('opacity-50', 'cursor-not-allowed');
                break;
            case 'ready':
                button.disabled = false;
                button.classList.remove('opacity-50', 'cursor-not-allowed');
                break;
            case 'disabled':
                button.disabled = true;
                button.classList.add('opacity-50', 'cursor-not-allowed');
                break;
        }
    });
    
    saveTexts.forEach(text => {
        if (!text) return;
        
        switch (state) {
            case 'saving':
                text.textContent = 'Menyimpan...';
                break;
            case 'ready':
            case 'disabled':
                text.textContent = editingNoteId ? 'Perbarui' : 'Simpan';
                break;
        }
    });
};

// Enable save buttons when there's content
const checkContentAndUpdateButtons = () => {
    const content = elements.hasilTeksDiv.textContent.trim();
    const hasContent = content.length > 0;
    updateSaveButtonState(hasContent ? 'ready' : 'disabled');
};

// ================================
// Mobile View Functions
// ================================

const switchView = (viewToShow) => {
    if (window.innerWidth >= 768) { // md breakpoint
        elements.editorView.style.display = 'flex';
        elements.notesView.style.display = 'flex';
        return;
    }
    
    if (viewToShow === 'editor') {
        elements.editorView.style.display = 'flex';
        elements.notesView.style.display = 'none';
        elements.editorNavBtn.classList.add('active');
        elements.notesNavBtn.classList.remove('active');
    } else if (viewToShow === 'notes') {
        elements.editorView.style.display = 'none';
        elements.notesView.style.display = 'flex';
        elements.notesNavBtn.classList.add('active');
        elements.editorNavBtn.classList.remove('active');
    }
    
    // Update mobile nav
    updateMobileNav();
};

const updateMobileNav = () => {
    const isMobile = window.innerWidth < 768;
    const mobileNav = document.querySelector('.mobile-nav');
    
    if (isMobile) {
        if (mobileNav) mobileNav.style.display = 'flex';
    } else {
        if (mobileNav) mobileNav.style.display = 'none';
        // Show both views on desktop
        elements.editorView.style.display = 'flex';
        elements.notesView.style.display = 'flex';
    }
};

// ================================
// Speech Recognition Functions
// ================================

let recognition;

const initializeSpeechRecognition = () => {
    console.log('🔍 Initializing speech recognition...');
    console.log('User agent:', navigator.userAgent);
    console.log('Available APIs:', {
        SpeechRecognition: 'SpeechRecognition' in window,
        webkitSpeechRecognition: 'webkitSpeechRecognition' in window,
        mediaDevices: 'mediaDevices' in navigator,
        ElectronRecorder: 'ElectronRecorder' in window
    });
    
    // Check if we're in Electron and use alternative recording
    if (navigator.userAgent.includes('Electron')) {
        console.log('🖥️ Running in Electron, trying alternative recording...');
        initializeElectronRecording();
        return;
    }
    
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognition = new SpeechRecognition();
        
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'id-ID';
        
        recognition.onstart = () => {
            console.log('🎤 Speech recognition started');
            isRecording = true;
            updateRecordingUI();
        };
        
        recognition.onresult = (event) => {
            let interimTranscript = '';
            
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    finalTranscript += transcript + ' ';
                } else {
                    interimTranscript += transcript;
                }
            }
            
            // Add text directly without auto-formatting to preserve manual formatting
            const combinedText = pausedTranscript + finalTranscript + interimTranscript;
            elements.hasilTeksDiv.innerHTML = combinedText.trim();
            
            // Update save button state when content changes
            checkContentAndUpdateButtons();
            
            // Auto-scroll to bottom
            elements.hasilTeksDiv.scrollTop = elements.hasilTeksDiv.scrollHeight;
        };
        
        recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            let errorMessage = '';
            switch(event.error) {
                case 'not-allowed':
                    errorMessage = 'Microphone access ditolak. Mohon izinkan akses microphone.';
                    break;
                case 'no-speech':
                    errorMessage = 'Tidak ada suara yang terdeteksi.';
                    break;
                case 'audio-capture':
                    errorMessage = 'Gagal mengakses microphone.';
                    break;
                case 'network':
                    errorMessage = 'Koneksi internet diperlukan untuk speech recognition.';
                    break;
                default:
                    errorMessage = `Error pengenalan suara: ${event.error}`;
            }
            elements.statusDiv.textContent = `❌ ${errorMessage}`;
            isRecording = false;
            updateRecordingUI();
        };
        
        recognition.onend = () => {
            console.log('🛑 Speech recognition ended');
            if (isRecording && !isPaused) {
                // Restart if should still be recording
                setTimeout(() => {
                    if (isRecording && !isPaused) {
                        recognition.start();
                    }
                }, 100);
            } else {
                isRecording = false;
                updateRecordingUI();
            }
        };
        
        window.recognition = recognition;
        console.log('✅ Speech recognition initialized successfully');
        elements.statusDiv.textContent = '✅ Speech recognition siap digunakan';
    } else {
        console.warn('❌ Speech Recognition API not supported');
        elements.statusDiv.textContent = '❌ Browser tidak mendukung speech recognition. Gunakan Chrome/Edge untuk fitur ini.';
        
        // Disable recording buttons
        if (elements.tombolRekam) elements.tombolRekam.disabled = true;
        if (elements.tombolRekamMobile) elements.tombolRekamMobile.disabled = true;
    }
};

let electronRecorder = null;

const initializeElectronRecording = async () => {
    try {
        if (window.ElectronRecorder) {
            electronRecorder = new window.ElectronRecorder();
            const initialized = await electronRecorder.initialize();
            
            if (initialized) {
                console.log('✅ Electron recorder initialized successfully');
                elements.statusDiv.textContent = '✅ Microphone ready (basic recording mode)';
                
                // Override the start/stop recording functions
                window.startRecording = startElectronRecording;
                window.stopRecording = stopElectronRecording;
            } else {
                throw new Error('Failed to initialize Electron recorder');
            }
        } else {
            throw new Error('ElectronRecorder not available');
        }
    } catch (error) {
        console.error('❌ Failed to initialize Electron recording:', error);
        elements.statusDiv.textContent = '❌ Gagal mengakses microphone. Pastikan microphone terhubung dan izin diberikan.';
    }
};

const startElectronRecording = () => {
    if (electronRecorder && electronRecorder.startRecording()) {
        isRecording = true;
        updateRecordingUI();
        elements.statusDiv.textContent = '🎤 Merekam... (mode basic recording)';
    }
};

const stopElectronRecording = () => {
    if (electronRecorder && electronRecorder.stopRecording()) {
        isRecording = false;
        updateRecordingUI();
        elements.statusDiv.textContent = '🛑 Recording stopped';
    }
};

const startRecording = () => {
    if (!recognition) {
        initializeSpeechRecognition();
    }
    
    if (recognition && !isRecording) {
        try {
            isPaused = false;
            recognition.start();
            elements.statusDiv.textContent = '🎤 Merekam suara...';
        } catch (error) {
            console.error('Start recording error:', error);
            elements.statusDiv.textContent = '❌ Gagal memulai perekaman';
        }
    }
};

const pauseRecording = () => {
    if (recognition && isRecording) {
        isPaused = !isPaused;
        
        if (isPaused) {
            recognition.stop();
            pausedTranscript = elements.hasilTeksDiv.innerHTML;
            elements.statusDiv.textContent = '⏸️ Perekaman dijeda...';
            
            // Update save button state when paused
            checkContentAndUpdateButtons();
        } else {
            finalTranscript = '';
            recognition.start();
            elements.statusDiv.textContent = '🎤 Melanjutkan perekaman...';
        }
        
        updateRecordingUI();
    }
};

const stopRecording = () => {
    if (recognition && isRecording) {
        isRecording = false;
        isPaused = false;
        recognition.stop();
        elements.statusDiv.textContent = '🛑 Perekaman dihentikan';
        updateRecordingUI();
        
        // Update save button state after recording stops
        checkContentAndUpdateButtons();
    }
};

const updateRecordingUI = () => {
    // Update record button
    if (isRecording && !isPaused) {
        // Recording active
        elements.tombolRekam.classList.add('recording-indicator', 'bg-red-500', 'animate-pulse');
        elements.tombolRekam.classList.remove('bg-blue-500', 'hover:bg-blue-600');
        elements.tombolRekam.innerHTML = '<i class="fas fa-stop mr-2"></i>Hentikan';
        elements.tombolRekam.onclick = stopRecording;
        
        // Show pause button
        elements.tombolPause.classList.remove('hidden');
        elements.fabPause.classList.remove('hidden');
        
        // FAB recording state
        elements.fabRekam.classList.add('recording-indicator', 'bg-red-500', 'animate-pulse');
        elements.fabRekam.classList.remove('bg-blue-500', 'hover:bg-blue-600');
        elements.fabRekam.onclick = stopRecording;
        
    } else if (isPaused) {
        // Paused state
        elements.tombolRekam.classList.remove('recording-indicator', 'bg-red-500', 'animate-pulse');
        elements.tombolRekam.classList.add('bg-blue-500', 'hover:bg-blue-600');
        elements.tombolRekam.innerHTML = '<i class="fas fa-microphone mr-2"></i>Rekam';
        elements.tombolRekam.onclick = startRecording;
        
        elements.fabRekam.classList.remove('recording-indicator', 'bg-red-500', 'animate-pulse');
        elements.fabRekam.classList.add('bg-blue-500', 'hover:bg-blue-600');
        elements.fabRekam.onclick = startRecording;
        
    } else {
        // Stopped/Default state
        elements.tombolRekam.classList.remove('recording-indicator', 'bg-red-500', 'animate-pulse');
        elements.tombolRekam.classList.add('bg-blue-500', 'hover:bg-blue-600');
        elements.tombolRekam.innerHTML = '<i class="fas fa-microphone mr-2"></i>Rekam';
        elements.tombolRekam.onclick = startRecording;
        
        // Hide pause button
        elements.tombolPause.classList.add('hidden');
        elements.fabPause.classList.add('hidden');
        
        // FAB default state
        elements.fabRekam.classList.remove('recording-indicator', 'bg-red-500', 'animate-pulse');
        elements.fabRekam.classList.add('bg-blue-500', 'hover:bg-blue-600');
        elements.fabRekam.onclick = startRecording;
    }
    
    // Update pause/resume icons
    if (isPaused) {
        elements.pauseIcon.style.display = 'none';
        elements.resumeIcon.style.display = 'inline';
        elements.fabPauseIcon.style.display = 'none';
        elements.fabResumeIcon.style.display = 'inline';
        elements.tombolPauseTeks.textContent = 'Lanjut';
    } else {
        elements.pauseIcon.style.display = 'inline';
        elements.resumeIcon.style.display = 'none';
        elements.fabPauseIcon.style.display = 'inline';
        elements.fabResumeIcon.style.display = 'none';
        elements.tombolPauseTeks.textContent = 'Jeda';
    }
};

// ================================
// Editor Functions
// ================================

const resetEditor = () => {
    // Check if user is editing and has unsaved changes
    if (editingNoteId) {
        const currentText = elements.hasilTeksDiv.textContent.trim();
        const originalNote = allNotes.find(n => n.id === editingNoteId);
        
        if (originalNote && currentText !== originalNote.text) {
            const confirmCancel = confirm('Anda memiliki perubahan yang belum disimpan. Yakin ingin membatalkan?');
            if (!confirmCancel) {
                return; // User wants to continue editing
            }
        }
        
        elements.statusDiv.textContent = '❌ Edit dibatalkan';
        setTimeout(() => {
            elements.statusDiv.textContent = '';
        }, 2000);
    }
    
    // Use the new clearEditor function for consistency
    clearEditor();
    
    // Stop any recording
    stopRecording();
    
    console.log('✅ Editor direset');
};

// ================================
// Text-to-Speech Functions
// ================================

const initializeTextToSpeech = () => {
    if ('speechSynthesis' in window) {
        // Get available voices and filter for Indonesian
        const updateVoices = () => {
            const voices = speechSynthesis.getVoices();
            indonesianVoices = voices.filter(voice => 
                voice.lang.includes('id') || 
                voice.lang.includes('ID') ||
                voice.name.toLowerCase().includes('indonesia')
            );
            
            if (indonesianVoices.length === 0) {
                indonesianVoices = voices.filter(voice => 
                    voice.lang.includes('en') || voice.default
                );
            }
            
            selectedVoice = indonesianVoices[0] || voices[0];
            console.log('🔊 Text-to-speech ready with', voices.length, 'voices');
        };
        
        updateVoices();
        speechSynthesis.onvoiceschanged = updateVoices;
    } else {
        console.warn('⚠️ Text-to-speech not supported');
    }
};

const speakText = (text, noteId = null) => {
    if (!('speechSynthesis' in window)) {
        elements.statusDiv.textContent = '❌ Browser tidak mendukung text-to-speech';
        return;
    }
    
    if (currentlySpeakingNoteId && currentlySpeakingNoteId !== noteId) {
        speechSynthesis.cancel();
        updateSpeakButtonState(currentlySpeakingNoteId, false);
    }
    
    if (speechSynthesis.speaking) {
        speechSynthesis.cancel();
        updateSpeakButtonState(noteId, false);
        currentlySpeakingNoteId = null;
        return;
    }
    
    if (text.trim() === '') {
        elements.statusDiv.textContent = '⚠️ Tidak ada teks untuk dibaca';
        return;
    }
    
    const utterance = new SpeechSynthesisUtterance(text);
    
    if (selectedVoice) {
        utterance.voice = selectedVoice;
    }
    
    utterance.rate = 0.9;
    utterance.pitch = 1;
    utterance.volume = 1;
    
    utterance.onstart = () => {
        currentlySpeakingNoteId = noteId;
        updateSpeakButtonState(noteId, true);
        elements.statusDiv.textContent = '🔊 Membaca teks...';
    };
    
    utterance.onend = () => {
        currentlySpeakingNoteId = null;
        updateSpeakButtonState(noteId, false);
        elements.statusDiv.textContent = '';
    };
    
    utterance.onerror = (event) => {
        console.error('Speech synthesis error:', event.error);
        currentlySpeakingNoteId = null;
        updateSpeakButtonState(noteId, false);
        elements.statusDiv.textContent = '❌ Gagal membaca teks';
    };
    
    speechSynthesis.speak(utterance);
};

const updateSpeakButtonState = (noteId, isSpeaking) => {
    if (noteId) {
        const speakBtn = document.querySelector(`[data-note-id="${noteId}"] .speak-btn`);
        if (speakBtn) {
            const icon = speakBtn.querySelector('i');
            if (isSpeaking) {
                icon.className = 'fas fa-stop';
                speakBtn.title = 'Hentikan pembacaan';
            } else {
                icon.className = 'fas fa-volume-up';
                speakBtn.title = 'Baca catatan';
            }
        }
    } else {
        // Editor speak button
        const editorSpeakBtn = elements.tombolBacaEditor;
        if (editorSpeakBtn) {
            const icon = editorSpeakBtn.querySelector('i');
            if (isSpeaking) {
                icon.className = 'fas fa-stop';
                editorSpeakBtn.title = 'Hentikan pembacaan';
            } else {
                icon.className = 'fas fa-volume-up';
                editorSpeakBtn.title = 'Baca teks editor';
            }
        }
    }
};

// ================================
// Notes Display Functions
// ================================

const renderNotes = (notesToRender = allNotes) => {
    const container = elements.catatanContainer;
    
    if (!container) {
        console.error('❌ Catatan container not found');
        return;
    }
    
    if (notesToRender.length === 0) {
        container.innerHTML = `
            <div class="flex flex-col items-center justify-center py-12 text-gray-500">
                <i class="fas fa-sticky-note text-6xl mb-4 opacity-50"></i>
                <p class="text-lg mb-2">Belum ada catatan</p>
                <p class="text-sm">Mulai merekam untuk membuat catatan pertama Anda</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = notesToRender.map(note => {
        // Buat preview singkat - maksimal 100 karakter untuk 2 baris
        const fullText = note.html ? note.html.replace(/<[^>]*>/g, '') : note.text;
        const previewText = fullText.substring(0, 100);
        const hasMoreContent = fullText.length > 100;
        
        return `
            <div class="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-4 hover:shadow-lg transition-all duration-200" data-note-id="${note.id}">
                <div class="flex justify-between items-start mb-2">
                    <div class="flex-1">
                        ${note.tag ? `<span class="inline-block bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 text-xs px-2 py-1 rounded-full mb-2">${note.tag}</span>` : ''}
                    </div>
                    <div class="flex space-x-1 ml-2">
                        <button onclick="window.editNote('${note.id}')" 
                                class="p-1.5 text-gray-400 hover:text-green-500 hover:bg-green-50 dark:hover:bg-green-900/30 rounded-md transition-colors text-sm" 
                                title="Edit catatan">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button onclick="window.deleteNote('${note.id}')" 
                                class="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-md transition-colors text-sm" 
                                title="Hapus catatan">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
                
                <!-- Preview ringkas -->
                <div class="text-gray-800 dark:text-gray-200 mb-3 leading-relaxed text-sm line-clamp-2">
                    ${previewText}${hasMoreContent ? '...' : ''}
                </div>
                
                <!-- Footer dengan tanggal dan tombol detail -->
                <div class="flex justify-between items-center pt-2 border-t border-gray-100 dark:border-gray-700">
                    <div class="text-gray-500 dark:text-gray-400 text-xs">
                        <i class="fas fa-calendar-alt mr-1"></i>
                        ${new Date(note.timestamp || note.updatedAt).toLocaleDateString('id-ID', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric'
                        })}
                        ${note.updatedAt && note.updatedAt !== note.timestamp ? ' • Diperbarui' : ''}
                    </div>
                    <button onclick="window.viewNoteDetail('${note.id}')" 
                            class="bg-blue-500 hover:bg-blue-600 text-white text-xs px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1" 
                            title="Lihat catatan lengkap">
                        <i class="fas fa-eye"></i>
                        <span>Lihat Detail</span>
                    </button>
                </div>
            </div>
        `;
    }).join('');
};

const renderTagFilters = (notes) => {
    const tags = [...new Set(notes.map(note => note.tag).filter(tag => tag && tag.trim() !== ''))];
    const container = elements.tagFiltersContainer;
    
    if (!container) return;
    
    const allButton = `
        <button onclick="window.filterByTag('all')" 
                class="tag-filter px-3 py-1 rounded-full text-sm transition-colors duration-200 ${activeTagFilter === 'all' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}">
            Semua (${notes.length})
        </button>
    `;
    
    const tagButtons = tags.map(tag => {
        const count = notes.filter(note => note.tag === tag).length;
        return `
            <button onclick="window.filterByTag('${tag}')" 
                    class="tag-filter px-3 py-1 rounded-full text-sm transition-colors duration-200 ${activeTagFilter === tag ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}">
                ${tag} (${count})
            </button>
        `;
    }).join('');
    
    container.innerHTML = allButton + tagButtons;
};

// ================================
// Search and Filter Functions
// ================================

const applyFilters = () => {
    let filteredNotes = [...allNotes];
    
    // Filter by tag
    if (activeTagFilter !== 'all') {
        filteredNotes = filteredNotes.filter(note => note.tag === activeTagFilter);
    }
    
    // Filter by search
    const searchTerm = elements.searchInput?.value.toLowerCase().trim();
    if (searchTerm) {
        filteredNotes = filteredNotes.filter(note => 
            note.text.toLowerCase().includes(searchTerm) ||
            (note.tag && note.tag.toLowerCase().includes(searchTerm))
        );
    }
    
    renderNotes(filteredNotes);
};

// Global functions for HTML onclick
window.filterByTag = (tag) => {
    activeTagFilter = tag;
    applyFilters();
    renderTagFilters(allNotes);
};

window.editNote = (noteId) => {
    const note = allNotes.find(n => n.id === noteId);
    if (!note) return;
    
    // Populate editor with HTML content if available, fallback to text
    if (note.html) {
        elements.hasilTeksDiv.innerHTML = note.html;
    } else {
        // Fallback for old notes without HTML content
        elements.hasilTeksDiv.innerHTML = note.text.replace(/\n/g, '<br>');
    }
    elements.tagInput.value = note.tag || '';
    
    // Set editing state
    editingNoteId = noteId;
    
    // Show cancel button
    if (elements.tombolBatal) {
        elements.tombolBatal.classList.remove('hidden');
    }
    
    // Switch to editor view on mobile
    if (window.innerWidth < 768) {
        switchView('editor');
    }
    
    // Scroll to editor and focus
    elements.hasilTeksDiv.scrollIntoView({ behavior: 'smooth' });
    elements.hasilTeksDiv.focus();
    
    // Update save button state for editing
    updateSaveButtonState('ready');
    
    elements.statusDiv.textContent = '✏️ Mode edit - ubah teks dan klik perbarui';
    console.log('✏️ Editing note:', noteId);
};

// Make speakText available globally
window.speakText = speakText;

window.deleteNote = async (noteId) => {
    const note = allNotes.find(n => n.id === noteId);
    if (!note) {
        elements.statusDiv.textContent = '❌ Catatan tidak ditemukan';
        return;
    }
    
    // Show preview of the note to be deleted
    const preview = note.text.substring(0, 100) + (note.text.length > 100 ? '...' : '');
    const confirmDelete = confirm(`Apakah Anda yakin ingin menghapus catatan ini?\n\n"${preview}"\n\nTindakan ini tidak dapat dibatalkan.`);
    
    if (!confirmDelete) {
        return; // User cancelled
    }
    
    try {
        // Show deleting state
        elements.statusDiv.textContent = '🗑️ Menghapus catatan...';
        
        // Check authentication
        if (!userId) {
            throw new Error('Anda harus login untuk menghapus catatan');
        }
        
        // Delete from Firestore
        await deleteDoc(doc(db, 'users', userId, 'notes', noteId));
        
        // If currently editing this note, clear the editor
        if (editingNoteId === noteId) {
            clearEditor();
        }
        
        // Show success message
        elements.statusDiv.textContent = '✅ Catatan berhasil dihapus';
        
        // Clear status after 3 seconds
        setTimeout(() => {
            elements.statusDiv.textContent = '';
        }, 3000);
        
        console.log('✅ Note deleted successfully:', noteId);
        
    } catch (error) {
        console.error('❌ Delete failed:', error);
        
        // Show user-friendly error message
        let errorMessage = '❌ Gagal menghapus catatan: ';
        if (error.message.includes('login')) {
            errorMessage = '🔐 ' + error.message;
        } else if (error.code === 'permission-denied') {
            errorMessage = '🚫 Akses ditolak. Silakan login ulang.';
        } else if (error.code === 'unavailable') {
            errorMessage = '📡 Layanan tidak tersedia. Coba lagi nanti.';
        } else {
            errorMessage += 'Coba lagi nanti.';
        }
        
        elements.statusDiv.textContent = errorMessage;
        
        // Clear error after 5 seconds
        setTimeout(() => {
            if (elements.statusDiv.textContent.includes('❌') || elements.statusDiv.textContent.includes('🚫')) {
                elements.statusDiv.textContent = '';
            }
        }, 5000);
    }
};

// ================================
// Authentication Functions
// ================================

const handleLogin = async () => {
    const email = elements.emailLoginInput.value.trim();
    const password = elements.passwordLoginInput.value.trim();
    
    if (!email || !password) {
        elements.statusDiv.textContent = '⚠️ Email dan password harus diisi';
        return;
    }
    
    try {
        elements.statusDiv.textContent = '🔄 Sedang masuk...';
        await signInWithEmailAndPassword(auth, email, password);
        // Success handled in onAuthStateChanged
    } catch (error) {
        console.error('Login error:', error);
        let errorMessage = '❌ Gagal masuk: ';
        
        switch (error.code) {
            case 'auth/user-not-found':
                errorMessage += 'Email tidak terdaftar';
                break;
            case 'auth/wrong-password':
                errorMessage += 'Password salah';
                break;
            case 'auth/invalid-email':
                errorMessage += 'Format email tidak valid';
                break;
            case 'auth/too-many-requests':
                errorMessage += 'Terlalu banyak percobaan. Coba lagi nanti';
                break;
            default:
                errorMessage += error.message;
        }
        
        elements.statusDiv.textContent = errorMessage;
    }
};

const handleSignUp = async () => {
    const email = elements.emailDaftarInput.value.trim();
    const password = elements.passwordDaftarInput.value.trim();
    
    if (!email || !password) {
        elements.statusDiv.textContent = '⚠️ Email dan password harus diisi';
        return;
    }
    
    if (password.length < 6) {
        elements.statusDiv.textContent = '⚠️ Password minimal 6 karakter';
        return;
    }
    
    try {
        elements.statusDiv.textContent = '🔄 Sedang mendaftar...';
        await createUserWithEmailAndPassword(auth, email, password);
        // Success handled in onAuthStateChanged
    } catch (error) {
        console.error('Sign up error:', error);
        let errorMessage = '❌ Gagal mendaftar: ';
        
        switch (error.code) {
            case 'auth/email-already-in-use':
                errorMessage += 'Email sudah terdaftar';
                break;
            case 'auth/invalid-email':
                errorMessage += 'Format email tidak valid';
                break;
            case 'auth/weak-password':
                errorMessage += 'Password terlalu lemah';
                break;
            default:
                errorMessage += error.message;
        }
        
        elements.statusDiv.textContent = errorMessage;
    }
};

const handleLogout = async () => {
    try {
        await signOut(auth);
        // Cleanup handled in onAuthStateChanged
    } catch (error) {
        console.error('Logout error:', error);
        elements.statusDiv.textContent = '❌ Gagal keluar: ' + error.message;
    }
};

const toggleAuthMode = () => {
    const isLoginMode = elements.loginSection.style.display !== 'none';
    
    if (isLoginMode) {
        elements.loginSection.style.display = 'none';
        elements.signupSection.style.display = 'block';
        elements.authToggleText.textContent = 'Sudah punya akun? Masuk di sini';
    } else {
        elements.loginSection.style.display = 'block';
        elements.signupSection.style.display = 'none';
        elements.authToggleText.textContent = 'Belum punya akun? Daftar di sini';
    }
};

// ================================
// Event Listeners Setup
// ================================

const setupEventListeners = () => {
    // Recording controls
    if (elements.tombolRekam) elements.tombolRekam.addEventListener('click', startRecording);
    if (elements.fabRekam) elements.fabRekam.addEventListener('click', startRecording);
    if (elements.tombolPause) elements.tombolPause.addEventListener('click', pauseRecording);
    if (elements.fabPause) elements.fabPause.addEventListener('click', pauseRecording);
    
    // Editor controls
    if (elements.tombolBatal) elements.tombolBatal.addEventListener('click', resetEditor);
    if (elements.tombolBacaEditor) {
        elements.tombolBacaEditor.addEventListener('click', () => {
            const text = elements.hasilTeksDiv.textContent.trim();
            if (text) {
                speakText(text);
            } else {
                elements.statusDiv.textContent = '⚠️ Tidak ada teks untuk dibaca';
            }
        });
    }
    
    // Save controls
    if (elements.tombolSimpan) {
        console.log('✅ Desktop save button found, adding event listener');
        elements.tombolSimpan.addEventListener('click', saveNote);
    } else {
        console.log('❌ Desktop save button NOT found');
    }
    if (elements.tombolSimpanMobile) {
        console.log('✅ Mobile save button found, adding event listener');
        elements.tombolSimpanMobile.addEventListener('click', saveNote);
    } else {
        console.log('❌ Mobile save button NOT found');
    }
    
    // Checkbox button control
    const checkboxButton = document.querySelector('button[onclick*="insertCheckbox"]');
    if (checkboxButton) {
        console.log('✅ Checkbox button found, adding event listener');
        checkboxButton.removeAttribute('onclick'); // Remove inline onclick
        checkboxButton.addEventListener('click', () => {
            console.log('🔧 Checkbox button clicked');
            window.insertCheckbox();
        });
    } else {
        console.log('❌ Checkbox button NOT found');
    }
    
    // Content monitoring for save button state
    if (elements.hasilTeksDiv) {
        elements.hasilTeksDiv.addEventListener('input', checkContentAndUpdateButtons);
        elements.hasilTeksDiv.addEventListener('keyup', checkContentAndUpdateButtons);
        elements.hasilTeksDiv.addEventListener('paste', () => {
            setTimeout(checkContentAndUpdateButtons, 100);
            handlePasteWithURLDetection();
        });
        
        // Auto URL detection on typing
        elements.hasilTeksDiv.addEventListener('input', debouncedAutoDetectURLs);
        elements.hasilTeksDiv.addEventListener('keyup', (e) => {
            // Trigger URL detection on space, enter, or after typing URL-like content
            if (e.key === ' ' || e.key === 'Enter' || e.key === 'Tab') {
                debouncedAutoDetectURLs();
            }
        });
        
        // Link interaction in editor
        elements.hasilTeksDiv.addEventListener('click', handleLinkClick);
        elements.hasilTeksDiv.addEventListener('dblclick', handleLinkDoubleClick);
        
        // MutationObserver to watch for programmatic content changes (like speech recognition)
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList' || mutation.type === 'characterData') {
                    checkContentAndUpdateButtons();
                }
            });
        });
        
        observer.observe(elements.hasilTeksDiv, {
            childList: true,
            subtree: true,
            characterData: true
        });
        
        // Setup checkbox text editing listeners
        setupCheckboxTextListeners();
    }
    
    // Auth controls
    if (elements.tombolSubmitLogin) elements.tombolSubmitLogin.addEventListener('click', handleLogin);
    if (elements.tombolSubmitDaftar) elements.tombolSubmitDaftar.addEventListener('click', handleSignUp);
    if (elements.tombolLogout) elements.tombolLogout.addEventListener('click', handleLogout);
    if (elements.authToggleBtn) elements.authToggleBtn.addEventListener('click', toggleAuthMode);
    if (elements.authToggleBtn2) elements.authToggleBtn2.addEventListener('click', toggleAuthMode);
    

    
    // Form submission prevention
    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');
    if (loginForm) {
        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            handleLogin();
        });
    }
    if (signupForm) {
        signupForm.addEventListener('submit', (e) => {
            e.preventDefault();
            handleSignUp();
        });
    }
    
    // Search and filters
    if (elements.searchInput) elements.searchInput.addEventListener('input', applyFilters);
    if (elements.tagFiltersContainer) {
        elements.tagFiltersContainer.addEventListener('click', (e) => {
            if (e.target.classList.contains('tag-filter')) {
                const tag = e.target.onclick.toString().match(/'([^']+)'/)?.[1] || 'all';
                filterByTag(tag);
            }
        });
    }
    
    // Mobile navigation
    if (elements.editorNavBtn) elements.editorNavBtn.addEventListener('click', () => switchView('editor'));
    if (elements.notesNavBtn) elements.notesNavBtn.addEventListener('click', () => switchView('notes'));
    
    // Responsive updates
    window.addEventListener('resize', () => updateMobileNav());
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'F2') {
            e.preventDefault();
            if (isRecording) {
                pauseRecording();
            } else {
                startRecording();
            }
        }
    });
    
    console.log('✅ Event listeners setup complete');
};

// ================================
// Authentication State Management
// ================================

const initializeAuth = () => {
    onAuthStateChanged(auth, (user) => {
        if (user) {
            userId = user.uid;
            elements.userEmail.textContent = user.email;
            
            // Show app, hide auth
            elements.authPageContainer.style.display = 'none';
            elements.mainContentContainer.style.display = 'flex';
            
            // Setup notes listener
            setupNotesListener(userId);
            
            elements.statusDiv.textContent = `✅ Selamat datang, ${user.email}!`;
            
            // Clear auth inputs
            elements.emailLoginInput.value = '';
            elements.passwordLoginInput.value = '';
            elements.emailDaftarInput.value = '';
            elements.passwordDaftarInput.value = '';
            
            console.log('✅ User authenticated:', user.email);
            
        } else {
            userId = null;
            
            // Cleanup
            if (unsubscribeNotes) {
                unsubscribeNotes();
                unsubscribeNotes = null;
            }
            
            // Clear data
            allNotes = [];
            resetEditor();
            
            // Show auth, hide app
            elements.authPageContainer.style.display = 'flex';
            elements.mainContentContainer.style.display = 'none';
            
            elements.statusDiv.textContent = '';
            console.log('🔓 User signed out');
        }
    });
};

// ================================
// Application Initialization
// ================================

document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 BLineNote Application Starting...');
    
    // Clean up any remaining demo data
    localStorage.removeItem('blinenoteDemoNotes');
    
    // Initialize all components
    initializeAuth();
    initializeSpeechRecognition();
    initializeTextToSpeech();
    setupEventListeners();
    setupDetailPageListeners();
    setupDetailViewLinks();
    updateMobileNav();
    initializeAutoURLToggle();
    
    // Initialize save button state (disabled by default)
    updateSaveButtonState('disabled');
    
    // Expose functions to global scope for debugging
    console.log('🔧 Exposing functions globally...');
    if (typeof window.insertCheckbox === 'function') {
        console.log('✅ insertCheckbox function is available');
    } else {
        console.log('❌ insertCheckbox function NOT available');
    }
    
    console.log('✅ BLineNote Application Ready!');
    console.log('📝 Voice Note App - Full Functionality');
});

// ================================
// Rich Text Editor Functions
// ================================

// Execute formatting commands
window.formatCommand = (command, value = null) => {
    // Focus the editor first
    if (elements.hasilTeksDiv) {
        elements.hasilTeksDiv.focus();
        
        // Execute the command
        document.execCommand(command, false, value);
        
        // Update button states
        updateToolbarButtonStates();
        
        // Check content for save button
        checkContentAndUpdateButtons();
    }
};

// Insert line break
window.insertLineBreak = () => {
    if (elements.hasilTeksDiv) {
        elements.hasilTeksDiv.focus();
        document.execCommand('insertHTML', false, '<br><br>');
        checkContentAndUpdateButtons();
    }
};

// Update toolbar button states based on current selection
const updateToolbarButtonStates = () => {
    const commands = ['bold', 'italic', 'underline'];
    
    commands.forEach(command => {
        const button = document.querySelector(`button[onclick="formatCommand('${command}')"]`);
        if (button) {
            if (document.queryCommandState(command)) {
                button.classList.add('active');
            } else {
                button.classList.remove('active');
            }
        }
    });
};

// ================================
// Link Management Functions
// ================================

// Insert/Create Link
window.insertLink = () => {
    if (!elements.hasilTeksDiv) return;
    
    // Focus the editor
    elements.hasilTeksDiv.focus();
    
    // Get selected text
    const selection = window.getSelection();
    const selectedText = selection.toString().trim();
    
    // Prompt for URL
    const url = prompt('Masukkan URL:', 'https://');
    if (!url || url === 'https://') {
        return; // User cancelled or entered empty URL
    }
    
    // Validate URL
    if (!isValidURL(url)) {
        alert('URL tidak valid. Pastikan URL dimulai dengan http:// atau https://');
        return;
    }
    
    // Prompt for link text if no text is selected
    let linkText = selectedText;
    if (!linkText) {
        linkText = prompt('Masukkan teks link:', url);
        if (!linkText) {
            linkText = url; // Use URL as fallback
        }
    }
    
    // Create the link
    if (selectedText) {
        // If text is selected, convert it to link
        document.execCommand('createLink', false, url);
        
        // Set target="_blank" for external links
        const links = elements.hasilTeksDiv.querySelectorAll('a[href="' + url + '"]');
        links.forEach(link => {
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.title = url;
        });
    } else {
        // If no text selected, insert new link
        const linkHTML = `<a href="${url}" target="_blank" rel="noopener noreferrer" title="${url}">${linkText}</a>`;
        document.execCommand('insertHTML', false, linkHTML);
    }
    
    // Update save button state
    checkContentAndUpdateButtons();
    
    logger.debug('🔗 Link inserted:', { url, linkText });
};

// Remove Link
window.removeLink = () => {
    if (!elements.hasilTeksDiv) return;
    
    elements.hasilTeksDiv.focus();
    
    // Check if cursor is on a link
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const link = range.commonAncestorContainer.parentElement;
        
        if (link && link.tagName === 'A') {
            // Remove the link but keep the text
            const textContent = link.textContent;
            const textNode = document.createTextNode(textContent);
            link.parentNode.replaceChild(textNode, link);
            
            // Update save button state
            checkContentAndUpdateButtons();
            
            logger.debug('🔗 Link removed');
            return;
        }
    }
    
    // If no link found at cursor, try to unlink selected text
    if (document.queryCommandSupported('unlink')) {
        document.execCommand('unlink', false, null);
        checkContentAndUpdateButtons();
    } else {
        alert('Posisikan kursor pada link yang ingin dihapus atau pilih teks link.');
    }
};

// ================================
// Checkbox Functions
// ================================

// Insert Checkbox
window.insertCheckbox = () => {
    console.log('🔧 insertCheckbox called'); // Debug log
    if (!elements.hasilTeksDiv) {
        console.log('❌ hasilTeksDiv not found');
        return;
    }
    
    // Focus the editor
    elements.hasilTeksDiv.focus();
    
    // Create a unique ID for the checkbox
    const checkboxId = 'checkbox-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    
    // Create checkbox HTML with proper structure
    const checkboxHTML = `
        <div class="checkbox-item" data-checkbox-id="${checkboxId}">
            <label class="checkbox-label">
                <input type="checkbox" class="checkbox-input" id="${checkboxId}" onchange="window.handleCheckboxChange('${checkboxId}')">
                <span class="checkbox-custom"></span>
                <span class="checkbox-text" contenteditable="true" data-placeholder="Tulis item checklist...">Tulis item checklist...</span>
            </label>
        </div>
    `;
    
    // Insert the checkbox
    document.execCommand('insertHTML', false, checkboxHTML);
    
    // Focus on the text area of the newly created checkbox
    setTimeout(() => {
        const newCheckbox = document.getElementById(checkboxId);
        if (newCheckbox) {
            const textSpan = newCheckbox.parentElement.querySelector('.checkbox-text');
            if (textSpan) {
                textSpan.focus();
                // Select all placeholder text
                const selection = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(textSpan);
                selection.removeAllRanges();
                selection.addRange(range);
            }
        }
    }, 100);
    
    // Update save button state
    checkContentAndUpdateButtons();
    
    logger.debug('☑️ Checkbox inserted:', checkboxId);
};

// Handle checkbox state change
window.handleCheckboxChange = (checkboxId) => {
    const checkbox = document.getElementById(checkboxId);
    if (checkbox) {
        const checkboxItem = checkbox.closest('.checkbox-item');
        const textSpan = checkboxItem.querySelector('.checkbox-text');
        
        if (checkbox.checked) {
            checkboxItem.classList.add('checkbox-checked');
            textSpan.classList.add('text-completed');
        } else {
            checkboxItem.classList.remove('checkbox-checked');
            textSpan.classList.remove('text-completed');
        }
        
        // Update save button state since content changed
        checkContentAndUpdateButtons();
        
        logger.debug('☑️ Checkbox state changed:', { checkboxId, checked: checkbox.checked });
    }
};

// Setup checkbox text editing event listeners
const setupCheckboxTextListeners = () => {
    // Use event delegation for dynamically created checkboxes
    if (elements.hasilTeksDiv) {
        elements.hasilTeksDiv.addEventListener('keydown', (e) => {
            if (e.target.classList.contains('checkbox-text')) {
                // Handle Enter key to create new checkbox
                if (e.key === 'Enter') {
                    e.preventDefault();
                    
                    // If the current checkbox text is empty, just add a line break
                    if (e.target.textContent.trim() === '' || e.target.textContent === 'Tulis item checklist...') {
                        window.insertLineBreak();
                    } else {
                        // Create a new checkbox
                        setTimeout(() => {
                            window.insertCheckbox();
                        }, 10);
                    }
                }
                
                // Handle Backspace on empty checkbox to remove it
                if (e.key === 'Backspace' && (e.target.textContent.trim() === '' || e.target.textContent === 'Tulis item checklist...')) {
                    e.preventDefault();
                    const checkboxItem = e.target.closest('.checkbox-item');
                    if (checkboxItem) {
                        checkboxItem.remove();
                        checkContentAndUpdateButtons();
                    }
                }
            }
        });
        
        elements.hasilTeksDiv.addEventListener('input', (e) => {
            if (e.target.classList.contains('checkbox-text')) {
                checkContentAndUpdateButtons();
            }
        });
        
        elements.hasilTeksDiv.addEventListener('focus', (e) => {
            if (e.target.classList.contains('checkbox-text')) {
                // Clear placeholder text when focusing
                if (e.target.textContent === 'Tulis item checklist...') {
                    e.target.textContent = '';
                }
            }
        }, true);
        
        elements.hasilTeksDiv.addEventListener('blur', (e) => {
            if (e.target.classList.contains('checkbox-text')) {
                // Restore placeholder if empty
                if (e.target.textContent.trim() === '') {
                    e.target.textContent = 'Tulis item checklist...';
                }
            }
        }, true);
    }
};

// Validate URL format
const isValidURL = (string) => {
    try {
        const url = new URL(string);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (e) {
        return false;
    }
};

// Edit existing link
window.editLink = (linkElement) => {
    if (!linkElement || linkElement.tagName !== 'A') return;
    
    const currentURL = linkElement.href;
    const currentText = linkElement.textContent;
    
    // Prompt for new URL
    const newURL = prompt('Edit URL:', currentURL);
    if (!newURL || !isValidURL(newURL)) {
        if (newURL !== null) { // User didn't cancel
            alert('URL tidak valid.');
        }
        return;
    }
    
    // Prompt for new text
    const newText = prompt('Edit teks link:', currentText);
    if (newText === null) return; // User cancelled
    
    // Update link
    linkElement.href = newURL;
    linkElement.textContent = newText || newURL;
    linkElement.title = newURL;
    
    // Update save button state
    checkContentAndUpdateButtons();
    
    logger.debug('🔗 Link updated:', { newURL, newText });
};

// Handle link clicks in editor (prevent default navigation)
const handleLinkClick = (e) => {
    if (e.target.tagName === 'A') {
        e.preventDefault();
        e.stopPropagation();
        
        // Show link options
        const link = e.target;
        const choice = confirm(`Link: ${link.href}\n\nKlik OK untuk membuka link di tab baru, Cancel untuk edit link.`);
        
        if (choice) {
            // Open link in new tab
            window.open(link.href, '_blank', 'noopener,noreferrer');
            logger.debug('🔗 Link opened:', link.href);
        } else {
            // Edit link
            window.editLink(link);
        }
    }
};

// Handle double-click on links for quick edit
const handleLinkDoubleClick = (e) => {
    if (e.target.tagName === 'A') {
        e.preventDefault();
        e.stopPropagation();
        window.editLink(e.target);
    }
};

// Setup link event listeners for detail view
const setupDetailViewLinks = () => {
    const detailContent = document.getElementById('detail-content');
    if (detailContent) {
        detailContent.addEventListener('click', (e) => {
            if (e.target.tagName === 'A') {
                // In detail view, allow normal link behavior but add tracking
                logger.debug('🔗 Link clicked in detail view:', e.target.href);
            }
        });
    }
};

// ================================
// Auto URL Detection Functions
// ================================

// Comprehensive URL detection regex
const URL_REGEX = /(https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&=]*))/g;

// Simple URL detection for common patterns
const SIMPLE_URL_REGEX = /((?:https?:\/\/|www\.)[^\s<>"']+)/g;

// Enhanced URL detection that includes www. URLs
const ENHANCED_URL_REGEX = /((?:https?:\/\/|www\.)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*(?:\/[^\s<>"']*)?)/g;

// Debounce timer for auto-detection
let autoDetectionTimeout = null;

// Auto-detect and convert URLs to links
const autoDetectURLs = () => {
    if (!elements.hasilTeksDiv) return;
    
    const content = elements.hasilTeksDiv.innerHTML;
    let modified = false;
    
    // Create a temporary div to work with
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = content;
    
    // Process text nodes recursively
    processTextNodesForURLs(tempDiv);
    
    // Check if content was modified
    if (tempDiv.innerHTML !== content) {
        // Store cursor position
        const selection = window.getSelection();
        const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
        const cursorOffset = range ? range.startOffset : 0;
        
        // Update content
        elements.hasilTeksDiv.innerHTML = tempDiv.innerHTML;
        
        // Restore cursor position (approximate)
        try {
            if (range) {
                const walker = document.createTreeWalker(
                    elements.hasilTeksDiv,
                    NodeFilter.SHOW_TEXT,
                    null,
                    false
                );
                
                let currentOffset = 0;
                let targetNode = null;
                let node;
                
                while (node = walker.nextNode()) {
                    if (currentOffset + node.textContent.length >= cursorOffset) {
                        targetNode = node;
                        break;
                    }
                    currentOffset += node.textContent.length;
                }
                
                if (targetNode) {
                    const newRange = document.createRange();
                    const newOffset = Math.min(cursorOffset - currentOffset, targetNode.textContent.length);
                    newRange.setStart(targetNode, newOffset);
                    newRange.collapse(true);
                    selection.removeAllRanges();
                    selection.addRange(newRange);
                }
            }
        } catch (e) {
            // Cursor restoration failed, continue silently
            logger.debug('⚠️ Cursor restoration failed:', e.message);
        }
        
        modified = true;
        checkContentAndUpdateButtons();
        logger.debug('🔗 Auto-detected and converted URLs to links');
    }
    
    return modified;
};

// Process text nodes recursively to find and convert URLs
const processTextNodesForURLs = (element) => {
    const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: function(node) {
                // Skip if parent is already a link
                if (node.parentElement && node.parentElement.tagName === 'A') {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        },
        false
    );
    
    const textNodes = [];
    let node;
    while (node = walker.nextNode()) {
        textNodes.push(node);
    }
    
    // Process text nodes
    textNodes.forEach(textNode => {
        const text = textNode.textContent;
        const matches = text.match(ENHANCED_URL_REGEX);
        
        if (matches && matches.length > 0) {
            let newHTML = text;
            
            matches.forEach(url => {
                // Clean URL and ensure it has protocol
                let cleanURL = url.trim();
                let displayURL = cleanURL;
                
                // Add https:// if URL starts with www.
                if (cleanURL.startsWith('www.')) {
                    cleanURL = 'https://' + cleanURL;
                }
                
                // Validate the URL
                if (isValidURL(cleanURL)) {
                    const linkHTML = `<a href="${cleanURL}" target="_blank" rel="noopener noreferrer" title="${cleanURL}" class="auto-detected-link">${displayURL}</a>`;
                    newHTML = newHTML.replace(url, linkHTML);
                }
            });
            
            if (newHTML !== text) {
                // Replace text node with HTML
                const wrapper = document.createElement('span');
                wrapper.innerHTML = newHTML;
                
                // Replace the text node with the new content
                while (wrapper.firstChild) {
                    textNode.parentNode.insertBefore(wrapper.firstChild, textNode);
                }
                textNode.parentNode.removeChild(textNode);
            }
        }
    });
};

// Debounced auto URL detection
const debouncedAutoDetectURLs = () => {
    if (!APP_CONFIG.autoDetectURLs) return; // Check if auto-detection is enabled
    
    if (autoDetectionTimeout) {
        clearTimeout(autoDetectionTimeout);
    }
    
    autoDetectionTimeout = setTimeout(() => {
        autoDetectURLs();
    }, APP_CONFIG.urlDetectionDelay || 1500); // Use config delay
};

// Enhanced paste handler for URLs
const handlePasteWithURLDetection = (e) => {
    if (!APP_CONFIG.autoDetectURLs) return; // Check if auto-detection is enabled
    
    // Let the default paste happen first
    setTimeout(() => {
        const wasModified = autoDetectURLs();
        if (wasModified && APP_CONFIG.showUrlNotifications) {
            showURLDetectionNotification('URL otomatis dikonversi menjadi link!');
        }
    }, 100);
};

// Show notification when URLs are auto-detected
const showURLDetectionNotification = (message = 'URL terdeteksi dan dikonversi menjadi link!') => {
    // Remove existing notification if any
    const existingNotification = document.querySelector('.url-detection-notification');
    if (existingNotification) {
        existingNotification.remove();
    }
    
    // Create new notification
    const notification = document.createElement('div');
    notification.className = 'url-detection-notification';
    notification.innerHTML = `
        <i class="fas fa-link"></i>
        <span>${message}</span>
    `;
    
    // Add to document
    document.body.appendChild(notification);
    
    // Auto-remove after 3 seconds
    setTimeout(() => {
        if (notification.parentElement) {
            notification.style.animation = 'fadeOut 0.3s ease-out forwards';
            setTimeout(() => {
                notification.remove();
            }, 300);
        }
    }, 3000);
    
    logger.debug('🔗 URL detection notification shown:', message);
};

// Manual trigger for URL detection (for testing)
window.triggerURLDetection = () => {
    const wasModified = autoDetectURLs();
    if (wasModified) {
        showURLDetectionNotification();
    } else {
        showURLDetectionNotification('Tidak ada URL yang ditemukan untuk dikonversi.');
    }
};

// Toggle auto URL detection on/off
window.toggleAutoURLDetection = () => {
    APP_CONFIG.autoDetectURLs = !APP_CONFIG.autoDetectURLs;
    
    const toggleButton = document.getElementById('auto-url-toggle');
    if (toggleButton) {
        if (APP_CONFIG.autoDetectURLs) {
            toggleButton.className = 'toolbar-btn auto-url-enabled';
            toggleButton.title = 'Auto URL Detection: ON';
            showURLDetectionNotification('✅ Auto URL detection diaktifkan');
        } else {
            toggleButton.className = 'toolbar-btn auto-url-disabled';
            toggleButton.title = 'Auto URL Detection: OFF';
            showURLDetectionNotification('❌ Auto URL detection dinonaktifkan');
        }
    }
    
    logger.debug('🔄 Auto URL detection toggled:', APP_CONFIG.autoDetectURLs ? 'ON' : 'OFF');
};

// Initialize auto URL toggle button state
const initializeAutoURLToggle = () => {
    const toggleButton = document.getElementById('auto-url-toggle');
    if (toggleButton) {
        if (APP_CONFIG.autoDetectURLs) {
            toggleButton.className = 'toolbar-btn auto-url-enabled';
            toggleButton.title = 'Auto URL Detection: ON';
        } else {
            toggleButton.className = 'toolbar-btn auto-url-disabled';
            toggleButton.title = 'Auto URL Detection: OFF';
        }
    }
};

// Update toolbar when selection changes
document.addEventListener('selectionchange', () => {
    if (document.activeElement === elements.hasilTeksDiv) {
        updateToolbarButtonStates();
    }
});

// ================================
// Note Detail View Functions
// ================================

let currentDetailNoteId = null;

// Open note detail page
window.viewNoteDetail = (noteId) => {
    const note = allNotes.find(n => n.id === noteId);
    if (!note) return;
    
    currentDetailNoteId = noteId;
    
    // Get elements
    const detailPage = document.getElementById('note-detail-page');
    const detailContent = document.getElementById('detail-content');
    const detailTagContainer = document.getElementById('detail-tag-container');
    const detailDate = document.querySelector('#detail-date .date-text');
    const detailUpdated = document.getElementById('detail-updated');
    
    // Populate content dengan styling yang lebih baik
    if (note.html) {
        detailContent.innerHTML = note.html;
        // Pastikan styling rich text teraplikasi
        detailContent.style.lineHeight = '1.8';
        detailContent.style.fontSize = '16px';
    } else {
        // Format teks biasa dengan paragraph breaks
        const formattedText = note.text
            .split('\n\n')
            .map(paragraph => `<p class="mb-4">${paragraph.replace(/\n/g, '<br>')}</p>`)
            .join('');
        detailContent.innerHTML = formattedText;
        detailContent.style.lineHeight = '1.8';
        detailContent.style.fontSize = '16px';
    }
    
    // Populate tag dengan styling yang lebih menonjol
    if (note.tag) {
        detailTagContainer.innerHTML = `<span class="inline-block bg-gradient-to-r from-blue-500 to-blue-600 text-white text-sm px-4 py-2 rounded-full shadow-sm font-medium">${note.tag}</span>`;
    } else {
        detailTagContainer.innerHTML = '<span class="text-gray-500 dark:text-gray-400 text-sm italic">Tanpa kategori</span>';
    }
    
    // Format tanggal yang lebih detail
    const dateOptions = {
        weekday: 'long',
        year: 'numeric', 
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    };
    detailDate.textContent = new Date(note.timestamp || note.updatedAt).toLocaleDateString('id-ID', dateOptions);
    
    // Status update yang lebih informatif
    if (note.updatedAt && note.updatedAt !== note.timestamp) {
        detailUpdated.classList.remove('hidden');
        const updateDate = new Date(note.updatedAt).toLocaleDateString('id-ID', dateOptions);
        const updatedElement = detailUpdated.querySelector('.update-text');
        if (updatedElement) {
            updatedElement.textContent = `Terakhir diperbarui: ${updateDate}`;
        }
    } else {
        detailUpdated.classList.add('hidden');
    }
    
    // Show detail page dengan animasi smooth
    detailPage.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    
    // Scroll to top of detail content
    setTimeout(() => {
        detailContent.scrollTop = 0;
    }, 100);
    
    console.log('👁️ Viewing note detail:', note.id);
};

// Close note detail page
const closeNoteDetail = () => {
    const detailPage = document.getElementById('note-detail-page');
    detailPage.classList.add('hidden');
    document.body.style.overflow = 'auto'; // Restore scroll
    currentDetailNoteId = null;
};

// Setup detail page event listeners
const setupDetailPageListeners = () => {
    const closeBtn = document.getElementById('close-detail-btn');
    const speakBtn = document.getElementById('detail-speak-btn');
    const editBtn = document.getElementById('detail-edit-btn');
    const deleteBtn = document.getElementById('detail-delete-btn');
    
    if (closeBtn) {
        closeBtn.addEventListener('click', closeNoteDetail);
    }
    
    if (speakBtn) {
        speakBtn.addEventListener('click', () => {
            if (currentDetailNoteId) {
                const note = allNotes.find(n => n.id === currentDetailNoteId);
                if (note) {
                    speakText(note.text, note.id);
                }
            }
        });
    }
    
    if (editBtn) {
        editBtn.addEventListener('click', () => {
            if (currentDetailNoteId) {
                closeNoteDetail();
                window.editNote(currentDetailNoteId);
            }
        });
    }
    
    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
            if (currentDetailNoteId) {
                closeNoteDetail();
                window.deleteNote(currentDetailNoteId);
            }
        });
    }
    
    // Close on escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !document.getElementById('note-detail-page').classList.contains('hidden')) {
            closeNoteDetail();
        }
    });
};