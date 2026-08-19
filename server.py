from flask import Flask, request, jsonify
from flask_cors import CORS
from youtube_transcript_api import YouTubeTranscriptApi
import requests
import json

app = Flask(__name__)
CORS(app)

GROK_API_KEY = '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'
GROK_API_URL = 'https://openrouter.ai/api/v1/chat/completions'

@app.route('/api/transcript')
def get_transcript():
    video_id = request.args.get('videoId')
    if not video_id:
        return jsonify({'error': 'videoId required'}), 400
    try:
        ytt_api = YouTubeTranscriptApi()
        transcript = ytt_api.fetch(video_id, languages=['es', 'en'])
        text = ' '.join([entry.text for entry in transcript.snippets])
        return jsonify({'transcript': text})
    except Exception as e:
        return jsonify({'transcript': None, 'error': str(e)})

@app.route('/api/study', methods=['POST'])
def bible_study():
    data = request.json
    transcript = data.get('transcript', '')
    title = data.get('title', '')

    prompt = f"""Eres un experto en estudios bíblicos. Analiza la siguiente predicación cristiana y proporciona:

1. RESUMEN: Un resumen claro y conciso (3-4 párrafos)

2. MENSAJE PRINCIPAL: El mensaje central más importante

3. VERSÍCULOS MENCIONADOS: Lista cada versículo con:
   - Referencia completa (Libro Capítulo:Versículo)
   - El texto del versículo
   - Por qué se mencionó en la predicación

4. CONTEXTO Y EXPLICACIÓN: Contexto histórico y espiritual

5. PARA PROFUNDIZAR: Temas para estudio personal

Título: {title}

Transcripción:
{transcript or 'No disponible. Analiza solo por el título: ' + title}

Responde en español con secciones claras usando markdown."""

    try:
        response = requests.post(
            GROK_API_URL,
            headers={
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {GROK_API_KEY}'
            },
            json={
                'model': 'poolside/laguna-s-2.1:free',
                'messages': [{'role': 'user', 'content': prompt}],
                'temperature': 0.7,
                'max_tokens': 4096
            },
            timeout=60
        )
        result = response.json()
        if 'choices' in result and result['choices']:
            return jsonify({'result': result['choices'][0]['message']['content']})
        return jsonify({'error': 'API error', 'details': result}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(port=5000, debug=False)
