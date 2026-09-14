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

# Soporte COOKIES_TXT como env var (para Fly.io secrets) - ALWAYS recreate on startup
if os.getenv("COOKIES_TXT"):
    try:
        Path("cookies.txt").write_text(os.getenv("COOKIES_TXT"), encoding="utf-8")
        print(f"cookies.txt creado desde env COOKIES_TXT ({len(os.getenv('COOKIES_TXT'))} bytes)")
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
    "https://academiavc.kavanasystems.com",
    "https://*.kavanasystems.com",
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
SUPADATA_API_KEY = os.getenv("SUPADATA_API_KEY", "")
TRANSCRIPTAPI_KEY = os.getenv("TRANSCRIPTAPI_KEY", "")

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

    # Cache en disco (30 días - las transcripciones de YouTube no cambian)
    cache_dir = Path(tempfile.gettempdir()) / "transcript_cache"
    cache_dir.mkdir(exist_ok=True)
    cache_file = cache_dir / f"{video_id}.json"
    if cache_file.exists():
        try:
            import json as _json_cache
            cached = _json_cache.loads(cache_file.read_text(encoding="utf-8"))
            if time.time() - cached.get("ts", 0) < 2592000:  # 30 días
                print(f"Transcript cache hit para {video_id}")
                return jsonify(cached["data"])
        except Exception:
            pass

    last_error = None

    def _cache_and_return(data):
        try:
            cache_file.write_text(__import__('json').dumps({"ts": time.time(), "data": data}, ensure_ascii=False), encoding="utf-8")
        except Exception:
            pass
        return jsonify(data)

    # Intento 1: youtube_transcript_api (rápido, soporta auto-generados y extrae timestamps exactos)
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        proxy_config = get_proxy_config()
        ytt_api = YouTubeTranscriptApi(proxy_config=proxy_config) if proxy_config else YouTubeTranscriptApi()
        transcript = ytt_api.fetch(video_id, languages=["es", "es-419", "en"])
        entries = [{"start": s.start, "duration": s.duration, "text": s.text} for s in transcript.snippets]
        if entries:
            return _cache_and_return({
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
                                return _cache_and_return({
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

    # Intento 3: yt-dlp subtitle extraction (designed to bypass YouTube anti-bot)
    try:
        import yt_dlp as _ytdlp
        print(f"Intentando yt-dlp para {video_id}...")
        sub_opts = {
            'skip_download': True,
            'writesubtitles': True,
            'writeautomaticsub': True,
            'subtitleslangs': ['es', 'es-419', 'en'],
            'subtitlesformat': 'json3',
            'quiet': True,
            'no_warnings': True,
            'socket_timeout': 30,
            'http_headers': {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
            },
        }
        if Path("cookies.txt").exists():
            sub_opts['cookiefile'] = 'cookies.txt'
        elif os.getenv("COOKIES_TXT"):
            Path("cookies.txt").write_text(os.getenv("COOKIES_TXT"), encoding="utf-8")
            sub_opts['cookiefile'] = 'cookies.txt'

        url = f"https://www.youtube.com/watch?v={video_id}"
        with _ytdlp.YoutubeDL(sub_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            subs = info.get('subtitles') or {}
            auto_subs = info.get('automatic_captions') or {}
            track = subs.get('es-orig') or subs.get('es') or subs.get('es-419') or auto_subs.get('es-orig') or auto_subs.get('es') or auto_subs.get('es-419') or subs.get('en') or auto_subs.get('en')
            if track:
                fmt = next((f for f in track if f.get('ext') == 'json3'), track[0])
                sub_url = fmt.get('url', '')
                if sub_url:
                    cap_resp = requests.get(sub_url, timeout=15)
                    if cap_resp.status_code == 200:
                        cap_json = cap_resp.json()
                        entries = []
                        for ev in cap_json.get("events", []):
                            segs = ev.get("segs", [])
                            text = " ".join(s.get("utf8", "") for s in segs).strip()
                            if text:
                                start = ev.get("tStartMs", 0) / 1000.0
                                entries.append({"start": start, "text": text})
                        if entries:
                            return _cache_and_return({
                                "transcript": " ".join(e["text"] for e in entries),
                                "entries": entries,
                                "source": "yt-dlp"
                            })
                last_error = "yt-dlp: subtitle URL empty"
            else:
                last_error = "yt-dlp: no subtitle tracks found"
    except Exception as e:
        last_error = str(e)
        print(f"yt-dlp transcript failed: {e}")

    # Intento 3.5: InnerTube iOS client (no PoToken required)
    try:
        print(f"Intentando InnerTube iOS client para {video_id}...")
        innertube_payload = {
            "context": {
                "client": {
                    "clientName": "IOS",
                    "clientVersion": "19.45.4",
                    "deviceMake": "Apple",
                    "deviceModel": "iPhone16,2",
                    "hl": "es",
                    "gl": "ES",
                    "osName": "iPhone",
                    "osVersion": "18.1.0.22B83",
                    "userAgent": "com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X;)"
                }
            },
            "videoId": video_id,
            "contentCheckOk": True,
            "racyCheckOk": True
        }
        it_resp = requests.post(
            "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
            json=innertube_payload,
            headers={
                "Content-Type": "application/json",
                "User-Agent": "com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X;)",
            },
            timeout=15
        )
        if it_resp.status_code == 200:
            it_data = it_resp.json()
            captions = it_data.get("captions", {}).get("playerCaptionsTracklistRenderer", {}).get("captionTracks", [])
            if captions:
                track = next((t for t in captions if t.get("languageCode", "").startswith("es")), captions[0])
                base_url = track.get("baseUrl", "")
                if base_url:
                    cap_resp = requests.get(base_url + "&fmt=json3", timeout=15)
                    if cap_resp.status_code == 200:
                        cap_json = cap_resp.json()
                        entries = []
                        for ev in cap_json.get("events", []):
                            segs = ev.get("segs", [])
                            text = " ".join(s.get("utf8", "") for s in segs).strip()
                            if text:
                                start = ev.get("tStartMs", 0) / 1000.0
                                entries.append({"start": start, "text": text})
                        if entries:
                            return _cache_and_return({
                                "transcript": " ".join(e["text"] for e in entries),
                                "entries": entries,
                                "source": "innertube-ios"
                            })
                    last_error = "InnerTube: caption download failed"
                else:
                    last_error = "InnerTube: no baseUrl in caption track"
            else:
                last_error = "InnerTube: no caption tracks in player response"
        else:
            last_error = f"InnerTube: HTTP {it_resp.status_code}"
    except Exception as e:
        last_error = str(e)
        print(f"InnerTube iOS transcript failed: {e}")

    # Intento 4: Supadata API (100 gratis/mes, maneja PoToken)
    if SUPADATA_API_KEY:
        try:
            print(f"Intentando Supadata API para {video_id}...")
            sd_resp = requests.get(
                f"https://api.supadata.ai/v1/youtube/transcript?videoId={video_id}&lang=es&text=true",
                headers={"x-api-key": SUPADATA_API_KEY, "Content-Type": "application/json"},
                timeout=30
            )
            if sd_resp.status_code == 200:
                sd_data = sd_resp.json()
                transcript_text = sd_data.get("content", "")
                if transcript_text and isinstance(transcript_text, str) and len(transcript_text) > 10:
                    return _cache_and_return({
                        "transcript": transcript_text,
                        "entries": [{"start": 0, "text": transcript_text}],
                        "source": "supadata"
                    })
                last_error = "Supadata: empty or invalid response"
            else:
                last_error = f"Supadata: HTTP {sd_resp.status_code}"
        except Exception as e:
            last_error = str(e)
            print(f"Supadata transcript failed: {e}")
    else:
        print("Supadata API key no configurada, saltando...")

    # Intento 5: TranscriptAPI.com (100 gratis/mes)
    if TRANSCRIPTAPI_KEY:
        try:
            print(f"Intentando TranscriptAPI para {video_id}...")
            ta_resp = requests.get(
                f"https://transcriptapi.com/api/v2/youtube/transcript?video_url=https://www.youtube.com/watch?v={video_id}&format=text",
                headers={"Authorization": f"Bearer {TRANSCRIPTAPI_KEY}", "User-Agent": "AcademiaBiblica/1.0"},
                timeout=30
            )
            if ta_resp.status_code == 200:
                ta_data = ta_resp.json()
                transcript_text = ta_data.get("transcript", "")
                if transcript_text and isinstance(transcript_text, str) and len(transcript_text) > 10:
                    return _cache_and_return({
                        "transcript": transcript_text,
                        "entries": [{"start": 0, "text": transcript_text}],
                        "source": "transcriptapi"
                    })
                last_error = "TranscriptAPI: empty or invalid response"
            else:
                last_error = f"TranscriptAPI: HTTP {ta_resp.status_code}"
        except Exception as e:
            last_error = str(e)
            print(f"TranscriptAPI transcript failed: {e}")
    else:
        print("TranscriptAPI key no configurada, saltando...")

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

    # Fallback InnerTube iOS client
    try:
        innertube_payload = {
            "context": {
                "client": {
                    "clientName": "IOS",
                    "clientVersion": "19.45.4",
                    "deviceMake": "Apple",
                    "deviceModel": "iPhone16,2",
                    "hl": "es",
                    "gl": "ES",
                    "osName": "iPhone",
                    "osVersion": "18.1.0.22B83",
                    "userAgent": "com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X;)"
                }
            },
            "videoId": video_id,
            "contentCheckOk": True,
            "racyCheckOk": True
        }
        it_resp = requests.post(
            "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
            json=innertube_payload,
            headers={
                "Content-Type": "application/json",
                "User-Agent": "com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X;)",
            },
            timeout=15
        )
        if it_resp.status_code == 200:
            it_data = it_resp.json()
            captions = it_data.get("captions", {}).get("playerCaptionsTracklistRenderer", {}).get("captionTracks", [])
            if captions:
                track = next((t for t in captions if t.get("languageCode", "").startswith("es")), captions[0])
                base_url = track.get("baseUrl", "")
                if base_url:
                    cap_resp = requests.get(base_url + "&fmt=json3", timeout=15)
                    if cap_resp.status_code == 200:
                        cap_json = cap_resp.json()
                        texts = []
                        for ev in cap_json.get("events", []):
                            text = " ".join(s.get("utf8", "") for s in ev.get("segs", [])).strip()
                            if text:
                                texts.append(text)
                        if texts:
                            return " ".join(texts)
    except Exception as e:
        print(f"_get_transcript_text InnerTube failed: {e}")

    # Fallback Supadata API
    if SUPADATA_API_KEY:
        try:
            print(f"_get_transcript_text intentando Supadata para {video_id}...")
            sd_resp = requests.get(
                f"https://api.supadata.ai/v1/youtube/transcript?videoId={video_id}&lang=es&text=true",
                headers={"x-api-key": SUPADATA_API_KEY, "Content-Type": "application/json"},
                timeout=30
            )
            if sd_resp.status_code == 200:
                sd_data = sd_resp.json()
                transcript_text = sd_data.get("content", "")
                if transcript_text and isinstance(transcript_text, str) and len(transcript_text) > 10:
                    return transcript_text
        except Exception as e:
            print(f"_get_transcript_text Supadata failed: {e}")

    # Fallback TranscriptAPI.com
    if TRANSCRIPTAPI_KEY:
        try:
            print(f"_get_transcript_text intentando TranscriptAPI para {video_id}...")
            ta_resp = requests.get(
                f"https://transcriptapi.com/api/v2/youtube/transcript?video_url=https://www.youtube.com/watch?v={video_id}&format=text",
                headers={"Authorization": f"Bearer {TRANSCRIPTAPI_KEY}", "User-Agent": "AcademiaBiblica/1.0"},
                timeout=30
            )
            if ta_resp.status_code == 200:
                ta_data = ta_resp.json()
                transcript_text = ta_data.get("transcript", "")
                if transcript_text and isinstance(transcript_text, str) and len(transcript_text) > 10:
                    return transcript_text
        except Exception as e:
            print(f"_get_transcript_text TranscriptAPI failed: {e}")

    if os.getenv("ENABLE_WHISPER") == "1":
        return transcribe_with_whisper(video_id)
    return None


def _call_openrouter(prompt):
    models_to_try = [
        OPENROUTER_MODEL,
        "openrouter/free",
        "nvidia/nemotron-3-ultra-550b-a55b:free",
    ]
    
    last_error = None
    for model in models_to_try:
        try:
            print(f"Trying model: {model}")
            resp = requests.post(
                GROK_API_URL,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {OPENROUTER_KEY}",
                },
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.7,
                    "max_tokens": 4096,
                },
                timeout=90,
            )
            data = resp.json()
            if "choices" in data and data["choices"]:
                print(f"Success with model: {model}")
                return data["choices"][0]["message"]["content"]
            
            error_code = data.get("error", {}).get("code", 0)
            last_error = data.get("error", {}).get("message") or str(data)
            print(f"Error on {model} (code {error_code}): {last_error}")
            
            if error_code == 429:
                print(f"Rate limited on {model}, trying next...")
                time.sleep(2)
                continue
            else:
                break
        except requests.exceptions.Timeout:
            print(f"Timeout on {model}")
            last_error = f"Timeout on {model}"
            continue
        except Exception as e:
            last_error = str(e)
            print(f"Exception on {model}: {last_error}")
            continue
    
    raise Exception(last_error or "All models failed")


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

    prompt = f"""Eres un experto en estudios biblicos cristianos evangélicos. Analiza la siguiente predicacion y genera un ESTUDIO BIBLICO COMPLETO Y PROFUNDO.

FORMATO (en español, markdown):

## 📖 TEMA PRINCIPAL
Tema central de la predicacion (2-3 párrafos).

## 📝 RESUMEN
Resumen claro y conciso (3-4 párrafos).

## 🔍 ANÁLISIS POR SECCIONES
Divide la predicacion en partes. Para cada una:
- **Subtema**
- **Explicación**
- **Versículos usados**: referencia y por qué

## 📚 VERSICULOS MENCIONADOS
Para CADA versiculo citado:
- **Referencia**: Libro Cap:Vers
- **Texto completo**
- **Contexto en la predicación**: por qué se mencionó
- **Contexto bíblico original**: contexto en su libro
- **Conexión con el tema**

## 🧠 CONTEXTO HISTÓRICO Y ESPIRITUAL
Contexto histórico, cultural y espiritual de los pasajes.

## 💡 TEMAS PARA REFLEXIONAR
5-7 temas profundos con explicación y pregunta.

## 🙏 APLICACIÓN PRÁCTICA
3-4 puntos concretos para la vida diaria.

## 📌 VERSICULO CLAVE
El versículo más importante y por qué.

## 📖 PARA PROFUNDIZAR
Otros pasajes relacionados.

---

Título: {title}

Transcripción:
{transcript or 'No disponible. Analiza solo por el título: ' + title}

IMPORTANTE: Sé exhaustivo y profundo. El objetivo es entender la predicación en profundidad."""

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

    prompt = f"""Basandote en la siguiente predicacion cristiana, genera un quiz de 10 preguntas de opcion multiple que evalúen comprensión profunda.

Cada pregunta debe tener:
- La pregunta clara y concisa
- 4 opciones (A, B, C, D)
- La respuesta correcta marcada con un asterisco *
- Una breve explicación de la respuesta correcta

Tipos de preguntas (varía entre ellas):
- Preguntas sobre el tema principal
- Preguntas sobre versículos específicos mencionados
- Preguntas sobre el contexto histórico/espiritual
- Preguntas de aplicación práctica
- Preguntas de conexión entre conceptos

Ejemplo:
1. Cuál es el tema principal de esta predicación?
A) La oración
B) La fe*
C) El amor
D) La esperanza
Explicación: El predicador enfatiza la fe como el pilar fundamental...

---

Título: {title}

Transcripción:
{transcript or 'No disponible. Genera preguntas basadas en el título: ' + title}

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
