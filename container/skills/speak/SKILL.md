---
name: speak
description: Convert text to audio and send as a voice note. Supports local Piper TTS (free), OpenAI TTS, and ElevenLabs (with The Dude voice). Use when the user asks to speak, say aloud, send audio, voice note, read aloud, or TTS. Also use when sending scheduled briefings or alerts that should be audio.
---

# /speak — Text-to-Speech Voice Notes

Send text as an audio voice note to the user. Three backends available:
- **local** — Piper TTS (free, runs on server, default)
- **openai** — OpenAI TTS via LiteLLM (natural, ~$0.003/message)
- **elevenlabs** — ElevenLabs with The Dude's voice + text Dude-ification (~$0.01/message)

## Usage

When the user asks you to speak something, read something aloud, or send audio:

### Step 1: Determine the text

- Direct text: the user says what to speak
- File reference: the user references a file — read it first
- Your own output: user asks you to speak your response

### Step 2: Determine the backend

Check in this order:
1. User explicitly specifies: "use openai", "use elevenlabs", "use local", "use dude voice"
2. Per-group default: read `/workspace/group/tts-config.json` if it exists
3. System default: `local`

If user says "set default voice to X", write `/workspace/group/tts-config.json`:
```json
{"default_backend": "openai"}
```

### Step 3: Dude-ify (ElevenLabs only)

When using ElevenLabs, run the text through the Dude-ification script first:
```bash
python3 /home/node/.claude/skills/speak/scripts/dudeify.py "the source text" > /tmp/dudeified.txt
```

This adds Dude expressions with decreasing intensity for longer texts. Read the output and use it as the TTS input.

### Step 4: Generate audio

```bash
python3 /home/node/.claude/skills/speak/scripts/tts.py \
  --text "the text to speak" \
  --backend <local|openai|elevenlabs> \
  --output /tmp/speak-output.opus
```

For file input:
```bash
python3 /home/node/.claude/skills/speak/scripts/tts.py \
  --file /path/to/file.txt \
  --backend <backend> \
  --output /tmp/speak-output.opus
```

Environment variables are already set: `$LITELLM_HOST`, `$LITELLM_API_KEY`, `$ELEVENLABS_API_KEY`, `$ELEVENLABS_VOICE_ID`.

### Step 5: Send via IPC

Write an IPC message to send the audio as a voice note:
```bash
CHAT_JID=$(cat /workspace/ipc/current_chat_jid 2>/dev/null || echo "$NANOCLAW_CHAT_JID")
cat > "/workspace/ipc/messages/speak-$(date +%s%N).json" << EOF
{
  "type": "audio",
  "chatJid": "$CHAT_JID",
  "filePath": "/tmp/speak-output.opus",
  "caption": "optional text caption"
}
EOF
```

**Important:** The `filePath` must be an absolute path accessible from the host. Since `/tmp` inside the container is not shared, use the group's writable directory instead:

```bash
OUTPUT_DIR="/workspace/group/audio"
mkdir -p "$OUTPUT_DIR"
OUTPUT_FILE="$OUTPUT_DIR/speak-$(date +%s%N).opus"

python3 /home/node/.claude/skills/speak/scripts/tts.py \
  --text "the text" \
  --backend local \
  --output "$OUTPUT_FILE"

cat > "/workspace/ipc/messages/speak-$(date +%s%N).json" << EOF
{
  "type": "audio",
  "chatJid": "$(cat /workspace/ipc/current_chat_jid 2>/dev/null || echo $NANOCLAW_CHAT_JID)",
  "filePath": "$OUTPUT_FILE"
}
EOF
```

### Step 6: Confirm

Tell the user the voice note was sent, which backend was used, and approximately how long the audio is.

## Error Handling

- If Piper is not installed, fall back to OpenAI
- If OpenAI fails, report the error and send the text as a regular message instead
- If ElevenLabs fails (no API key, no voice ID), fall back to OpenAI and note that Dude voice requires ElevenLabs setup
- Always send the text as a fallback message if all TTS backends fail

## Notes

- Maximum text length: ~4000 chars for OpenAI, ~5000 for ElevenLabs, unlimited for Piper (but keep reasonable)
- For very long texts (>2000 chars), consider summarizing before speaking
- The Dude-ification only runs for ElevenLabs — local and OpenAI get the original text
