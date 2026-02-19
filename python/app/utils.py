def segments_to_timeline_clips(segments):
    """
    Convert Whisper transcription segments into timeline subtitle clip format.

    Input:  [{ "start": 1.2, "end": 3.7, "text": "Hello world" }, …]
    Output: [{ "start": 1.2, "duration": 2.5, "subtitleText": "Hello world" }, …]
    """
    clips = []
    for seg in segments:
        start = seg.get("start", 0)
        end = seg.get("end", start)
        duration = round(end - start, 3)

        if duration <= 0:
            continue

        text = seg.get("text", "").strip()
        if not text:
            continue

        clips.append({
            "start": round(start, 3),
            "duration": duration,
            "subtitleText": text,
        })

    return clips
