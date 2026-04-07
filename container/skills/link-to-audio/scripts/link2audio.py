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
import subprocess
import sys
import time


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

    file_size = os.path.getsize(output_path)
    file_size_mb = file_size / (1024 * 1024)
    print(f"Audio ready: {output_path} ({file_size_mb:.1f} MB)")

    # Step 5: Send via IPC
    send_audio_ipc(output_path, args.chat_jid, args.ipc_dir)

    # Output success result
    print(json.dumps({
        "status": "ok",
        "title": title,
        "word_count": word_count,
        "chunks": len(chunks),
        "est_minutes": est_minutes,
        "file_size_mb": round(file_size_mb, 1),
        "output_path": output_path,
        "voice": args.voice,
        "backend": args.backend,
    }))


if __name__ == "__main__":
    main()
