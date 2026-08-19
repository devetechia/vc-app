// ===== APP STATE =====
let currentScreen = 'inicio';
let previousScreen = null;
const screens = ['inicio', 'nosotros', 'predicaciones', 'youtube', 'donativos'];

// ===== SPLASH SCREEN =====
window.addEventListener('load', () => {
    setTimeout(() => {
        document.getElementById('splash').classList.add('hidden');
    }, 1500);
});

// ===== NAVIGATION =====
function navigateTo(screen) {
    if (screen === currentScreen) return;

    const currentEl = document.getElementById('screen-' + currentScreen);
    const nextEl = document.getElementById('screen-' + screen);

    if (!currentEl || !nextEl) return;

    // Determine direction
    const currentIdx = screens.indexOf(currentScreen);
    const nextIdx = screens.indexOf(screen);
    const goingForward = nextIdx > currentIdx;

    // Animate out
    currentEl.style.animation = goingForward
        ? 'slideOutLeft 0.3s cubic-bezier(0.55, 0.085, 0.68, 0.53) forwards'
        : 'slideOutRight 0.3s cubic-bezier(0.55, 0.085, 0.68, 0.53) forwards';

    setTimeout(() => {
        currentEl.classList.remove('active');
        currentEl.style.animation = '';

        // Scroll to top
        nextEl.querySelector('.screen-content').scrollTop = 0;

        // Animate in
        nextEl.classList.add('active');
        nextEl.style.animation = goingForward
            ? 'slideInRight 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards'
            : 'slideInLeft 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards';

        setTimeout(() => {
            nextEl.style.animation = '';
        }, 350);
    }, 280);

    // Update nav
    previousScreen = currentScreen;
    currentScreen = screen;
    updateNav();

    // Haptic feedback
    if (navigator.vibrate) navigator.vibrate(10);
}

function updateNav() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.target === currentScreen);
    });
}

// ===== SWIPE GESTURES =====
let touchStartX = 0;
let touchStartY = 0;
let touchEndX = 0;
let touchEndY = 0;

document.addEventListener('touchstart', e => {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
}, { passive: true });

document.addEventListener('touchend', e => {
    touchEndX = e.changedTouches[0].screenX;
    touchEndY = e.changedTouches[0].screenY;
    handleSwipe();
}, { passive: true });

function handleSwipe() {
    const diffX = touchEndX - touchStartX;
    const diffY = touchEndY - touchStartY;

    // Only handle horizontal swipes (ignore vertical)
    if (Math.abs(diffX) < 60 || Math.abs(diffY) > Math.abs(diffX)) return;

    const currentIdx = screens.indexOf(currentScreen);

    if (diffX > 0 && currentIdx > 0) {
        // Swipe right - go to previous screen
        navigateTo(screens[currentIdx - 1]);
    } else if (diffX < 0 && currentIdx < screens.length - 1) {
        // Swipe left - go to next screen
        navigateTo(screens[currentIdx + 1]);
    }
}

// ===== COPY IBAN =====
function copyIBAN() {
    const iban = 'ES8921005052070200014366';

    if (navigator.clipboard) {
        navigator.clipboard.writeText(iban).then(showToast);
    } else {
        const ta = document.createElement('textarea');
        ta.value = iban;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast();
    }

    if (navigator.vibrate) navigator.vibrate(20);
}

function showToast() {
    const toast = document.getElementById('toast');
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2000);
}

// ===== OPEN MAP =====
function openMap() {
    const address = 'C/ Reverendo Rafael Tramoyeres 39, Valencia';
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
    window.open(url, '_blank');
}

// ===== SERVICE WORKER =====
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js')
        .then(reg => console.log('SW registered'))
        .catch(err => console.log('SW error:', err));
}

// ===== INSTALL PROMPT =====
let deferredPrompt;

window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
});

// ===== CSS ANIMATIONS (injected) =====
const style = document.createElement('style');
style.textContent = `
    @keyframes slideInRight {
        from { opacity: 0; transform: translateX(40px); }
        to { opacity: 1; transform: translateX(0); }
    }
    @keyframes slideInLeft {
        from { opacity: 0; transform: translateX(-40px); }
        to { opacity: 1; transform: translateX(0); }
    }
    @keyframes slideOutLeft {
        from { opacity: 1; transform: translateX(0); }
        to { opacity: 0; transform: translateX(-40px); }
    }
    @keyframes slideOutRight {
        from { opacity: 1; transform: translateX(0); }
        to { opacity: 0; transform: translateX(40px); }
    }
`;
document.head.appendChild(style);

// ===== YOUTUBE API CONFIG =====
const YT_API_KEY = 'AIzaSyBcbSSyNgUn5yiVxQJ0-yTUj1eVEU1dCu8';
const YT_CHANNEL_ID = 'UCRpj-vU_Nu6UaxJJvGI7jAA';

async function fetchLatestVideos(maxResults = 4) {
    const url = `https://www.googleapis.com/youtube/v3/search?key=${YT_API_KEY}&channelId=${YT_CHANNEL_ID}&part=snippet&order=date&maxResults=${maxResults}&type=video`;
    const res = await fetch(url);
    const data = await res.json();
    return data.items || [];
}

function loadSermons() {
    const list = document.querySelector('.sermons-list');
    if (!list) return;

    fetchLatestVideos(4).then(videos => {
        list.innerHTML = videos.map((item, i) => {
            const id = item.id.videoId;
            const title = item.snippet.title;
            const thumb = item.snippet.thumbnails.high?.url || item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default?.url;
            const date = new Date(item.snippet.publishedAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
            return `
                <div class="sermon-item" data-video="${id}">
                    <div class="sermon-thumb">
                        <img src="${thumb}" alt="${title}" loading="lazy">
                        <div class="sermon-play">
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
                        </div>
                        ${i === 0 ? '<span class="sermon-badge">Nuevo</span>' : ''}
                    </div>
                    <div class="sermon-embed"></div>
                    <div class="sermon-details">
                        <h3>${title}</h3>
                        <span class="sermon-speaker">${date}</span>
                    </div>
                </div>`;
        }).join('');

        initSermonClicks();
    }).catch(err => console.error('Error loading sermons:', err));
}

function initSermonClicks() {
    document.querySelectorAll('.sermon-item[data-video]').forEach(item => {
        item.addEventListener('click', () => {
            const videoId = item.dataset.video;
            const embedDiv = item.querySelector('.sermon-embed');

            if (item.classList.contains('playing')) {
                item.classList.remove('playing');
                embedDiv.innerHTML = '';
                return;
            }

            document.querySelectorAll('.sermon-item.playing').forEach(c => {
                c.classList.remove('playing');
                c.querySelector('.sermon-embed').innerHTML = '';
            });

            embedDiv.innerHTML = `<iframe 
                src="https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0" 
                title="Predicación" 
                allow="picture-in-picture" 
                allowfullscreen>
            </iframe>`;

            item.classList.add('playing');
        });
    });
}

// Cargar predicaciones al iniciar
document.addEventListener('DOMContentLoaded', loadSermons);
