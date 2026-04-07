---
name: add-link-to-audio
description: Add link-to-audio capability to NanoClaw. Converts web articles to TTS voice notes — send a URL via WhatsApp or Telegram and get back an audio recording of the article. Uses OpenAI TTS (shimmer voice) by default.
---

# Add Link-to-Audio

This skill adds article-to-audio conversion. Users send `!listen <URL>` and get back a voice note of the article content.

## Phase 1: Pre-flight

### Check if already applied

Check if `container/skills/link-to-audio/SKILL.md` exists. If it does, skip to Phase 3 (Verify).

## Phase 2: Apply

The code is already on `main` — no branch merge needed. The container skill files, extraction script, and orchestrator script are all in place.

### Rebuild the container

The container image needs `trafilatura` (Python article extraction library). Rebuild:

```bash
./container/build.sh
```

If the build fails due to cache, prune and retry:
```bash
docker builder prune -f && ./container/build.sh
```

### Restart NanoClaw

```bash
# Linux (systemd)
systemctl --user restart nanoclaw

# macOS (launchd)
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

## Phase 3: Verify

### Test extraction

Test that the extraction script works inside the container:

```bash
docker run --rm --entrypoint bash nanoclaw-agent -c \
  "python3 /home/node/.claude/skills/link-to-audio/scripts/extract.py \
    --url 'https://en.wikipedia.org/wiki/Koi' --json"
```

Should return JSON with title, text, and word_count.

### Test end-to-end

Send `!listen https://en.wikipedia.org/wiki/Koi` in a registered chat. The agent should:
1. Extract the article
2. Generate audio chunks
3. Send back a voice note

### Check logs if needed

```bash
tail -f logs/nanoclaw.log | grep -i "audio\|link2audio\|extract"
```

## Troubleshooting

### "trafilatura not found" in container

The container image needs rebuilding. Run `./container/build.sh`.

### TTS fails with "empty response"

Check that LiteLLM is running and the OpenAI TTS model is configured:
```bash
curl -s http://localhost:4000/v1/models -H "Authorization: Bearer $(grep LITELLM_API_KEY .env | cut -d= -f2)" | python3 -c "import sys,json; [print(m['id']) for m in json.load(sys.stdin)['data'] if 'tts' in m['id'].lower()]"
```

### Audio not delivered

Check IPC audio handling in logs. The audio file must be in `/workspace/group/audio/` (host-accessible path), not `/tmp`.

## Usage

Once installed, users can send in any registered chat:
- `!listen https://example.com/article` — convert article to voice note
- `!read https://example.com/article` — alias
- `!listen https://example.com/article voice:nova` — use different voice
- `!listen https://example.com/article use elevenlabs` — use different TTS backend
