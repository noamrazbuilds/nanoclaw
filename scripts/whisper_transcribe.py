#!/usr/bin/env python3
"""
Local voice transcription using faster-whisper.
Reads audio from a file path (first argument), outputs transcript to stdout.
Falls back gracefully on errors — caller handles OpenAI fallback.

Usage: python3 whisper_transcribe.py <audio_file_path>
Output: plain text transcript on stdout, nothing on stderr unless error
Exit code: 0 on success, 1 on failure
"""

import sys
import os

def main():
    if len(sys.argv) < 2:
        print("Usage: whisper_transcribe.py <audio_file>", file=sys.stderr)
        sys.exit(1)

    audio_path = sys.argv[1]
    if not os.path.exists(audio_path):
        print(f"File not found: {audio_path}", file=sys.stderr)
        sys.exit(1)

    model_name = os.environ.get("WHISPER_MODEL", "base")

    try:
        from faster_whisper import WhisperModel

        # Download model to a stable cache dir on first run
        cache_dir = os.path.join(os.path.dirname(__file__), "..", "data", "whisper-models")
        os.makedirs(cache_dir, exist_ok=True)

        model = WhisperModel(
            model_name,
            device="cpu",
            compute_type="int8",
            download_root=cache_dir,
        )

        segments, info = model.transcribe(audio_path, beam_size=5)
        transcript = " ".join(seg.text.strip() for seg in segments).strip()

        if transcript:
            print(transcript)
            sys.exit(0)
        else:
            print("(empty transcript)", file=sys.stderr)
            sys.exit(1)

    except Exception as e:
        print(f"faster-whisper error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
