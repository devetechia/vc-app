"""Tests del prompt de estudio de nivel seminario y su generador."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server import STUDY_PROMPT_HEAD, _build_study_prompt, _generate_study

SECCIONES_OBLIGATORIAS = [
    "## Idea central",
    "## Contexto de la predicacion",
    "## Estructura del mensaje",
    "## Exegesis de los textos citados",
    "## Analisis teologico",
    "## Contexto historico y espiritual",
    "## Temas para profundizar",
    "## Puente entonces a ahora",
    "## Preguntas de reflexion",
    "## Aplicacion practica",
    "## Versiculo clave",
    "## Para profundizar",
    "## Oracion sugerida",
]

GUARDARRAILES = [
    "Reina-Valera 1960",
    "CITA DIRECTA",
    "ALUSION",
    "INTERPRETACION",
    "no inventes",
    "lo que el predicador dijo",
    "pasaje de apoyo, no citado por el predicador",
]


def test_prompt_contiene_todas_las_secciones():
    for s in SECCIONES_OBLIGATORIAS:
        assert s in STUDY_PROMPT_HEAD, f"Falta la seccion {s}"


def test_prompt_contiene_guardarrailes():
    head_lower = STUDY_PROMPT_HEAD.lower()
    for g in GUARDARRAILES:
        assert g.lower() in head_lower, f"Falta el guardarrail {g}"


def test_build_prompt_inyecta_titulo_y_transcripto():
    p = _build_study_prompt("Mi Titulo", "Mi transcripto")
    assert "Mi Titulo" in p
    assert "Mi transcripto" in p


def test_generate_study_passthrough(monkeypatch):
    called = {}

    def fake_call_model(prompt, model, **kw):
        called["model"] = model
        called["prompt"] = prompt
        return "ESTUDIO_OK"

    monkeypatch.setattr("server._call_model", fake_call_model)
    result = _generate_study("Titulo", "Transcripto")
    assert result == "ESTUDIO_OK"
    assert called["model"].startswith("deepseek")
    assert "Titulo" in called["prompt"]