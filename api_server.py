from flask import Flask, request, jsonify, send_file
import os
import json
import io
import song_manager
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

@app.route("/test", methods=["POST"])
def test():
    return "ok"

song_history = []

@app.route("/create_song", methods=["POST"])
def create_song():
    data = request.get_json()
    if not all(k in data for k in ("samples", "SynthConfigs", "Tracks")):
        return jsonify({"error": "Missing song fields"}), 400
    song = song_manager.load_song(data=data)
    song_history.append(song)
    return jsonify({"status": "ok"})

@app.route("/save_song", methods=["POST"])
def save_song():
    save_path = request
    current_song = song_history[-1]
    song_manager.save_song(current_song, save_path)
    return jsonify({"status": "ok"})

@app.route("/revert_song", methods=["GET"])
def revert_song():
    if len(song_history) > 1:
        song_history.pop()
    song = song_history[-1]
    song_data = song.save_song()
    return jsonify(song_data)

@app.route("/play_song", methods=["POST"])
def play_song():
    if not song_history:
        return jsonify({"error": "No song loaded"}), 400
    song = song_history[-1]
    wav_bytes = song.render_wav()
    return send_file(
        io.BytesIO(wav_bytes),
        mimetype="audio/wav",
        as_attachment=False,
        download_name="song.wav"
    )

@app.route("/llm_edit_song", methods=["POST"])
def llm_edit_song():
    prompt = request.get_json().get("prompt", "")
    if not song_history:
        return jsonify({"error": "No song loaded"}), 400
    song = song_history[-1]
    song_data = song.save_song()
    new_song = song_manager.llm_edit_song(song_data, prompt)
    song_history.append(new_song)
    new_song_data = new_song.save_song()
    return jsonify(new_song_data)

if __name__ == "__main__":
    app.run(port=5050, debug=True)