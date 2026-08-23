import os
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

app = Flask(__name__)
CORS(app, origins=[
    "http://localhost:8001",
    "http://127.0.0.1:8001",
    "http://localhost:8000",
    "https://devetechia.github.io",
    "https://*.fly.dev",
    "https://*.vercel.app",
])

YT_API_KEY = os.getenv("YT_API_KEY", "AIzaSyBcbSSyNgUn5yiVxQJ0-yTUj1eVEU1dCu8")
YT_CHANNEL_ID = os.getenv("YT_CHANNEL_ID", "UCRpj-vU_Nu6UaxJJvGI7jAA")
OPENROUTER_KEY = os.getenv("OPENROUTER_KEY", "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")
OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "poolside/laguna-s-2.1:free")
GROK_API_URL = "https://openrouter.ai/api/v1/chat/completions"

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

# ===== VIDEOS (proxy YouTube Data API) =====
@app.route("/api/videos")
def get_videos():
    max_results = request.args.get("maxResults", "50")
    try:
        max_results = min(int(max_results), 50)
    except:
        max_results = 50
    page_token = request.args.get("pageToken", "")

    url = (
        f"https://www.googleapis.com/youtube/v3/search"
        f"?key={YT_API_KEY}&channelId={YT_CHANNEL_ID}"
        f"&part=snippet&order=date&maxResults={max_results}&type=video"
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
        for item in data.get("items", []):
            vid = item.get("id", {}).get("videoId")
            sn = item.get("snippet", {})
            if not vid:
                continue
            items.append({
                "id": vid,
                "title": sn.get("title", ""),
                "thumbnail": (sn.get("thumbnails", {}).get("high") or sn.get("thumbnails", {}).get("medium") or {}).get("url", ""),
                "date": sn.get("publishedAt", ""),
                "description": sn.get("description", ""),
            })
        return jsonify({
            "items": items,
            "nextPageToken": data.get("nextPageToken", ""),
            "prevPageToken": data.get("prevPageToken", ""),
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
    # Intento 1: youtube_transcript_api
    for attempt in range(2):
        try:
            from youtube_transcript_api import YouTubeTranscriptApi
            ytt_api = YouTubeTranscriptApi()
            transcript = ytt_api.fetch(video_id, languages=["es", "en"])
            text = " ".join([entry.text for entry in transcript.snippets])
            if text:
                return jsonify({"transcript": text, "source": "youtube_captions"})
        except Exception as e:
            last_error = str(e)
            print(f"youtube_transcript_api failed (attempt {attempt+1}): {e}")
            if attempt == 0:
                time.sleep(1)

    # Intento 2: Whisper local (yt-dlp + faster-whisper)
    print(f"Fallback a Whisper para {video_id}...")
    whisper_text = transcribe_with_whisper(video_id)
    if whisper_text:
        return jsonify({"transcript": whisper_text, "source": "whisper"})

    return jsonify({"transcript": None, "error": last_error or "No se pudo transcribir. Prueba pegando manualmente o añade cookies.txt"}), 500


# Compatibilidad: usado por /api/study y /api/quiz cuando no viene transcript
def _get_transcript_text(video_id):
    if not video_id:
        return None
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        ytt_api = YouTubeTranscriptApi()
        transcript = ytt_api.fetch(video_id, languages=["es", "en"])
        text = " ".join([entry.text for entry in transcript.snippets])
        if text:
            return text
    except Exception as e:
        print(f"_get_transcript_text youtube_transcript_api failed: {e}")
    # Fallback whisper
    return transcribe_with_whisper(video_id)


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
    return jsonify({"ok": True, "whisper": _whisper_model is not None, "cookies": find_cookies_file() is not None})


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=False)
