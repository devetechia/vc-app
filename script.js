// ===== YOUTUBE API CONFIG =====
const YT_API_KEY = 'AIzaSyBcbSSyNgUn5yiVxQJ0-yTUj1eVEU1dCu8';
const YT_CHANNEL_ID = 'UCRpj-vU_Nu6UaxJJvGI7jAA';
const OPENROUTER_KEY = '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';

async function fetchLatestVideos(maxResults = 4) {
    const url = `https://www.googleapis.com/youtube/v3/search?key=${YT_API_KEY}&channelId=${YT_CHANNEL_ID}&part=snippet&order=date&maxResults=${maxResults}&type=video`;
    const res = await fetch(url);
    const data = await res.json();
    return data.items || [];
}

function loadSermons() {
    const grid = document.querySelector('.sermons-grid');
    if (!grid) return;

    fetchLatestVideos(4).then(videos => {
        grid.innerHTML = videos.map((item, i) => {
            const id = item.id.videoId;
            const title = item.snippet.title;
            const thumb = item.snippet.thumbnails.high?.url || item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default?.url;
            const date = new Date(item.snippet.publishedAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
            const safeTitle = title.replace(/'/g, "\\'").replace(/"/g, '&quot;');
            return `
                <div class="sermon-card reveal visible" data-video="${id}">
                    <div class="sermon-thumb">
                        <img src="${thumb}" alt="${safeTitle}" loading="lazy">
                        <div class="sermon-play">
                            <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                        </div>
                        ${i === 0 ? '<span class="sermon-badge">Reciente</span>' : ''}
                    </div>
                    <div class="sermon-embed"></div>
                    <div class="sermon-info">
                        <h3>${title}</h3>
                        <p class="sermon-pastor">${date}</p>
                        <button class="btn-study" data-video-id="${id}" data-video-title="${safeTitle}">
                            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z"/></svg>
                            Estudio bíblico
                        </button>
                    </div>
                </div>`;
        }).join('');

        // Attach study button events
        document.querySelectorAll('.btn-study[data-video-id]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                openBibleStudy(btn.dataset.videoId, btn.dataset.videoTitle);
            });
        });

        initSermonClicks();
    }).catch(err => console.error('Error loading sermons:', err));
}

function initSermonClicks() {
    document.querySelectorAll('.sermon-card[data-video]').forEach(card => {
        card.addEventListener('click', () => {
            const videoId = card.dataset.video;
            const embedDiv = card.querySelector('.sermon-embed');

            if (card.classList.contains('playing')) {
                card.classList.remove('playing');
                embedDiv.innerHTML = '';
                return;
            }

            document.querySelectorAll('.sermon-card.playing').forEach(c => {
                c.classList.remove('playing');
                c.querySelector('.sermon-embed').innerHTML = '';
            });

            embedDiv.innerHTML = `<iframe 
                src="https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0" 
                title="Predicación" 
                allow="picture-in-picture" 
                allowfullscreen>
            </iframe>`;

            card.classList.add('playing');
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
    });
}

// ===== PARTICLES =====
function createParticles() {
    const container = document.getElementById('particles');
    if (!container) return;
    const count = window.innerWidth < 768 ? 20 : 40;
    for (let i = 0; i < count; i++) {
        const p = document.createElement('div');
        p.className = 'particle';
        p.style.left = Math.random() * 100 + '%';
        p.style.animationDelay = Math.random() * 8 + 's';
        p.style.animationDuration = (6 + Math.random() * 6) + 's';
        p.style.width = p.style.height = (2 + Math.random() * 3) + 'px';
        if (Math.random() > 0.7) p.style.background = '#D4A843';
        container.appendChild(p);
    }
}

// ===== NAVBAR =====
function initNavbar() {
    const navbar = document.getElementById('navbar');
    const toggle = document.getElementById('navToggle');
    const menu = document.getElementById('navMenu');
    const links = document.querySelectorAll('.nav-link');
    const sections = document.querySelectorAll('section[id]');

    // Scroll effect
    window.addEventListener('scroll', () => {
        navbar.classList.toggle('scrolled', window.scrollY > 50);
    });

    // Mobile toggle
    toggle.addEventListener('click', () => {
        toggle.classList.toggle('active');
        menu.classList.toggle('open');
    });

    // Close menu on link click
    links.forEach(link => {
        link.addEventListener('click', () => {
            toggle.classList.remove('active');
            menu.classList.remove('open');
        });
    });

    // Active link on scroll
    window.addEventListener('scroll', () => {
        let current = '';
        sections.forEach(section => {
            const top = section.offsetTop - 100;
            if (window.scrollY >= top) {
                current = section.getAttribute('id');
            }
        });
        links.forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('href') === '#' + current) {
                link.classList.add('active');
            }
        });
    });
}

// ===== REVEAL ON SCROLL =====
function initReveal() {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
            }
        });
    }, {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    });

    document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
}

// ===== COPY IBAN =====
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        const toast = document.getElementById('toast');
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2500);
    }).catch(() => {
        // Fallback for older browsers
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        const toast = document.getElementById('toast');
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2500);
    });
}

// ===== SMOOTH SCROLL =====
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({ behavior: 'smooth' });
        }
    });
});

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
    createParticles();
    initNavbar();
    initReveal();
    initPastorVideo();
    loadSermons();
});

// ===== PASTOR VIDEO HOVER =====
function initPastorVideo() {
    const cards = document.querySelectorAll('.pastor-card[id^="pastor-"]');

    cards.forEach(card => {
        const video = card.querySelector('.pastor-video');
        if (!video) return;

        card.addEventListener('mouseenter', () => {
            video.play().catch(() => {});
        });

        card.addEventListener('mouseleave', () => {
            video.pause();
            video.currentTime = 0;
        });
    });
}

// ===== BIBLICAL STUDY =====
async function getYouTubeTranscript(videoId) {
    try {
        const proxyUrl = `https://corsproxy.io/?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`;
        const res = await fetch(proxyUrl);
        const html = await res.text();

        const match = html.match(/"captions":\s*(\{.*?"playerCaptionsTracklistRenderer".*?\})\s*,\s*"videoDetails"/s);
        if (!match) return null;

        const captionsData = JSON.parse(match[1]);
        const tracks = captionsData?.playerCaptionsTracklistRenderer?.captionTracks;
        if (!tracks || tracks.length === 0) return null;

        const langTrack = tracks.find(t => t.languageCode === 'es') || tracks[0];
        const captionUrl = langTrack.baseUrl;

        const captionRes = await fetch(captionUrl);
        const captionXml = await captionRes.text();

        const texts = [];
        const regex = /<text[^>]*>(.*?)<\/text>/g;
        let m;
        while ((m = regex.exec(captionXml)) !== null) {
            texts.push(m[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/<[^>]*>/g, ''));
        }
        return texts.join(' ') || null;
    } catch (error) {
        console.error('Error getting transcript:', error);
        return null;
    }
}

async function analyzeWithGemini(transcript, videoTitle) {
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

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENROUTER_KEY}`,
            'HTTP-Referer': window.location.origin,
            'X-Title': 'Iglesia Vida Cristiana'
        },
        body: JSON.stringify({
            model: 'poolside/laguna-s-2.1:free',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.7,
            max_tokens: 4096
        })
    });

    const data = await response.json();

    if (data.choices && data.choices[0]) {
        return data.choices[0].message.content;
    }

    throw new Error(data.error?.message || 'No se pudo obtener respuesta de la IA');
}

function parseAIResponse(text) {
    const sections = {
        summary: '',
        message: '',
        verses: [],
        context: '',
        study: ''
    };

    // Split by sections
    const lines = text.split('\n');
    let currentSection = '';
    let currentContent = [];

    for (const line of lines) {
        const lower = line.toLowerCase();
        
        if (lower.includes('resumen') && (lower.includes('##') || lower.includes('**'))) {
            if (currentSection && currentContent.length) {
                sections[currentSection] = currentContent.join('\n').trim();
            }
            currentSection = 'summary';
            currentContent = [];
        } else if (lower.includes('mensaje principal') || lower.includes('mensaje central')) {
            if (currentSection && currentContent.length) {
                sections[currentSection] = currentContent.join('\n').trim();
            }
            currentSection = 'message';
            currentContent = [];
        } else if (lower.includes('versículo') || lower.includes('versiculo')) {
            if (currentSection && currentContent.length) {
                sections[currentSection] = currentContent.join('\n').trim();
            }
            currentSection = 'verses';
            currentContent = [];
        } else if (lower.includes('contexto') || lower.includes('explicación') || lower.includes('explicacion')) {
            if (currentSection && currentContent.length) {
                sections[currentSection] = currentContent.join('\n').trim();
            }
            currentSection = 'context';
            currentContent = [];
        } else if (lower.includes('profundizar') || lower.includes('estudio')) {
            if (currentSection && currentContent.length) {
                sections[currentSection] = currentContent.join('\n').trim();
            }
            currentSection = 'study';
            currentContent = [];
        } else if (line.trim()) {
            currentContent.push(line);
        }
    }
    
    if (currentSection && currentContent.length) {
        sections[currentSection] = currentContent.join('\n').trim();
    }

    // If no structured sections found, put everything in summary
    if (!sections.summary && !sections.message) {
        sections.summary = text;
    }

    return sections;
}

function renderMarkdown(text) {
    return text
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br>');
}

let currentVideoId = null;
let currentVideoTitle = '';

function openBibleStudy(videoId, title) {
    currentVideoId = videoId;
    currentVideoTitle = title;
    
    const modal = document.getElementById('bibleModal');
    const subtitle = document.getElementById('bibleModalSubtitle');
    const loading = document.getElementById('bibleLoading');
    const results = document.getElementById('bibleResults');
    const error = document.getElementById('bibleError');
    
    subtitle.textContent = title;
    loading.style.display = 'block';
    results.style.display = 'none';
    error.style.display = 'none';
    
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    
    startBibleStudy();
}

function closeBibleStudy() {
    const modal = document.getElementById('bibleModal');
    modal.classList.remove('active');
    document.body.style.overflow = '';
}

function renderStudyResults(aiResponse) {
    const parsed = parseAIResponse(aiResponse);
    
    document.querySelector('#bibleSummary .bible-section-content').innerHTML = renderMarkdown(parsed.summary);
    document.querySelector('#bibleMessage .bible-section-content').innerHTML = renderMarkdown(parsed.message);
    document.querySelector('#bibleContext .bible-section-content').innerHTML = renderMarkdown(parsed.context);
    document.querySelector('#bibleStudy .bible-section-content').innerHTML = renderMarkdown(parsed.study);
    
    const versesList = document.querySelector('#bibleVerses .bible-verses-list');
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
        versesList.innerHTML = '<p style="color: var(--text-muted);">Los versículos se encuentran en la sección de contexto arriba.</p>';
    }
}

function getCachedStudy(videoId) {
    try {
        return localStorage.getItem('bibleStudy_' + videoId);
    } catch { return null; }
}

function setCachedStudy(videoId, aiResponse) {
    try {
        localStorage.setItem('bibleStudy_' + videoId, aiResponse);
    } catch { }
}

async function startBibleStudy() {
    const loading = document.getElementById('bibleLoading');
    const results = document.getElementById('bibleResults');
    const error = document.getElementById('bibleError');
    
    try {
        // Check cache first
        const cached = getCachedStudy(currentVideoId);
        if (cached) {
            loading.style.display = 'none';
            renderStudyResults(cached);
            results.style.display = 'block';
            return;
        }

        // Get transcript
        loading.querySelector('p').textContent = 'Obteniendo transcripción del vídeo...';
        const transcript = await getYouTubeTranscript(currentVideoId);
        
        // Analyze with AI
        loading.querySelector('p').textContent = 'Analizando con inteligencia artificial...';
        const aiResponse = await analyzeWithGemini(transcript, currentVideoTitle);
        
        // Cache the result
        setCachedStudy(currentVideoId, aiResponse);
        
        // Render
        loading.style.display = 'none';
        renderStudyResults(aiResponse);
        results.style.display = 'block';
        
    } catch (err) {
        console.error('Error in Bible study:', err);
        loading.style.display = 'none';
        error.style.display = 'block';
    }
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('bibleModalClose').addEventListener('click', closeBibleStudy);
    document.getElementById('bibleModal').addEventListener('click', (e) => {
        if (e.target.id === 'bibleModal') closeBibleStudy();
    });
    document.getElementById('bibleRetry').addEventListener('click', startBibleStudy);
    document.getElementById('btnCopyStudy').addEventListener('click', copyStudyResults);
});

function copyStudyResults() {
    const results = document.getElementById('bibleResults');
    const sections = results.querySelectorAll('.bible-section');
    let text = '';
    
    sections.forEach(section => {
        const h3 = section.querySelector('h3');
        if (h3) text += h3.textContent + '\n\n';
        
        const content = section.querySelector('.bible-section-content');
        if (content) text += content.innerText + '\n\n';
        
        const verseCards = section.querySelectorAll('.bible-verse-card');
        verseCards.forEach(card => {
            const ref = card.querySelector('.bible-verse-ref');
            const verseText = card.querySelector('.bible-verse-text');
            const explain = card.querySelector('.bible-verse-explain');
            if (ref) text += ref.textContent + '\n';
            if (verseText) text += verseText.textContent + '\n';
            if (explain) text += explain.textContent + '\n\n';
        });
    });
    
    const btn = document.getElementById('btnCopyStudy');
    navigator.clipboard.writeText(text.trim()).then(() => {
        btn.textContent = '✅ Copiado';
        btn.classList.add('copied');
        setTimeout(() => {
            btn.textContent = '📋 Copiar todo';
            btn.classList.remove('copied');
        }, 2000);
    }).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = text.trim();
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        btn.textContent = '✅ Copiado';
        btn.classList.add('copied');
        setTimeout(() => {
            btn.textContent = '📋 Copiar todo';
            btn.classList.remove('copied');
        }, 2000);
    });
}
