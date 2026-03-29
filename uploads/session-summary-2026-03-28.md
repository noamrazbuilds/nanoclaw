# NanoClaw Session Summary — 2026-03-28

## What was built

### 1. Restic Backup Fix
Fixed `PATH` issue in `scripts/restic-backup.sh` — cron couldn't find `restic` at `~/.local/bin/`. Verified with a test run.

### 2. Overflow Containers
When the Dude is busy, new messages spawn a single-turn overflow container instead of waiting. Responds independently, no session conflicts.

### 3. Task Slots
Multiple independent, long-running agent sessions per group:
- `#research do X` — routes to slot "research" with its own session
- `#1 do Y` — routes to slot "1"
- `#slots` — lists active slots
- `#research close` — closes a slot
- Each slot has isolated session dir, IPC namespace, and lingers for follow-ups
- Responses prefixed with `[#slotname]` so you know which slot replied
- Capped at 5 per group (`MAX_SLOTS_PER_GROUP`)

### 4. Context7 MCP
Added to both Claude Code (`.mcp.json`) and container agents for fetching current library docs. Instructions added to CLAUDE.md files.

### 5. LiteLLM Proxy Integration
Multi-LLM routing:
- Config: `services/litellm/config.yaml` with Anthropic + OpenAI + placeholder for Gemini/Ollama
- Docker: `services/litellm/docker-compose.yml`
- Systemd: `~/.config/systemd/user/litellm.service`
- Routing: When `LITELLM_PROXY_URL` is set in `.env`, containers route through LiteLLM
- Model selection: `/model gpt-4o` or `/model gemini-2.0-flash` works in any message or slot
- No code changes in agent-runner — the Agent SDK reads `ANTHROPIC_BASE_URL` from environment

### To activate LiteLLM:
1. Copy `services/litellm/.env.example` to `services/litellm/.env`, fill in API keys
2. Add `LITELLM_PROXY_URL=http://localhost:4000` and `LITELLM_API_KEY=sk-your-key` to NanoClaw's `.env`
3. `systemctl --user enable --now litellm`
4. Restart NanoClaw

## Open Issue: API vs Max Subscription
NanoClaw currently uses API billing (not Max subscription). The Agent SDK doesn't support OAuth/Max — it requires an API key. Investigating workarounds.
