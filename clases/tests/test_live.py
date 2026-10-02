"""Tests para deteccion de directos (domingos 10-14h Madrid)."""
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from live_status import (
    in_live_window,
    cache_ttl,
    quota_exceeded,
    check_live_status,
)

MADRID = ZoneInfo("Europe/Madrid")


def _dt(y, m, d, h, mi=0):
    return datetime(y, m, d, h, mi, tzinfo=MADRID)


def test_domingo_11_dentro_ventana():
    # 2026-10-04 es domingo
    assert in_live_window(_dt(2026, 10, 4, 11, 0)) is True


def test_domingo_10_en_punto_dentro():
    assert in_live_window(_dt(2026, 10, 4, 10, 0)) is True


def test_domingo_14_fuera():
    assert in_live_window(_dt(2026, 10, 4, 14, 0)) is False


def test_domingo_9_fuera():
    assert in_live_window(_dt(2026, 10, 4, 9, 59)) is False


def test_sabado_11_fuera():
    assert in_live_window(_dt(2026, 10, 3, 11, 0)) is False


def test_lunes_11_fuera():
    assert in_live_window(_dt(2026, 10, 5, 11, 0)) is False


def test_ttl_negativo_largo_y_positivo_corto():
    assert cache_ttl(is_live=False) == 1800
    assert cache_ttl(is_live=True) == 180


def test_quota_guard():
    assert quota_exceeded(used=7999, cap=8000) is False
    assert quota_exceeded(used=8000, cap=8000) is True
    assert quota_exceeded(used=9500, cap=8000) is True


def test_fuera_de_ventana_no_llama_api():
    calls = []

    def fake_fetch(kind):
        calls.append(kind)
        return None

    now = _dt(2026, 10, 5, 11, 0)  # lunes
    result = check_live_status(now=now, fetcher=fake_fetch)
    assert result["live"] is False
    assert result["reason"] == "off-hours"
    assert calls == []


def test_dentro_ventana_con_directo():
    def fake_fetch(kind):
        if kind == "live":
            return {"videoId": "abc123", "title": "Culto en directo"}
        return None

    now = _dt(2026, 10, 4, 11, 0)
    result = check_live_status(now=now, fetcher=fake_fetch)
    assert result["live"] is True
    assert result["videoId"] == "abc123"


def test_dentro_ventana_sin_directo_mira_upcoming():
    calls = []

    def fake_fetch(kind):
        calls.append(kind)
        if kind == "upcoming":
            return {"videoId": "up1", "title": "Culto domingo", "scheduled": "2026-10-11T10:00:00+02:00"}
        return None

    now = _dt(2026, 10, 4, 11, 0)
    result = check_live_status(now=now, fetcher=fake_fetch)
    assert result["live"] is False
    assert result["upcoming"]["videoId"] == "up1"
    assert calls == ["live", "upcoming"]


def test_cuota_agotada_no_llama_api():
    calls = []

    def fake_fetch(kind):
        calls.append(kind)
        return None

    now = _dt(2026, 10, 4, 11, 0)
    result = check_live_status(now=now, fetcher=fake_fetch, quota_used=8000, quota_cap=8000)
    assert result["live"] is False
    assert result["reason"] == "quota-guard"
    assert calls == []
