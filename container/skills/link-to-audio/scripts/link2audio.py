#!/usr/bin/env python3
"""
Link-to-Audio: Extract article from URL, convert to TTS audio, send via IPC.

Usage:
  python3 link2audio.py --url "https://example.com/article" --chat-jid "jid" \
    --ipc-dir /workspace/ipc/messages --output-dir /workspace/group/audio

Options:
  --url URL             Article URL to convert
  --chat-jid JID        Chat JID for IPC delivery
  --ipc-dir DIR         IPC messages directory
  --output-dir DIR      Audio output directory
  --voice VOICE         TTS voice (default: shimmer)
  --backend BACKEND     TTS backend (default: openai)
  --tts-script PATH     Path to tts.py script
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time


# --- Background audio mixing constants ---

AMBIENT_AUDIO_DIR = "/ambient-audio"

BG_VOLUME_DEFAULTS = {
    "brown-noise":    0.10,
    "rain":           0.12,
    "river":          0.10,
    "ocean":          0.10,
    "forest-wind":    0.12,
    "airplane-cabin": 0.15,
}

BG_VOLUME_MIN = 0.05
BG_VOLUME_MAX = 0.25

# Shorthand aliases for background types
BG_TYPE_ALIASES = {
    "brown": "brown-noise",
    "noise": "brown-noise",
    "forest": "forest-wind",
    "wind": "forest-wind",
    "airplane": "airplane-cabin",
    "plane": "airplane-cabin",
    "cabin": "airplane-cabin",
    "sea": "ocean",
    "surf": "ocean",
    "stream": "river",
    "water": "river",
}

AMBIENT_FORMAT_PRIORITY = ("wav", "flac", "ogg", "mp3")

# Opus encoding for re-encode after mixing (higher than default to offset
# generational loss from decode+re-encode)
OPUS_BITRATE = "64k"


# --- Text chunking ---

def chunk_text(text, max_chars=3800):
    """Split text into chunks at sentence boundaries."""
    paragraphs = text.split("\n\n")
    sentences = []
    for para in paragraphs:
        para_sentences = re.split(r"(?<=[.!?])\s+", para.strip())
        sentences.extend(para_sentences)
        sentences.append("")  # paragraph break marker

    chunks = []
    current_chunk = ""

    for sentence in sentences:
        if sentence == "":
            current_chunk += "\n\n"
            continue

        # Single sentence exceeds limit — split at clause/word boundaries
        if len(sentence) > max_chars:
            if current_chunk.strip():
                chunks.append(current_chunk.strip())
                current_chunk = ""
            chunks.extend(_split_long_sentence(sentence, max_chars))
            continue

        if len(current_chunk) + len(sentence) + 1 > max_chars:
            chunks.append(current_chunk.strip())
            current_chunk = sentence
        else:
            current_chunk = f"{current_chunk} {sentence}" if current_chunk.strip() else sentence

    if current_chunk.strip():
        chunks.append(current_chunk.strip())

    return chunks


def _split_long_sentence(sentence, max_chars):
    """Split an oversized sentence at clause boundaries, then word boundaries."""
    clauses = re.split(r"(?<=[,;:])\s+", sentence)
    sub_chunks = []
    current = ""
    for clause in clauses:
        if len(clause) > max_chars:
            if current.strip():
                sub_chunks.append(current.strip())
                current = ""
            words = clause.split()
            for word in words:
                if len(current) + len(word) + 1 > max_chars:
                    sub_chunks.append(current.strip())
                    current = word
                else:
                    current = f"{current} {word}" if current else word
        elif len(current) + len(clause) + 1 > max_chars:
            sub_chunks.append(current.strip())
            current = clause
        else:
            current = f"{current} {clause}" if current else clause
    if current.strip():
        sub_chunks.append(current.strip())
    return sub_chunks


# --- TTS generation ---

def generate_chunk_audio(chunk_text, chunk_index, voice, backend, tts_script,
                         output_dir, job_id):
    """Generate audio for a single text chunk using tts.py."""
    output_path = os.path.join(output_dir, f"link2audio_{job_id}_chunk_{chunk_index}.opus")

    env = dict(os.environ)
    env["OPENAI_TTS_VOICE"] = voice

    result = subprocess.run(
        [
            "python3", tts_script,
            "--text", chunk_text,
            "--backend", backend,
            "--output", output_path,
        ],
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )

    if result.returncode != 0:
        raise RuntimeError(
            f"TTS failed for chunk {chunk_index}: {result.stderr.strip()}"
        )

    if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
        raise RuntimeError(f"TTS produced empty output for chunk {chunk_index}")

    return output_path


# --- Audio concatenation ---

def concatenate_audio(chunk_paths, output_path):
    """Concatenate audio chunks using ffmpeg stream copy."""
    if len(chunk_paths) == 1:
        os.rename(chunk_paths[0], output_path)
        return output_path

    filelist_path = output_path.replace(".opus", "_filelist.txt")
    with open(filelist_path, "w") as f:
        for path in chunk_paths:
            f.write(f"file '{path}'\n")

    result = subprocess.run(
        [
            "ffmpeg", "-y", "-f", "concat", "-safe", "0",
            "-i", filelist_path, "-c", "copy", output_path,
        ],
        capture_output=True,
        text=True,
        timeout=60,
    )

    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg concat failed: {result.stderr.strip()}")

    # Cleanup
    os.remove(filelist_path)
    for path in chunk_paths:
        if os.path.exists(path):
            os.remove(path)

    return output_path


# --- Background audio mixing ---

def _resolve_bg_volume(bg_type, explicit_volume):
    """Return clamped volume: explicit override > per-type default > 0.12."""
    if explicit_volume is not None:
        return max(BG_VOLUME_MIN, min(BG_VOLUME_MAX, explicit_volume))
    return BG_VOLUME_DEFAULTS.get(bg_type, 0.12)


def _resolve_ambient_path(bg_type):
    """Find the ambient file for bg_type in /ambient-audio/. Returns path or None."""
    for ext in AMBIENT_FORMAT_PRIORITY:
        candidate = os.path.join(AMBIENT_AUDIO_DIR, f"{bg_type}.{ext}")
        if os.path.isfile(candidate):
            return candidate
    return None


def _get_audio_duration(path):
    """Get duration in seconds via ffprobe."""
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", path],
        capture_output=True, text=True, timeout=15,
    )
    return float(result.stdout.strip())


def mix_background(speech_path, bg_type, bg_volume=None, work_dir=None):
    """
    Mix a background audio layer under the speech .opus file.

    Returns (path, fell_back) where fell_back is True if an ambient type
    was requested but brown noise was used instead. On failure, returns
    the original path (graceful degradation — unmixed audio > no audio).
    """
    # Resolve shorthand aliases (e.g. "brown" → "brown-noise")
    bg_type = BG_TYPE_ALIASES.get(bg_type, bg_type)

    if work_dir is None:
        work_dir = os.path.dirname(speech_path)

    vol = _resolve_bg_volume(bg_type, bg_volume)
    output_path = os.path.join(work_dir, "mixed_output.opus")
    fell_back = False

    # Get speech duration for noise generation and fade timing
    try:
        duration = _get_audio_duration(speech_path)
    except Exception as e:
        print(f"WARNING: Could not probe speech duration ({e}) — skipping background mix")
        return speech_path, False

    # Dynamic fade: min(3s, half the duration) to handle short clips
    fade_dur = min(3.0, duration / 2)
    fade_out_start = max(0, duration - fade_dur)

    # Determine background source
    use_brown_noise = False
    ambient_path = None

    if bg_type == "brown-noise":
        use_brown_noise = True
    else:
        ambient_path = _resolve_ambient_path(bg_type)
        if ambient_path is None:
            print(f"WARNING: Ambient file for '{bg_type}' not found in {AMBIENT_AUDIO_DIR} — falling back to brown noise")
            use_brown_noise = True
            fell_back = True

    # Build ffmpeg command
    if use_brown_noise:
        filter_complex = (
            f"anoisesrc=color=brown:duration={duration}:sample_rate=48000[noise];"
            f"[noise]volume={vol},"
            f"afade=t=in:st=0:d={fade_dur},"
            f"afade=t=out:st={fade_out_start}:d={fade_dur}[bg];"
            f"[0:a][bg]amix=inputs=2:duration=first:dropout_transition=0"
        )
        cmd = [
            "ffmpeg", "-y",
            "-i", speech_path,
            "-filter_complex", filter_complex,
            "-c:a", "libopus", "-b:a", OPUS_BITRATE, "-vbr", "on",
            output_path,
        ]
    else:
        filter_complex = (
            f"[1:a]atrim=0:{duration},asetpts=PTS-STARTPTS,"
            f"volume={vol},"
            f"afade=t=in:st=0:d={fade_dur},"
            f"afade=t=out:st={fade_out_start}:d={fade_dur}[bg];"
            f"[0:a][bg]amix=inputs=2:duration=first:dropout_transition=0"
        )
        cmd = [
            "ffmpeg", "-y",
            "-i", speech_path,
            "-stream_loop", "-1", "-i", ambient_path,
            "-filter_complex", filter_complex,
            "-c:a", "libopus", "-b:a", OPUS_BITRATE, "-vbr", "on",
            output_path,
        ]

    # Execute
    bg_label = "brown-noise" if use_brown_noise else bg_type
    print(f"Mixing background: {bg_label} at volume {vol:.2f} (fade {fade_dur:.1f}s)")

    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True,
            timeout=max(120, duration * 2),
        )
        if result.returncode != 0:
            print(f"WARNING: ffmpeg mixing failed (exit {result.returncode}): {result.stderr[-300:]}")
            return speech_path, False
    except subprocess.TimeoutExpired:
        print(f"WARNING: ffmpeg mixing timed out — delivering unmixed audio")
        return speech_path, False

    # Validate output
    if not os.path.isfile(output_path) or os.path.getsize(output_path) < 100:
        print("WARNING: Mixed output missing or empty — delivering unmixed audio")
        return speech_path, False

    # Replace original with mixed version
    final_path = speech_path.replace(".opus", "_bg.opus")
    shutil.move(output_path, final_path)

    size_kb = os.path.getsize(final_path) / 1024
    print(f"Background mix complete: {final_path} ({size_kb:.0f} KB)")

    return final_path, fell_back


# --- IPC delivery ---

def send_audio_ipc(audio_path, chat_jid, ipc_dir):
    """Send audio file via IPC message."""
    os.makedirs(ipc_dir, exist_ok=True)
    msg_file = os.path.join(ipc_dir, f"link2audio-{int(time.time() * 1e9)}.json")

    with open(msg_file, "w") as f:
        json.dump({
            "type": "audio",
            "chatJid": chat_jid,
            "filePath": audio_path,
        }, f)

    return msg_file


# --- Extraction ---

def extract_article(url, extract_script):
    """Extract article using extract.py. Returns parsed JSON result."""
    result = subprocess.run(
        ["python3", extract_script, "--url", url, "--json"],
        capture_output=True,
        text=True,
        timeout=30,
    )

    output = result.stdout.strip()
    if not output:
        if result.returncode != 0:
            return {"error": result.stderr.strip() or "extraction failed"}
        return {"error": "no output from extraction"}

    return json.loads(output)


# --- Main orchestrator ---

def main():
    parser = argparse.ArgumentParser(description="Link-to-Audio: URL to voice note")
    parser.add_argument("--url", required=True, help="Article URL")
    parser.add_argument("--chat-jid", required=True, help="Chat JID for delivery")
    parser.add_argument("--ipc-dir", default="/workspace/ipc/messages",
                        help="IPC messages directory")
    parser.add_argument("--output-dir", default="/workspace/group/audio",
                        help="Audio output directory")
    parser.add_argument("--voice", default="shimmer", help="TTS voice")
    parser.add_argument("--backend", default="openai", help="TTS backend")
    parser.add_argument("--tts-script",
                        default="/home/node/.claude/skills/speak/scripts/tts.py",
                        help="Path to tts.py")
    parser.add_argument("--extract-script", default=None,
                        help="Path to extract.py (default: same dir as this script)")
    parser.add_argument("--background", default=None, metavar="TYPE",
                        help="Background audio: brown-noise, rain, river, ocean, "
                             "forest-wind, airplane-cabin")
    parser.add_argument("--bg-volume", type=float, default=None, metavar="VOL",
                        help="Background volume 0.05-0.25 (default: per-type)")
    args = parser.parse_args()

    # Default extract script path: same directory as this script
    if args.extract_script is None:
        args.extract_script = os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "extract.py"
        )

    os.makedirs(args.output_dir, exist_ok=True)
    job_id = f"{int(time.time())}"

    # Step 1: Extract article
    print(f"Extracting article from: {args.url}")
    article = extract_article(args.url, args.extract_script)

    if "error" in article:
        error = article["error"]
        if article.get("is_paywalled"):
            print(json.dumps({"status": "error", "error": "paywalled",
                              "title": article.get("title"),
                              "message": "This article appears to be paywalled."}))
        elif "HTTP 403" in error or "HTTP 401" in error:
            print(json.dumps({"status": "error", "error": "blocked",
                              "message": "This page blocked access — may require login."}))
        elif "HTTP 404" in error:
            print(json.dumps({"status": "error", "error": "not_found",
                              "message": "Page not found (404)."}))
        elif "timed out" in error.lower() or "timeout" in error.lower():
            print(json.dumps({"status": "error", "error": "timeout",
                              "message": "Page took too long to load."}))
        else:
            print(json.dumps({"status": "error", "error": "extraction_failed",
                              "message": f"Couldn't extract readable content: {error}"}))
        sys.exit(1)

    title = article.get("title", "Unknown")
    text = article["text"]
    word_count = article["word_count"]
    char_count = article["char_count"]

    print(f"Extracted: \"{title}\" ({word_count:,} words, {char_count:,} chars)")

    # Step 2: Chunk text
    chunks = chunk_text(text)
    est_minutes = round(word_count / 150)  # ~150 wpm for TTS
    print(f"Chunked into {len(chunks)} segments, est. ~{est_minutes} min audio")

    # Step 3: Generate TTS audio for each chunk (sequential for Phase 1)
    chunk_paths = []
    for i, chunk in enumerate(chunks):
        print(f"Generating audio: chunk {i + 1}/{len(chunks)}...")
        retries = 3
        for attempt in range(retries):
            try:
                path = generate_chunk_audio(
                    chunk, i, args.voice, args.backend,
                    args.tts_script, args.output_dir, job_id,
                )
                chunk_paths.append(path)
                break
            except Exception as e:
                if attempt < retries - 1:
                    wait = 2 ** (attempt + 1)
                    print(f"  Retry {attempt + 1}/{retries}: {e}, waiting {wait}s...")
                    time.sleep(wait)
                else:
                    print(json.dumps({"status": "error", "error": "tts_failed",
                                      "message": f"TTS failed on chunk {i + 1}: {e}"}))
                    # Cleanup partial files
                    for p in chunk_paths:
                        if os.path.exists(p):
                            os.remove(p)
                    sys.exit(1)

    # Step 4: Concatenate audio
    output_path = os.path.join(args.output_dir, f"link2audio-{job_id}.opus")
    print("Concatenating audio...")
    concatenate_audio(chunk_paths, output_path)

    # Step 4b: Background audio mixing (optional)
    bg_fell_back = False
    if args.background:
        output_path, bg_fell_back = mix_background(
            speech_path=output_path,
            bg_type=args.background,
            bg_volume=args.bg_volume,
            work_dir=args.output_dir,
        )

    file_size = os.path.getsize(output_path)
    file_size_mb = file_size / (1024 * 1024)
    print(f"Audio ready: {output_path} ({file_size_mb:.1f} MB)")

    # Step 5: Send via IPC
    send_audio_ipc(output_path, args.chat_jid, args.ipc_dir)

    # Output success result
    result = {
        "status": "ok",
        "title": title,
        "word_count": word_count,
        "chunks": len(chunks),
        "est_minutes": est_minutes,
        "file_size_mb": round(file_size_mb, 1),
        "output_path": output_path,
        "voice": args.voice,
        "backend": args.backend,
    }
    if args.background:
        result["background"] = args.background
        result["bg_volume"] = _resolve_bg_volume(args.background, args.bg_volume)
        if bg_fell_back:
            result["bg_fallback"] = "brown-noise"
    print(json.dumps(result))


if __name__ == "__main__":
    main()
