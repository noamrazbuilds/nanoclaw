---
name: link-to-audio
description: Convert web articles to audio voice notes. When a user sends !listen or !read followed by a URL, extract the article content and convert it to a TTS voice note. Also triggers on natural language like "read this article" or "listen to this" with a URL.
---

# Link-to-Audio: URL → Voice Note

Convert web articles into audio voice notes. Extracts the main content (stripping ads, navigation, etc.), converts to speech, and sends back as a voice note.

## Triggers

Activate this skill when the message matches any of these patterns:

- `!listen <URL>` or `!read <URL>` — explicit command
- `!listen <URL> voice:nova` — with voice override
- `!listen <URL> use elevenlabs` — with backend override
- `!listen <URL> bg:rain` — with background audio
- `!listen <URL> bg:brown-noise vol:0.15` — with background + volume override

## Step 1: Parse the Request

Extract from the message:
- **URL**: the `https://...` link
- **Voice override**: look for `voice:<name>` (valid: alloy, echo, fable, onyx, nova, shimmer)
- **Backend override**: look for `use <backend>` or `backend:<name>` (valid: openai, elevenlabs, piper)
- **Background audio**: look for `bg:<type>` (valid: brown-noise, rain, river, ocean, forest-wind, airplane-cabin)
- **Background volume**: look for `vol:<number>` (range: 0.05–0.25)

Defaults: voice=`shimmer`, backend=`openai`, background=none (off).

## Step 2: Run the Pipeline

Use the orchestrator script. It handles extraction, chunking, TTS, concatenation, optional background mixing, and IPC delivery in one call.

```bash
CHAT_JID=$(cat /workspace/ipc/current_chat_jid 2>/dev/null || echo "$NANOCLAW_CHAT_JID")

python3 /home/node/.claude/skills/link-to-audio/scripts/link2audio.py \
  --url "THE_URL" \
  --chat-jid "$CHAT_JID" \
  --voice "shimmer" \
  --backend "openai"
```

With overrides:
```bash
python3 /home/node/.claude/skills/link-to-audio/scripts/link2audio.py \
  --url "THE_URL" \
  --chat-jid "$CHAT_JID" \
  --voice "nova" \
  --backend "elevenlabs"
```

With background audio:
```bash
python3 /home/node/.claude/skills/link-to-audio/scripts/link2audio.py \
  --url "THE_URL" \
  --chat-jid "$CHAT_JID" \
  --background "rain" \
  --bg-volume 0.12
```

The script prints progress to stdout and outputs a final JSON result line.

## Step 3: Report to User

Based on the script output:

**On success** (last line is JSON with `"status": "ok"`):
- Tell the user the voice note was sent
- Include: article title, word count, estimated duration, voice used
- If background was used, mention it. If `bg_fallback` is present, note that the requested ambient wasn't available and brown noise was used instead.

Example: *Sent voice note of "Article Title" (~2,500 words, ~17 min) using shimmer voice with rain background.*

**On error** (exit code 1, last line is JSON with `"status": "error"`):
- Report the error message from the JSON
- Common errors:
  - `paywalled`: "This article appears to be paywalled. I extracted what I could."
  - `blocked`: "This page blocked access — it may require login."
  - `not_found`: "Page not found (404). Check the URL?"
  - `timeout`: "The page took too long to load."
  - `extraction_failed`: "Couldn't extract readable content from this page."
  - `tts_failed`: "Audio generation failed. Try again?"

## Background Audio

Optionally mix a background audio layer under the speech to reduce listener fatigue.

### Available types

| Type | Source | Default Volume |
|---|---|---|
| `brown-noise` | Generated on-the-fly (always available) | 0.14 |
| `rain` | Ambient file | 0.12 |
| `river` | Ambient file | 0.10 |
| `ocean` | Ambient file | 0.10 |
| `forest-wind` | Ambient file | 0.12 |
| `airplane-cabin` | Ambient file | 0.15 |

- **Brown noise** is always available (synthetic).
- **Ambient files** are loaded from `/ambient-audio/` in the container (mounted from `~/.ambient-audio/` on host). If the requested ambient file isn't found, it falls back to brown noise with a warning.
- Volume range: 0.05 (barely perceptible) to 0.25 (clearly audible). Default varies by type.

### Adding ambient files

Place WAV/FLAC/OGG/MP3 files in `~/.ambient-audio/` on the host with the type as filename:
```
~/.ambient-audio/rain.wav
~/.ambient-audio/ocean.wav
```

Files are picked up automatically on next use — no restart needed.

## Notes

- Max article size for immediate generation: ~60,000 chars (~9,000 words). For longer articles, ask the user to confirm before generating.
- The audio is in OGG Opus format (native for WhatsApp and Telegram voice notes).
- Output files are saved in `/workspace/group/audio/` for IPC access.
- This skill reuses the TTS engine from the /speak skill — same backends and voices are available.
