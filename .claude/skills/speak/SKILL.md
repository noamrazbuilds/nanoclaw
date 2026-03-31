---
name: speak
description: Convert text to audio using TTS. Supports local Piper (free), OpenAI TTS, and ElevenLabs (with The Dude voice). Use when the user asks to speak, say aloud, send audio, voice note, read aloud, or TTS.
---

# /speak — Text-to-Speech

Generate audio from text using one of three backends:
- **local** — Piper TTS (free, default)
- **openai** — OpenAI TTS via LiteLLM
- **elevenlabs** — ElevenLabs with Dude voice + Dude-ification

## Usage

1. Determine backend: user specifies, or default is `local`
2. If ElevenLabs, Dude-ify the text first:
   ```bash
   python3 container/skills/speak/scripts/dudeify.py "the text"
   ```
3. Generate audio:
   ```bash
   python3 container/skills/speak/scripts/tts.py \
     --text "text to speak" \
     --backend <local|openai|elevenlabs> \
     --output uploads/speak-output.opus
   ```
4. Tell the user where the audio file is saved

The scripts are in `container/skills/speak/scripts/` (shared with the container skill).

Environment variables needed: `LITELLM_API_KEY` in `.env`, plus `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` for ElevenLabs.
