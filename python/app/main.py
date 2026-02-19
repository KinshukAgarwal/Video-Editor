import os
import tempfile
import traceback

from flask import Flask, request, jsonify
from flask_cors import CORS

from whisper_service import transcribe
from utils import segments_to_timeline_clips

app = Flask(__name__)
CORS(app)


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


@app.route("/transcribe", methods=["POST"])
def handle_transcribe():
    if "file" not in request.files:
        return jsonify({"error": "No file provided. Send a file with key 'file'."}), 400

    uploaded = request.files["file"]
    if not uploaded.filename:
        return jsonify({"error": "Empty filename."}), 400

    # Save to a temp file so Whisper can read it
    suffix = os.path.splitext(uploaded.filename)[1] or ".mp4"
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    try:
        uploaded.save(tmp.name)
        tmp.close()

        language = request.form.get("language", None) or None

        print(f"[transcribe] Processing: {uploaded.filename} ({suffix})")
        segments = transcribe(tmp.name, language=language)
        clips = segments_to_timeline_clips(segments)
        print(f"[transcribe] Done — {len(clips)} subtitle clip(s) generated.")

        return jsonify({"clips": clips, "segmentCount": len(clips)})
    except Exception as exc:
        traceback.print_exc()
        return jsonify({"error": f"Transcription failed: {str(exc)}"}), 500
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass


if __name__ == "__main__":
    port = int(os.environ.get("PYTHON_SERVICE_PORT", 5001))
    print(f"[whisper-service] Starting on port {port}")
    app.run(host="0.0.0.0", port=port, debug=False)
