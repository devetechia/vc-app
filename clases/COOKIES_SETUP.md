# Setup cookies.txt para Whisper (Plan B)

Sin esto, `yt-dlp` es bloqueado por YouTube ("Sign in to confirm you're not a bot").

## Opcion A — Extension (1 click, recomendado)

1. Chrome/Firefox: instala **"Get cookies.txt LOCALLY"**
   - Chrome: https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc
   - Firefox: https://addons.mozilla.org/en-US/firefox/addon/get-cookies-txt-locally/
2. Ve a **https://www.youtube.com** y asegurate de estar logueado con tu cuenta de Google
3. Click en la extension → **Export** → se descarga `cookies.txt`
4. Mueve el archivo a `clases/cookies.txt` (al lado de `server.py`)
5. Reinicia el server: cierra terminal y ejecuta `python server.py` de nuevo
6. Verifica: http://localhost:5000/api/health debe mostrar `"cookies": true`

## Opcion B — Manual con yt-dlp

Si prefieres no usar extension:

```bash
# Chrome (requiere cerrar Chrome primero)
yt-dlp --cookies-from-browser chrome --cookies cookies.txt https://www.youtube.com/watch?v=MgHTULjQdJI --skip-download
```

## Notas

- `cookies.txt` contiene sesion de YouTube, **NO lo subas a GitHub** (ya esta en .gitignore)
- Caduca cada pocas semanas. Si vuelve a fallar con "bot", re-exporta.
- Sin cookies, la academia sigue funcionando via **pegado manual** (YouTube → Mostrar transcripcion → pegar).

## Test rapido

```bash
curl "http://localhost:5000/api/transcript?videoId=MgHTULjQdJI"
# Debe responder con {"transcript": "...", "source": "whisper"} tras 2-3 min la primera vez (descarga modelo base 145MB)
```
