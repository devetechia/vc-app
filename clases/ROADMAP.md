# Roadmap — Academia Bíblica Vida Cristiana

> Plataforma de estudio bíblico basada en predicaciones de YouTube con transcripción, análisis IA, tests y apuntes. Todo en `localStorage`, sin backend obligatorio (excepto fallback de transcripción).

**Estado actual:** v0.8 — Funcional en local (`localhost:5000` + `localhost:8001`), bloqueado parcialmente por rate-limit de YouTube en transcripciones. Diseño sólido, gaps críticos de seguridad/cuota y funcionalidad detectados en auditoría del 22/08/2026.

---

## Visión

Convertir la academia en una plataforma de discipulado completa: descubrir → ver → transcribir → estudiar con IA → tomar apuntes → evaluar → retener → compartir.

**Métricas de éxito (v1.0):**
- 50 predicaciones accesibles sin agotar cuota de YouTube
- Estudio IA y tests funcionan 100% sin depender de IP de YouTube
- Usuario puede completar un ciclo completo en <5 min sin fricción
- 0 keys expuestas en cliente

---

## Resumen de Fases

| Fase | Nombre | Objetivo | Esfuerzo | Cuándo |
|------|--------|----------|----------|--------|
| **0** | Hotfix Crítico | Evitar que la app se rompa en prod | S (1 día) | Inmediato |
| **1** | Fundamentos UX | Pulir fricciones diarias | M (1 semana) | Semana 1 |
| **2** | Descubrimiento & Contenido | Que el usuario encuentre qué estudiar | M (1-2 semanas) | Semana 2-3 |
| **3** | Aprendizaje & Retención | Hacer que el estudio sea memorable | L (2 semanas) | Semana 3-5 |
| **4** | Plataforma & Crecimiento | Escalar, medir y compartir | L (2 semanas) | Semana 5-7 |

> S = <4h · M = 4-12h · L = >12h

---

## Fase 0 — Hotfix Crítico (Hacer YA, antes de publicar)

Bloquea deploy si no se hace.

| ID | Título | Problema | Solución | Esf. | Impacto |
|----|--------|----------|----------|------|---------|
| **0.1** | Leak de API Keys | `YT_API_KEY` y `OPENROUTER_KEY` en `script.js:2-4` visibles para cualquiera → robo de cuota/coste | Crear `.env` + `.env.example`. Frontend llama a `POST /api/study` y `POST /api/quiz` en `server.py` (ya existe, hoy no se usa). Keys solo en server. Añadir `.gitignore` para `.env`. | S | 🔴 Crítico |
| **0.2** | Cuota YouTube se agota | `search.list` cuesta 100 unidades. 3 recargas = 300. Límite 10k/día = ~33 usuarios/día y muere. | Cachear lista de videos en `localStorage` con TTL 30min. Si hay cache, no llamar a YouTube. Añadir manejo de error `quotaExceeded` con mensaje útil. | S | 🔴 Crítico |
| **0.3** | Tests bloqueados | `tests.html` solo intenta `getYouTubeTranscript()` automático. Si IP bloqueada, no hay forma de hacer test desde esa página. | Replicar panel manual de `estudio.html` en `tests.html`: textarea + upload .txt + botón "Usar transcripción". | S | 🔴 Crítico |
| **0.4** | XSS en renderMarkdown | `renderMarkdown()` + `innerHTML` sin sanitizar → prompt injection de IA puede ejecutar JS | Escapar HTML antes de `innerHTML` o usar `DOMPurify`. `text.replace(/</g,'&lt;')` antes de reemplazos markdown. | S | 🔴 Alto |
| **0.5** | CORS abierto | `CORS(app)` permite cualquier origen | `CORS(app, origins=["http://localhost:8001", "https://devetechia.github.io"])` | S | Alto |

**Entregable Fase 0:** `git push` seguro, app no muere con 50 usuarios, tests funcionan aunque YouTube bloquee.

---

## Fase 1 — Fundamentos UX (Semana 1)

Pulir lo que el usuario toca todos los días.

| ID | Título | Solución | Esf. |
|----|--------|----------|------|
| **1.1** | Navbar móvil a11y | `aria-expanded`, cerrar al click en link, cerrar al click fuera, focus-trap. Extraer lógica duplicada a `script.js` (`initNavbar()`). | S |
| **1.2** | Toolbar de transcripción clara | Tooltip en slider + label: "Descarta X min de alabanza". Deshabilitar slider cuando es transcripción manual (timestamps falsos `i*3`). | S |
| **1.3** | File input con estilo | Reemplazar `<input type=file>` crudo por botón `btn-outline` + drag&drop zone. Mostrar nombre de archivo. | S |
| **1.4** | PDF decente | Cargar `jspdf` una vez (singleton). Plantilla con logo, título, fecha, numeración. Añadir `exportStudyPDF()` y `exportNotesPDF()`. | M |
| **1.5** | Cachear transcripción | Llamar a `setCachedTranscript(videoId, entries)` al cargar (auto o manual). Al recargar página, restaurar sin pedir a YouTube. | S |
| **1.6** | Búsqueda con debounce + highlight | Debounce 300ms, buscar en `title + description`, botón X para limpiar, resaltar coincidencias con `<mark>`. | S |
| **1.7** | Toast con cola | Cola FIFO, max 1 visible, resto en espera. Auto-dismiss 2.5s. | S |
| **1.8** | Iconografía pro | Reemplazar emojis `🎬📜` por SVGs lucide/heroui con estilo `stroke` uniforme color `var(--purple)`. | S |
| **1.9** | A11y rápido | `alt` descriptivo en thumbs, `title` en iframe, `label for="skipSlider"`, `aria-label` en botones. | S |

---

## Fase 2 — Descubrimiento & Contenido (Semana 2-3)

Que el usuario encuentre y no pierda contenido.

| ID | Título | Solución | Esf. |
|----|--------|----------|------|
| **2.1** | Paginación real | Usar `nextPageToken` de YouTube API. Botón "Cargar más 50" en `predicaciones.html`. Guardar todas las páginas en cache. | M |
| **2.2** | Filtros | Filtro por Año/Mes (derivado de `publishedAt`), por pastor (parsear `title` con regex `I\s*\|.*I\s*(.*)$`), y orden (recientes/antiguas). Chips UI. | M |
| **2.3** | Badges de progreso en cards | En cada `sermon-card` mostrar dots: 🟣 estudiado, 🟡 con apuntes, 🟢 test hecho (leer `localStorage`: `academia_study_*`, `academia_notes`, `academia_quizzes`). | M |
| **2.4** | Vista de progreso / Dashboard | En `index.html` sección "Tu progreso": `3/50 estudiadas · 2 tests · promedio 8.2`. Barra de progreso + "Continuar donde lo dejaste". | M |
| **2.5** | Preview de notas corregido | Truncar por palabra (`text.slice(0,120).split(' ').slice(0,-1).join(' ')+'...'`). Añadir buscador en `notas.html` y orden por fecha/título. | S |
| **2.6** | Manejo de video no disponible | Si `fetchYouTubeVideos` devuelve vacío o 403, mostrar card de fallback + link directo a YouTube. Si `videoId` no existe, mostrar "Predicación no encontrada" con lista sugerida. | S |

---

## Fase 3 — Aprendizaje & Retención (Semana 3-5)

El core pedagógico.

| ID | Título | Solución | Esf. |
|----|--------|----------|------|
| **3.1** | Quiz configurable | Selector: 5/10/15 preguntas + dificultad (básico/intermedio/profundo). Pasar al prompt de IA. | M |
| **3.2** | Quiz con explicaciones | Prompt IA: "Añade 1 línea de explicación por respuesta". Mostrar tras responder. Permitir "Ver explicación" sin revelar correctas. | M |
| **3.3** | Regenerar quiz/estudio | Botón "Regenerar con IA" que borra `academia_study_*` / `academia_quiz_*` y vuelve a llamar. Confirm con modal. | S |
| **3.4** | Historial de tests útil | En `tests.html` historial clickeable → ver detalle (preguntas falladas), botón "Rehacer" y "Compartir resultado" (imagen/texto). | M |
| **3.5** | Apuntes mejorados | Auto-save con debounce 1s (no solo botón Guardar), contador de palabras, markdown básico en apuntes, exportar apunte a PDF. | M |
| **3.6** | Click-to-seek en transcripción | Cada bloque `[02:15]` clickeable → `player.seekTo(seconds)`. Requiere guardar `rawEntries` con `start` real y exponer player via `YT.Player` API. | L |
| **3.7** | Favoritos / Guardados | Corazón en card → `localStorage academia_favs[]`. Filtro "Favoritos" en `predicaciones.html`. | S |

---

## Fase 4 — Plataforma & Crecimiento (Semana 5-7)

Escalar y medir.

| ID | Título | Solución | Esf. |
|----|--------|----------|------|
| **4.1** | PWA Offline | `manifest.json` + `service-worker.js` para cachear HTML/CSS/JS y `localStorage` sync. Como la web principal. | L |
| **4.2** | Export/Import total | Botón en `notas.html`: "Exportar todo (.json)" y "Importar". Backup de estudios, tests, apuntes. | M |
| **4.3** | Compartir | Botón "Compartir estudio" → Web Share API + fallback copiar link `estudio.html?id=...&share=1`. | S |
| **4.4** | Analytics sin cookies | `plausible` o `umami` (privacidad) para medir: predicación más estudiada, tasa de completado de test. | S |
| **4.5** | Deploy real | `server.py` con `gunicorn` + `Dockerfile` + `fly.io`/`render.com` o GitHub Pages solo-frontend con fallback 100% client-side (OpenRouter directo si server cae). Documentar en `README.md`. | M |
| **4.6** | Tests automatizados | `vitest` para `parseQuiz`, `parseAIResponse`, `filterTranscript` + `playwright` para flujo e2e (cargar video → pegar transcript → generar estudio). | L |

---

## Dependencias

```
0.1 (keys) ─┬─> 0.2 (quota) ─> 2.1 (paginación)
            └─> 1.4 (PDF) ─> 3.5 (export apuntes)
0.3 (tests manual) ─> 3.1 (quiz configurable)
1.5 (cache transcript) ─> 2.3 (badges) ─> 2.4 (dashboard)
3.6 (click-to-seek) depende de 1.5 + YT Player API
```

---

## Roadmap Visual (7 semanas)

```
Semana:  0 (hoy)  1        2        3        4        5        6        7
         ├────────┼────────┼────────┼────────┼────────┼────────┼────────┤
Fase 0:  ████████
Fase 1:           ████████████
Fase 2:                    ████████████████
Fase 3:                              ████████████████████
Fase 4:                                                  ████████████████
                                              ▲ v1.0 release
```

**v1.0** = Fase 0+1+2 completas. Ya es publicable.
**v1.1** = Fase 3 (retención).
**v2.0** = Fase 4 (PWA + analytics).

---

## Riesgos & Mitigaciones

| Riesgo | Mitigación |
|--------|------------|
| YouTube IP block permanente | Fase 0.2 (cache) + manual paste como feature, no como bug. Evaluar proxy opcional en server (ej. `scraperapi` free tier) en Fase 4. |
| OpenRouter free tier cae | Añadir fallback a `server.py` con segundo modelo (`nousresearch/hermes-3-405b:free`). |
| localStorage lleno (5MB) | Fase 1.5: limitar a 50 estudios, LRU eviction, avisar con toast si `QuotaExceededError`. |

---

## Próximo paso

¿Empezamos por **Fase 0** (hotfixes críticos)? Son ~2-3h y dejan la app lista para deploy sin leaks.
Di `implementa fase 0` y lo hago en un solo bloque.

---

*Generado: 22/08/2026 · Auditor: OpenCode · Archivos auditados: `index.html`, `predicaciones.html`, `estudio.html`, `tests.html`, `notas.html`, `script.js`, `styles.css`, `server.py`*
