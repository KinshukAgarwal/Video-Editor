import whisper

_model = None
MODEL_NAME = "medium"


def get_model():
    global _model
    if _model is None:
        print(f"[whisper] Loading '{MODEL_NAME}' model (first run downloads ~460 MB)…")
        _model = whisper.load_model(MODEL_NAME)
        print("[whisper] Model loaded.")
    return _model


def transcribe(audio_path, language=None):
    model = get_model()

    options = {
        "verbose": False,
        "condition_on_previous_text": True,
        "no_speech_threshold": 0.4,
        "compression_ratio_threshold": 3.0,
        "logprob_threshold": -1.5,
        "word_timestamps": True,
    }
    if language:
        options["language"] = language

    result = model.transcribe(audio_path, **options)

    segments = []
    for seg in result.get("segments", []):
        text = seg.get("text", "").strip()
        if not text:
            continue
        segments.append({
            "start": round(seg["start"], 3),
            "end": round(seg["end"], 3),
            "text": text,
        })

    return segments
