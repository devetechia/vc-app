#!/usr/bin/env python3
"""
Auto-sync de estudios biblicos (version Windows, pipeline verificada 2026-10-15).

Pipeline por video nuevo (publicado hace >= 2 dias):
  1. Lista de videos: GET {FLY_API_URL}/api/videos (deduplica reconexiones de directos)
  2. Salta si clases/estudios/<id>.md ya existe
  3. Transcripcion: GET {FLY_API_URL}/api/transcript?videoId=... (cadena de fallbacks con proxy)
  4. Estudio: NVIDIA z-ai/glm-5.3 streaming, thinking=false, max_tokens=40000,
     transcript recortado (14k inicio + 6k final), bucle de continuacion si se trunca
  5. Limpia '## Oracion sugerida', valida 12 secciones, guarda markdown
  6. git add + commit + push

Ejecutar con: python3 auto_sync_studies.py   (solo stdlib; lee .env del directorio)
Log: sync_studies.log
"""
import json
import os
import re
import subprocess
import sys
import time
import unicodedata
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

BASE = Path(__file__).parent
LOG_FILE = BASE / "sync_studies.log"

# --- .env (solo pares CLAVE=valor; el archivo esta en .gitignore) ---
ENV = {}
env_path = BASE / ".env"
if env_path.exists():
    for line in env_path.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^\s*([A-Z_]+)\s*=\s*(.*?)\s*$", line)
        if m and m.group(2):
            ENV[m.group(1)] = m.group(2)

FLY_API_URL = ENV.get("FLY_API_URL", "https://academia-biblica-vc.fly.dev")
NVIDIA_KEY = ENV.get("NVIDIA_API_KEY", "")
NVIDIA_MODEL = ENV.get("NVIDIA_MODEL", "z-ai/glm-5.3")
NV_URL = "https://integrate.api.nvidia.com/v1/chat/completions"
MIN_AGE_DAYS = 2
LOCK_FILE = BASE / ".sync_studies.lock"


def log(msg):
    line = f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
    try:
        print(line, flush=True)
    except Exception:
        pass
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")
            f.flush()
            os.fsync(f.fileno())
    except Exception:
        pass


def _pid_alive(pid):
    try:
        out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"],
                             capture_output=True, text=True, timeout=20).stdout
        return str(pid) in out
    except Exception:
        return True  # si no se puede comprobar, asumir vivo (fail-safe)


def acquire_lock():
    """Evita ejecuciones solapadas. Lock con PID: si el proceso murio, se recicla."""
    if LOCK_FILE.exists():
        try:
            content = LOCK_FILE.read_text(encoding="utf-8").strip()
            age = time.time() - LOCK_FILE.stat().st_mtime
            pid = int(content) if content.isdigit() else 0
            if pid and _pid_alive(pid) and age < 12 * 3600:
                return False
            log("lock obsoleto (proceso muerto); se recicla")
        except Exception:
            return False
    try:
        LOCK_FILE.write_text(str(os.getpid()), encoding="utf-8")
    except OSError:
        return False
    return True


def heartbeat_lock():
    try:
        LOCK_FILE.write_text(str(os.getpid()), encoding="utf-8")
    except OSError:
        pass


def release_lock():
    try:
        LOCK_FILE.unlink()
    except OSError:
        pass


def http_get_json(url, timeout, retries=3):
    last = None
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "vc-auto-sync/1.0"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            # Error del servidor (p.ej. 500 sin transcripcion): no reintentar, no hay sentido
            raise
        except Exception as e:
            last = e
            if attempt < retries:
                wait = 20 * attempt
                log(f"    reintento {attempt}/{retries - 1} en {wait}s ({type(e).__name__})")
                time.sleep(wait)
    raise last


def get_videos():
    data = http_get_json(f"{FLY_API_URL}/api/videos?maxResults=50", timeout=60)
    cutoff = datetime.now(timezone.utc) - timedelta(days=MIN_AGE_DAYS)
    out = []
    for v in data.get("items", []):
        date_str = v.get("date", "")
        try:
            pub = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
            if pub <= cutoff:
                out.append(v)
        except ValueError:
            out.append(v)  # sin fecha valida no se filtra
    return out


def get_transcript(video_id):
    try:
        data = http_get_json(f"{FLY_API_URL}/api/transcript?videoId={video_id}", timeout=420, retries=3)
        tr = data.get("transcript") or ""
        if len(tr) > 500:
            return tr
        return None
    except Exception as e:
        log(f"    transcript error: {type(e).__name__}: {str(e)[:120]}")
        return None


NORMAS = """NORMAS (anti-alucinacion):
1. Solo exegetiza los versiculos que el predicador MENCIONA EXPLICITAMENTE. Los pasajes de apoyo se marcan como "(pasaje de apoyo, no citado por el predicador)".
2. Cita todo texto biblico en Reina-Valera 1960 (RVR1960). Nunca una parafrasis como cita literal.
3. Distingue: CITA DIRECTA (el predicador lo leyo), ALUSION (referencia implicita) e INTERPRETACION (etiquetada).
4. Separa siempre "lo que el predicador dijo" de "lo que el pasaje significa en su contexto".
5. No inventes datos historicos, nombres, fechas ni doctrinas; si falta informacion, declralo.
6. Ignora introduccion, saludos, anuncios y alabanza: centrate en la predicacion."""

FORMAT_SPEC = """FORMATO OBLIGATORIO: responde SOLO en markdown, con estos encabezados exactos (##) y en este orden:

## Idea central
Una frase que resume la tesis del mensaje.

## Contexto de la predicacion
Quien predica, la ocasion y el punto de partida del mensaje (solo lo deducible del material).

## Estructura del mensaje
Como organizo el predicador su argumento, en puntos.

## Exegesis de los textos citados
Para cada versiculo mencionado:
### N. Referencia
> "texto en RVR1960"

**Como lo uso el predicador.**
**Contexto biblico original.**
**Que significa en contexto.**
**Por que es clave para el mensaje.**

## Analisis teologico
Las doctrinas que subyacen al mensaje.

## Contexto historico y espiritual
Trasfondo de los pasajes y su horizonte (si es deducible; si no, dilo).

## Temas para profundizar
Varios hilos de estudio personal, cada uno con su referencia y una pregunta.

## Puente entonces a ahora
El principio que se traslada a la vida actual.

## Preguntas de reflexion
Preguntas cerradas al contenido predicado, no genericas.

## Aplicacion practica
Pasos concretos y verificables.

## Versiculo clave
El versiculo de anclaje y por que.

## Para profundizar
Pasajes afines (marcados como apoyo si no los cito el predicador).

IMPORTANTE: en espanol, exhaustivo y profundo, sin encabezados fuera de los indicados."""

REQUIRED = ["## idea central", "## contexto de la predicacion", "## estructura del mensaje",
            "## exegesis de los textos citados", "## analisis teologico", "## contexto historico y espiritual",
            "## temas para profundizar", "## puente entonces a ahora", "## preguntas de reflexion",
            "## aplicacion practica", "## versiculo clave", "## para profundizar"]


def _norm(s):
    return "".join(c for c in unicodedata.normalize("NFD", s.lower())
                   if unicodedata.category(c) != "Mn")


def count_sections(md):
    n = _norm(md)
    return sum(1 for s in REQUIRED if s in n)


def clean_study(md):
    md = re.sub(r"## Oraci[oó]n sugerida.*", "", md, flags=re.DOTALL)
    return md.strip() + "\n"


def nvidia_stream(messages, max_tokens):
    payload = {"model": NVIDIA_MODEL, "messages": messages, "temperature": 0.7,
               "top_p": 1, "max_tokens": max_tokens, "stream": True,
               "chat_template_kwargs": {"thinking": False}}
    req = urllib.request.Request(
        NV_URL, data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {NVIDIA_KEY}",
                 "Accept": "text/event-stream"}, method="POST")
    t0 = time.time()
    parts = []
    finish = "?"
    with urllib.request.urlopen(req, timeout=3600) as resp:
        for raw in resp:
            line = raw.decode("utf-8").strip()
            if not line.startswith("data:"):
                continue
            chunk = line[5:].strip()
            if chunk == "[DONE]":
                break
            try:
                obj = json.loads(chunk)
            except json.JSONDecodeError:
                continue
            choices = obj.get("choices") or []
            if not choices:
                continue
            delta = choices[0].get("delta") or {}
            if delta.get("content"):
                parts.append(delta["content"])
            if choices[0].get("finish_reason"):
                finish = choices[0]["finish_reason"]
    content = "".join(parts)
    log(f"    nvidia: finish={finish} {time.time()-t0:.0f}s content={len(content)}")
    return content, finish


def generate_study(title, transcript):
    """Genera el estudio con reintentos y continuacion. Devuelve markdown o None."""
    tr = transcript
    if len(tr) > 20000:
        tr = tr[:14000] + "\n[...]\n" + tr[-6000:]
    prompt = (
        "Escribe el ESTUDIO BIBLICO FINAL en espanol de esta predicacion, directamente, "
        "empezando por '## Idea central'.\n\n"
        f"{NORMAS}\n\n{FORMAT_SPEC}\n\n"
        f"Titulo: {title}\n\n"
        "Transcripcion (inicio y final; el medio fue recortado):\n" + tr
    )

    for attempt in (1, 2, 3):
        log(f"    generando (intento {attempt})...")
        messages = [{"role": "user", "content": prompt}]
        try:
            full, finish = nvidia_stream(messages, 40000)
        except Exception as e:
            log(f"    nvidia fallo: {type(e).__name__}: {str(e)[:120]}")
            if attempt < 3:
                time.sleep(30 * attempt)
                continue
            raise
        if not full:
            log("    sin contenido; reintentando")
            if attempt < 3:
                time.sleep(30)
            continue
        # bucle de continuacion si se trunco
        rounds = 0
        while finish == "length" and full and rounds < 4:
            if count_sections(full) == len(REQUIRED):
                break
            rounds += 1
            log(f"    continuando (ronda {rounds})...")
            messages.append({"role": "assistant", "content": full})
            messages.append({"role": "user", "content": (
                "Tu ultima frase quedo incompleta. Continua EXACTAMENTE donde te quedaste, "
                "sin repetir nada. Completa la seccion en curso y termina el estudio con "
                "todas las secciones restantes hasta '## Para profundizar' inclusive. "
                "Responde solo con la continuacion del markdown.")})
            try:
                piece, finish = nvidia_stream(messages, 16384)
            except Exception as e:
                log(f"    continuacion fallo: {type(e).__name__}")
                break
            if not piece:
                break
            full += piece
        if full:
            return clean_study(full)
    return None


def git_commit_push(paths):
    if not paths:
        return
    try:
        subprocess.run(["git", "add"] + paths, cwd=BASE, check=True)
        msg = f"auto: generate {len(paths)} estudio(s) biblico(s)"
        subprocess.run(["git", "commit", "-m", msg], cwd=BASE, check=True)
        r = subprocess.run(["git", "push", "origin", "master"], cwd=BASE, capture_output=True, text=True)
        if r.returncode == 0:
            log("git: push OK")
        else:
            log(f"git: push fallo (r.returncode) — pendiente manual: {r.stderr.strip()[:150]}")
    except subprocess.CalledProcessError as e:
        log(f"git error: {e}")


def main():
    if not NVIDIA_KEY:
        log("FALTA NVIDIA_API_KEY en .env")
        sys.exit(1)
    if not acquire_lock():
        log("ya hay una ejecucion en curso; se sale")
        sys.exit(0)
    try:
        run_sync()
    finally:
        release_lock()


def run_sync():
    log("=== inicio sync ===")
    try:
        videos = get_videos()
    except Exception as e:
        log(f"lista de videos fallo: {type(e).__name__}: {str(e)[:150]}")
        sys.exit(1)
    log(f"{len(videos)} videos con >= {MIN_AGE_DAYS} dias")

    for v in videos:
        vid = v.get("id")
        title = v.get("title", "")
        out = BASE / "estudios" / f"{vid}.md"
        if out.exists() and out.stat().st_size > 1000:
            continue
        log(f"[{vid}] {title[:70]}")
        heartbeat_lock()
        try:
            tr = get_transcript(vid)
            if not tr:
                log("    sin transcripcion aun; se reintentara en la proxima ejecucion")
                continue
            log(f"    transcript len={len(tr)}")
            md = generate_study(title, tr)
            if not md:
                log("    generacion fallo; se reintentara en la proxima ejecucion")
                continue
            secs = count_sections(md)
            out.parent.mkdir(exist_ok=True)
            out.write_text(md, encoding="utf-8")
            rel = str(out.relative_to(BASE.parent.parent)).replace("\\", "/")
            log(f"    guardado ({len(md)} chars, {secs}/{len(REQUIRED)} secciones)")
            if secs < len(REQUIRED):
                log("    AVISO: secciones incompletas")
            # commit+push por video: si el proceso muere, no se pierde lo generado
            git_commit_push([rel])
        except Exception as e:
            log(f"    ERROR en {vid}: {type(e).__name__}: {str(e)[:200]}")
            continue
        time.sleep(3)
    log("=== fin sync ===")


if __name__ == "__main__":
    main()
