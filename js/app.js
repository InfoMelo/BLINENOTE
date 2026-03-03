// ================================
// BLineNote - Main Application Logic
// ================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getFirestore, collection, onSnapshot, addDoc, doc, updateDoc, deleteDoc, query, orderBy, getDocs, writeBatch } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getStorage, ref as storageRef, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

import { firebaseConfig, APP_CONFIG } from './config.js';
import { errorHandler } from './errorHandler.js';

// Production-safe logging
const logger = {
    log: APP_CONFIG.enableLogging ? console.log.bind(console) : () => {},
    error: console.error.bind(console), // Always log errors
    warn: APP_CONFIG.enableLogging ? console.warn.bind(console) : () => {},
    debug: APP_CONFIG.debug ? console.log.bind(console) : () => {}
};

const isLocalDevelopment = () => APP_CONFIG.environment === 'development' || window.location.hostname === '';

// Basic escaping for safe string interpolation in HTML
const escapeHTML = (value = '') => String(value).replace(/[&<>"']/g, (char) => {
    const escapeMap = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    };
    return escapeMap[char] || char;
});

// Sanitize HTML content to reduce XSS risk
const sanitizeHTML = (html = '') => {
    if (window.DOMPurify) {
        return window.DOMPurify.sanitize(html, {
            ADD_TAGS: ['input', 'label', 'img', 'figure', 'figcaption'],
            ADD_ATTR: ['class', 'id', 'type', 'checked', 'data-checkbox-id', 'data-placeholder', 'contenteditable', 'src', 'alt', 'title', 'width', 'height', 'loading', 'decoding']
        });
    }

    const temp = document.createElement('div');
    temp.textContent = html;
    return temp.innerHTML;
};

// ================================
// Firebase Initialization
// ================================

const app = initializeApp(firebaseConfig);
// Initialize Firestore with modern cache configuration
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);

const MAX_IMAGE_SIZE_MB = 5;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

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
    const safeTag = note.tag ? escapeHTML(note.tag) : '';
    const safeHtml = sanitizeHTML(note.html || '');

    noteDiv.innerHTML = `
        <div class="flex justify-between items-start mb-2">
            <div class="flex items-center gap-2">
                ${safeTag ? `<span class="tag-badge">${safeTag}</span>` : ''}
                <span class="text-xs text-slate-500">${formattedDate}</span>
            </div>
        </div>
        <div class="note-content prose prose-slate dark:prose-invert">
            ${safeHtml}
        </div>
        <div class="flex justify-between items-center mt-3 text-xs text-slate-500">
            <span>${note.wordCount} kata | ${note.characterCount} karakter</span>
            <button class="text-red-500 hover:text-red-600" data-note-action="delete" data-note-id="${note.id}">Hapus</button>
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

// Auto-save and data protection
let hasUnsavedChanges = false;
let autoSaveTimer = null;
let lastSavedContent = '';
const AUTO_SAVE_DELAY = 120000; // 120 seconds (2 minutes) - Safe for meetings

// Pagination and performance
let displayedNotesCount = 20; // Initial load
const NOTES_PER_PAGE = 20;
let isLoadingMore = false;
let currentSortOrder = 'newest'; // newest, oldest, alphabetical
let activeDateFilter = 'all'; // all, today, week, month, custom

// Scheduled backup
let autoBackupTimer = null;
let lastBackupTime = localStorage.getItem('lastBackupTime');
const AUTO_BACKUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

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
    backupBtn: document.getElementById('backup-btn'),
    restoreBtn: document.getElementById('restore-btn'),
    restoreFileInput: document.getElementById('restore-file-input'),
    imageUploadBtn: document.getElementById('image-upload-btn'),
    imageUploadInput: document.getElementById('image-upload-input'),
    
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
    notesNavBtn: document.getElementById('notes-nav-btn'),
    
    // Templates
    templateSelector: document.getElementById('template-selector'),
    insertTemplateBtn: document.getElementById('insert-template-btn')
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
            showStatus(errorMsg, { type: 'error', duration: 5000 });
        });
    } catch (error) {
        const errorMsg = errorHandler.logError(error, { context: 'setup_notes_listener' });
        showStatus(errorMsg, { type: 'error', duration: 5000 });
    }
};

const setupLocalDevNotes = () => {
    try {
        console.log('🧪 Setting up local development notes');
        
        // Load notes from localStorage
        const localNotes = JSON.parse(localStorage.getItem('dev-notes') || '[]');
        allNotes = localNotes.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        renderTagFilters(allNotes);
        applyFilters();
        
        console.log(`📝 Loaded ${allNotes.length} local development notes`);
        
    } catch (error) {
        console.error('❌ Error loading local development notes:', error);
        allNotes = [];
        renderTagFilters(allNotes);
        applyFilters();
    }
};

// ================================
// Save Functions - Clean Implementation
// ================================

// Simple save state to prevent double-clicking
let isSaving = false;

const saveNote = async (isAutoSave = false) => {
    console.log('🔍 saveNote() called', isAutoSave ? '(AUTO-SAVE)' : '(MANUAL)');
    
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
        showStatus('💾 Menyimpan catatan...', { type: 'loading' });
        
        // Basic validation - get HTML content directly from editor
        const htmlContent = sanitizeHTML(elements.hasilTeksDiv.innerHTML.trim());
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
        
        // Check if running in development mode (localhost)
        const isLocalhost = isLocalDevelopment();
        
        // Authentication check - allow localhost testing
        if (!userId && !isLocalhost) {
            showStatus('❌ Silakan login terlebih dahulu', { type: 'error', duration: 4000 });
            return;
        }
        
        // Handle local development testing
        if (!userId && isLocalhost) {
            console.log('🧪 Development mode: Using localStorage fallback');
            
            const noteData = {
                id: editingNoteId || Date.now().toString(),
                text: textContent,
                html: htmlContent,
                tag: tagContent || '',
                wordCount: textContent.split(/\s+/).filter(word => word.length > 0).length,
                characterCount: textContent.length,
                timestamp: new Date().toISOString(),
                userId: 'local-dev-user'
            };
            
            // Get existing notes from localStorage
            let localNotes = JSON.parse(localStorage.getItem('dev-notes') || '[]');
            
            if (editingNoteId) {
                // Update existing note
                const noteIndex = localNotes.findIndex(note => note.id === editingNoteId);
                if (noteIndex !== -1) {
                    localNotes[noteIndex] = { ...localNotes[noteIndex], ...noteData };
                    showStatus('✅ Catatan berhasil diperbarui! (Mode Development)', { type: 'success', duration: 4000 });
                } else {
                    showStatus('❌ Catatan tidak ditemukan untuk diperbarui', { type: 'error', duration: 4000 });
                    return;
                }
            } else {
                // Add new note
                localNotes.unshift(noteData);
                showStatus('✅ Catatan berhasil disimpan! (Mode Development)', { type: 'success', duration: 4000 });
            }
            
            // Save to localStorage
            localStorage.setItem('dev-notes', JSON.stringify(localNotes));
            
            // Clear editor only on manual save
            if (!isAutoSave) {
                clearEditor();
                
                // Switch to notes view on mobile
                if (window.innerWidth < 768) {
                    switchView('notes');
                }
            } else {
                // For auto-save, just update the tracking variables
                lastSavedContent = htmlContent;
                hasUnsavedChanges = false;
            }
            
            console.log('✅ Local save completed');
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
            showStatus('✅ Catatan berhasil diperbarui!', { type: 'success', duration: 4000 });
        } else {
            // Create new note
            await addDoc(collection(db, 'users', userId, 'notes'), noteData);
            showStatus('✅ Catatan berhasil disimpan!', { type: 'success', duration: 4000 });
        }
        
        // Clear editor only on manual save, NOT on auto-save
        if (!isAutoSave) {
            clearEditor();
            
            // Switch to notes view on mobile
            if (window.innerWidth < 768) {
                switchView('notes');
            }
        } else {
            // For auto-save, just update the tracking variables without clearing
            lastSavedContent = htmlContent;
            hasUnsavedChanges = false;
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
        
        showStatus(errorMessage, { type: 'error', duration: 5000 });
        
    } finally {
        isSaving = false;
        updateSaveButtonState('ready');
    }
};

const clearEditor = () => {
    // Clear content
    elements.hasilTeksDiv.textContent = '';
    elements.tagInput.value = '';
    
    // Reset auto-save state
    hasUnsavedChanges = false;
    lastSavedContent = '';
    if (autoSaveTimer) {
        clearTimeout(autoSaveTimer);
        autoSaveTimer = null;
    }
    
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

// ================================
// Auto-Save System
// ================================

const scheduleAutoSave = () => {
    // Clear existing timer
    if (autoSaveTimer) {
        clearTimeout(autoSaveTimer);
    }
    
    // Schedule auto-save
    autoSaveTimer = setTimeout(() => {
        if (hasUnsavedChanges && elements.hasilTeksDiv.textContent.trim()) {
            console.log('⏰ Auto-saving...');
            autoSave();
        }
    }, AUTO_SAVE_DELAY);
};

const autoSave = async () => {
    // Don't auto-save if already saving or no changes
    if (isSaving || !hasUnsavedChanges) return;
    
    const currentContent = elements.hasilTeksDiv.innerHTML.trim();
    
    // Don't save if content hasn't changed
    if (currentContent === lastSavedContent) {
        hasUnsavedChanges = false;
        return;
    }
    
    // Don't save empty content
    if (!elements.hasilTeksDiv.textContent.trim()) return;
    
    try {
        console.log('💾 Auto-save triggered - saving in background without clearing editor');
        await saveNote(true); // Pass true to indicate auto-save
        showStatus('💾 Auto-saved (2 menit)', { type: 'success', duration: 2000 });
    } catch (error) {
        console.error('❌ Auto-save failed:', error);
        // Don't show error for auto-save, just log it
    }
};

const trackContentChanges = () => {
    const currentContent = elements.hasilTeksDiv.innerHTML.trim();
    if (currentContent !== lastSavedContent && currentContent) {
        hasUnsavedChanges = true;
        scheduleAutoSave();
    }
};

// Before unload warning
const handleBeforeUnload = (e) => {
    if (hasUnsavedChanges && elements.hasilTeksDiv.textContent.trim()) {
        e.preventDefault();
        e.returnValue = 'Anda memiliki perubahan yang belum disimpan. Yakin ingin menutup halaman?';
        return e.returnValue;
    }
};

// Keyboard shortcuts
const handleKeyboardShortcuts = (e) => {
    // Ctrl+S or Cmd+S for save
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (elements.hasilTeksDiv.textContent.trim()) {
            saveNote();
        }
    }
    
    // Ctrl+Z or Cmd+Z for undo (browser default, but ensure it works)
    // Ctrl+Y or Cmd+Y for redo (browser default, but ensure it works)
    // These are handled by browser's contenteditable, but we keep the handler for future custom undo/redo
};

// Enable save buttons when there's content
const checkContentAndUpdateButtons = () => {
    const content = elements.hasilTeksDiv.textContent.trim();
    const hasContent = content.length > 0;
    updateSaveButtonState(hasContent ? 'ready' : 'disabled');
};

// ================================
// Template System
// ================================

const TEMPLATES = {
    blank: {
        name: 'Kosong',
        content: '',
        tag: ''
    },
    meeting: {
        name: 'Catatan Rapat',
        content: `<p><strong>📝 Catatan Rapat</strong></p>
<p><strong>Tanggal:</strong> ${new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
<p><strong>Topik:</strong> [Isi topik rapat]</p>
<p><strong>Peserta:</strong> [Nama peserta]</p>
<p>&nbsp;</p>
<p><strong>Agenda:</strong></p>
<ul>
<li>[Item agenda 1]</li>
<li>[Item agenda 2]</li>
</ul>
<p>&nbsp;</p>
<p><strong>Keputusan:</strong></p>
<ul>
<li>[Keputusan 1]</li>
<li>[Keputusan 2]</li>
</ul>
<p>&nbsp;</p>
<p><strong>Action Items:</strong></p>
<ul>
<li>[ ] [Task 1] - PIC: [Nama]</li>
<li>[ ] [Task 2] - PIC: [Nama]</li>
</ul>`,
        tag: 'Rapat'
    },
    expense: {
        name: 'Catatan Pengeluaran',
        content: `<p><strong>💰 Catatan Pengeluaran</strong></p>
<p><strong>Tanggal:</strong> ${new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
<p><strong>Kategori:</strong> [Makanan/Transport/Belanja/Lainnya]</p>
<p>&nbsp;</p>
<p><strong>Daftar Pengeluaran:</strong></p>
<ul>
<li>[Item] - Rp [Jumlah]</li>
<li>[Item] - Rp [Jumlah]</li>
<li>[Item] - Rp [Jumlah]</li>
</ul>
<p>&nbsp;</p>
<p><strong>Total:</strong> Rp [Total]</p>
<p><strong>Catatan:</strong> [Catatan tambahan jika ada]</p>`,
        tag: 'Keuangan'
    },
    study: {
        name: 'Catatan Belajar',
        content: `<p><strong>📚 Catatan Belajar</strong></p>
<p><strong>Mata Pelajaran/Topik:</strong> [Isi topik]</p>
<p><strong>Tanggal:</strong> ${new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
<p>&nbsp;</p>
<p><strong>Konsep Utama:</strong></p>
<ul>
<li>[Konsep 1]</li>
<li>[Konsep 2]</li>
<li>[Konsep 3]</li>
</ul>
<p>&nbsp;</p>
<p><strong>Penjelasan Detail:</strong></p>
<p>[Tuliskan penjelasan detail di sini...]</p>
<p>&nbsp;</p>
<p><strong>Contoh/Latihan:</strong></p>
<p>[Contoh soal atau latihan]</p>
<p>&nbsp;</p>
<p><strong>Pertanyaan/Yang Belum Dipahami:</strong></p>
<ul>
<li>[Pertanyaan 1]</li>
<li>[Pertanyaan 2]</li>
</ul>`,
        tag: 'Belajar'
    },
    daily: {
        name: 'Jurnal Harian',
        content: `<p><strong>📋 Jurnal Harian</strong></p>
<p><strong>Tanggal:</strong> ${new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
<p>&nbsp;</p>
<p><strong>Mood Hari Ini:</strong> [😊 😐 😔 😤 🥳]</p>
<p>&nbsp;</p>
<p><strong>Yang Saya Lakukan Hari Ini:</strong></p>
<ul>
<li>[Aktivitas 1]</li>
<li>[Aktivitas 2]</li>
<li>[Aktivitas 3]</li>
</ul>
<p>&nbsp;</p>
<p><strong>Hal yang Disyukuri:</strong></p>
<ul>
<li>[Hal 1]</li>
<li>[Hal 2]</li>
</ul>
<p>&nbsp;</p>
<p><strong>Refleksi & Catatan:</strong></p>
<p>[Tuliskan refleksi atau catatan penting hari ini...]</p>`,
        tag: 'Jurnal'
    },
    travel: {
        name: 'Catatan Perjalanan',
        content: `<p><strong>✈️ Catatan Perjalanan</strong></p>
<p><strong>Tujuan:</strong> [Nama kota/tempat]</p>
<p><strong>Tanggal:</strong> ${new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
<p>&nbsp;</p>
<p><strong>Itinerary/Jadwal:</strong></p>
<ul>
<li><strong>Pagi:</strong> [Aktivitas pagi]</li>
<li><strong>Siang:</strong> [Aktivitas siang]</li>
<li><strong>Malam:</strong> [Aktivitas malam]</li>
</ul>
<p>&nbsp;</p>
<p><strong>Tempat yang Dikunjungi:</strong></p>
<ul>
<li>[Tempat 1] - [Kesan singkat]</li>
<li>[Tempat 2] - [Kesan singkat]</li>
</ul>
<p>&nbsp;</p>
<p><strong>Pengalaman Menarik:</strong></p>
<p>[Ceritakan pengalaman menarik selama perjalanan...]</p>
<p>&nbsp;</p>
<p><strong>Tips/Catatan Penting:</strong></p>
<ul>
<li>[Tips 1]</li>
<li>[Tips 2]</li>
</ul>`,
        tag: 'Travel'
    },
    ideas: {
        name: 'Ideas/Brainstorm',
        content: `<p><strong>💡 Ideas & Brainstorming</strong></p>
<p><strong>Topik:</strong> [Isi topik ide]</p>
<p><strong>Tanggal:</strong> ${new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
<p>&nbsp;</p>
<p><strong>Latar Belakang/Masalah:</strong></p>
<p>[Jelaskan konteks atau masalah yang ingin diselesaikan...]</p>
<p>&nbsp;</p>
<p><strong>Ideas/Solusi:</strong></p>
<ul>
<li>💡 [Ide 1]</li>
<li>💡 [Ide 2]</li>
<li>💡 [Ide 3]</li>
<li>💡 [Ide 4]</li>
</ul>
<p>&nbsp;</p>
<p><strong>Ide Terbaik (Prioritas):</strong></p>
<p>[Pilih ide yang paling menjanjikan dan jelaskan alasannya...]</p>
<p>&nbsp;</p>
<p><strong>Next Steps:</strong></p>
<ul>
<li>[ ] [Langkah 1]</li>
<li>[ ] [Langkah 2]</li>
<li>[ ] [Langkah 3]</li>
</ul>`,
        tag: 'Ideas'
    }
};

// Insert selected template into editor
const insertTemplate = (templateKey) => {
    const template = TEMPLATES[templateKey];
    if (!template) return;
    
    // If blank, just clear editor
    if (templateKey === 'blank') {
        elements.hasilTeksDiv.innerHTML = '';
        elements.hasilTeksDiv.focus();
        return;
    }
    
    // Check if editor has content
    const currentContent = elements.hasilTeksDiv.textContent.trim();
    if (currentContent) {
        const confirm = window.confirm(
            `Editor sudah berisi teks. Gunakan template akan mengganti konten yang ada.\n\nLanjutkan?`
        );
        if (!confirm) return;
    }
    
    // Insert template content
    elements.hasilTeksDiv.innerHTML = template.content;
    
    // Auto-fill tag if available
    if (template.tag && elements.tagInput) {
        elements.tagInput.value = template.tag;
    }
    
    // Move cursor to first empty field (placeholder text in brackets)
    moveCursorToFirstEmptyField();
    
    // Mark as having unsaved changes
    hasUnsavedChanges = true;
    checkContentAndUpdateButtons();
    scheduleAutoSave();
    
    // Reset template selector
    if (elements.templateSelector) {
        elements.templateSelector.value = '';
        if (elements.insertTemplateBtn) {
            elements.insertTemplateBtn.disabled = true;
        }
    }
};

// Move cursor to first empty field (text in square brackets)
const moveCursorToFirstEmptyField = () => {
    const editor = elements.hasilTeksDiv;
    const content = editor.innerHTML;
    
    // Find first occurrence of [text]
    const match = content.match(/\[([^\]]+)\]/);
    if (!match) {
        editor.focus();
        return;
    }
    
    // Create a temporary div to parse HTML
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = content;
    
    // Find the text node containing the match
    const walker = document.createTreeWalker(
        tempDiv,
        NodeFilter.SHOW_TEXT,
        null,
        false
    );
    
    let targetNode = null;
    let targetOffset = 0;
    
    while (walker.nextNode()) {
        const node = walker.currentNode;
        const index = node.textContent.indexOf(match[0]);
        if (index !== -1) {
            targetNode = node;
            targetOffset = index;
            break;
        }
    }
    
    if (targetNode) {
        // Replace tempDiv content back to editor to maintain node references
        editor.innerHTML = tempDiv.innerHTML;
        
        // Find the corresponding node in the actual editor
        const editorWalker = document.createTreeWalker(
            editor,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );
        
        let editorNode = null;
        while (editorWalker.nextNode()) {
            const node = editorWalker.currentNode;
            if (node.textContent === targetNode.textContent) {
                editorNode = node;
                break;
            }
        }
        
        if (editorNode) {
            // Set selection to highlight the bracketed text
            const range = document.createRange();
            range.setStart(editorNode, targetOffset);
            range.setEnd(editorNode, targetOffset + match[0].length);
            
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            
            editor.focus();
            return;
        }
    }
    
    // Fallback: just focus the editor
    editor.focus();
};

// Expose for onclick handlers
window.insertTemplate = insertTemplate;

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
            showStatus(`❌ ${errorMessage}`, { type: 'error', duration: 5000 });
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
        showStatus('✅ Speech recognition siap digunakan', { type: 'success', duration: 4000 });
    } else {
        console.warn('❌ Speech Recognition API not supported');
        showStatus('❌ Browser tidak mendukung speech recognition. Gunakan Chrome/Edge untuk fitur ini.', { type: 'error', duration: 5000 });
        
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
                showStatus('✅ Microphone ready (basic recording mode)', { type: 'success', duration: 4000 });
                
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
        showStatus('❌ Gagal mengakses microphone. Pastikan microphone terhubung dan izin diberikan.', { type: 'error', duration: 5000 });
    }
};

const startElectronRecording = () => {
    if (electronRecorder && electronRecorder.startRecording()) {
        isRecording = true;
        updateRecordingUI();
        showStatus('🎤 Merekam... (mode basic recording)', { type: 'loading' });
    }
};

const stopElectronRecording = () => {
    if (electronRecorder && electronRecorder.stopRecording()) {
        isRecording = false;
        updateRecordingUI();
        showStatus('🛑 Recording stopped', { type: 'info', duration: 3000 });
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
            showStatus('🎤 Merekam suara...', { type: 'loading' });
        } catch (error) {
            console.error('Start recording error:', error);
            showStatus('❌ Gagal memulai perekaman', { type: 'error', duration: 5000 });
        }
    }
};

const pauseRecording = () => {
    if (recognition && isRecording) {
        isPaused = !isPaused;
        
        if (isPaused) {
            recognition.stop();
            pausedTranscript = elements.hasilTeksDiv.innerHTML;
            showStatus('⏸️ Perekaman dijeda...', { type: 'warning', duration: 4000 });
            
            // Update save button state when paused
            checkContentAndUpdateButtons();
        } else {
            finalTranscript = '';
            recognition.start();
            showStatus('🎤 Melanjutkan perekaman...', { type: 'loading' });
        }
        
        updateRecordingUI();
    }
};

const stopRecording = () => {
    if (recognition && isRecording) {
        isRecording = false;
        isPaused = false;
        recognition.stop();
        showStatus('🛑 Perekaman dihentikan', { type: 'info', duration: 3000 });
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
        
        showStatus('❌ Edit dibatalkan', { type: 'error', duration: 5000 });
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
        showStatus('❌ Browser tidak mendukung text-to-speech', { type: 'error', duration: 5000 });
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
        showStatus('⚠️ Tidak ada teks untuk dibaca', { type: 'warning', duration: 4000 });
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
        showStatus('🔊 Membaca teks...', { type: 'loading' });
    };
    
    utterance.onend = () => {
        currentlySpeakingNoteId = null;
        updateSpeakButtonState(noteId, false);
    };
    
    utterance.onerror = (event) => {
        console.error('Speech synthesis error:', event.error);
        currentlySpeakingNoteId = null;
        updateSpeakButtonState(noteId, false);
        showStatus('❌ Gagal membaca teks', { type: 'error', duration: 5000 });
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

const renderNotes = (notesToRender = allNotes, append = false) => {
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
        displayedNotesCount = 0;
        return;
    }
    
    // Pagination: only render a subset
    const notesToShow = notesToRender.slice(0, displayedNotesCount);
    
    const notesHTML = notesToShow.map(note => {
        // Buat preview singkat - maksimal 100 karakter untuk 2 baris
        const fullText = note.html ? note.html.replace(/<[^>]*>/g, '') : note.text;
        const previewText = fullText.substring(0, 100);
        const hasMoreContent = fullText.length > 100;
        const safePreviewText = escapeHTML(previewText);
        const safeTag = note.tag ? escapeHTML(note.tag) : '';
        
        return `
            <div class="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-4 hover:shadow-lg transition-all duration-200" data-note-id="${note.id}">
                <div class="flex justify-between items-start mb-2">
                    <div class="flex-1">
                        ${safeTag ? `<span class="inline-block bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 text-xs px-2 py-1 rounded-full mb-2">${safeTag}</span>` : ''}
                    </div>
                    <div class="flex space-x-1 ml-2">
                        <button data-note-action="edit" data-note-id="${note.id}"
                                class="p-1.5 text-gray-400 hover:text-green-500 hover:bg-green-50 dark:hover:bg-green-900/30 rounded-md transition-colors text-sm" 
                                title="Edit catatan">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button data-note-action="delete" data-note-id="${note.id}"
                                class="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-md transition-colors text-sm" 
                                title="Hapus catatan">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
                
                <!-- Preview ringkas -->
                <div class="text-gray-800 dark:text-gray-200 mb-3 leading-relaxed text-sm line-clamp-2">
                    ${safePreviewText}${hasMoreContent ? '...' : ''}
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
                    <button data-note-action="view" data-note-id="${note.id}"
                            class="bg-blue-500 hover:bg-blue-600 text-white text-xs px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1" 
                            title="Lihat catatan lengkap">
                        <i class="fas fa-eye"></i>
                        <span>Lihat Detail</span>
                    </button>
                </div>
            </div>
        `;
    }).join('');
    
    if (append) {
        container.insertAdjacentHTML('beforeend', notesHTML);
    } else {
        container.innerHTML = notesHTML;
    }
    
    // Show load more button if there are more notes
    showLoadMoreButton(notesToRender.length > displayedNotesCount);
};

// Load more notes (infinite scroll)
const loadMoreNotes = () => {
    if (isLoadingMore) return;
    isLoadingMore = true;
    
    displayedNotesCount += NOTES_PER_PAGE;
    applyFilters();
    
    setTimeout(() => {
        isLoadingMore = false;
    }, 300);
};

// Show/hide load more button
const showLoadMoreButton = (show) => {
    let loadMoreBtn = document.getElementById('load-more-btn');
    
    if (show && !loadMoreBtn) {
        // Create button if doesn't exist
        loadMoreBtn = document.createElement('button');
        loadMoreBtn.id = 'load-more-btn';
        loadMoreBtn.className = 'w-full py-3 mt-4 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg transition-colors';
        loadMoreBtn.textContent = 'Muat Lebih Banyak';
        loadMoreBtn.addEventListener('click', loadMoreNotes);
        elements.catatanContainer.insertAdjacentElement('afterend', loadMoreBtn);
    } else if (!show && loadMoreBtn) {
        loadMoreBtn.remove();
    } else if (show && loadMoreBtn) {
        loadMoreBtn.style.display = 'block';
    } else if (!show && loadMoreBtn) {
        loadMoreBtn.style.display = 'none';
    }
};

const renderTagFilters = (notes) => {
    const tags = [...new Set(notes.map(note => note.tag).filter(tag => tag && tag.trim() !== ''))];
    const container = elements.tagFiltersContainer;
    
    if (!container) return;
    
    const allButton = `
        <button data-tag="all"
                class="tag-filter px-3 py-1 rounded-full text-sm transition-colors duration-200 ${activeTagFilter === 'all' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}">
            Semua (${notes.length})
        </button>
    `;
    
    const tagButtons = tags.map(tag => {
        const count = notes.filter(note => note.tag === tag).length;
        const safeTag = escapeHTML(tag);
        return `
            <button data-tag="${safeTag}" 
                    class="tag-filter px-3 py-1 rounded-full text-sm transition-colors duration-200 ${activeTagFilter === tag ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}">
                ${safeTag} (${count})
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
    
    // Filter by date
    if (activeDateFilter !== 'all') {
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        
        filteredNotes = filteredNotes.filter(note => {
            const noteDate = new Date(note.timestamp || note.updatedAt);
            switch (activeDateFilter) {
                case 'today':
                    return noteDate >= startOfToday;
                case 'week':
                    return noteDate >= startOfWeek;
                case 'month':
                    return noteDate >= startOfMonth;
                default:
                    return true;
            }
        });
    }
    
    // Filter by search
    const searchTerm = elements.searchInput?.value.toLowerCase().trim();
    if (searchTerm) {
        filteredNotes = filteredNotes.filter(note => 
            note.text.toLowerCase().includes(searchTerm) ||
            (note.tag && note.tag.toLowerCase().includes(searchTerm))
        );
    }
    
    // Sort notes
    filteredNotes = sortNotes(filteredNotes, currentSortOrder);
    
    // Reset pagination on new filter
    displayedNotesCount = NOTES_PER_PAGE;
    
    // Update UI indicators
    updateFilterUI();
    updateResultsCounter(filteredNotes.length, allNotes.length);
    
    renderNotes(filteredNotes);
};

// Update filter UI to show active state
const updateFilterUI = () => {
    // Update date filter buttons
    const dateButtons = {
        'all': document.getElementById('filter-all'),
        'today': document.getElementById('filter-today'),
        'week': document.getElementById('filter-week'),
        'month': document.getElementById('filter-month')
    };
    
    Object.keys(dateButtons).forEach(key => {
        const btn = dateButtons[key];
        if (btn) {
            btn.classList.toggle('active', activeDateFilter === key);
        }
    });
    
    // Sync sort dropdown
    const sortSelect = document.getElementById('sort-select');
    if (sortSelect) sortSelect.value = currentSortOrder;
    
    // Update active filters badges
    updateActiveFiltersBadges();
};

// Show active filters as removable badges
const updateActiveFiltersBadges = () => {
    const container = document.getElementById('active-filters-container');
    const badgesContainer = document.getElementById('active-filters-badges');
    
    if (!container || !badgesContainer) return;
    
    const badges = [];
    const searchTerm = elements.searchInput?.value.toLowerCase().trim();
    
    // Check if any non-default filters are active
    const hasActiveFilters = 
        activeDateFilter !== 'all' || 
        currentSortOrder !== 'newest' || 
        activeTagFilter !== 'all' || 
        searchTerm;
    
    if (!hasActiveFilters) {
        container.classList.add('hidden');
        return;
    }
    
    container.classList.remove('hidden');
    
    // Date filter badge
    if (activeDateFilter !== 'all') {
        const dateLabels = {
            'today': '📅 Hari Ini',
            'week': '📆 Minggu Ini',
            'month': '🗓️ Bulan Ini'
        };
        badges.push(`
            <span class="inline-flex items-center gap-1 px-3 py-1 bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 text-xs font-medium rounded-full">
                ${dateLabels[activeDateFilter]}
                <button data-badge-action="reset-date" class="hover:text-indigo-900 dark:hover:text-indigo-100 transition-colors">
                    ✕
                </button>
            </span>
        `);
    }
    
    // Sort filter badge
    if (currentSortOrder !== 'newest') {
        const sortLabels = {
            'oldest': '🔼 Terlama',
            'alphabetical': '🔤 A-Z'
        };
        badges.push(`
            <span class="inline-flex items-center gap-1 px-3 py-1 bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 text-xs font-medium rounded-full">
                ${sortLabels[currentSortOrder]}
                <button data-badge-action="reset-sort" class="hover:text-purple-900 dark:hover:text-purple-100 transition-colors">
                    ✕
                </button>
            </span>
        `);
    }
    
    // Tag filter badge
    if (activeTagFilter !== 'all') {
        badges.push(`
            <span class="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 text-xs font-medium rounded-full">
                🏷️ ${escapeHTML(activeTagFilter)}
                <button data-badge-action="reset-tag" class="hover:text-blue-900 dark:hover:text-blue-100 transition-colors">
                    ✕
                </button>
            </span>
        `);
    }
    
    // Search filter badge
    if (searchTerm) {
        badges.push(`
            <span class="inline-flex items-center gap-1 px-3 py-1 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 text-xs font-medium rounded-full">
                🔍 "${escapeHTML(searchTerm)}"
                <button data-badge-action="reset-search" class="hover:text-green-900 dark:hover:text-green-100 transition-colors">
                    ✕
                </button>
            </span>
        `);
    }
    
    badgesContainer.innerHTML = badges.join('');
};

// Update results counter
const updateResultsCounter = (filteredCount, totalCount) => {
    const counter = document.getElementById('results-counter');
    const filteredSpan = document.getElementById('filtered-count');
    const totalSpan = document.getElementById('total-count');
    
    if (!counter || !filteredSpan || !totalSpan) return;
    
    filteredSpan.textContent = filteredCount;
    totalSpan.textContent = totalCount;
    
    // Show counter when filtering is active
    if (filteredCount < totalCount) {
        counter.classList.remove('hidden');
    } else {
        counter.classList.add('hidden');
    }
};

// Global functions for filter controls
window.setDateFilter = (filter) => {
    activeDateFilter = filter;
    applyFilters();
};

window.setSortOrder = (order) => {
    currentSortOrder = order;
    applyFilters();
};

window.clearSearch = () => {
    if (elements.searchInput) {
        elements.searchInput.value = '';
        applyFilters();
    }
};

window.clearAllFilters = () => {
    // Reset all filters to defaults
    activeDateFilter = 'all';
    currentSortOrder = 'newest';
    activeTagFilter = 'all';
    if (elements.searchInput) {
        elements.searchInput.value = '';
    }
    
    // Reapply filters
    applyFilters();
    
    // Show confirmation
    showStatus('✅ Semua filter telah direset', { type: 'success', duration: 3000 });
};

// Sort notes by different criteria
const sortNotes = (notes, order) => {
    const sorted = [...notes];
    
    switch (order) {
        case 'oldest':
            return sorted.sort((a, b) => {
                const dateA = new Date(a.timestamp || a.updatedAt);
                const dateB = new Date(b.timestamp || b.updatedAt);
                return dateA - dateB;
            });
        case 'alphabetical':
            return sorted.sort((a, b) => {
                const textA = (a.text || '').toLowerCase();
                const textB = (b.text || '').toLowerCase();
                return textA.localeCompare(textB);
            });
        case 'newest':
        default:
            return sorted.sort((a, b) => {
                const dateA = new Date(a.timestamp || a.updatedAt);
                const dateB = new Date(b.timestamp || b.updatedAt);
                return dateB - dateA;
            });
    }
};

// ================================
// Backup and Restore Functions
// ================================

let statusTimeout = null;

const showStatus = (message, { type = 'info', duration = 0 } = {}) => {
    if (!elements.statusDiv) return;
    if (statusTimeout) {
        clearTimeout(statusTimeout);
        statusTimeout = null;
    }
    // Reset classes
    elements.statusDiv.className = 'status-toast text-sm';
    switch (type) {
        case 'success':
            elements.statusDiv.classList.add('text-green-500');
            break;
        case 'error':
            elements.statusDiv.classList.add('text-red-500', 'font-semibold');
            break;
        case 'warning':
            elements.statusDiv.classList.add('text-yellow-500');
            break;
        case 'loading':
            elements.statusDiv.classList.add('text-blue-400', 'animate-pulse');
            break;
        default:
            elements.statusDiv.classList.add('text-gray-400');
    }
    elements.statusDiv.textContent = message;
    elements.statusDiv.style.opacity = '1';
    elements.statusDiv.style.transform = 'translateY(0)';
    if (duration > 0) {
        statusTimeout = setTimeout(() => {
            elements.statusDiv.style.opacity = '0';
            elements.statusDiv.style.transform = 'translateY(8px)';
            setTimeout(() => {
                if (elements.statusDiv.style.opacity === '0') {
                    elements.statusDiv.textContent = '';
                }
            }, 300);
        }, duration);
    }
};

const getDecryptErrorMessage = (error) => {
    if (!error) return 'Password salah atau data backup rusak.';
    if (error.name === 'OperationError' || error.name === 'DataError') {
        return 'Password salah atau data backup rusak.';
    }
    return error.message || 'Password salah atau data backup rusak.';
};

const setBackupRestoreButtons = (disabled) => {
    if (elements.backupBtn) {
        elements.backupBtn.disabled = disabled;
        elements.backupBtn.style.opacity = disabled ? '0.5' : '1';
        elements.backupBtn.style.pointerEvents = disabled ? 'none' : 'auto';
    }
    if (elements.restoreBtn) {
        elements.restoreBtn.disabled = disabled;
        elements.restoreBtn.style.opacity = disabled ? '0.5' : '1';
        elements.restoreBtn.style.pointerEvents = disabled ? 'none' : 'auto';
    }
};

const stripHTML = (html = '') => {
    const temp = document.createElement('div');
    temp.innerHTML = html;
    return temp.textContent || '';
};

const bytesToBase64 = (bytes) => {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
};

const base64ToBytes = (base64) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
};

const deriveEncryptionKey = async (password, salt, iterations = 100000) => {
    const encoder = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
        'raw',
        encoder.encode(password),
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
    );

    return window.crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt,
            iterations,
            hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
};

const encryptData = async (dataObject, password) => {
    if (!window.crypto?.subtle) {
        throw new Error('Browser tidak mendukung enkripsi');
    }

    const encoder = new TextEncoder();
    const salt = window.crypto.getRandomValues(new Uint8Array(16));
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveEncryptionKey(password, salt);
    const plaintext = encoder.encode(JSON.stringify(dataObject));
    const ciphertext = await window.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        plaintext
    );

    return JSON.stringify({
        salt: bytesToBase64(salt),
        iv: bytesToBase64(iv),
        ciphertext: bytesToBase64(new Uint8Array(ciphertext))
    });
};

const decryptData = async (encryptedJson, password) => {
    if (!window.crypto?.subtle) {
        throw new Error('Browser tidak mendukung dekripsi');
    }

    const { salt, iv, ciphertext } = JSON.parse(encryptedJson);
    if (!salt || !iv || !ciphertext) {
        throw new Error('Struktur enkripsi tidak valid');
    }

    const saltBytes = base64ToBytes(salt);
    const ivBytes = base64ToBytes(iv);
    const dataBytes = base64ToBytes(ciphertext);
    const key = await deriveEncryptionKey(password, saltBytes);
    const plaintext = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: ivBytes },
        key,
        dataBytes
    );

    const decoder = new TextDecoder();
    return JSON.parse(decoder.decode(plaintext));
};

const promptPasswordForBackup = () => {
    const password = prompt('Masukkan password untuk enkripsi backup (minimal 8 karakter):');
    if (!password) return null;
    if (password.length < 8) {
        alert('Password minimal 8 karakter.');
        return null;
    }
    const confirmPassword = prompt('Ulangi password untuk konfirmasi:');
    if (confirmPassword !== password) {
        alert('Konfirmasi password tidak cocok.');
        return null;
    }
    return password;
};

const promptPasswordForRestore = () => {
    const password = prompt('Masukkan password untuk membuka backup:');
    if (!password) return null;
    if (password.length < 8) {
        alert('Password minimal 8 karakter.');
        return null;
    }
    return password;
};

const buildBackupPayload = () => {
    return {
        app: APP_CONFIG.name,
        version: APP_CONFIG.version,
        exportedAt: new Date().toISOString(),
        notes: allNotes.map(note => ({
            id: note.id || null,
            text: note.text || stripHTML(note.html || ''),
            html: sanitizeHTML(note.html || ''),
            tag: note.tag || '',
            wordCount: note.wordCount || 0,
            characterCount: note.characterCount || 0,
            timestamp: note.timestamp || null,
            updatedAt: note.updatedAt || null
        }))
    };
};

const downloadJson = (data, filename) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
};

const downloadText = (text, filename) => {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
};

const handleBackup = async () => {
    if (!userId) {
        showStatus('🔐 Silakan login untuk melakukan backup.', { type: 'warning', duration: 4000 });
        return;
    }

    if (!allNotes.length) {
        showStatus('⚠️ Tidak ada catatan untuk dibackup.', { type: 'warning', duration: 4000 });
        return;
    }

    const password = promptPasswordForBackup();
    if (!password) {
        showStatus('⚠️ Backup dibatalkan.', { type: 'warning', duration: 3000 });
        return;
    }

    setBackupRestoreButtons(true);
    try {
        showStatus('🔐 Mengenkripsi backup...', { type: 'loading' });
        const payload = buildBackupPayload();
        const encryptedJson = await encryptData(payload, password);
        const dateStamp = new Date().toISOString().slice(0, 10);
        const safeEmail = (elements.userEmail?.textContent || 'user').replace(/[^a-zA-Z0-9_-]/g, '_');
        const filename = `blinenote-backup-${safeEmail}-${dateStamp}.json`;
        downloadText(encryptedJson, filename);
        showStatus(`✅ Backup berhasil! ${allNotes.length} catatan terenkripsi → ${filename}`, { type: 'success', duration: 6000 });
    } catch (error) {
        showStatus(`❌ Backup gagal: ${error.message}`, { type: 'error', duration: 8000 });
    } finally {
        setBackupRestoreButtons(false);
    }
};

// Export notes to plain text
const exportToPlainText = () => {
    if (!userId) {
        showStatus('🔐 Silakan login untuk export catatan.', { type: 'warning', duration: 4000 });
        return;
    }

    if (!allNotes.length) {
        showStatus('⚠️ Tidak ada catatan untuk di-export.', { type: 'warning', duration: 4000 });
        return;
    }

    try {
        const dateStamp = new Date().toISOString().slice(0, 10);
        const safeEmail = (elements.userEmail?.textContent || 'user').replace(/[^a-zA-Z0-9_-]/g, '_');
        
        let textContent = `BLINENOTE - CATATAN SAYA\n`;
        textContent += `=================================\n`;
        textContent += `Exported: ${new Date().toLocaleString('id-ID')}\n`;
        textContent += `Total: ${allNotes.length} catatan\n\n`;
        
        allNotes.forEach((note, index) => {
            const text = note.text || stripHTML(note.html || '');
            const date = note.timestamp ? new Date(note.timestamp).toLocaleString('id-ID') : 'Tanggal tidak tersedia';
            const tag = note.tag || 'Tanpa Tag';
            
            textContent += `\n--- CATATAN ${index + 1} ---\n`;
            textContent += `Tanggal: ${date}\n`;
            textContent += `Tag: ${tag}\n`;
            textContent += `\n${text}\n`;
            textContent += `\n${'='.repeat(50)}\n`;
        });
        
        const filename = `blinenote-export-${safeEmail}-${dateStamp}.txt`;
        downloadText(textContent, filename);
        showStatus(`✅ Export berhasil! ${allNotes.length} catatan → ${filename}`, { type: 'success', duration: 6000 });
    } catch (error) {
        showStatus(`❌ Export gagal: ${error.message}`, { type: 'error', duration: 8000 });
    }
};

// Export notes to PDF using browser print
const exportToPDF = () => {
    if (!userId) {
        showStatus('🔐 Silakan login untuk export catatan.', { type: 'warning', duration: 4000 });
        return;
    }

    if (!allNotes.length) {
        showStatus('⚠️ Tidak ada catatan untuk di-export.', { type: 'warning', duration: 4000 });
        return;
    }

    try {
        // Create a print-friendly HTML
        const dateStamp = new Date().toLocaleString('id-ID');
        let htmlContent = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>BLineNote - Export PDF</title>
                <style>
                    body { font-family: 'Segoe UI', Arial, sans-serif; padding: 20px; max-width: 800px; margin: 0 auto; }
                    h1 { color: #4f46e5; border-bottom: 3px solid #4f46e5; padding-bottom: 10px; }
                    .meta { color: #666; font-size: 14px; margin-bottom: 30px; }
                    .note { margin-bottom: 40px; border: 1px solid #e2e8f0; padding: 20px; border-radius: 8px; page-break-inside: avoid; }
                    .note-header { display: flex; justify-content: space-between; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid #e2e8f0; }
                    .note-date { color: #64748b; font-size: 13px; }
                    .note-tag { background: #4f46e5; color: white; padding: 4px 12px; border-radius: 12px; font-size: 12px; }
                    .note-content { line-height: 1.6; color: #1e293b; }
                    @media print {
                        body { padding: 0; }
                        .note { page-break-inside: avoid; }
                    }
                </style>
            </head>
            <body>
                <h1>📝 BLineNote - Catatan Saya</h1>
                <div class="meta">
                    <p><strong>Exported:</strong> ${dateStamp}</p>
                    <p><strong>Total Catatan:</strong> ${allNotes.length}</p>
                </div>
        `;
        
        allNotes.forEach((note, index) => {
            const text = note.text || stripHTML(note.html || '');
            const html = note.html || text.replace(/\n/g, '<br>');
            const date = note.timestamp ? new Date(note.timestamp).toLocaleString('id-ID') : 'Tanggal tidak tersedia';
            const tag = note.tag || 'Tanpa Tag';
            
            htmlContent += `
                <div class="note">
                    <div class="note-header">
                        <span class="note-date">${date}</span>
                        <span class="note-tag">${tag}</span>
                    </div>
                    <div class="note-content">${sanitizeHTML(html)}</div>
                </div>
            `;
        });
        
        htmlContent += `
            </body>
            </html>
        `;
        
        // Open in new window and trigger print
        const printWindow = window.open('', '_blank');
        printWindow.document.write(htmlContent);
        printWindow.document.close();
        
        // Wait for content to load then print
        setTimeout(() => {
            printWindow.print();
            showStatus('✅ Dialog print PDF dibuka. Simpan sebagai PDF.', { type: 'success', duration: 6000 });
        }, 500);
        
    } catch (error) {
        showStatus(`❌ Export PDF gagal: ${error.message}`, { type: 'error', duration: 8000 });
    }
};

// Scheduled auto-backup functions
const shouldRunAutoBackup = () => {
    if (!lastBackupTime) return true;
    const timeSinceLastBackup = Date.now() - parseInt(lastBackupTime);
    return timeSinceLastBackup >= AUTO_BACKUP_INTERVAL;
};

const performAutoBackup = async () => {
    if (!userId || !allNotes.length) {
        console.log('⏭️ Auto-backup skipped: Not logged in or no notes');
        return;
    }

    if (!shouldRunAutoBackup()) {
        console.log('⏭️ Auto-backup skipped: Not yet 24 hours');
        return;
    }

    try {
        console.log('🔄 Running scheduled auto-backup...');
        const payload = buildBackupPayload();
        
        // Use a default password for auto-backup to avoid prompt
        const autoPassword = `auto-${userId}-blinenote`;
        const encryptedJson = await encryptData(payload, autoPassword);
        
        const dateStamp = new Date().toISOString().slice(0, 10);
        const timeStamp = new Date().toTimeString().slice(0, 5).replace(':', '');
        const safeEmail = (elements.userEmail?.textContent || 'user').replace(/[^a-zA-Z0-9_-]/g, '_');
        const filename = `blinenote-auto-backup-${safeEmail}-${dateStamp}-${timeStamp}.json`;
        
        downloadText(encryptedJson, filename);
        
        // Update last backup time
        lastBackupTime = Date.now().toString();
        localStorage.setItem('lastBackupTime', lastBackupTime);
        
        showStatus(`✅ Auto-backup berhasil! ${allNotes.length} catatan → ${filename}`, { 
            type: 'success', 
            duration: 8000 
        });
        
        console.log('✅ Auto-backup completed successfully');
    } catch (error) {
        console.error('❌ Auto-backup failed:', error);
        showStatus(`⚠️ Auto-backup gagal: ${error.message}. Coba backup manual.`, { 
            type: 'warning', 
            duration: 6000 
        });
    }
};

const scheduleAutoBackup = () => {
    // Clear existing timer
    if (autoBackupTimer) {
        clearInterval(autoBackupTimer);
    }
    
    // Check immediately on schedule
    performAutoBackup();
    
    // Then check every hour if backup is due
    autoBackupTimer = setInterval(() => {
        performAutoBackup();
    }, 60 * 60 * 1000); // Check every hour
    
    console.log('⏰ Auto-backup scheduler initialized');
};

const getLastBackupInfo = () => {
    if (!lastBackupTime) return 'Belum pernah backup';
    
    const lastBackup = new Date(parseInt(lastBackupTime));
    const now = new Date();
    const diffMs = now - lastBackup;
    const diffHours = Math.floor(diffMs / (60 * 60 * 1000));
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffDays > 0) {
        return `${diffDays} hari yang lalu`;
    } else if (diffHours > 0) {
        return `${diffHours} jam yang lalu`;
    } else {
        return 'Baru saja';
    }
};

const parseBackupFile = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const data = JSON.parse(reader.result);
                resolve(data);
            } catch (error) {
                reject(new Error('Format JSON tidak valid'));
            }
        };
        reader.onerror = () => reject(new Error('Gagal membaca file'));
        reader.readAsText(file);
    });
};

const normalizeImportedNote = (note) => {
    const html = sanitizeHTML(note.html || '');
    const text = note.text || stripHTML(html);
    return {
        text: text.trim(),
        html,
        tag: note.tag || '',
        wordCount: text.split(/\s+/).filter(word => word.length > 0).length,
        characterCount: text.length,
        timestamp: note.timestamp || new Date().toISOString(),
        updatedAt: note.updatedAt || null
    };
};

const buildNoteDedupKey = (note) => {
    const text = (note.text || '').trim();
    const timestamp = note.timestamp || note.updatedAt || '';
    const tag = note.tag || '';
    return `${text}||${timestamp}||${tag}`;
};

const batchImportNotes = async (notes) => {
    const notesCollectionPath = collection(db, 'users', userId, 'notes');
    let batch = writeBatch(db);
    let batchCount = 0;

    for (const note of notes) {
        const noteRef = doc(notesCollectionPath);
        batch.set(noteRef, note);
        batchCount += 1;

        if (batchCount >= 450) {
            await batch.commit();
            batch = writeBatch(db);
            batchCount = 0;
        }
    }

    if (batchCount > 0) {
        await batch.commit();
    }
};

const handleRestore = async (file) => {
    if (!userId) {
        showStatus('🔐 Silakan login untuk melakukan restore.', { type: 'warning', duration: 4000 });
        return;
    }

    setBackupRestoreButtons(true);
    try {
        showStatus('📥 Membaca file backup...', { type: 'loading' });
        let data = await parseBackupFile(file);

        if (data?.ciphertext && data?.salt && data?.iv) {
            const password = promptPasswordForRestore();
            if (!password) {
                showStatus('⚠️ Restore dibatalkan.', { type: 'warning', duration: 3000 });
                return;
            }
            showStatus('🔓 Mendekripsi backup...', { type: 'loading' });
            try {
                data = await decryptData(JSON.stringify(data), password);
            } catch (decryptError) {
                showStatus(`❌ Gagal dekripsi: ${getDecryptErrorMessage(decryptError)}`, { type: 'error', duration: 8000 });
                return;
            }
        } else {
            showStatus('❌ File backup tidak terenkripsi. Hanya backup terenkripsi yang didukung.', { type: 'error', duration: 6000 });
            return;
        }

        if (!data || !Array.isArray(data.notes)) {
            showStatus('❌ Struktur backup tidak valid. File mungkin rusak.', { type: 'error', duration: 6000 });
            return;
        }

        const totalNotes = data.notes.length;
        if (!totalNotes) {
            showStatus('⚠️ File backup kosong, tidak ada catatan untuk diimpor.', { type: 'warning', duration: 5000 });
            return;
        }

        // Show info about backup before confirm
        const backupDate = data.exportedAt ? new Date(data.exportedAt).toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' }) : 'tidak diketahui';
        const proceed = confirm(`File backup (${backupDate}):\n• ${totalNotes} catatan ditemukan\n• Catatan yang sudah ada tidak akan dihapus\n• Duplikat akan otomatis dilewati\n\nLanjutkan restore?`);
        if (!proceed) {
            showStatus('⚠️ Restore dibatalkan.', { type: 'warning', duration: 3000 });
            return;
        }

        showStatus(`🔍 Memeriksa ${totalNotes} catatan untuk duplikasi...`, { type: 'loading' });

        const existingKeys = new Set();
        allNotes.forEach(note => {
            const text = note.text || stripHTML(note.html || '');
            existingKeys.add(buildNoteDedupKey({
                text,
                timestamp: note.timestamp || note.updatedAt || '',
                tag: note.tag || ''
            }));
        });

        const notesToImport = [];
        let skipped = 0;
        data.notes.forEach(note => {
            const normalized = normalizeImportedNote(note);
            const key = buildNoteDedupKey(normalized);
            if (existingKeys.has(key)) {
                skipped += 1;
                return;
            }
            existingKeys.add(key);
            notesToImport.push(normalized);
        });

        if (!notesToImport.length) {
            showStatus(`ℹ️ Semua ${totalNotes} catatan sudah ada (duplikat). Tidak ada yang perlu diimpor.`, { type: 'warning', duration: 6000 });
            return;
        }

        showStatus(`📥 Mengimpor ${notesToImport.length} catatan baru...`, { type: 'loading' });
        await batchImportNotes(notesToImport);

        const summary = [];
        summary.push(`${notesToImport.length} catatan berhasil diimpor`);
        if (skipped > 0) summary.push(`${skipped} duplikat dilewati`);
        showStatus(`✅ Restore selesai! ${summary.join(', ')}.`, { type: 'success', duration: 8000 });
    } catch (error) {
        showStatus(`❌ Restore gagal: ${error.message}`, { type: 'error', duration: 8000 });
    } finally {
        setBackupRestoreButtons(false);
        if (elements.restoreFileInput) {
            elements.restoreFileInput.value = '';
        }
    }
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
        elements.hasilTeksDiv.innerHTML = sanitizeHTML(note.html);
    } else {
        // Fallback for old notes without HTML content
        const safeText = escapeHTML(note.text || '');
        elements.hasilTeksDiv.innerHTML = safeText.replace(/\n/g, '<br>');
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
    
    showStatus('✏️ Mode edit - ubah teks dan klik perbarui', { type: 'info', duration: 3000 });
    console.log('✏️ Editing note:', noteId);
};

// Make speakText available globally
window.speakText = speakText;

window.deleteNote = async (noteId) => {
    const note = allNotes.find(n => n.id === noteId);
    if (!note) {
        showStatus('❌ Catatan tidak ditemukan', { type: 'error', duration: 5000 });
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
        showStatus('🗑️ Menghapus catatan...', { type: 'loading' });
        
        // Check if running in development mode (localhost)
        const isLocalhost = isLocalDevelopment();
        
        if (isLocalhost && !userId) {
            // Handle local development deletion
            console.log('🧪 Development mode: Deleting from localStorage');
            
            let localNotes = JSON.parse(localStorage.getItem('dev-notes') || '[]');
            localNotes = localNotes.filter(note => note.id !== noteId);
            localStorage.setItem('dev-notes', JSON.stringify(localNotes));
            
            // Update allNotes and re-render
            allNotes = localNotes.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            renderTagFilters(allNotes);
            applyFilters();
            
            showStatus('✅ Catatan berhasil dihapus (Mode Development)', { type: 'success', duration: 4000 });
            
        } else {
            // Check authentication for production
            if (!userId) {
                throw new Error('Anda harus login untuk menghapus catatan');
            }
            
            // Delete from Firestore
            await deleteDoc(doc(db, 'users', userId, 'notes', noteId));
            showStatus('✅ Catatan berhasil dihapus', { type: 'success', duration: 4000 });
        }
        
        // If currently editing this note, clear the editor
        if (editingNoteId === noteId) {
            clearEditor();
        }
        
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
        
        showStatus(errorMessage, { type: 'error', duration: 5000 });
    }
};

// ================================
// Authentication Functions
// ================================

const handleLogin = async () => {
    const email = elements.emailLoginInput.value.trim();
    const password = elements.passwordLoginInput.value.trim();
    
    if (!email || !password) {
        showStatus('⚠️ Email dan password harus diisi', { type: 'warning', duration: 4000 });
        return;
    }
    
    try {
        showStatus('🔄 Sedang masuk...', { type: 'loading' });
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
        
        showStatus(errorMessage, { type: 'error', duration: 5000 });
    }
};

const handleSignUp = async () => {
    const email = elements.emailDaftarInput.value.trim();
    const password = elements.passwordDaftarInput.value.trim();
    
    if (!email || !password) {
        showStatus('⚠️ Email dan password harus diisi', { type: 'warning', duration: 4000 });
        return;
    }
    
    // Password strength validation
    const passwordStrength = validatePasswordStrength(password);
    
    if (!passwordStrength.isValid) {
        showStatus('⚠️ ' + passwordStrength.message, { type: 'warning', duration: 5000 });
        return;
    }
    
    if (passwordStrength.strength === 'weak') {
        const confirmed = confirm('Password Anda tergolong lemah. Disarankan menggunakan kombinasi huruf besar, huruf kecil, angka, dan simbol untuk keamanan lebih baik.\n\nLanjutkan dengan password ini?');
        if (!confirmed) return;
    }
    
    try {
        showStatus('🔄 Sedang mendaftar...', { type: 'loading' });
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
        
        showStatus(errorMessage, { type: 'error', duration: 5000 });
    }
};

// Password strength validator
const validatePasswordStrength = (password) => {
    const result = {
        isValid: false,
        strength: 'weak',
        message: '',
        score: 0
    };
    
    // Minimum length check
    if (password.length < 6) {
        result.message = 'Password minimal 6 karakter';
        return result;
    }
    
    result.isValid = true;
    let score = 0;
    
    // Length score
    if (password.length >= 8) score += 1;
    if (password.length >= 12) score += 1;
    
    // Complexity checks
    if (/[a-z]/.test(password)) score += 1; // lowercase
    if (/[A-Z]/.test(password)) score += 1; // uppercase
    if (/[0-9]/.test(password)) score += 1; // numbers
    if (/[^a-zA-Z0-9]/.test(password)) score += 1; // special chars
    
    result.score = score;
    
    // Determine strength
    if (score <= 2) {
        result.strength = 'weak';
        result.message = 'Password lemah (gunakan kombinasi huruf, angka, dan simbol)';
    } else if (score <= 4) {
        result.strength = 'medium';
        result.message = 'Password cukup kuat';
    } else {
        result.strength = 'strong';
        result.message = 'Password sangat kuat';
    }
    
    return result;
};

const handleLogout = async () => {
    try {
        await signOut(auth);
        // Cleanup handled in onAuthStateChanged
    } catch (error) {
        console.error('Logout error:', error);
        showStatus('❌ Gagal keluar: ' + error.message, { type: 'error', duration: 5000 });
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
                showStatus('⚠️ Tidak ada teks untuk dibaca', { type: 'warning', duration: 4000 });
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
    const checkboxButton = document.querySelector('button[data-toolbar-action="insert-checkbox"]');
    if (checkboxButton) {
        console.log('✅ Checkbox button found, adding event listener');
        checkboxButton.addEventListener('click', () => {
            console.log('🔧 Checkbox button clicked');
            window.insertCheckbox();
        });
    } else {
        console.log('❌ Checkbox button NOT found');
    }

    // Image upload controls
    if (elements.imageUploadBtn && elements.imageUploadInput) {
        if (!APP_CONFIG.enableImageUpload) {
            elements.imageUploadBtn.classList.add('hidden');
            elements.imageUploadBtn.setAttribute('aria-hidden', 'true');
            elements.imageUploadBtn.setAttribute('tabindex', '-1');
            elements.imageUploadBtn.remove();
            elements.imageUploadInput.remove();
        } else {
            elements.imageUploadBtn.classList.remove('hidden');
            elements.imageUploadBtn.addEventListener('click', () => {
                elements.imageUploadInput.click();
            });

            elements.imageUploadInput.addEventListener('change', (event) => {
                const file = event.target.files && event.target.files[0];
                if (file) {
                    handleImageUpload(file);
                }
                event.target.value = '';
            });
        }
    }
    
    // Content monitoring for save button state
    if (elements.hasilTeksDiv) {
        elements.hasilTeksDiv.addEventListener('input', checkContentAndUpdateButtons);
        elements.hasilTeksDiv.addEventListener('keyup', checkContentAndUpdateButtons);
        elements.hasilTeksDiv.addEventListener('paste', () => {
            setTimeout(checkContentAndUpdateButtons, 100);
            handlePasteWithURLDetection();
        });
        
        // Auto-save tracking
        elements.hasilTeksDiv.addEventListener('input', trackContentChanges);
        elements.hasilTeksDiv.addEventListener('paste', () => {
            setTimeout(trackContentChanges, 100);
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
                    trackContentChanges();
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
    
    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyboardShortcuts);
    
    // Before unload warning
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    // Auth controls
    if (elements.tombolSubmitLogin) elements.tombolSubmitLogin.addEventListener('click', handleLogin);
    if (elements.tombolSubmitDaftar) elements.tombolSubmitDaftar.addEventListener('click', handleSignUp);
    if (elements.tombolLogout) elements.tombolLogout.addEventListener('click', handleLogout);
    if (elements.authToggleBtn) elements.authToggleBtn.addEventListener('click', toggleAuthMode);
    if (elements.authToggleBtn2) elements.authToggleBtn2.addEventListener('click', toggleAuthMode);
    
    // Password strength indicator
    const passwordDaftarInput = document.getElementById('password-daftar');
    const passwordStrengthDiv = document.getElementById('password-strength');
    const passwordStrengthBar = document.getElementById('password-strength-bar');
    const passwordStrengthText = document.getElementById('password-strength-text');
    
    if (passwordDaftarInput && passwordStrengthDiv) {
        passwordDaftarInput.addEventListener('input', () => {
            const password = passwordDaftarInput.value;
            
            if (password.length === 0) {
                passwordStrengthDiv.classList.add('hidden');
                return;
            }
            
            passwordStrengthDiv.classList.remove('hidden');
            const strength = validatePasswordStrength(password);
            
            // Update bar width and color
            let widthPercent = 0;
            let colorClass = '';
            
            if (strength.score <= 2) {
                widthPercent = 33;
                colorClass = 'bg-red-500';
                passwordStrengthText.textContent = '❌ Lemah';
                passwordStrengthText.className = 'text-xs text-red-500';
            } else if (strength.score <= 4) {
                widthPercent = 66;
                colorClass = 'bg-yellow-500';
                passwordStrengthText.textContent = '⚠️ Sedang';
                passwordStrengthText.className = 'text-xs text-yellow-500';
            } else {
                widthPercent = 100;
                colorClass = 'bg-green-500';
                passwordStrengthText.textContent = '✅ Kuat';
                passwordStrengthText.className = 'text-xs text-green-500';
            }
            
            passwordStrengthBar.style.width = widthPercent + '%';
            passwordStrengthBar.className = 'h-full transition-all duration-300 ' + colorClass;
        });
    }

    // Backup & restore controls
    if (elements.backupBtn) elements.backupBtn.addEventListener('click', handleBackup);
    if (elements.restoreBtn && elements.restoreFileInput) {
        elements.restoreBtn.addEventListener('click', () => elements.restoreFileInput.click());
        elements.restoreFileInput.addEventListener('change', (e) => {
            const file = e.target.files && e.target.files[0];
            if (file) {
                handleRestore(file);
            }
        });
    }
    
    // Export controls
    const exportTxtBtn = document.getElementById('export-txt-btn');
    const exportPdfBtn = document.getElementById('export-pdf-btn');
    if (exportTxtBtn) exportTxtBtn.addEventListener('click', exportToPlainText);
    if (exportPdfBtn) exportPdfBtn.addEventListener('click', exportToPDF);
    

    
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
    
    // Infinite scroll for notes list
    const catatanContainer = document.getElementById('catatan-container');
    if (catatanContainer) {
        catatanContainer.addEventListener('scroll', () => {
            if (isLoadingMore) return;
            
            const scrollTop = catatanContainer.scrollTop;
            const scrollHeight = catatanContainer.scrollHeight;
            const clientHeight = catatanContainer.clientHeight;
            
            // Load more when user scrolls to bottom (with 100px threshold)
            if (scrollTop + clientHeight >= scrollHeight - 100) {
                loadMoreNotes();
            }
        });
    }
    
    // Search input - reset pagination on search
    if (elements.searchInput) {
        elements.searchInput.addEventListener('input', () => {
            displayedNotesCount = NOTES_PER_PAGE;
            applyFilters();
        });
    }
    
    // Search and filters
    if (elements.searchInput) elements.searchInput.addEventListener('input', applyFilters);

    const formattingToolbar = document.getElementById('formatting-toolbar');
    if (formattingToolbar) {
        formattingToolbar.addEventListener('click', (e) => {
            const button = e.target.closest('button');
            if (!button) return;

            const formatCommand = button.dataset.formatCommand;
            const toolbarAction = button.dataset.toolbarAction;

            if (formatCommand) {
                window.formatCommand(formatCommand);
                return;
            }

            if (toolbarAction === 'toggle-highlight') window.toggleHighlight();
            if (toolbarAction === 'insert-checkbox') window.insertCheckbox();
            if (toolbarAction === 'insert-link') window.insertLink();
            if (toolbarAction === 'remove-link') window.removeLink();
            if (toolbarAction === 'insert-line-break') window.insertLineBreak();
            if (toolbarAction === 'toggle-auto-url') window.toggleAutoURLDetection();
        });
    }

    const dateFilterButtons = {
        'filter-all': 'all',
        'filter-today': 'today',
        'filter-week': 'week',
        'filter-month': 'month'
    };
    Object.entries(dateFilterButtons).forEach(([id, value]) => {
        const button = document.getElementById(id);
        if (button) button.addEventListener('click', () => window.setDateFilter(value));
    });

    const sortSelect = document.getElementById('sort-select');
    if (sortSelect) sortSelect.addEventListener('change', () => window.setSortOrder(sortSelect.value));

    const clearAllFiltersBtn = document.getElementById('clear-all-filters');
    if (clearAllFiltersBtn) clearAllFiltersBtn.addEventListener('click', () => window.clearAllFilters());

    if (elements.tagFiltersContainer) {
        elements.tagFiltersContainer.addEventListener('click', (e) => {
            const button = e.target.closest('.tag-filter');
            if (button) {
                const tag = button.dataset.tag || 'all';
                filterByTag(tag);
            }
        });
    }

    if (elements.catatanContainer) {
        elements.catatanContainer.addEventListener('click', (e) => {
            const actionButton = e.target.closest('[data-note-action]');
            if (!actionButton) return;

            const action = actionButton.dataset.noteAction;
            const noteId = actionButton.dataset.noteId;
            if (!noteId) return;

            if (action === 'edit') window.editNote(noteId);
            if (action === 'delete') window.deleteNote(noteId);
            if (action === 'view') window.viewNoteDetail(noteId);
        });
    }

    const activeFiltersContainer = document.getElementById('active-filters-container');
    if (activeFiltersContainer) {
        activeFiltersContainer.addEventListener('click', (e) => {
            const button = e.target.closest('[data-badge-action]');
            if (!button) return;

            const action = button.dataset.badgeAction;
            if (action === 'reset-date') window.setDateFilter('all');
            if (action === 'reset-sort') window.setSortOrder('newest');
            if (action === 'reset-tag') window.filterByTag('all');
            if (action === 'reset-search') window.clearSearch();
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
    
    // Template selector
    const templateSelector = document.getElementById('template-selector');
    const insertTemplateBtn = document.getElementById('insert-template-btn');
    
    if (templateSelector) {
        templateSelector.addEventListener('change', (e) => {
            const selectedValue = e.target.value;
            if (insertTemplateBtn) {
                insertTemplateBtn.disabled = !selectedValue;
            }
        });
    }
    
    if (insertTemplateBtn) {
        insertTemplateBtn.addEventListener('click', () => {
            if (templateSelector && templateSelector.value) {
                insertTemplate(templateSelector.value);
            }
        });
    }
    
    console.log('✅ Event listeners setup complete');
};

// ================================
// Authentication State Management
// ================================

const initializeAuth = () => {
    // Check if running in development mode (localhost)
    const isLocalhost = isLocalDevelopment();
    
    if (isLocalhost) {
        console.log('🧪 Development mode detected - using localStorage');
        
        // Show app directly in development mode
        elements.authPageContainer.style.display = 'none';
        elements.mainContentContainer.style.display = 'flex';
        
        // Setup local development notes
        setupLocalDevNotes();
        
        showStatus('🧪 Mode Development - Data disimpan lokal', { type: 'info', duration: 3000 });
        elements.userEmail.textContent = 'Development Mode';
        
        return;
    }
    
    onAuthStateChanged(auth, (user) => {
        if (user) {
            userId = user.uid;
            elements.userEmail.textContent = user.email;
            const _av = document.getElementById('user-avatar');
            if (_av) _av.textContent = user.email.charAt(0).toUpperCase();
            
            // Show app, hide auth
            elements.authPageContainer.style.display = 'none';
            elements.mainContentContainer.style.display = 'flex';
            
            // Setup notes listener
            setupNotesListener(userId);
            
            // Setup scheduled auto-backup
            scheduleAutoBackup();
            
            showStatus(`✅ Selamat datang, ${user.email}!`, { type: 'success', duration: 4000 });
            
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
            
            // Clear auto-backup timer
            if (autoBackupTimer) {
                clearInterval(autoBackupTimer);
                autoBackupTimer = null;
            }
            
            // Clear data
            allNotes = [];
            resetEditor();
            
            // Show auth, hide app
            elements.authPageContainer.style.display = 'flex';
            elements.mainContentContainer.style.display = 'none';
            
            showStatus('🔓 Berhasil logout', { type: 'info', duration: 3000 });
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

const HIGHLIGHT_COLOR = '#fff3a3';

const getHighlightValue = () => {
    const value = document.queryCommandValue('hiliteColor') || document.queryCommandValue('backColor');
    return (value || '').toString().toLowerCase();
};

const isHighlightActive = () => {
    const value = getHighlightValue();
    if (!value) return false;
    if (value === 'transparent' || value === 'inherit' || value === 'initial') return false;
    if (value.includes('rgba(0, 0, 0, 0)')) return false;
    if (value === HIGHLIGHT_COLOR) return true;
    if (value.includes('rgb(255, 243, 163)')) return true;
    return false;
};

// Toggle highlight for selected text
window.toggleHighlight = () => {
    if (!elements.hasilTeksDiv) return;

    elements.hasilTeksDiv.focus();

    const highlightOn = isHighlightActive();
    const nextColor = highlightOn ? 'transparent' : HIGHLIGHT_COLOR;

    try {
        document.execCommand('hiliteColor', false, nextColor);
    } catch (error) {
        document.execCommand('backColor', false, nextColor);
    }

    updateToolbarButtonStates();
    checkContentAndUpdateButtons();
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
        const button = document.querySelector(`button[data-format-command="${command}"]`);
        if (button) {
            if (document.queryCommandState(command)) {
                button.classList.add('active');
            } else {
                button.classList.remove('active');
            }
        }
    });

    const highlightBtn = document.getElementById('highlight-btn');
    if (highlightBtn) {
        if (isHighlightActive()) {
            highlightBtn.classList.add('active');
        } else {
            highlightBtn.classList.remove('active');
        }
    }
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
        const safeLinkText = escapeHTML(linkText || url);
        const linkHTML = `<a href="${url}" target="_blank" rel="noopener noreferrer" title="${url}">${safeLinkText}</a>`;
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
// Image Upload Functions
// ================================

const sanitizeFileName = (name = '') => name.replace(/[^a-zA-Z0-9._-]/g, '_');

const getAltFromFileName = (name = '') => {
    const base = name.replace(/\.[^/.]+$/, '');
    return base.replace(/[-_]+/g, ' ').trim() || 'Gambar';
};

const insertImageToEditor = (url, fileName) => {
    if (!elements.hasilTeksDiv) return;

    const altText = escapeHTML(getAltFromFileName(fileName));
    const imageHTML = `<figure class="note-figure"><img src="${url}" alt="${altText}" title="${altText}" class="note-image" loading="lazy" decoding="async"></figure><p><br></p>`;

    elements.hasilTeksDiv.focus();
    document.execCommand('insertHTML', false, imageHTML);

    hasUnsavedChanges = true;
    checkContentAndUpdateButtons();
    scheduleAutoSave();
};

const handleImageUpload = async (file) => {
    if (!file) return;

    if (!APP_CONFIG.enableImageUpload) {
        showStatus('🔒 Fitur upload gambar tersedia untuk akun premium', { type: 'warning', duration: 4000 });
        return;
    }

    if (!userId) {
        showStatus('🔐 Silakan login untuk upload gambar', { type: 'warning', duration: 4000 });
        return;
    }

    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
        showStatus('⚠️ Format gambar harus JPG, PNG, WEBP, atau GIF', { type: 'error', duration: 4000 });
        return;
    }

    if (file.size > MAX_IMAGE_SIZE_MB * 1024 * 1024) {
        showStatus(`⚠️ Ukuran gambar maksimal ${MAX_IMAGE_SIZE_MB}MB`, { type: 'error', duration: 4000 });
        return;
    }

    try {
        showStatus('⬆️ Mengunggah gambar...', { type: 'loading' });

        const safeName = sanitizeFileName(file.name || `image-${Date.now()}`);
        const path = `users/${userId}/images/${Date.now()}-${safeName}`;
        const storageReference = storageRef(storage, path);

        const uploadTask = uploadBytesResumable(storageReference, file, {
            contentType: file.type
        });

        await new Promise((resolve, reject) => {
            uploadTask.on('state_changed',
                (snapshot) => {
                    const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                    logger.debug(`⬆️ Upload progress: ${progress.toFixed(0)}%`);
                },
                (error) => reject(error),
                () => resolve()
            );
        });

        const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
        insertImageToEditor(downloadURL, safeName);

        showStatus('✅ Gambar berhasil diunggah', { type: 'success', duration: 3000 });
        logger.debug('🖼️ Image uploaded:', downloadURL);
    } catch (error) {
        console.error('❌ Image upload failed:', error);
        showStatus('❌ Gagal upload gambar. Coba lagi.', { type: 'error', duration: 4000 });
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
                <input type="checkbox" class="checkbox-input" id="${checkboxId}" data-checkbox-id="${checkboxId}">
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
        elements.hasilTeksDiv.addEventListener('change', (e) => {
            if (e.target.classList.contains('checkbox-input')) {
                const checkboxId = e.target.getAttribute('data-checkbox-id') || e.target.id;
                window.handleCheckboxChange(checkboxId);
            }
        });

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
let activeGeminiController = null;
const GEMINI_TIMEOUT_MS = 15000;
let geminiWatchdogTimer = null;

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
        detailContent.innerHTML = sanitizeHTML(note.html);
        // Pastikan styling rich text teraplikasi
        detailContent.style.lineHeight = '1.8';
        detailContent.style.fontSize = '16px';
    } else {
        // Format teks biasa dengan paragraph breaks
        const safeText = escapeHTML(note.text || '');
        const formattedText = safeText
            .split('\n\n')
            .map(paragraph => `<p class="mb-4">${paragraph.replace(/\n/g, '<br>')}</p>`)
            .join('');
        detailContent.innerHTML = formattedText;
        detailContent.style.lineHeight = '1.8';
        detailContent.style.fontSize = '16px';
    }
    
    // Populate tag dengan styling yang lebih menonjol
    if (note.tag) {
        const safeTag = escapeHTML(note.tag);
        detailTagContainer.innerHTML = `<span class="inline-block bg-gradient-to-r from-blue-500 to-blue-600 text-white text-sm px-4 py-2 rounded-full shadow-sm font-medium">${safeTag}</span>`;
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

const openGeminiModal = (title = 'Hasil dari Gemini AI') => {
    const modal = document.getElementById('modal-gemini');
    const titleEl = document.getElementById('gemini-title');
    const loaderEl = document.getElementById('gemini-loader');
    const resultEl = document.getElementById('gemini-result-text');

    if (!modal || !titleEl || !loaderEl || !resultEl) return;

    titleEl.textContent = title;
    resultEl.textContent = '';
    loaderEl.classList.remove('hidden');
    modal.classList.remove('hidden');

    if (geminiWatchdogTimer) {
        clearTimeout(geminiWatchdogTimer);
    }

    geminiWatchdogTimer = setTimeout(() => {
        if (!loaderEl.classList.contains('hidden')) {
            setGeminiResult('⏱️ Proses AI memakan waktu terlalu lama. Coba ulangi, pendekkan teks, atau cek koneksi internet/API key.', true);
            showStatus('⏱️ Proses Gemini terlalu lama', { type: 'warning', duration: 4000 });
        }
    }, GEMINI_TIMEOUT_MS + 1000);
};

const setGeminiResult = (text, isError = false) => {
    const loaderEl = document.getElementById('gemini-loader');
    const resultEl = document.getElementById('gemini-result-text');

    if (!loaderEl || !resultEl) return;

    if (geminiWatchdogTimer) {
        clearTimeout(geminiWatchdogTimer);
        geminiWatchdogTimer = null;
    }

    loaderEl.classList.add('hidden');
    resultEl.textContent = text || '';
    resultEl.classList.toggle('text-red-500', isError);
    resultEl.classList.toggle('dark:text-red-400', isError);
};

const closeGeminiModal = () => {
    const modal = document.getElementById('modal-gemini');
    const loaderEl = document.getElementById('gemini-loader');

    if (activeGeminiController) {
        activeGeminiController.abort();
        activeGeminiController = null;
    }

    if (geminiWatchdogTimer) {
        clearTimeout(geminiWatchdogTimer);
        geminiWatchdogTimer = null;
    }

    if (loaderEl) loaderEl.classList.add('hidden');
    if (modal) modal.classList.add('hidden');
};

const getGeminiApiKey = () => {
    const fromStorage = localStorage.getItem('gemini_api_key') || localStorage.getItem('geminiApiKey');
    const fromWindow = typeof window !== 'undefined' ? window.GEMINI_API_KEY : null;
    return (fromStorage || fromWindow || '').trim();
};

const requestGeminiText = async (instruction, content) => {
    const apiKey = getGeminiApiKey();
    if (!apiKey) {
        throw new Error('Kunci Gemini API belum dikonfigurasi. Simpan di localStorage key: gemini_api_key.');
    }

    const controller = new AbortController();
    activeGeminiController = controller;
    const timeoutId = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
                contents: [
                    {
                        parts: [
                            { text: `${instruction}\n\n${content}` }
                        ]
                    }
                ],
                generationConfig: {
                    temperature: 0.3,
                    maxOutputTokens: 1024
                }
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Gemini API error (${response.status}): ${errorText || 'Unknown error'}`);
        }

        const data = await response.json();
        const text = data?.candidates?.[0]?.content?.parts?.map(part => part.text).filter(Boolean).join('\n') || '';

        if (!text) {
            throw new Error('Respon Gemini kosong.');
        }

        return text;
    } finally {
        clearTimeout(timeoutId);
        activeGeminiController = null;
    }
};

const runGeminiAction = async (instruction, title) => {
    const note = allNotes.find(n => n.id === currentDetailNoteId);
    const selectedText = window.getSelection()?.toString()?.trim();
    const editorText = elements?.hasilTeksDiv?.innerText?.trim() || stripHTML(elements?.hasilTeksDiv?.innerHTML || '');
    const noteText = selectedText || note?.text || stripHTML(note?.html || '') || editorText;

    if (!noteText?.trim()) {
        showStatus('⚠️ Tidak ada teks untuk diproses AI', { type: 'warning', duration: 3000 });
        return;
    }

    openGeminiModal(title || 'Hasil dari Gemini AI');

    try {
        const result = await requestGeminiText(instruction, noteText);
        setGeminiResult(result, false);
        showStatus('✅ Hasil Gemini berhasil dimuat', { type: 'success', duration: 3000 });
    } catch (error) {
        if (error.name === 'AbortError') {
            setGeminiResult('⏱️ Permintaan ke Gemini timeout (15 detik). Coba lagi dengan teks yang lebih pendek atau koneksi lebih stabil.', true);
            showStatus('⏱️ Gemini timeout', { type: 'warning', duration: 4000 });
            return;
        }

        console.error('❌ Gemini request failed:', error);
        setGeminiResult(`❌ Gagal memproses dengan Gemini.\n\n${error.message || 'Terjadi kesalahan tidak diketahui.'}`, true);
        showStatus('❌ Gagal memuat hasil Gemini', { type: 'error', duration: 4000 });
    }
};

// Setup detail page event listeners
const setupDetailPageListeners = () => {
    const closeBtn = document.getElementById('close-detail-btn');
    const speakBtn = document.getElementById('detail-speak-btn');
    const editBtn = document.getElementById('detail-edit-btn');
    const deleteBtn = document.getElementById('detail-delete-btn');
    const aiBtn = document.getElementById('detail-ai-btn');
    const aiMenu = document.getElementById('ai-menu');
    const closeGeminiBtn = document.getElementById('tombol-tutup-gemini');
    const copyGeminiBtn = document.getElementById('tombol-salin-gemini');
    const geminiModal = document.getElementById('modal-gemini');
    
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

    if (aiBtn && aiMenu) {
        aiBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const rect = aiBtn.getBoundingClientRect();
            aiMenu.style.top = `${rect.bottom + window.scrollY + 8}px`;
            aiMenu.style.left = `${Math.max(16, rect.left + window.scrollX - 120)}px`;
            aiMenu.classList.toggle('hidden');
        });

        aiMenu.addEventListener('click', async (e) => {
            const actionButton = e.target.closest('.ai-action-item');
            if (!actionButton) return;

            aiMenu.classList.add('hidden');
            const instruction = actionButton.dataset.prompt || 'Ringkas teks berikut:';
            const title = actionButton.dataset.title || 'Hasil dari Gemini AI';

            await runGeminiAction(instruction, title);
        });

        document.addEventListener('click', (e) => {
            if (!aiMenu.contains(e.target) && e.target !== aiBtn && !aiBtn.contains(e.target)) {
                aiMenu.classList.add('hidden');
            }
        });
    }

    if (closeGeminiBtn) {
        closeGeminiBtn.addEventListener('click', closeGeminiModal);
    }

    if (copyGeminiBtn) {
        copyGeminiBtn.addEventListener('click', async () => {
            const resultText = document.getElementById('gemini-result-text')?.textContent?.trim() || '';
            if (!resultText) {
                showStatus('⚠️ Tidak ada teks untuk disalin', { type: 'warning', duration: 3000 });
                return;
            }

            try {
                await navigator.clipboard.writeText(resultText);
                showStatus('✅ Hasil Gemini disalin', { type: 'success', duration: 2500 });
            } catch (error) {
                console.error('❌ Copy failed:', error);
                showStatus('❌ Gagal menyalin hasil Gemini', { type: 'error', duration: 3000 });
            }
        });
    }

    if (geminiModal) {
        geminiModal.addEventListener('click', (e) => {
            if (e.target === geminiModal) {
                closeGeminiModal();
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