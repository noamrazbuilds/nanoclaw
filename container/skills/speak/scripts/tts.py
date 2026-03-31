#!/usr/bin/env python3
"""
Text-to-Speech script for NanoClaw /speak skill.
Supports: local (Piper), openai, elevenlabs backends.

Usage:
  python3 tts.py --text "Hello world" --backend local --output /tmp/out.opus
  python3 tts.py --file input.txt --backend openai --output /tmp/out.opus
  echo "Hello" | python3 tts.py --backend elevenlabs --output /tmp/out.opus
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
import urllib.request
import urllib.error


def tts_piper(text: str, output_path: str) -> None:
    """Generate speech using local Piper TTS."""
    # Check container path first, then host path
    default_piper = (
        "/opt/piper/piper"
        if os.path.exists("/opt/piper/piper")
        else "/usr/local/bin/piper"
    )
    piper_bin = os.environ.get("PIPER_BIN", default_piper)
    model = os.environ.get(
        "PIPER_MODEL", "/opt/piper/voices/en_US-lessac-medium.onnx"
    )

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as wav:
        wav_path = wav.name

    try:
        proc = subprocess.run(
            [piper_bin, "--model", model, "--output_file", wav_path],
            input=text.encode(),
            capture_output=True,
            timeout=120,
        )
        if proc.returncode != 0:
            print(f"Piper error: {proc.stderr.decode()}", file=sys.stderr)
            sys.exit(1)

        # Convert wav to opus
        subprocess.run(
            [
                "ffmpeg", "-y", "-i", wav_path,
                "-c:a", "libopus", "-b:a", "48k",
                "-application", "voip",
                output_path,
            ],
            capture_output=True,
            timeout=60,
        )
    finally:
        if os.path.exists(wav_path):
            os.unlink(wav_path)


def tts_openai(text: str, output_path: str) -> None:
    """Generate speech using OpenAI TTS via LiteLLM."""
    host = os.environ.get("LITELLM_HOST", "http://localhost:4000")
    key = os.environ.get("LITELLM_API_KEY", "")
    voice = os.environ.get("OPENAI_TTS_VOICE", "onyx")

    data = json.dumps({
        "model": "tts-1",
        "input": text[:4096],  # OpenAI limit
        "voice": voice,
        "response_format": "opus",
    }).encode()

    req = urllib.request.Request(
        f"{host}/v1/audio/speech",
        data=data,
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            with open(output_path, "wb") as f:
                f.write(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:500]
        print(f"OpenAI TTS error ({e.code}): {body}", file=sys.stderr)
        sys.exit(1)


def tts_elevenlabs(text: str, output_path: str) -> None:
    """Generate speech using ElevenLabs API."""
    key = os.environ.get("ELEVENLABS_API_KEY", "")
    voice_id = os.environ.get("ELEVENLABS_VOICE_ID", "")

    if not key or not voice_id:
        print(
            "ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID required",
            file=sys.stderr,
        )
        sys.exit(1)

    data = json.dumps({
        "text": text,
        "model_id": "eleven_multilingual_v2",
        "voice_settings": {
            "stability": 0.5,
            "similarity_boost": 0.75,
        },
    }).encode()

    req = urllib.request.Request(
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
        data=data,
        headers={
            "xi-api-key": key,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        },
    )

    try:
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as mp3:
            mp3_path = mp3.name

        with urllib.request.urlopen(req, timeout=120) as resp:
            with open(mp3_path, "wb") as f:
                f.write(resp.read())

        # Convert mp3 to opus
        subprocess.run(
            [
                "ffmpeg", "-y", "-i", mp3_path,
                "-c:a", "libopus", "-b:a", "48k",
                "-application", "voip",
                output_path,
            ],
            capture_output=True,
            timeout=60,
        )
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:500]
        print(f"ElevenLabs error ({e.code}): {body}", file=sys.stderr)
        sys.exit(1)
    finally:
        if os.path.exists(mp3_path):
            os.unlink(mp3_path)


BACKENDS = {
    "local": tts_piper,
    "openai": tts_openai,
    "elevenlabs": tts_elevenlabs,
}


def main():
    parser = argparse.ArgumentParser(description="TTS for NanoClaw")
    parser.add_argument("--text", help="Text to speak")
    parser.add_argument("--file", help="File to read and speak")
    parser.add_argument(
        "--backend",
        choices=["local", "openai", "elevenlabs"],
        default="local",
    )
    parser.add_argument("--output", required=True, help="Output .opus path")
    args = parser.parse_args()

    # Get text from args, file, or stdin
    if args.text:
        text = args.text
    elif args.file:
        with open(args.file) as f:
            text = f.read()
    elif not sys.stdin.isatty():
        text = sys.stdin.read()
    else:
        print("No text provided (use --text, --file, or pipe stdin)", file=sys.stderr)
        sys.exit(1)

    text = text.strip()
    if not text:
        print("Empty text", file=sys.stderr)
        sys.exit(1)

    BACKENDS[args.backend](text, args.output)
    print(f"OK: {args.output}", file=sys.stdout)


if __name__ == "__main__":
    main()
