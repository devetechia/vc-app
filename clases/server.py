import os
import re
import tempfile
import time
from pathlib import Path
from flask import Flask, request, jsonify
from flask_cors import CORS
import requests

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# Soporte COOKIES_TXT como env var (para Fly.io secrets)
if os.getenv("COOKIES_TXT") and not Path("cookies.txt").exists():
    try:
        Path("cookies.txt").write_text(os.getenv("COOKIES_TXT"), encoding="utf-8")
        print("cookies.txt creado desde env COOKIES_TXT")
    except Exception as e:
        print(f"No se pudo crear cookies.txt desde env: {e}")

app = Flask(__name__, static_folder=".", static_url_path="")
CORS(app, origins=[
    "http://localhost:5000",
    "http://127.0.0.1:5000",
    "http://localhost:8001",
    "http://127.0.0.1:8001",
    "http://localhost:8000",
    "https://devetechia.github.io",
    "https://*.fly.dev",
    "https://*.vercel.app",
    "null",
])

# Servir archivos estáticos (HTML, CSS, JS) desde el directorio del proyecto
from flask import send_from_directory

@app.route('/')
def index():
    return send_from_directory(str(Path(__file__).parent), 'index.html')

@app.route('/favicon.ico')
def favicon():
    return send_from_directory(str(Path(__file__).parent / 'logos'), 'logo.svg', mimetype='image/svg+xml')

@app.route('/<path:filename>')
def serve_static(filename):
    return send_from_directory(str(Path(__file__).parent), filename)


YT_API_KEY = os.getenv("YT_API_KEY", "")
YT_CHANNEL_ID = os.getenv("YT_CHANNEL_ID", "UCRpj-vU_Nu6UaxJJvGI7jAA")
OPENROUTER_KEY = os.getenv("OPENROUTER_KEY", "")
OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "poolside/laguna-s-2.1:free")
GROK_API_URL = "https://openrouter.ai/api/v1/chat/completions"
PROXY_URL = os.getenv("PROXY_URL", "")  # ej: http://user:pass@proxy.webshare.io:80

# Validación de API Keys (ADR-001)
if not YT_API_KEY:
    print("⚠️  WARNING: YT_API_KEY no configurada. Configure .env o variable de entorno.")
if not OPENROUTER_KEY:
    print("⚠️  WARNING: OPENROUTER_KEY no configurada. Configure .env o variable de entorno.")

def get_proxy_config():
    if not PROXY_URL:
        return None
    try:
        from youtube_transcript_api.proxies import GenericProxyConfig
        return GenericProxyConfig(http_url=PROXY_URL, https_url=PROXY_URL)
    except Exception as e:
        print(f"Proxy config error: {e}")
        return None

# ===== WHISPER SETUP (lazy) =====
_whisper_model = None

def get_whisper_model():
    global _whisper_model
    if _whisper_model is None:
        from faster_whisper import WhisperModel
        # base = rapido (~74M), small = mejor calidad es. Usamos base para CPU.
        # Si quieres mas precision cambia a "small"
        _whisper_model = WhisperModel("base", device="cpu", compute_type="int8")
        print("Whisper model 'base' cargado (CPU int8)")
    return _whisper_model

def find_cookies_file():
    candidates = [
        Path(__file__).parent / "cookies.txt",
        Path(__file__).parent.parent / "cookies.txt",
        Path.cwd() / "cookies.txt",
    ]
    for p in candidates:
        if p.exists():
            return str(p)
    return None

def transcribe_with_whisper(video_id):
    """Descarga audio con yt-dlp y transcribe con faster-whisper. Retorna texto o None."""
    import yt_dlp

    # Asegurar deno en PATH para yt-dlp
    deno_path = os.path.join(os.environ.get("LOCALAPPDATA", ""), "deno")
    if os.path.isdir(deno_path) and deno_path not in os.environ.get("PATH", ""):
        os.environ["PATH"] = deno_path + os.pathsep + os.environ.get("PATH", "")

    cookies_file = find_cookies_file()
    tmpdir = tempfile.mkdtemp(prefix="academia_")
    out_tmpl = os.path.join(tmpdir, "%(id)s.%(ext)s")

    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": out_tmpl,
        "quiet": True,
        "noplaylist": True,
        "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "128"}],
        "postprocessor_args": [],
        "prefer_ffmpeg": True,
        "remote_components": ["ejs:github"],
    }
    if cookies_file:
        ydl_opts["cookiefile"] = cookies_file
        print(f"Usando cookies: {cookies_file}")
    if PROXY_URL:
        ydl_opts["proxy"] = PROXY_URL
        print(f"Usando proxy para yt-dlp: {PROXY_URL[:30]}...")

    url = f"https://www.youtube.com/watch?v={video_id}"
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
        # Buscar mp3 generado
        mp3_files = list(Path(tmpdir).glob("*.mp3"))
        if not mp3_files:
            # fallback: buscar cualquier audio
            mp3_files = list(Path(tmpdir).glob("*.*"))
            if not mp3_files:
                raise Exception("No se genero audio")
        audio_path = str(mp3_files[0])
        print(f"Audio descargado: {audio_path} ({os.path.getsize(audio_path)} bytes)")

        model = get_whisper_model()
        segments, info = model.transcribe(audio_path, language="es", beam_size=5)
        text = " ".join([s.text.strip() for s in segments if s.text.strip()])
        print(f"Whisper: idioma detectado {info.language} ({info.language_probability:.2f}), texto len {len(text)}")

        # cleanup
        try:
            for f in Path(tmpdir).glob("*"): f.unlink()
            Path(tmpdir).rmdir()
        except: pass

        return text if text else None
    except Exception as e:
        print(f"Whisper transcribe error: {e}")
        # cleanup
        try:
            for f in Path(tmpdir).glob("*"): f.unlink(missing_ok=True)
            Path(tmpdir).rmdir()
        except: pass
        return None

# ===== VIDEOS (proxy YouTube Data API via Playlist de Subidas) =====
@app.route("/api/videos")
def get_videos():
    max_results = request.args.get("maxResults", "50")
    try:
        max_results = min(int(max_results), 50)
    except:
        max_results = 50
    page_token = request.args.get("pageToken", "")

    # La playlist de subidas oficial de un canal siempre es 'UU' + channel_id[2:]
    uploads_playlist_id = os.getenv("YT_UPLOADS_PLAYLIST_ID", "")
    if not uploads_playlist_id and YT_CHANNEL_ID:
        uploads_playlist_id = "UU" + YT_CHANNEL_ID[2:] if YT_CHANNEL_ID.startswith("UC") else YT_CHANNEL_ID

    url = (
        f"https://www.googleapis.com/youtube/v3/playlistItems"
        f"?key={YT_API_KEY}&playlistId={uploads_playlist_id}"
        f"&part=snippet&maxResults={max_results}"
    )
    if page_token:
        url += f"&pageToken={page_token}"

    try:
        r = requests.get(url, timeout=15)
        data = r.json()
        if "error" in data:
            err = data["error"]
            if err.get("code") == 403 or "quota" in str(err).lower():
                return jsonify({"error": "quotaExceeded", "details": err, "items": []}), 429
            return jsonify({"error": err.get("message", "YouTube API error"), "details": err}), r.status_code

        items = []
        seen_ids = set()
        seen_titles = set()
        for item in data.get("items", []):
            sn = item.get("snippet", {})
            vid = sn.get("resourceId", {}).get("videoId")
            title = sn.get("title", "").strip()
            # Filtrar items sin videoId o videos privados / eliminados
            if not vid or title in ("Private video", "Deleted video"):
                continue
            
            # Normalizar título para desduplicar reconexiones de transmisiones en vivo
            norm_title = re.sub(r'[\s|Il\-_:]+', ' ', title.lower()).strip()
            if vid in seen_ids or (norm_title and norm_title in seen_titles):
                continue
            seen_ids.add(vid)
            if norm_title:
                seen_titles.add(norm_title)

            items.append({
                "id": vid,
                "title": title,
                "thumbnail": (sn.get("thumbnails", {}).get("high") or sn.get("thumbnails", {}).get("medium") or sn.get("thumbnails", {}).get("default") or {}).get("url", ""),
                "date": sn.get("publishedAt", ""),
                "description": sn.get("description", ""),
            })
        return jsonify({
            "items": items,
            "nextPageToken": data.get("nextPageToken", ""),
            "prevPageToken": data.get("prevPageToken", ""),
            "totalResults": data.get("pageInfo", {}).get("totalResults", 0)
        })
    except Exception as e:
        return jsonify({"error": str(e), "items": []}), 500


# ===== TRANSCRIPT (youtube_transcript_api -> whisper fallback) =====
@app.route("/api/transcript")
def get_transcript():
    video_id = request.args.get("videoId")
    if not video_id:
        return jsonify({"error": "videoId required"}), 400

    last_error = None

    # Intento 1: youtube_transcript_api (rápido, soporta auto-generados y extrae timestamps exactos)
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        proxy_config = get_proxy_config()
        ytt_api = YouTubeTranscriptApi(proxy_config=proxy_config) if proxy_config else YouTubeTranscriptApi()
        transcript = ytt_api.fetch(video_id, languages=["es", "es-419", "en"])
        entries = [{"start": s.start, "duration": s.duration, "text": s.text} for s in transcript.snippets]
        if entries:
            return jsonify({
                "transcript": " ".join([e["text"] for e in entries]),
                "entries": entries,
                "source": "youtube_transcript_api"
            })
    except Exception as e:
        last_error = str(e)
        print(f"youtube_transcript_api attempt failed: {e}")

    # Intento 2: Parse YouTube page HTML to extract caption track URLs
    try:
        import re, json as _json
        page_url = f"https://www.youtube.com/watch?v={video_id}"
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        }
        resp = requests.get(page_url, headers=headers, timeout=15)
        if resp.status_code == 200:
            html = resp.text
            m = re.search(r'ytInitialPlayerResponse\s*=\s*(\{.+?\});', html)
            if m:
                player = _json.loads(m.group(1))
                captions = player.get("captions", {}).get("playerCaptionsTracklistRenderer", {}).get("captionTracks", [])
                if captions:
                    track = None
                    for t in captions:
                        if t.get("languageCode", "").startswith("es"):
                            track = t
                            break
                    if not track:
                        for t in captions:
                            if t.get("languageCode", "").startswith("en"):
                                track = t
                                break
                    if not track:
                        track = captions[0]
                    base_url = track.get("baseUrl", "")
                    if base_url:
                        cap_resp = requests.get(base_url + "&fmt=json3", headers=headers, timeout=15)
                        if cap_resp.status_code == 200 and cap_resp.text.strip():
                            cap_json = cap_resp.json()
                            entries = []
                            for ev in cap_json.get("events", []):
                                segs = ev.get("segs", [])
                                text = " ".join(s.get("utf8", "") for s in segs).strip()
                                if text:
                                    start = ev.get("tStartMs", 0) / 1000.0
                                    entries.append({"start": start, "text": text})
                            if entries:
                                return jsonify({
                                    "transcript": " ".join(e["text"] for e in entries),
                                    "entries": entries,
                                    "source": "youtube_page_parse"
                                })
                        else:
                            last_error = f"Caption download empty or HTTP {cap_resp.status_code}"
                else:
                    last_error = "No caption tracks found in player response"
            else:
                last_error = "ytInitialPlayerResponse not found in page"
        else:
            last_error = f"YouTube page HTTP {resp.status_code}"
    except Exception as e:
        last_error = str(e)
        print(f"Page parse transcript failed: {e}")

    if os.getenv("ENABLE_WHISPER") == "1":
        print(f"Fallback a Whisper para {video_id}...")
        whisper_text = transcribe_with_whisper(video_id)
        if whisper_text:
            return jsonify({"transcript": whisper_text, "source": "whisper"})

    return jsonify({"transcript": None, "error": last_error or "Transcripcion no disponible."}), 500


# Compatibilidad: usado por /api/study y /api/quiz cuando no viene transcript
def _get_transcript_text(video_id):
    if not video_id:
        return None
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        proxy_config = get_proxy_config()
        ytt_api = YouTubeTranscriptApi(proxy_config=proxy_config) if proxy_config else YouTubeTranscriptApi()
        transcript = ytt_api.fetch(video_id, languages=["es", "es-419", "en"])
        text = " ".join([entry.text for entry in transcript.snippets])
        if text:
            return text
    except Exception as e:
        print(f"_get_transcript_text youtube_transcript_api failed: {e}")

    # Fallback parse pagina
    try:
        import re, json as _json
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
        }
        resp = requests.get(f"https://www.youtube.com/watch?v={video_id}", headers=headers, timeout=15)
        if resp.status_code == 200:
            m = re.search(r'ytInitialPlayerResponse\s*=\s*(\{.+?\});', resp.text)
            if m:
                player = _json.loads(m.group(1))
                captions = player.get("captions", {}).get("playerCaptionsTracklistRenderer", {}).get("captionTracks", [])
                if captions:
                    track = next((t for t in captions if t.get("languageCode", "").startswith("es")), captions[0])
                    base_url = track.get("baseUrl", "")
                    if base_url:
                        cap_resp = requests.get(base_url + "&fmt=json3", headers=headers, timeout=15)
                        if cap_resp.status_code == 200 and cap_resp.text.strip():
                            cap_json = cap_resp.json()
                            texts = []
                            for ev in cap_json.get("events", []):
                                text = " ".join(s.get("utf8", "") for s in ev.get("segs", [])).strip()
                                if text:
                                    texts.append(text)
                            if texts:
                                return " ".join(texts)
    except Exception as e:
        print(f"_get_transcript_text page parse failed: {e}")

    if os.getenv("ENABLE_WHISPER") == "1":
        return transcribe_with_whisper(video_id)
    return None


def _call_openrouter(prompt):
    resp = requests.post(
        GROK_API_URL,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {OPENROUTER_KEY}",
        },
        json={
            "model": OPENROUTER_MODEL,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.7,
            "max_tokens": 4096,
        },
        timeout=60,
    )
    data = resp.json()
    if "choices" in data and data["choices"]:
        return data["choices"][0]["message"]["content"]
    raise Exception(data.get("error", {}).get("message") or str(data))


# ===== STUDY =====
@app.route("/api/study", methods=["POST"])
def bible_study():
    data = request.json or {}
    transcript = data.get("transcript", "")
    title = data.get("title", "")
    video_id = data.get("videoId", "")
    if not transcript and video_id:
        fetched = _get_transcript_text(video_id)
        if fetched:
            transcript = fetched
            print(f"Study: transcript fetched via fallback, len={len(transcript)}")

    prompt = f"""Eres un experto en estudios biblicos. Analiza la siguiente predicacion cristiana y proporciona:

1. RESUMEN: Un resumen claro y conciso (3-4 parrafos)

2. MENSAJE PRINCIPAL: El mensaje central mas importante

3. VERSICULOS MENCIONADOS: Lista cada versiculo con:
   - Referencia completa (Libro Capitulo:Versiculo)
   - El texto del versiculo
   - Por que se menciono en la predicacion

4. CONTEXTO Y EXPLICACION: Contexto historico y espiritual

5. PARA PROFUNDIZAR: Temas para estudio personal

Titulo: {title}

Transcripcion:
{transcript or 'No disponible. Analiza solo por el titulo: ' + title}

Responde en espanol con secciones claras usando markdown."""

    try:
        result = _call_openrouter(prompt)
        return jsonify({"result": result})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ===== QUIZ =====
@app.route("/api/quiz", methods=["POST"])
def bible_quiz():
    data = request.json or {}
    transcript = data.get("transcript", "")
    title = data.get("title", "")
    video_id = data.get("videoId", "")
    if not transcript and video_id:
        fetched = _get_transcript_text(video_id)
        if fetched:
            transcript = fetched

    prompt = f"""Basandote en la siguiente predicacion cristiana, genera un quiz de 10 preguntas de opcion multiple.

Cada pregunta debe tener:
- La pregunta clara y concisa
- 4 opciones (A, B, C, D)
- La respuesta correcta marcada con un asterisco *

Ejemplo:
1. Cual es el tema principal de esta predicacion?
A) La oracion
B) La fe*
C) El amor
D) La esperanza

Titulo: {title}

Transcripcion:
{transcript or 'No disponible. Genera preguntas basadas en el titulo: ' + title}

Responde SOLO con las preguntas en el formato indicado, sin explicaciones adicionales."""

    try:
        result = _call_openrouter(prompt)
        return jsonify({"result": result})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/health")
def health():
    return jsonify({"ok": True, "whisper": _whisper_model is not None, "cookies": find_cookies_file() is not None, "proxy": bool(PROXY_URL)})


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=False)
