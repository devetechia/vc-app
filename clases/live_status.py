"""Deteccion de directos de YouTube (domingos 10-14h Madrid).

Funciones puras y testeables. El acceso a red lo inyecta el llamador
via `fetcher(kind)` donde kind es "live" o "upcoming".
"""
import os
from datetime import datetime
from zoneinfo import ZoneInfo

LIVE_TZ = os.getenv("LIVE_TZ", "Europe/Madrid")
LIVE_DAYS = {int(x) for x in os.getenv("LIVE_DAYS", "6").split(",") if x.strip() != ""}
LIVE_START_HOUR = int(os.getenv("LIVE_START_HOUR", "10"))
LIVE_END_HOUR = int(os.getenv("LIVE_END_HOUR", "14"))
LIVE_NEG_TTL = int(os.getenv("LIVE_NEG_TTL", "1800"))  # sin directo: 30 min
LIVE_POS_TTL = int(os.getenv("LIVE_POS_TTL", "180"))  # con directo: 3 min
LIVE_QUOTA_CAP = int(os.getenv("LIVE_QUOTA_CAP", "8000"))


def in_live_window(now=None):
    """True si `now` cae en dia/hora de culto. `now` debe ser aware; si es
    naive se interpreta en LIVE_TZ."""
    tz = ZoneInfo(LIVE_TZ)
    if now is None:
        now = datetime.now(tz)
    elif now.tzinfo is None:
        now = now.replace(tzinfo=tz)
    else:
        now = now.astimezone(tz)
    if now.weekday() not in LIVE_DAYS:
        return False
    return LIVE_START_HOUR <= now.hour < LIVE_END_HOUR


def cache_ttl(is_live):
    return LIVE_POS_TTL if is_live else LIVE_NEG_TTL


def quota_exceeded(used, cap=LIVE_QUOTA_CAP):
    return used >= cap


def check_live_status(now=None, fetcher=None, quota_used=0, quota_cap=LIVE_QUOTA_CAP):
    """Orquesta la deteccion. Devuelve dict JSON-serializable.

    - Fuera de ventana: no toca la API (reason off-hours).
    - Cuota agotada: no toca la API (reason quota-guard).
    - Dentro: busca live; si no hay, busca upcoming programado.
    """
    if not in_live_window(now):
        return {"live": False, "reason": "off-hours", "upcoming": None}
    if quota_exceeded(quota_used, quota_cap):
        return {"live": False, "reason": "quota-guard", "upcoming": None}
    if fetcher is None:
        return {"live": False, "reason": "no-fetcher", "upcoming": None}

    live = fetcher("live")
    if live:
        return {"live": True, "videoId": live.get("videoId"), "title": live.get("title"), "upcoming": None}
    upcoming = fetcher("upcoming")
    return {"live": False, "reason": "no-live", "upcoming": upcoming}
