#!/usr/bin/env python3
"""
Auto-sync de estudios biblicos: detecta videos nuevos en YouTube y genera
estudios markdown automaticamente en clases/estudios/.
Se ejecuta desde el VPS donde corre server.py.
"""
import os
import re
import json
import time
import requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).parent
ESTUDIOS_DIR = BASE_DIR / "estudios"
API_BASE = os.getenv("API_BASE_URL", "http://localhost:5000")
ADMIN_KEY = os.getenv("ADMIN_KEY", "")
YT_CHANNEL_ID = os.getenv("YT_CHANNEL_ID", "")

HEADERS = {"X-Admin-Key": ADMIN_KEY, "Content-Type": "application/json"}

def get_videos():
    url = f"{API_BASE}/api/videos?maxResults=50"
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    items = r.json().get("items", [])
    # Filtrar videos publicados hace >= 2 días para dar tiempo a transcripción
    from datetime import datetime, timezone, timedelta
    cutoff = datetime.now(timezone.utc) - timedelta(days=2)
    filtered = []
    for v in items:
        date_str = v.get("date", "")
        try:
            # ISO 8601
            pub = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
            if pub <= cutoff:
                filtered.append(v)
        except Exception:
            # Si no hay fecha válida, lo incluimos para no perderlo
            filtered.append(v)
    return filtered

def study_exists(video_id):
    return (ESTUDIOS_DIR / f"{video_id}.md").exists()

def generate_study(video_id, title):
    # Intentar obtener transcripcion via API propia
    try:
        tr = requests.get(f"{API_BASE}/api/transcript", params={"videoId": video_id}, timeout=60)
        if tr.status_code == 200:
            data = tr.json()
            transcript = data.get("transcript") or ""
        else:
            transcript = ""
    except Exception:
        transcript = ""
    
    payload = {"title": title, "transcript": transcript, "videoId": video_id}
    r = requests.post(f"{API_BASE}/api/admin/generate", headers=HEADERS, json=payload, timeout=240)
    if r.status_code != 200:
        raise RuntimeError(f"Generacion fallida {r.status_code}: {r.text}")
    return r.json().get("result", "")

def clean_study(md):
    # Eliminar seccion Oración sugerida si existe
    md = re.sub(r'## Oración sugerida.*', '', md, flags=re.DOTALL)
    return md.strip()

def save_study(video_id, md):
    ESTUDIOS_DIR.mkdir(exist_ok=True)
    path = ESTUDIOS_DIR / f"{video_id}.md"
    path.write_text(clean_study(md), encoding="utf-8")
    return path

def git_commit(new_files):
    if not new_files:
        return
    try:
        import subprocess
        subprocess.run(["git", "add"] + [str(p) for p in new_files], cwd=BASE_DIR, check=True, stdout=subprocess.DEVNULL)
        msg = f"auto: generate {len(new_files)} studies"
        subprocess.run(["git", "commit", "-m", msg], cwd=BASE_DIR, check=True, stdout=subprocess.DEVNULL)
        subprocess.run(["git", "push"], cwd=BASE_DIR, check=True, stdout=subprocess.DEVNULL)
        print(f"Git push: {len(new_files)} archivos")
    except Exception as e:
        print(f"Git error: {e}")

def main():
    if not ADMIN_KEY:
        print("ADMIN_KEY no configurado")
        return
    videos = get_videos()
    new_files = []
    for v in videos:
        vid = v["id"]
        title = v.get("title", "")
        if study_exists(vid):
            continue
        print(f"Generando estudio para {vid} - {title[:60]}")
        try:
            md = generate_study(vid, title)
            if not md.strip():
                print(f"  Sin contenido, saltando")
                continue
            path = save_study(vid, md)
            new_files.append(path)
            print(f"  Guardado {path.name}")
            time.sleep(5)  # rate limit suave
        except Exception as e:
            print(f"  Error: {e}")
    git_commit(new_files)
    print("Sync completo")

if __name__ == "__main__":
    main()
