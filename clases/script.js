// ===== CONFIG =====
// Cambia FLY_API_URL por tu URL real de Fly.io tras `fly deploy`
const FLY_API_URL = 'https://academia-biblica-vc.fly.dev';
const API_BASE = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? 'http://localhost:5000'
    : FLY_API_URL;
const TRANSCRIPT_SKIP_MINUTES = 20;
const VIDEO_CACHE_TTL_MS = 30 * 60 * 1000; // 30 min
const VIDEO_CACHE_KEY = 'academia_videos_cache';

// ===== YOUTUBE API (via server proxy, con cache) =====
async function fetchYouTubeVideos(maxResults = 50) {
    // Intentar cache
    try {
        const cached = JSON.parse(localStorage.getItem(VIDEO_CACHE_KEY));
        if (cached && cached.timestamp && (Date.now() - cached.timestamp < VIDEO_CACHE_TTL_MS)) {
            const items = cached.items || [];
            // Si pide menos que lo cacheado, slice
            if (items.length >= maxResults) return items.slice(0, maxResults);
            // Si pide más, seguir a fetch pero devolver cache mientras tanto no — mejor fetch
            if (items.length > 0 && maxResults <= 50) return items.slice(0, maxResults);
        }
    } catch {}

    const url = `${API_BASE}/api/videos?maxResults=${maxResults}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.error === 'quotaExceeded' || res.status === 429) {
        // Intentar devolver cache aunque expirado
        try {
            const cached = JSON.parse(localStorage.getItem(VIDEO_CACHE_KEY));
            if (cached && cached.items && cached.items.length) {
                console.warn('YouTube quota exceeded, usando cache expirado');
                return cached.items.slice(0, maxResults);
            }
        } catch {}
        throw new Error('quotaExceeded');
    }
    if (data.error) throw new Error(data.error);
    if (!data.items) throw new Error('No se pudieron cargar videos');

    const videos = data.items.map(item => ({
        id: item.id,
        title: item.title,
        thumbnail: item.thumbnail,
        date: item.date ? new Date(item.date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }) : '',
        description: item.description || ''
    }));

    // Guardar cache
    try {
        localStorage.setItem(VIDEO_CACHE_KEY, JSON.stringify({ timestamp: Date.now(), items: videos }));
    } catch {}
    return videos;
}

// ===== TRANSCRIPT (cliente IFrame API → server fallback) =====
let _ytApiReady = false;
let _ytApiResolvers = [];
function _loadYTIframeAPI() {
    if (window.YT && window.YT.Player) { _ytApiReady = true; _ytApiResolvers.forEach(r => r()); _ytApiResolvers = []; return; }
    if (window.__ytApiLoading) return;
    window.__ytApiLoading = true;
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.onload = () => {
        window.onYouTubeIframeAPIReady = window.onYouTubeIframeAPIReady || function () {};
    };
    document.head.appendChild(tag);
    window.onYouTubeIframeAPIReady = () => {
        _ytApiReady = true;
        _ytApiResolvers.forEach(r => r());
        _ytApiResolvers = [];
    };
}

async function getYouTubeTranscript(videoId) {
    const cached = getCachedTranscript(videoId);
    if (cached && Array.isArray(cached) && cached.length) return cached;

    // 1. Cliente: extraer captions desde el navegador del usuario (IP residencial, no bloqueada)
    try {
        const entries = await _getTranscriptViaPlayer(videoId);
        if (entries && entries.length) {
            try { setCachedTranscript(videoId, entries); } catch {}
            return entries;
        }
    } catch (e) { console.warn('Client transcript fallo:', e.message); }

    // 2. Fallback: server (Fly) via proxy
    try {
        const res = await fetch(`${API_BASE}/api/transcript?videoId=${videoId}`);
        const data = await res.json();
        if (data.transcript) {
            const entries = data.transcript.split('\n').filter(l => l.trim()).map((text, i) => ({ start: i * 3, text: text.trim() }));
            if (entries.length) {
                try { setCachedTranscript(videoId, entries); } catch {}
                return entries;
            }
        }
    } catch (e) { /* server not available */ }
    return null;
}

function _getTranscriptViaPlayer(videoId) {
    return new Promise((resolve, reject) => {
        const ready = new Promise(r => {
            if (_ytApiReady) return r();
            _loadYTIframeAPI();
            _ytApiResolvers.push(r);
        });
        const timeout = setTimeout(() => reject(new Error('timeout')), 20000);
        ready.then(() => {
            const container = document.createElement('div');
            container.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:2px;height:2px;';
            document.body.appendChild(container);
            let done = false;
            const finish = (val) => {
                if (done) return;
                done = true;
                clearTimeout(timeout);
                try { player.destroy(); } catch {}
                try { container.remove(); } catch {}
                resolve(val);
            };
            const player = new YT.Player(container, {
                videoId,
                width: 2, height: 2,
                playerVars: { controls: 0, autoplay: 0, cc_load_policy: 1 },
                events: {
                    onReady: async () => {
                        // Wait for captions to load (they may not be ready at onReady)
                        const tryGetCaptions = async (attempt) => {
                            try {
                                const tracklist = player.getOption('captions', 'tracklist');
                                const tracks = tracklist || [];
                                if (tracks.length > 0) {
                                    const track = tracks.find(t => t.languageCode === 'es') || tracks[0];
                                    if (track && track.baseUrl) {
                                        const res = await fetch(track.baseUrl + '&fmt=json3');
                                        if (res.ok) {
                                            const j = await res.json();
                                            const entries = [];
                                            for (const ev of (j.events || [])) {
                                                if (!ev.segs) continue;
                                                const text = ev.segs.map(s => s.utf8 || '').join(' ').trim();
                                                if (text) entries.push({ start: ev.tStartMs ? ev.tStartMs / 1000 : (ev.aAppend ? ev.aAppend / 1000 : 0), text });
                                            }
                                            if (entries.length) { finish(entries); return; }
                                        }
                                    }
                                }
                                // Retry with delay (captions may still be loading)
                                if (attempt < 3) {
                                    setTimeout(() => tryGetCaptions(attempt + 1), 2000);
                                } else {
                                    finish(null);
                                }
                            } catch (e) { finish(null); }
                        };
                        tryGetCaptions(0);
                    },
                    onError: () => finish(null)
                }
            });
        });
    });
}

function parseCaptionXML(xml) {
    const entries = [];
    const regex = /<text start="([\d.]+)"[^>]*>(.*?)<\/text>/g;
    let m;
    while ((m = regex.exec(xml)) !== null) {
        const start = parseFloat(m[1]);
        const text = m[2].replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/<[^>]*>/g, '').trim();
        if (text) entries.push({ start, text });
    }
    return entries.length > 0 ? entries : null;
}

function parseManualTranscript(text) {
    if (!text || !text.trim()) return null;
    const lines = text.split('\n').filter(l => l.trim());
    return lines.map((line, i) => ({ start: i * 3, text: line.trim() }));
}

function filterTranscript(entries, skipMinutes = TRANSCRIPT_SKIP_MINUTES) {
    if (!entries) return '';
    const skipSeconds = skipMinutes * 60;
    const filtered = entries.filter(e => e.start >= skipSeconds);
    if (filtered.length === 0) return entries.map(e => e.text).join(' ');
    return filtered.map(e => e.text).join(' ');
}

function formatTranscript(entries, skipMinutes = TRANSCRIPT_SKIP_MINUTES) {
    if (!entries) return 'Transcripción no disponible';
    const skipSeconds = skipMinutes * 60;
    const filtered = entries.filter(e => e.start >= skipSeconds);
    const items = filtered.length > 0 ? filtered : entries;

    let result = '';
    let lastMinute = -1;
    for (const entry of items) {
        const minute = Math.floor(entry.start / 60);
        if (minute !== lastMinute) {
            const m = Math.floor(minute);
            const s = Math.floor(entry.start % 60);
            result += `\n[${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}] `;
            lastMinute = minute;
        }
        result += entry.text + ' ';
    }
    return result.trim();
}

// ===== AI (via server proxy — keys no expuestas) =====
async function callServerAI(endpoint, payload) {
    const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.result) return data.result;
    throw new Error(data.error || 'Error en la IA');
}

// ===== BIBLICAL STUDY =====
async function generateBiblicalStudy(transcript, videoTitle, videoId = '') {
    return await callServerAI('/api/study', { transcript: transcript || '', title: videoTitle, videoId });
}

// ===== QUIZ GENERATOR =====
async function generateQuiz(transcript, videoTitle, videoId = '') {
    return await callServerAI('/api/quiz', { transcript: transcript || '', title: videoTitle, videoId });
}

function parseQuiz(aiResponse) {
    const questions = [];
    const blocks = aiResponse.split(/\n\s*\d+[\.\)]\s*/).filter(b => b.trim());

    for (const block of blocks) {
        const lines = block.split('\n').map(l => l.trim()).filter(l => l);
        if (lines.length < 5) continue;

        const questionText = lines[0].replace(/\?$/, '').trim();
        const options = [];
        let correctIndex = 0;

        for (let i = 1; i <= 4; i++) {
            if (i >= lines.length) break;
            const optText = lines[i].replace(/^[A-D][\.\)]\s*/, '').replace(/\*$/, '').trim();
            const isCorrect = lines[i].includes('*');
            options.push(optText);
            if (isCorrect) correctIndex = i - 1;
        }

        if (options.length === 4) {
            questions.push({ question: questionText + '?', options, correctIndex });
        }
    }
    return questions;
}

// ===== AI RESPONSE PARSER =====
function parseAIResponse(text) {
    const sections = { summary: '', message: '', verses: [], context: '', study: '' };
    const lines = text.split('\n');
    let currentSection = '';
    let currentContent = [];

    for (const line of lines) {
        const lower = line.toLowerCase();

        if (lower.includes('resumen') && (lower.includes('##') || lower.includes('**'))) {
            if (currentSection && currentContent.length) sections[currentSection] = currentContent.join('\n').trim();
            currentSection = 'summary';
            currentContent = [];
        } else if (lower.includes('mensaje principal') || lower.includes('mensaje central')) {
            if (currentSection && currentContent.length) sections[currentSection] = currentContent.join('\n').trim();
            currentSection = 'message';
            currentContent = [];
        } else if (lower.includes('versículo') || lower.includes('versiculo')) {
            if (currentSection && currentContent.length) sections[currentSection] = currentContent.join('\n').trim();
            currentSection = 'verses';
            currentContent = [];
        } else if (lower.includes('contexto') || lower.includes('explicación') || lower.includes('explicacion')) {
            if (currentSection && currentContent.length) sections[currentSection] = currentContent.join('\n').trim();
            currentSection = 'context';
            currentContent = [];
        } else if (lower.includes('profundizar') || lower.includes('estudio')) {
            if (currentSection && currentContent.length) sections[currentSection] = currentContent.join('\n').trim();
            currentSection = 'study';
            currentContent = [];
        } else if (line.trim()) {
            currentContent.push(line);
        }
    }
    if (currentSection && currentContent.length) sections[currentSection] = currentContent.join('\n').trim();
    if (!sections.summary && !sections.message) sections.summary = text;
    return sections;
}

function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderMarkdown(text) {
    const escaped = escapeHtml(text);
    return escaped
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br>');
}

// ===== LOCALSTORAGE =====
function getStorage(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

function setStorage(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {
        if (e.name === 'QuotaExceededError' || e.code === 22) {
            console.warn('localStorage lleno, limpiando cache de videos');
            try { localStorage.removeItem(VIDEO_CACHE_KEY); } catch {}
            try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
        }
    }
}

function getNotes() { return getStorage('academia_notes') || {}; }
function saveNote(videoId, note) { const n = getNotes(); n[videoId] = { text: note, date: new Date().toISOString() }; setStorage('academia_notes', n); }
function deleteNote(videoId) { const n = getNotes(); delete n[videoId]; setStorage('academia_notes', n); }

function getQuizHistory() { return getStorage('academia_quizzes') || []; }
function saveQuizResult(result) { const q = getQuizHistory(); q.unshift(result); setStorage('academia_quizzes', q.slice(0, 50)); }

function getCachedStudy(videoId) { return getStorage('academia_study_' + videoId); }
function setCachedStudy(videoId, data) { setStorage('academia_study_' + videoId, data); }

function getCachedQuiz(videoId) { return getStorage('academia_quiz_' + videoId); }
function setCachedQuiz(videoId, data) { setStorage('academia_quiz_' + videoId, data); }

function getCachedTranscript(videoId) { return getStorage('academia_transcript_' + videoId); }
function setCachedTranscript(videoId, data) { setStorage('academia_transcript_' + videoId, data); }

// ===== PDF EXPORT (singleton loader, premium) =====
let _jspdfLoading = null;
function ensureJsPDF() {
    if (window.jspdf) return Promise.resolve();
    if (_jspdfLoading) return _jspdfLoading;
    _jspdfLoading = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        script.onload = () => resolve();
        script.onerror = () => {
            // Fallback CDN
            const fallback = document.createElement('script');
            fallback.src = 'https://unpkg.com/jspdf@2.5.1/dist/jspdf.umd.min.js';
            fallback.onload = () => resolve();
            fallback.onerror = () => reject(new Error('No se pudo cargar jsPDF'));
            document.head.appendChild(fallback);
        };
        document.head.appendChild(script);
    });
    return _jspdfLoading;
}

function _pdfHeader(doc, title) {
    const margin = 20;
    // Top bar
    doc.setFillColor(139, 92, 246);
    doc.rect(0, 0, 210, 12, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('ACADEMIA BIBLICA  •  IGLESIA VIDA CRISTIANA', margin, 8);
    doc.setTextColor(40, 40, 60);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    const titleLines = doc.splitTextToSize(title, 170);
    doc.text(titleLines, margin, 22);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 140);
    const dateStr = new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
    doc.text(dateStr, margin, 28 + (titleLines.length - 1) * 6);
    // Divider
    doc.setDrawColor(200, 180, 255);
    doc.setLineWidth(0.4);
    const yLine = 30 + (titleLines.length - 1) * 6;
    doc.line(margin, yLine, 190, yLine);
    return yLine + 8;
}

function _pdfFooter(doc) {
    const total = doc.internal.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
        doc.setPage(i);
        doc.setFontSize(7);
        doc.setTextColor(150, 150, 170);
        doc.text(`Pagina ${i} de ${total}  •  Academia Biblica - Vida Cristiana`, 20, 287);
        doc.text(new Date().toLocaleDateString('es-ES'), 190, 287, { align: 'right' });
    }
}

async function exportTranscriptPDF(title, text) {
    await ensureJsPDF();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    let y = _pdfHeader(doc, title);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(40, 40, 60);
    const lines = doc.splitTextToSize(text, 170);
    for (const line of lines) {
        if (y > 272) { doc.addPage(); y = 20; }
        doc.text(line, 20, y);
        y += 6;
    }
    _pdfFooter(doc);
    doc.save(`transcripcion-${title.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50)}.pdf`);
}

async function exportStudyPDF(title, studyMarkdown) {
    await ensureJsPDF();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    let y = _pdfHeader(doc, title + ' — Estudio Biblico');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(40, 40, 60);
    // Simple markdown: strip ** and render bold via font
    const clean = studyMarkdown.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1');
    const lines = doc.splitTextToSize(clean, 170);
    for (const line of lines) {
        if (y > 272) { doc.addPage(); y = 20; }
        // Detect section headers (lines starting with #)
        if (line.trim().startsWith('#')) {
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(11);
            doc.setTextColor(124, 58, 237);
        } else {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(10);
            doc.setTextColor(40, 40, 60);
        }
        doc.text(line.replace(/^#+\s*/, ''), 20, y);
        y += 6;
    }
    _pdfFooter(doc);
    doc.save(`estudio-${title.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50)}.pdf`);
}

// ===== NAVBAR (a11y) =====
function initNavbar() {
    const toggle = document.getElementById('navToggle');
    const links = document.getElementById('navLinks');
    if (!toggle || !links) return;
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', 'navLinks');
    toggle.addEventListener('click', () => {
        const open = links.classList.toggle('open');
        toggle.classList.toggle('active', open);
        toggle.setAttribute('aria-expanded', String(open));
    });
    links.querySelectorAll('a').forEach(a => {
        a.addEventListener('click', () => {
            links.classList.remove('open');
            toggle.classList.remove('active');
            toggle.setAttribute('aria-expanded', 'false');
        });
    });
    document.addEventListener('click', (e) => {
        if (!links.contains(e.target) && !toggle.contains(e.target)) {
            links.classList.remove('open');
            toggle.classList.remove('active');
            toggle.setAttribute('aria-expanded', 'false');
        }
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            links.classList.remove('open');
            toggle.classList.remove('active');
            toggle.setAttribute('aria-expanded', 'false');
        }
    });
}

// ===== UTILS =====
function getUrlParam(name) {
    return new URLSearchParams(window.location.search).get(name);
}

let _toastQueue = [];
let _toastShowing = false;
function showToast(message) {
    _toastQueue.push(message);
    if (_toastShowing) return;
    _showNextToast();
}
function _showNextToast() {
    if (_toastQueue.length === 0) { _toastShowing = false; return; }
    _toastShowing = true;
    const msg = _toastQueue.shift();
    let toast = document.getElementById('toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        toast.className = 'toast';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(_showNextToast, 300);
    }, 2500);
}

function renderStudyResults(containerId, aiResponse) {
    const parsed = parseAIResponse(aiResponse);

    const summaryEl = document.querySelector(`#${containerId} #bibleSummary .bible-section-content`);
    const messageEl = document.querySelector(`#${containerId} #bibleMessage .bible-section-content`);
    const contextEl = document.querySelector(`#${containerId} #bibleContext .bible-section-content`);
    const studyEl = document.querySelector(`#${containerId} #bibleStudy .bible-section-content`);

    if (summaryEl) summaryEl.innerHTML = renderMarkdown(parsed.summary);
    if (messageEl) messageEl.innerHTML = renderMarkdown(parsed.message);
    if (contextEl) contextEl.innerHTML = renderMarkdown(parsed.context);
    if (studyEl) studyEl.innerHTML = renderMarkdown(parsed.study);

    const versesList = document.querySelector(`#${containerId} #bibleVerses .bible-verses-list`);
    if (versesList) {
        const versesData = parsed.verses;
        if (Array.isArray(versesData) && versesData.length > 0) {
            versesList.innerHTML = versesData.map(v => `
                <div class="bible-verse-card">
                    <span class="bible-verse-ref">${escapeHtml(v.reference || 'Versiculo')}</span>
                    <p class="bible-verse-text">${escapeHtml(v.text || '')}</p>
                    <p class="bible-verse-explain">${escapeHtml(v.explanation || '')}</p>
                </div>
            `).join('');
        } else if (typeof versesData === 'string' && versesData.length > 0) {
            versesList.innerHTML = `<div class="bible-verse-card"><div class="bible-section-content">${renderMarkdown(versesData)}</div></div>`;
        } else {
            versesList.innerHTML = '<p style="color:var(--text-muted)">Los versiculos se encuentran en la seccion de contexto.</p>';
        }
    }
}
