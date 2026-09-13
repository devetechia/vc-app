from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from youtube_transcript_api import YouTubeTranscriptApi
import requests
import json
import os

app = Flask(__name__, static_folder='.', static_url_path='')
CORS(app)

GROK_API_KEY = '«redacted:sk-…»'
GROK_API_URL = 'https://openrouter.ai/api/v1/chat/completions'

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

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

    prompt = (
        "Eres un experto en estudios bíblicos. Analiza la siguiente predicación cristiana y proporciona:\n\n"
        "1. RESUMEN: Un resumen claro y conciso (3-4 párrafos)\n\n"
        "2. MENSAJE PRINCIPAL: El mensaje central más importante\n\n"
        "3. VERSÍCULOS MENCIONADOS: Lista cada versículo con:\n"
        "   - Referencia completa (Libro Capítulo:Versículo)\n"
        "   - El texto del versículo\n"
        "   - Por qué se mencionó en la predicación\n\n"
        "4. CONTEXTO Y EXPLICACIÓN: Contexto histórico y espiritual\n\n"
        "5. PARA PROFUNDIZAR: Temas para estudio personal\n\n"
        f"Título: {title}\n\n"
        f"Transcripción:\n{transcript or 'No disponible. Analiza solo por el título: ' + title}\n\n"
        "Responde en español con secciones claras usando markdown."
    )

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

@app.route('/<path:path>')
def static_files(path):
    return send_from_directory('.', path)

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)