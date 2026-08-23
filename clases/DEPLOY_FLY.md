# Deploy Fly.io + Whisper (Academia Biblica)

## 1. Requisitos

- Cuenta en https://fly.io (free tier)
- `flyctl` instalado: https://fly.io/docs/hands-on/install-flyctl/
  ```powershell
  powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"
  fly auth login
  ```

## 2. Preparar secrets (keys + cookies)

```powershell
cd "C:\Users\jorge\Desktop\proyectos IA\vida cristiana\clases"

# Secrets de API (obligatorio)
fly secrets set YT_API_KEY="AIzaSyBcbSSyNgUn5yiVxQJ0-yTUj1eVEU1dCu8"
fly secrets set YT_CHANNEL_ID="UCRpj-vU_Nu6UaxJJvGI7jAA"
fly secrets set OPENROUTER_KEY="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"

# Cookies para yt-dlp/whisper (obligatorio para videos con bloqueo)
# Opcion A: desde archivo
fly secrets set COOKIES_TXT="$(Get-Content cookies.txt -Raw)"

# Opcion B: si no tienes cookies.txt aun, deploya sin y luego lo añades
```

> `COOKIES_TXT` caduca cada 3-4 semanas. Cuando Whisper falle con "bot", re-exporta y haz `fly secrets set COOKIES_TXT=...` + `fly deploy`.

## 3. Deploy

```powershell
# Primera vez (crea app)
fly launch --name academia-biblica-vc --region mad --no-deploy

# Deploy (construirá Docker con ffmpeg + whisper base, ~3-5 min primera vez)
fly deploy

# Ver logs
fly logs

# Probar
curl https://academia-biblica-vc.fly.dev/api/health
# => {"cookies":true,"ok":true,"whisper":false} (whisper true tras primer uso)
```

## 4. Conectar frontend (GitHub Pages)

En `script.js` ya esta:

```js
const FLY_API_URL = 'https://academia-biblica-vc.fly.dev';
```

Si cambias el nombre de la app en `fly.toml`, cambia esa URL.

Push a GitHub Pages:

```powershell
git add clases/
git commit -m "deploy academia + fly whisper"
git push
```

GitHub Pages servirá `clases/` y llamará a Fly.io para `/api/videos`, `/api/transcript`, `/api/study`, `/api/quiz`.

## 5. Verificacion

- https://academia-biblica-vc.fly.dev/api/videos?maxResults=2  → lista de videos
- https://academia-biblica-vc.fly.dev/api/transcript?videoId=MgHTULjQdJI → transcript (youtube_captions o whisper)
- En la academia: abrir `estudio.html?id=...` → Generar Estudio → debe tardar 5-10s (captions) o 2-3 min (whisper primera vez)

## Notas

- `fly.toml` usa `memory_mb = 2048` (necesario para whisper base). Free tier Fly da 3 VMs de 256MB, pero puedes usar 1x2048 dentro del free allowance (ver `fly scale show`).
- Si prefieres no pagar, alternativa es **Render** (tambien soporta Docker con 512MB, pero whisper base necesita 1GB+ → usar `tiny` en vez de `base` en `server.py`).
- Vercel NO sirve para whisper (serverless sin ffmpeg). Para Vercel usa solo `youtube_transcript_api` + manual paste.
