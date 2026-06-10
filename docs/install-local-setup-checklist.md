# Install-Local Setup Checklist

**What this is:** the things that are NOT in the git repo and must be set up or
configured per-machine after a `git clone`. The codebase (trunk + the
`v2-migration` working branch) is the *registry/infra*; the actual secrets,
credentials, channel adapters, container image, host services, vendored MCP
servers, and per-group DB config live **outside version control** by design.

If you clone this fork onto a new box and only `pnpm install && pnpm build`, the
host process will start but be **deaf and toothless** — no channels, no agent
containers, no credentials. This checklist is everything else.

> Why these are correctly NOT committed: channels/providers are skill-installed
> from sibling branches (see CLAUDE.md "Channels and Providers"); secrets never
> belong in git; the container image is a build artifact; systemd units +
> firewall rules are machine state; vendored MCP servers are security-vetted
> copies; per-group config lives in the central DB. See also
> `migration-notes/cutover-runbook.md` for the one-time v1→v2 data migration.

---

## 1. Secrets — `.env` (repo root; gitignored)
Create `.env`. Keys this install uses (✱ = required for basic operation):

- ✱ `ASSISTANT_NAME` — the agent's name
- ✱ `CLAUDE_OAUTH_TOKEN` + `USE_OAUTH=true` — Claude Max auth (auto-refreshed by the OAuth daemon; needs `~/.claude/.credentials.json`)
- `ANTHROPIC_BASE_URL` — only if routing Claude through LiteLLM (enables the C1 credit→fallback path)
- `DEFAULT_MODEL`, `DEFAULT_FALLBACK_MODEL` — model + credit-exhaustion fallback
- `LITELLM_API_KEY`, `LITELLM_PROXY_URL` — LiteLLM gateway (used by Arena, generate_image, link-to-audio TTS, fallback)
- `OPENAI_API_KEY` — image/transcription/TTS fallbacks
- `TZ` — e.g. `Asia/Jerusalem` (drives scheduling + Arena cron)
- `WHISPER_MODEL` (e.g. `base`), optional `WHISPER_PYTHON` — host voice transcription
- `ONECLI_URL`, `ONECLI_API_KEY` — OneCLI gateway (if used)
- `OAUTH_PROXY_URL` — optional SOCKS5 for OAuth refresh (retired; empty is fine)
- **Channels:** `TELEGRAM_BOT_TOKEN` (+ `TELEGRAM_BOT_POOL` if used)
- **Arena (F1):** `ARENA_ENABLED=true` + `ARENA_BOT_TOKEN_{DEEPSEEK,KIMI,MINIMAX,QWEN,GEMMA,SONNET}`
- **GWS proxy:** `GWS_PROXY_TOKEN` (≥32 random chars), `GWS_BINARY_PATH` (abs path to the `gws` binary), `GWS_PROXY_PORT` (default 7850)
- Optional: `WATCHDOG_ALERT_CHAT_ID`, `LOG_LEVEL`, `INSTALL_CJK_FONTS`

Then sync for the container: `mkdir -p data/env && cp .env data/env/env`.

## 2. Channel adapters — skill-installed (NOT in trunk)
Run the `/add-<channel>` skills; each copies the adapter from the channels branch,
appends the barrel import in `src/channels/index.ts`, and installs pinned deps:
- **WhatsApp** (`/add-whatsapp`): `src/channels/whatsapp.ts`, `setup/whatsapp-auth.ts`, `setup/groups.ts`; deps `@whiskeysockets/baileys`, `qrcode`, `@types/qrcode`, `pino`. Source: `origin/channels`.
- **Telegram** (`/add-telegram`): `src/channels/telegram.ts` + `telegram-pairing.ts` + `telegram-markdown-sanitize.ts` (+tests), `setup/pair-telegram.ts`; dep `@chat-adapter/telegram@4.26.0`. **Source: `origin/channels`** (NOT the telegram fork — that's v1-lineage; see the add-telegram SKILL.md correction note).
- These add entries to `package.json`/`pnpm-lock.yaml` that show as "modified" — expected; they are install-local, don't assume they belong upstream.

## 3. WhatsApp auth keystore — `store/auth/` (gitignored)
Pair the device: `/add-whatsapp` QR/pairing flow, OR copy an existing
`store/auth/` (creds.json + sessions). Without it WhatsApp won't connect.
⚠ The adapter only wipes this on a real `loggedOut` (401), not on clean shutdown.

## 4. Container image — build artifact (NOT in registry)
`./container/build.sh` — builds `nanoclaw-agent-v2-<install-slug>:latest`. The
tag is install-slug-specific, so it's never pre-present after a clone. Rebuild
after any Dockerfile change (e.g. python3/ffmpeg/CJK fonts). The agent-runner
*source* is live-mounted, so source-only changes need NO rebuild — only
Dockerfile/dep changes do.

## 5. Google Workspace (gws) — host binary + OAuth + firewall
- Install the `gws` CLI on the host (it's a glibc-2.39 Rust binary; the container can't run it — that's why the host proxy exists).
- OAuth: `~/.config/gws/` (`client.json`, `credentials.json`). Re-consent with `scripts/gws-reauth.py` (fixed-port headless flow). **Use a downscoped scope set** — `drive.readonly` not full `auth/drive` (the agent must not be able to delete Drive files; two sheets were lost that way).
- `GWS_PROXY_TOKEN` + `GWS_BINARY_PATH` in `.env` (see §1).
- The proxy itself (`src/gws-proxy.ts`) + container MCP (`gws-mcp-stdio.ts`) + `google-workspace` skill ARE in trunk — but per-group wiring is DB config (§8).

## 6. Vendored MCP servers + assets (gitignored / vetted copies)
- **AnyList** (`vendor/anylist-mcp/`): rsync the security-vetted source (`npm ci` if needed). Creds via OneCLI vault or the mcp_server env block.
- **link-to-audio ambient media** (`~/.ambient-audio/`): host dir mounted to `/workspace/extra/ambient-audio` (rain.wav etc.; missing ambiences synthesize brown noise).
- **PKA** (`~/pka/`): separate project, mounted into owner groups.

## 7. Host services — systemd user units (machine-local, NOT in repo)
These live in `~/.config/systemd/user/` and must be (re)created + enabled:
- `nanoclaw.service` — the host process. `systemctl --user enable nanoclaw` (auto-start on boot).
- `nanoclaw-watchdog.{service,timer}` — runs `scripts/nanoclaw-health-check.sh` every 5 min, restarts nanoclaw if down + Telegram-alerts. (script IS in repo; units are not)
- `nanoclaw-sheet-backup.{service,timer}` — weekly `scripts/backup-sheets.ts` (script in repo; units not). Configure target sheets in `data/sheet-backups/sheets.json`.
- **Enable linger** so user services run at boot without login: `loginctl enable-linger nanoclaw`.

## 8. Firewall — UFW docker0 rules (machine state)
Container→host traffic on the Docker bridge needs explicit allows (host-mode
bind bypasses port-publishing). Per service used:
- `sudo ufw allow in on docker0 to any port 4000 proto tcp` — LiteLLM
- `sudo ufw allow in on docker0 to any port 10255 proto tcp` — OneCLI gateway
- `sudo ufw allow in on docker0 to any port 7850 proto tcp` — GWS proxy
- `sudo ufw allow in on docker0 to any port 7851 proto tcp` — reMarkable proxy
(Symptom of a missing rule: container `curl host.docker.internal:<port>` times out.)

## 9. Per-agent-group config — `container_configs` in `data/v2.db` (NOT in repo)
Set via `ncl groups config update` (or at migration). Per owner/group as needed:
- `mcp_servers` — e.g. `gws` (env: GWS_PROXY_URL/TOKEN/NANOCLAW_IS_MAIN), `anylist`
- `additional_mounts` — pka, `data/archive.db` (RO, message history+live), anylist vendor, ambient-audio
- `skills` — `all`, or an explicit list (link-to-audio, speak, google-workspace…)
- `packages_apt` / `packages_pip` — per-group container deps (then `ncl groups restart --rebuild`)
- `allow_model_delegation`, `cli_scope`

## 10. Data + external dependencies
- `data/v2.db` — central DB (created by migrations on first run, or populated by the v1→v2 migration; see cutover-runbook).
- `data/archive.db` — searchable message history (`scripts/build-message-archive.ts` to import; host archiver keeps it live).
- `data/whisper-models/` — faster-whisper model cache (auto-downloads on first transcription).
- **External, must be running:** Docker daemon; LiteLLM at `localhost:4000` (if used); Ollama local models (if Arena/local routing used); OneCLI gateway (if used).

## 11. Owner / roles — central DB (set post-migration, NOT in repo)
At least one `owner` in `user_roles` (e.g. via `/init-first-agent` or direct insert),
keyed `<channel>:<handle>`. Without an owner, admin commands + approval routing fail.

---

### Quick smoke after setup
1. `systemctl --user status nanoclaw` → active; logs show each channel "Channel adapter started" + "NanoClaw running".
2. Message the bot (DM / `@<name>` in a group) → a container spawns and replies.
3. `systemctl --user list-timers` → watchdog + backup timers scheduled.
4. If GWS used: `curl host.docker.internal:7850/health` from inside a container → `{"ok":true}`.
