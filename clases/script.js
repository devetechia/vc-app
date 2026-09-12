// ===== CONFIG =====
// Cambia FLY_API_URL por tu URL real de Fly.io tras `fly deploy`
const FLY_API_URL = 'https://academia-biblica-vc.fly.dev';
const API_BASE = (typeof location !== 'undefined' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.protocol === 'file:' || !location.hostname))
    ? 'http://localhost:5000'
    : FLY_API_URL;
const TRANSCRIPT_SKIP_MINUTES = 20;
const VIDEO_CACHE_TTL_MS = 30 * 60 * 1000; // 30 min
const VIDEO_CACHE_KEY = 'academia_videos_cache_v6';

// Limpiar caches heredados antiguos
try {
    localStorage.removeItem('academia_videos_cache');
    localStorage.removeItem('academia_videos_cache_v2');
    localStorage.removeItem('academia_videos_cache_v3');
    localStorage.removeItem('academia_videos_cache_v4');
    localStorage.removeItem('academia_videos_cache_v5');
} catch {}

const SPANISH_MONTHS = {
    ene: 1, enero: 1, feb: 2, febrero: 2, mar: 3, marzo: 3, abr: 4, abril: 4,
    may: 5, mayo: 5, jun: 6, junio: 6, jul: 7, julio: 7, ago: 8, agosto: 8,
    sep: 9, sept: 9, septiembre: 9, oct: 10, octubre: 10, nov: 11, noviembre: 11, dic: 12, diciembre: 12
};

function deduplicateVideos(list) {
    if (!Array.isArray(list)) return [];
    const seenIds = new Set();
    const seenTitles = new Set();
    return list.filter(item => {
        if (!item || !item.id) return false;
        if (seenIds.has(item.id)) return false;
        seenIds.add(item.id);
        const norm = (item.title || '').toLowerCase().replace(/[\s|Il\-_:]+/g, ' ').trim();
        if (norm && seenTitles.has(norm)) return false;
        if (norm) seenTitles.add(norm);
        return true;
    });
}

function parseAnyDate(str) {
    if (!str) return null;
    let d = new Date(str);
    if (!isNaN(d.getTime())) return d;
    const m = String(str).match(/(\d{1,2})\s+([a-záéíóúñ]+)\.?\s+(\d{4})/i);
    if (m) {
        const monKey = m[2].toLowerCase().replace('.', '').slice(0, 4);
        const mon = SPANISH_MONTHS[monKey] || SPANISH_MONTHS[monKey.slice(0, 3)];
        if (mon) {
            return new Date(parseInt(m[3], 10), mon - 1, parseInt(m[1], 10));
        }
    }
    return null;
}

function normalizeVideoItem(item) {
    if (!item) return null;
    let rawDate = item.rawDate || item.date || '';
    let d = parseAnyDate(rawDate);
    let year = item.year || (d ? d.getFullYear() : null);
    let month = item.month || (d ? d.getMonth() + 1 : null);
    let dateStr = item.date;
    if (!dateStr && d && !isNaN(d.getTime())) {
        dateStr = d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
    }
    let preacher = item.preacher || extractPreacher(item.title || '');

    return {
        id: item.id,
        title: item.title || '',
        thumbnail: item.thumbnail || '',
        rawDate: d ? d.toISOString() : (item.rawDate || ''),
        year: year,
        month: month,
        date: dateStr || '',
        preacher: preacher,
        description: item.description || ''
    };
}

// ===== YOUTUBE API (via server proxy, con cache) =====
async function fetchYouTubeVideos(maxResults = 50, pageToken = '') {
    // Intentar cache (solo para la primera página, sin pageToken)
    if (!pageToken) {
        try {
            const raw = localStorage.getItem(VIDEO_CACHE_KEY);
            if (raw) {
                const cached = JSON.parse(raw);
                if (cached && cached.timestamp && (Date.now() - cached.timestamp < VIDEO_CACHE_TTL_MS)) {
                    const rawItems = Array.isArray(cached.items) ? cached.items : [];
                    const items = deduplicateVideos(rawItems.map(normalizeVideoItem).filter(Boolean));
                    if (items.length >= maxResults) {
                        return { items: items.slice(0, maxResults), nextPageToken: '' };
                    }
                    if (items.length > 0 && maxResults <= 50) {
                        return { items: items.slice(0, maxResults), nextPageToken: '' };
                    }
                }
            }
        } catch (e) {
            console.warn('[Academia] Cache corrupto, limpiando:', e);
            try { localStorage.removeItem(VIDEO_CACHE_KEY); } catch {}
        }
    }

    const url = `${API_BASE}/api/videos?maxResults=${maxResults}${pageToken ? `&pageToken=${pageToken}` : ''}`;
    console.log('[Academia] Fetching videos:', url);
    let res;
    try {
        res = await fetch(url);
    } catch (networkErr) {
        console.error('[Academia] Network error fetching videos:', networkErr);
        throw new Error('No se pudo conectar con el servidor. Verifica que esté corriendo en localhost:5000.');
    }
    if (!res.ok) {
        console.error('[Academia] HTTP error', res.status, res.statusText);
        throw new Error(`Servidor respondió HTTP ${res.status}: ${res.statusText}`);
    }
    const data = await res.json();

    if (data.error === 'quotaExceeded' || res.status === 429) {
        // Intentar devolver cache aunque expirado
        try {
            const cached = JSON.parse(localStorage.getItem(VIDEO_CACHE_KEY));
            if (cached && cached.items && cached.items.length) {
                console.warn('YouTube quota exceeded, usando cache expirado');
                const dedupedCached = deduplicateVideos(cached.items);
                return { items: dedupedCached.slice(0, maxResults), nextPageToken: '' };
            }
        } catch {}
        throw new Error('quotaExceeded');
    }
    if (data.error) throw new Error(data.error);
    if (!data.items) throw new Error('No se pudieron cargar videos');

    const mappedVideos = data.items.map(item => {
        const rawDate = item.date || '';
        const d = rawDate ? new Date(rawDate) : null;
        return {
            id: item.id,
            title: item.title,
            thumbnail: item.thumbnail,
            rawDate: rawDate,
            year: d && !isNaN(d.getFullYear()) ? d.getFullYear() : null,
            month: d && !isNaN(d.getMonth()) ? d.getMonth() + 1 : null,
            date: d && !isNaN(d.getTime()) ? d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }) : '',
            preacher: extractPreacher(item.title),
            description: item.description || ''
        };
    });

    const videos = deduplicateVideos(mappedVideos);

    // Guardar cache (solo para la primera página)
    if (!pageToken) {
        try {
            localStorage.setItem(VIDEO_CACHE_KEY, JSON.stringify({ timestamp: Date.now(), items: videos }));
        } catch {}
    }

    return { 
        items: videos, 
        nextPageToken: data.nextPageToken || '' 
    };
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

    // 1. Servidor Backend primero (rápido, con timestamps exactos vía youtube_transcript_api)
    try {
        const res = await fetch(`${API_BASE}/api/transcript?videoId=${videoId}`);
        if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data.entries) && data.entries.length) {
                try { setCachedTranscript(videoId, data.entries); } catch {}
                return data.entries;
            }
            if (data.transcript) {
                const lines = data.transcript.split('\n').filter(l => l.trim());
                const entries = lines.map((text, i) => ({ start: i * 3, text: text.trim() }));
                if (entries.length) {
                    try { setCachedTranscript(videoId, entries); } catch {}
                    return entries;
                }
            }
        }
    } catch (e) {
        console.warn('Server transcript error:', e);
    }

    // 2. Fetch captions desde el navegador del usuario (IP residencial)
    try {
        const entries = await _getTranscriptFromPage(videoId);
        if (entries && entries.length) {
            try { setCachedTranscript(videoId, entries); } catch {}
            return entries;
        }
    } catch (e) { console.warn('Page fetch transcript fallo:', e.message); }

    // 3. Fallback: IFrame API (solo funciona en Chrome)
    try {
        const entries = await _getTranscriptViaPlayer(videoId);
        if (entries && entries.length) {
            try { setCachedTranscript(videoId, entries); } catch {}
            return entries;
        }
    } catch (e) { console.warn('Client transcript fallo:', e.message); }

    return null;
}

async function _getTranscriptFromPage(videoId) {
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`;
    const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error('Proxy fetch failed: ' + res.status);
    const html = await res.text();

    const playerMatch = html.match(/var ytInitialPlayerResponse\s*=\s*(\{.*?\});/s)
        || html.match(/ytInitialPlayerResponse\s*=\s*(\{.*?\});/s);
    if (!playerMatch) throw new Error('No player response found');

    const player = JSON.parse(playerMatch[1]);
    const captions = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!captions || !captions.length) throw new Error('No caption tracks');

    const track = captions.find(t => t.languageCode === 'es')
        || captions.find(t => t.languageCode?.startsWith('es'))
        || captions[0];
    if (!track?.baseUrl) throw new Error('No caption URL');

    let captionData = null;
    try {
        const captionRes = await fetch(track.baseUrl + '&fmt=json3', { signal: AbortSignal.timeout(10000) });
        if (captionRes.ok) captionData = await captionRes.json();
    } catch {}
    if (!captionData) {
        const proxyCaptionUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(track.baseUrl + '&fmt=json3')}`;
        const captionRes = await fetch(proxyCaptionUrl, { signal: AbortSignal.timeout(15000) });
        if (!captionRes.ok) throw new Error('Caption fetch failed');
        captionData = await captionRes.json();
    }

    const entries = [];
    for (const ev of (captionData.events || [])) {
        if (!ev.segs) continue;
        const text = ev.segs.map(s => s.utf8 || '').join(' ').trim();
        if (text) entries.push({ start: ev.tStartMs ? ev.tStartMs / 1000 : 0, text });
    }
    if (!entries.length) throw new Error('No entries parsed');
    return entries;
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


// ===== DEBOUNCE =====
function debounce(fn, delay) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Convierte markdown básico a HTML seguro.
 * Orden correcto: 1) markdown→HTML, 2) sanitizar con DOMPurify.
 * ADR-003: Mitigación de XSS.
 */
function renderMarkdown(text) {
    if (!text) return '';
    // 1) Convertir markdown a HTML (solo reemplazos seguros, NO inyectar HTML crudo)
    const html = text
        // Encabezados
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^# (.+)$/gm, '<h1>$1</h1>')
        // Listas
        .replace(/^\s*[-*]\s+(.+)$/gm, '<li>$1</li>')
        // Negrita e itálica (escapar primero para no confundir con markdown del usuario)
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        // Código inline
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        // Saltos de línea
        .replace(/\n\n/g, '</p><p>')
        .replace(/\n/g, '<br>');
    
    // 2) Sanitizar con DOMPurify (permite markdown seguro)
    if (typeof DOMPurify !== 'undefined') {
        return DOMPurify.sanitize(html, {
            ALLOWED_TAGS: ['h1','h2','h3','h4','p','br','strong','em','code','li','ul','ol','blockquote'],
            ALLOWED_ATTR: []
        });
    }
    // Fallback si DOMPurify no carga (menos seguro pero funcional)
    console.warn('DOMPurify no disponible, usando escape fallback');
    return escapeHtml(html);
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
function saveNote(videoId, note, title = '') {
    const n = getNotes();
    const existing = n[videoId] || {};
    const noteTitle = title || existing.title || (typeof document !== 'undefined' ? document.getElementById('videoTitle')?.textContent : '') || '';
    n[videoId] = {
        text: note,
        title: (noteTitle && noteTitle !== 'Cargando predicacion...' && noteTitle !== 'Predicacion no encontrada') ? noteTitle : (existing.title || ''),
        date: new Date().toISOString()
    };
    setStorage('academia_notes', n);
    if (typeof isLoggedIn === 'function' && isLoggedIn()) { saveNoteToDB(videoId, note).catch(()=>{}); }
}
function deleteNote(videoId) { const n = getNotes(); delete n[videoId]; setStorage('academia_notes', n); if (typeof isLoggedIn === 'function' && isLoggedIn()) { deleteNoteFromDB(videoId).catch(()=>{}); } }

function getQuizHistory() { return getStorage('academia_quizzes') || []; }
function saveQuizResult(result) { const q = getQuizHistory(); q.unshift(result); setStorage('academia_quizzes', q.slice(0, 50)); }

// ===== DATA LAYER: Supabase (logged in) or localStorage (guest) =====
function getCachedStudy(videoId) { return getStorage('academia_study_' + videoId); }
function setCachedStudy(videoId, data) { setStorage('academia_study_' + videoId, data); if (typeof isLoggedIn === 'function' && isLoggedIn()) { saveStudyToDB(videoId, '', data).catch(()=>{}); } }

function getCachedQuiz(videoId) { return getStorage('academia_quiz_' + videoId); }
function setCachedQuiz(videoId, data) { setStorage('academia_quiz_' + videoId, data); }

function getCachedTranscript(videoId) { return getStorage('academia_transcript_' + videoId); }
function setCachedTranscript(videoId, data) { setStorage('academia_transcript_' + videoId, data); if (typeof isLoggedIn === 'function' && isLoggedIn()) { saveTranscriptToDB(videoId, JSON.stringify(data), 'auto').catch(()=>{}); } }

// Sync localStorage to Supabase on login
onAuthChange(async (user) => {
    if (!user) return;
    try {
        // Sync notes
        const localNotes = getNotes();
        for (const [vid, note] of Object.entries(localNotes)) {
            if (note && note.text) await saveNoteToDB(vid, note.text).catch(()=>{});
        }
        // Sync studies
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('academia_study_')) {
                const vid = key.replace('academia_study_', '');
                const data = getStorage(key);
                if (data) await saveStudyToDB(vid, '', data).catch(()=>{});
            }
        }
        // Sync transcripts
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('academia_transcript_')) {
                const vid = key.replace('academia_transcript_', '');
                const data = getStorage(key);
                if (data) await saveTranscriptToDB(vid, JSON.stringify(data), 'auto').catch(()=>{});
            }
        }
    } catch (e) { console.warn('Sync to Supabase failed:', e); }
});

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

// Inicializar navbar y Service Worker al cargar página
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        initNavbar();
        initServiceWorker();
    });
}

function initServiceWorker() {
    // Service worker disabled for GitHub Pages subfolder deployment
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

// ===== VIDEO PROGRESS HELPERS =====
function getVideoProgress(videoId) {
    const key = `video_progress_${videoId}`;
    const val = localStorage.getItem(key);
    return val ? parseInt(val, 10) : 0;
}

function setVideoProgress(videoId, progress) {
    const key = `video_progress_${videoId}`;
    localStorage.setItem(key, Math.min(100, Math.max(0, progress)));
}

function isVideoWatched(videoId) {
    const key = `video_watched_${videoId}`;
    return localStorage.getItem(key) === 'true';
}

function setVideoWatched(videoId, watched) {
    const key = `video_watched_${videoId}`;
    localStorage.setItem(key, !!watched);
}

// ===== SERMON BADGE HELPER =====
function getSermonBadges(videoId, index, append) {
    const isWatched = isVideoWatched(videoId);
    const recentBadge = (index === 0 && !append) ? '<span class="sermon-badge">Reciente</span>' : '';
    const watchedBadge = isWatched ? '<span class="sermon-badge watched">Visto</span>' : '';
    return recentBadge + watchedBadge;
}

// ===== PREACHER EXTRACTION HELPER =====
const KNOWN_PREACHERS = [
    'Juan José López', 'Juanjo', 'Ana', 'Jorge Pérez', 'Klaus Morales',
    'Karolin Pastrona', 'Wagner Barbosa', 'Tere Guillen', 'José Suarez',
    'Eloísa Salvatierra', 'Pastor Park', 'Joni García', 'Guadalupe Orellano Tula',
    'Carlos Hernández', 'Sebastián Pérez', 'Daniel Gómez'
];

function toTitleCase(str) {
    if (!str) return '';
    return str.toLowerCase().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function extractPreacher(title) {
    if (!title) return '';
    let t = title.replace(/\s+\d{1,2}[\s/-]+\d{1,2}[\s/-]+\d{4}\s*$/, '').trim();

    // 1. Check known pastors/preachers with word boundary
    for (const kp of KNOWN_PREACHERS) {
        const escaped = kp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp('\\b' + escaped + '\\b', 'i');
        if (re.test(t)) {
            return kp === 'Juanjo' ? 'Juan José López' : kp;
        }
    }

    // 2. Structural parsing for titles like 'Tipo | Titulo | Predicador' or 'Tipo | Predicador | Titulo'
    const parts = t.split(/\s+[|Il]\s+|\s{3,}/).map(p => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
        for (let i = parts.length - 1; i >= 1; i--) {
            let cand = parts[i];
            if (/invitado|especial/i.test(cand)) continue;
            if (/:|[¿?¡!]/.test(cand)) continue;
            if (/^(el|la|los|las|un|una|cuando|como|de|en|por|para|experimentando|derribando|desafiando|reavivando|aceptando|peleando)\b/i.test(cand)) continue;
            
            cand = cand.replace(/^(?:PASTORA?|Pastor[a]?)\s+/i, '').replace(/\s+/g, ' ').trim();
            if (cand.length > 2) {
                if (cand === cand.toUpperCase() && cand.length > 3) cand = toTitleCase(cand);
                if (/^park$/i.test(cand)) return 'Pastor Park';
                return cand;
            }
        }
    }

    // 3. Fallback regex for 'PASTOR/A ...'
    const m = t.match(/(?:PASTORA?|Pastor[a]?)\s+([A-Za-zÁÉÍÓÚáéíóúÑñ\s]+)/i);
    if (m) {
        let cand = m[1].trim();
        if (cand === cand.toUpperCase() && cand.length > 3) cand = toTitleCase(cand);
        return cand;
    }

    return '';
}

// ===== DASHBOARD & PROGRESS TRACKING =====
const WATCH_HISTORY_KEY = 'academia_watch_history';

function getWatchHistory() {
    try {
        const raw = localStorage.getItem(WATCH_HISTORY_KEY);
        if (!raw) return [];
        const list = JSON.parse(raw);
        return Array.isArray(list) ? list : [];
    } catch (e) {
        console.warn('[Academia] Error reading watch history:', e);
        return [];
    }
}

function recordVideoWatch(video) {
    if (!video || !video.id) return;
    setVideoWatched(video.id, true);
    try {
        let history = getWatchHistory();
        history = history.filter(item => item.id !== video.id);
        history.unshift({
            id: video.id,
            title: video.title || '',
            thumbnail: video.thumbnail || `https://img.youtube.com/vi/${video.id}/mqdefault.jpg`,
            date: video.date || '',
            preacher: video.preacher || extractPreacher(video.title || ''),
            watchedAt: Date.now()
        });
        if (history.length > 50) history = history.slice(0, 50);
        localStorage.setItem(WATCH_HISTORY_KEY, JSON.stringify(history));
    } catch (e) {
        console.warn('[Academia] Error saving watch history:', e);
    }
}

function getOverallProgress(allVideos = []) {
    const history = getWatchHistory();
    const historyIds = new Set(history.map(item => item.id));
    const watchedSet = new Set();

    allVideos.forEach(v => {
        if (historyIds.has(v.id) || isVideoWatched(v.id)) {
            watchedSet.add(v.id);
        }
    });

    const totalWatched = watchedSet.size;
    const totalAvailable = allVideos.length;
    const percentage = totalAvailable > 0 ? Math.min(100, Math.round((totalWatched / totalAvailable) * 100)) : 0;

    let recommendedVideo = allVideos.find(v => !watchedSet.has(v.id)) || (allVideos.length > 0 ? allVideos[0] : null);
    const recentWatched = history.slice(0, 3);

    return {
        totalAvailable,
        totalWatched,
        percentage,
        recommendedVideo,
        recentWatched
    };
}

function renderProgressDashboard(containerId, allVideos = []) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const stats = getOverallProgress(allVideos);
    const hasActivity = stats.totalWatched > 0 || stats.recentWatched.length > 0;

    let html = `
        <div class="dashboard-kpi-grid">
            <div class="dashboard-kpi-card">
                <div class="kpi-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20v-6M6 20V10M18 20V4"/></svg>
                </div>
                <div class="kpi-body">
                    <span class="kpi-value">${stats.totalWatched}</span>
                    <span class="kpi-label">Predicaciones estudiadas</span>
                </div>
            </div>
            <div class="dashboard-kpi-card">
                <div class="kpi-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                </div>
                <div class="kpi-body">
                    <span class="kpi-value">${stats.percentage}%</span>
                    <span class="kpi-label">Progreso del catálogo</span>
                    <div class="progress-bar-container" title="${stats.percentage}% completado">
                        <div class="progress-bar-fill" style="width: ${stats.percentage}%;"></div>
                    </div>
                </div>
            </div>
            <div class="dashboard-kpi-card">
                <div class="kpi-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                </div>
                <div class="kpi-body">
                    <span class="kpi-value">${stats.totalAvailable}</span>
                    <span class="kpi-label">Total disponibles</span>
                </div>
            </div>
        </div>
    `;

    if (stats.recommendedVideo) {
        const rec = stats.recommendedVideo;
        html += `
            <div class="dashboard-recommendation-panel">
                <div class="rec-badge">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                    <span>${hasActivity ? 'Próximo estudio recomendado' : 'Comienza tu primer estudio'}</span>
                </div>
                <div class="rec-content">
                    <div class="rec-thumb">
                        <img src="${rec.thumbnail}" alt="${escapeHtml(rec.title)}" loading="lazy">
                    </div>
                    <div class="rec-details">
                        <h4 class="rec-title">${escapeHtml(rec.title)}</h4>
                        <div class="rec-meta">
                            ${rec.preacher ? `<span class="sermon-preacher-badge">${escapeHtml(rec.preacher)}</span>` : ''}
                            <span class="rec-date">${escapeHtml(rec.date || '')}</span>
                        </div>
                        <a href="estudio.html?id=${rec.id}" class="btn btn-primary btn-sm rec-btn">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                            ${hasActivity ? 'Continuar estudio' : 'Empezar ahora'}
                        </a>
                    </div>
                </div>
            </div>
        `;
    }

    if (stats.recentWatched && stats.recentWatched.length > 0) {
        html += `
            <div class="dashboard-recent-section">
                <div class="dashboard-subtitle-row">
                    <h3 class="dashboard-subtitle">Tu actividad reciente</h3>
                    <a href="predicaciones.html" class="dashboard-link">Ver catálogo completo →</a>
                </div>
                <div class="dashboard-recent-grid">
                    ${stats.recentWatched.map(v => `
                        <a href="estudio.html?id=${v.id}" class="recent-card" aria-label="Continuar ${escapeHtml(v.title)}">
                            <div class="recent-thumb-wrap">
                                <img src="${v.thumbnail}" alt="${escapeHtml(v.title)}" loading="lazy">
                                <span class="sermon-badge watched">Visto</span>
                            </div>
                            <div class="recent-info">
                                <h4 class="recent-title">${escapeHtml(v.title)}</h4>
                                <div class="recent-meta">
                                    ${v.preacher ? `<span class="recent-preacher">${escapeHtml(v.preacher)}</span>` : ''}
                                    <span class="recent-date">${escapeHtml(v.date || '')}</span>
                                </div>
                            </div>
                        </a>
                    `).join('')}
                </div>
            </div>
        `;
    }

    container.innerHTML = html;
}

// ===== VIDEO NOT AVAILABLE / EMPTY STATE =====
function renderVideoNotFoundHTML(suggestedVideos = []) {
    const suggestions = (suggestedVideos || []).slice(0, 3);
    const suggestionsHTML = suggestions.length > 0 ? `
        <div class="unavailable-suggestions">
            <h4 class="unavailable-suggestions-title">Predicaciones recomendadas</h4>
            <div class="unavailable-suggestions-grid">
                ${suggestions.map(v => `
                    <a href="estudio.html?id=${v.id}" class="unavailable-sug-card">
                        <div class="unavailable-sug-thumb">
                            <img src="${v.thumbnail}" alt="${escapeHtml(v.title)}" loading="lazy">
                        </div>
                        <div class="unavailable-sug-info">
                            <h5>${escapeHtml(v.title)}</h5>
                            ${v.preacher ? `<span class="sermon-preacher-badge">${escapeHtml(v.preacher)}</span>` : ''}
                            <span class="sug-date">${escapeHtml(v.date || '')}</span>
                        </div>
                    </a>
                `).join('')}
            </div>
        </div>
    ` : '';

    return `
        <div class="video-unavailable-container">
            <div class="unavailable-icon-wrap">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>
                </svg>
            </div>
            <h2 class="unavailable-title">Esta predicación no está disponible</h2>
            <p class="unavailable-desc">
                El video que buscas puede haber sido eliminado, modificado o no se encuentra en el catálogo de subidas disponibles.
            </p>
            <div class="unavailable-actions">
                <a href="predicaciones.html" class="btn btn-primary">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
                    Volver a todas las predicaciones
                </a>
            </div>
            ${suggestionsHTML}
        </div>
    `;
}

function renderVideoNotFoundState(containerId, suggestedVideos = []) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = renderVideoNotFoundHTML(suggestedVideos);
}

// ===== BACKUP & EXPORT HELPERS =====
function generateBackupData() {
    const notes = getNotes();
    const history = getWatchHistory();
    const quizzes = getQuizHistory();
    
    const videoStates = {};
    try {
        if (typeof localStorage !== 'undefined') {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && (key.startsWith('video_watched_') || key.startsWith('video_progress_'))) {
                    videoStates[key] = localStorage.getItem(key);
                }
            }
        }
    } catch {}

    return {
        appName: 'Academia Bíblica',
        version: '1.0',
        exportedAt: new Date().toISOString(),
        notes,
        history,
        quizzes,
        videoStates
    };
}

function _downloadTextFile(filename, text, mimeType = 'text/plain') {
    if (typeof document === 'undefined') return;
    const blob = new Blob([text], { type: `${mimeType};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportBackupJSON() {
    const data = generateBackupData();
    const dateStr = new Date().toISOString().slice(0, 10);
    const jsonStr = JSON.stringify(data, null, 2);
    _downloadTextFile(`academia_biblica_backup_${dateStr}.json`, jsonStr, 'application/json');
}

function importBackupJSON(jsonString) {
    try {
        const data = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;
        if (!data || typeof data !== 'object') {
            return { success: false, error: 'Archivo no contiene un formato JSON válido.' };
        }

        let notesCount = 0;
        if (data.notes && typeof data.notes === 'object') {
            const currentNotes = getNotes();
            const merged = { ...currentNotes, ...data.notes };
            setStorage('academia_notes', merged);
            notesCount = Object.keys(data.notes).length;
        }

        if (Array.isArray(data.history)) {
            const currentHist = getWatchHistory();
            const histMap = new Map();
            data.history.forEach(item => { if (item && item.id) histMap.set(item.id, item); });
            currentHist.forEach(item => { if (item && item.id && !histMap.has(item.id)) histMap.set(item.id, item); });
            try {
                localStorage.setItem(WATCH_HISTORY_KEY, JSON.stringify(Array.from(histMap.values())));
            } catch {}
        }

        if (Array.isArray(data.quizzes)) {
            const currentQuizzes = getQuizHistory();
            const mergedQuizzes = [...data.quizzes, ...currentQuizzes].slice(0, 50);
            setStorage('academia_quizzes', mergedQuizzes);
        }

        if (data.videoStates && typeof data.videoStates === 'object') {
            Object.entries(data.videoStates).forEach(([k, v]) => {
                try { localStorage.setItem(k, String(v)); } catch {}
            });
        }

        return { success: true, notesCount };
    } catch (e) {
        return { success: false, error: e.message || 'Error al procesar archivo de copia de seguridad.' };
    }
}

function generateNotesMarkdown() {
    const notes = getNotes();
    const keys = Object.keys(notes);
    const dateStr = new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
    
    let md = `# Mis Apuntes - Academia Bíblica\n`;
    md += `*Exportado el ${dateStr}*\n\n`;
    md += `---\n\n`;

    if (keys.length === 0) {
        md += `*No hay apuntes guardados actualmente.*\n`;
        return md;
    }

    const sorted = keys.map(k => ({ id: k, ...notes[k] })).sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

    sorted.forEach((n, idx) => {
        const nDate = n.date ? new Date(n.date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
        const title = n.title || `Predicación (${n.id})`;
        md += `## ${idx + 1}. ${title}\n`;
        if (n.id) md += `- **ID de Video**: \`${n.id}\`\n`;
        if (nDate) md += `- **Fecha de guardado**: ${nDate}\n`;
        if (n.id) md += `- **Enlace**: https://www.youtube.com/watch?v=${n.id}\n`;
        md += `\n### Apuntes Personales:\n\n${n.text || ''}\n\n`;
        md += `---\n\n`;
    });

    return md;
}

function exportNotesMarkdown() {
    const md = generateNotesMarkdown();
    const dateStr = new Date().toISOString().slice(0, 10);
    _downloadTextFile(`mis_apuntes_academia_biblica_${dateStr}.md`, md, 'text/markdown');
}

// ===== SEARCH & HIGHLIGHT HELPERS =====
function normalizeSearchStr(str) {
    if (!str) return '';
    return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function highlightMatches(text, query) {
    if (!text || !query) return escapeHtml(text || '');
    const q = query.trim();
    if (!q) return escapeHtml(text);

    const safeText = escapeHtml(text);
    const escapedQuery = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(${escapedQuery})`, 'gi');
    return safeText.replace(pattern, '<mark>$1</mark>');
}

function searchSermonsDeep(query, videos = []) {
    if (!query || !query.trim()) return videos;
    const qNorm = normalizeSearchStr(query);
    const notes = getNotes();
    const results = [];

    (videos || []).forEach(v => {
        if (!v) return;
        const titleNorm = normalizeSearchStr(v.title);
        const preacherNorm = normalizeSearchStr(v.preacher);
        
        // 1. Coincidencia en título o predicador
        if (titleNorm.includes(qNorm) || preacherNorm.includes(qNorm)) {
            results.push({
                ...v,
                matchType: 'title',
                matchSnippet: ''
            });
            return;
        }

        // 2. Coincidencia en notas personales
        const note = notes[v.id];
        if (note && note.text) {
            const noteNorm = normalizeSearchStr(note.text);
            if (noteNorm.includes(qNorm)) {
                const idx = noteNorm.indexOf(qNorm);
                const start = Math.max(0, idx - 40);
                const end = Math.min(note.text.length, idx + query.length + 50);
                const snippet = (start > 0 ? '...' : '') + note.text.slice(start, end).trim() + (end < note.text.length ? '...' : '');

                results.push({
                    ...v,
                    matchType: 'note',
                    matchSnippet: snippet
                });
                return;
            }
        }

        // 3. Coincidencia en transcripción cacheada
        const cachedTrans = getCachedTranscript(v.id);
        if (Array.isArray(cachedTrans)) {
            for (const seg of cachedTrans) {
                const segText = seg.text || '';
                if (normalizeSearchStr(segText).includes(qNorm)) {
                    results.push({
                        ...v,
                        matchType: 'transcript',
                        matchSnippet: `[${seg.start ? Math.floor(seg.start / 60) + ' min' : 'Transcripción'}]: ${segText.trim()}`
                    });
                    return;
                }
            }
        }

        // 4. Coincidencia en estudio bíblico IA cacheado
        const cachedStudy = getCachedStudy(v.id);
        if (cachedStudy && typeof cachedStudy === 'object') {
            const studyStr = JSON.stringify(cachedStudy);
            if (normalizeSearchStr(studyStr).includes(qNorm)) {
                results.push({
                    ...v,
                    matchType: 'study',
                    matchSnippet: 'Coincidencia en el análisis bíblico con IA'
                });
                return;
            }
        }
    });

    return results;
}





