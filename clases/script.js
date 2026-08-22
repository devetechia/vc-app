// ===== CONFIG =====
const YT_API_KEY = 'AIzaSyBcbSSyNgUn5yiVxQJ0-yTUj1eVEU1dCu8';
const YT_CHANNEL_ID = 'UCRpj-vU_Nu6UaxJJvGI7jAA';
const OPENROUTER_KEY = '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';
const TRANSCRIPT_SKIP_MINUTES = 20;

// ===== YOUTUBE API =====
async function fetchYouTubeVideos(maxResults = 50) {
    const url = `https://www.googleapis.com/youtube/v3/search?key=${YT_API_KEY}&channelId=${YT_CHANNEL_ID}&part=snippet&order=date&maxResults=${maxResults}&type=video`;
    const res = await fetch(url);
    const data = await res.json();
    return (data.items || []).map(item => ({
        id: item.id.videoId,
        title: item.snippet.title,
        thumbnail: item.snippet.thumbnails.high?.url || item.snippet.thumbnails.medium?.url,
        date: new Date(item.snippet.publishedAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }),
        description: item.snippet.description
    }));
}

// ===== TRANSCRIPT (CORS proxy + YouTube captions) =====
async function getYouTubeTranscript(videoId) {
    try {
        const targetUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
        const res = await fetch(proxyUrl);
        const html = await res.text();

        const match = html.match(/"captions":\s*(\{.*?"playerCaptionsTracklistRenderer".*?\})\s*,\s*"videoDetails"/s);
        if (!match) return null;

        const captionsData = JSON.parse(match[1]);
        const tracks = captionsData?.playerCaptionsTracklistRenderer?.captionTracks;
        if (!tracks || tracks.length === 0) return null;

        const langTrack = tracks.find(t => t.languageCode === 'es') || tracks[0];
        const captionRes = await fetch(langTrack.baseUrl);
        const captionXml = await captionRes.text();

        const entries = [];
        const regex = /<text start="([\d.]+)"[^>]*>(.*?)<\/text>/g;
        let m;
        while ((m = regex.exec(captionXml)) !== null) {
            const start = parseFloat(m[1]);
            const text = m[2].replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/<[^>]*>/g, '').trim();
            if (text) entries.push({ start, text });
        }
        return entries;
    } catch (error) {
        console.error('Error getting transcript:', error);
        return null;
    }
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

// ===== OPENROUTER AI =====
async function callOpenRouter(prompt) {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENROUTER_KEY}`,
            'HTTP-Referer': window.location.origin,
            'X-Title': 'Academia Bíblica'
        },
        body: JSON.stringify({
            model: 'poolside/laguna-s-2.1:free',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.7,
            max_tokens: 4096
        })
    });
    const data = await response.json();
    if (data.choices && data.choices[0]) return data.choices[0].message.content;
    throw new Error(data.error?.message || 'Error en la IA');
}

// ===== BIBLICAL STUDY =====
async function generateBiblicalStudy(transcript, videoTitle) {
    const prompt = `Eres un experto en estudios bíblicos. Analiza la siguiente predicación cristiana y proporciona:

1. RESUMEN: Un resumen claro y conciso (3-4 párrafos)

2. MENSAJE PRINCIPAL: El mensaje central más importante

3. VERSÍCULOS MENCIONADOS: Lista cada versículo con:
   - Referencia completa (Libro Capítulo:Versículo)
   - El texto del versículo
   - Por qué se mencionó en la predicación

4. CONTEXTO Y EXPLICACIÓN: Contexto histórico y espiritual

5. PARA PROFUNDIZAR: Temas para estudio personal

Título: ${videoTitle}

Transcripción:
${transcript || 'No disponible. Analiza solo por el título: ' + videoTitle}

Responde en español con secciones claras usando markdown.`;
    return await callOpenRouter(prompt);
}

// ===== QUIZ GENERATOR =====
async function generateQuiz(transcript, videoTitle) {
    const prompt = `Basándote en la siguiente predicación cristiana, genera un quiz de 10 preguntas de opción múltiple.

Cada pregunta debe tener:
- La pregunta clara y concisa
- 4 opciones (A, B, C, D)
- La respuesta correcta marcada con un asterisco *

Ejemplo:
1. ¿Cuál es el tema principal de esta predicación?
A) La oración
B) La fe*
C) El amor
D) La esperanza

Título: ${videoTitle}

Transcripción:
${transcript || 'No disponible. Genera preguntas basadas en el título: ' + videoTitle}

Responde SOLO con las preguntas en el formato indicado, sin explicaciones adicionales.`;
    return await callOpenRouter(prompt);
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

function renderMarkdown(text) {
    return text
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br>');
}

// ===== LOCALSTORAGE =====
function getStorage(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

function setStorage(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
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

// ===== PDF EXPORT =====
function exportTranscriptPDF(title, text) {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.2/jspdf.umd.min.js';
    script.onload = () => {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        const margin = 20;
        const lineHeight = 7;
        let y = margin;

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(16);
        doc.text('Academia Bíblica - Vida Cristiana', margin, y);
        y += lineHeight + 4;

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        const titleLines = doc.splitTextToSize(title, 170);
        doc.text(titleLines, margin, y);
        y += titleLines.length * lineHeight + 6;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        const lines = doc.splitTextToSize(text, 170);
        for (const line of lines) {
            if (y > 270) {
                doc.addPage();
                y = margin;
            }
            doc.text(line, margin, y);
            y += lineHeight;
        }

        y += 10;
        doc.setFontSize(8);
        doc.setTextColor(150);
        doc.text('Generado por Academia Bíblica - Iglesia Vida Cristiana', margin, y);

        doc.save(`transcripcion-${title.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50)}.pdf`);
    };
    document.head.appendChild(script);
}

// ===== UTILS =====
function getUrlParam(name) {
    return new URLSearchParams(window.location.search).get(name);
}

function showToast(message) {
    let toast = document.getElementById('toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        toast.className = 'toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2500);
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
                    <span class="bible-verse-ref">${v.reference || 'Versículo'}</span>
                    <p class="bible-verse-text">${v.text || ''}</p>
                    <p class="bible-verse-explain">${v.explanation || ''}</p>
                </div>
            `).join('');
        } else if (typeof versesData === 'string' && versesData.length > 0) {
            versesList.innerHTML = `<div class="bible-verse-card"><div class="bible-section-content">${renderMarkdown(versesData)}</div></div>`;
        } else {
            versesList.innerHTML = '<p style="color:var(--text-muted)">Los versículos se encuentran en la sección de contexto.</p>';
        }
    }
}
