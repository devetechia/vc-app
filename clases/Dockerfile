FROM python:3.11-bullseye

# ffmpeg + deno (para yt-dlp JS challenge)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg curl unzip && \
    curl -fsSL https://deno.land/install.sh | sh && \
    cp /root/.deno/bin/deno /usr/local/bin/deno && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .
# cookies.txt se inyecta via Fly secrets (COOKIES_TXT env) o COPY si existe local
COPY cookies.txt* ./

ENV PORT=8080
EXPOSE 8080

CMD ["python", "server.py"]
