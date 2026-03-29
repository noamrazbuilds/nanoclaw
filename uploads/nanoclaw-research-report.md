# NanoClaw, OpenClaw, and Claude Code: A Comprehensive Research Report

**Prepared for:** Claude Code power user evaluating AI assistant frameworks
**Date:** 2026-03-29

---

## Executive Summary

This report answers four key questions for a user who tried OpenClaw (didn't like it), is now using NanoClaw (likes it better), and is exploring multi-agent systems, LiteLLM integration, and building a Knowledge & Productivity Assistant (KPA) to replace Obsidian. The headline finding: **Claude Code's native Auto Dream capability** -- based on Anthropic's Sleep-time Compute research and rolling out March 2026 -- fundamentally changes the calculus for the ideal path forward.

The recommended approach is a **phased hybrid (Option 2+3)**: use Claude Code as an immediate KPA (Phase 1, zero additional cost), then build a custom system on Claude Agent SDK + LiteLLM using NanoClaw's container patterns (Phase 2), reducing monthly costs from $125-375 to $30-65 through intelligent model routing.

---

## (a) What Exactly Does NanoClaw Add Over Just Using Claude Code?

NanoClaw (~3,900 LOC TypeScript, ~500 lines core logic, 35K tokens -- readable in ~8 minutes) is a lightweight, security-focused orchestration layer created by Gavriel Cohen (Qwibit.ai) in February 2026. It extends Claude Code in several specific areas:

### Always-On Daemon Architecture

NanoClaw runs as a **persistent daemon/service** -- its Body component operates 24/7, continuously polling for incoming messages across all connected channels. This is a genuine architectural differentiator: Claude Code is session-based (even cloud tasks have 1-hour minimum intervals and run discrete jobs), while NanoClaw is designed to be an always-listening, always-available assistant. For use cases requiring instant message response across WhatsApp, Telegram, etc., this persistent daemon model is essential.

### Container-Based Isolation

NanoClaw's primary differentiator. Three container runtimes:

- **Apple Container** (macOS): Uses Apple's native sandbox framework. Each container maps 1:1 to a lightweight VM under OS-level sandbox policies. Originally the default runtime at launch.
- **Docker**: Standard Docker containers on Linux/macOS/Windows (WSL2).
- **Docker Sandboxes** (newest, Docker partnership): Two-layer isolation -- each agent runs inside a micro-VM with its own kernel. Full architecture: `Host -> Docker Sandbox (micro VM) -> NanoClaw Node.js -> nested Docker daemon -> agent containers -> Claude Agent SDK`. A **MITM proxy** at `host.docker.internal:3128` intercepts all outbound traffic and injects the Anthropic API key, so agents never hold raw credentials.

Even if an agent gains root inside the container, it cannot reach the host filesystem. Only explicitly mounted directories are accessible. This is OS-enforced, not instruction-based.

**Claude Code** offers worktree isolation (filesystem-level via git worktrees), which is lighter but weaker -- no process isolation, no network interception.

### Multi-Channel Messaging

NanoClaw connects Claude to messaging platforms via a self-registering factory pattern (`src/channels/registry.ts`). Each channel implements `connect()`, `sendMessage()`, `isConnected()`, `ownsJid()`. Missing credentials cause graceful skip.

| Channel | Implementation |
|---|---|
| WhatsApp | Baileys library (unofficial WhatsApp Web API); QR/pairing code auth |
| Telegram | Native skill |
| Telegram Swarm | Agent teams with individual bot identities |
| Discord | Text channels with attachments and reply context |
| Slack | Socket Mode (no public URL required) |
| Gmail | Read, send, search, draft emails |
| Signal | Mentioned in third-party sources; NOT on official skills page -- unconfirmed |

Claude Code has **no native messaging integrations** -- it operates as a CLI, desktop app, web app, and IDE extension.

### Agent Swarms (with caveats)

NanoClaw claims to be the first personal AI assistant to support Claude's Agent Swarms. Architecture: Body (24/7 message receiver) + Brain (reasoning) + Orchestrator (multi-agent coordination). Each sub-agent runs in its own container with its own CLAUDE.md memory.

**Caveat:** The SPEC.md describes **sequential container execution with global concurrency limits (default: 5)**, not a dedicated parallel orchestration system. The "swarms" framing likely describes the concurrency model plus the skills layer. Claude Code's **Agent Teams** (experimental, v2.1.32+) offer true mesh communication, shared task lists, file locking, and plan approval gates -- a more structured multi-agent model.

### Credential Management

**OneCLI Agent Vault** (March 2026): API keys are injected at request time via the vault -- agents never hold raw credentials. In Docker Sandboxes, the MITM proxy handles credential injection at the network level. Claude Code relies on environment variables and MCP server configurations.

### Scheduled Task Execution

NanoClaw's `task-scheduler.ts` polls SQLite every 60 seconds for cron-style recurring tasks (confirmed active via GitHub issue #839).

Claude Code offers **4-tier scheduling** that surpasses this:

| Tier | Where | Requires Machine On | Persistent | Min Interval |
|---|---|---|---|---|
| Cloud tasks | Anthropic infrastructure | No | Yes | 1 hour |
| Desktop tasks | Local machine | Yes | Yes | 1 minute |
| `/loop` | Current CLI session | Yes | No | 1 minute |
| GitHub Actions | CI pipeline | No | Yes | Cron trigger |

Cloud tasks are the "always-on" answer -- they run on Anthropic-managed infrastructure, survive machine restarts, and execute fully autonomously.

### What NanoClaw Does NOT Add

- **No multi-LLM support.** Tightly coupled to Anthropic's Agent SDK. GitHub issues #70 (LiteLLM) closed as duplicate of #80 (multi-provider), which remains open with no timeline. The `ANTHROPIC_BASE_URL` env var allows Anthropic-compatible endpoints (Ollama, Together AI), but this is not true multi-LLM routing. Adding genuine multi-LLM would require replacing the core agent loop -- effectively a rewrite.
- **No dreaming/memory consolidation.** No equivalent to Claude Code's Auto Dream.
- **No plugin ecosystem.** Claude Code has 72+ official plugins, 10K+ MCP servers, and 150+ skills. NanoClaw has 4 skill types (Feature/Utility/Operational/Container) but no community marketplace.
- **No semantic memory search.** SQLite + JSONL + CLAUDE.md only. No vector embeddings, no BM25. MemOS (issue #1130) proposed but not merged.

### Bottom Line

NanoClaw adds **always-on daemon architecture, container isolation, multi-channel messaging, and credential vaulting** over bare Claude Code. For everything else -- scheduling, multi-agent coordination, plugins, memory, dreaming -- Claude Code now matches or exceeds NanoClaw natively. NanoClaw's real value to a power user is as an architectural reference (container patterns, channel adapters, daemon model), not as a long-term platform.

---

## (b) Backend/System Capabilities Missing in NanoClaw That Existed in OpenClaw

Setting aside the frontend dashboard, here are the **backend and system-level capabilities** present in OpenClaw (~430K LOC, 247K+ GitHub stars, 70+ dependencies) but absent in NanoClaw:

### 1. Heartbeat System

**OpenClaw** has a configurable heartbeat cycle defined in `HEARTBEAT.md`. On each tick, the gateway sends the agent a prompt to read HEARTBEAT.md and act on it. If the agent replies `HEARTBEAT_OK` (under 300 chars), the message is suppressed -- no user notification.

Configuration options:
- `every`: Interval (default 30 min; 60 min when using Anthropic OAuth)
- `activeHours`: Start/end times + timezone
- `lightContext`: Load only HEARTBEAT.md (token savings)
- `isolatedSession`: Fresh session per run (drastic token savings)
- Per-agent override via `agents.list[].heartbeat`
- Known bugs: Issue #14986 (per-agent intervals ignored), Issues #9084/#9184 (timer stops after macOS sleep/wake)

**NanoClaw** has no HEARTBEAT.md. Its `task-scheduler.ts` runs predefined cron jobs -- reactive, not proactive.

### 2. Soul/Identity System

**OpenClaw** provides a composable identity ecosystem:
- `SOUL.md` -- Core personality, values, worldview (recommended 500-1500 words). Injected into every LLM call's system prompt.
- `IDENTITY.md` -- Professional persona / role context
- `STYLE.md` -- Voice, syntax, writing patterns
- `SKILL.md` -- Operating modes (tweet-mode, essay-mode, chat-mode)
- `MEMORY.md` -- Curated durable facts for continuity

All plain Markdown, versionable, diffable. The SoulSpec open standard (soulspec.org) is implemented by OpenClaw.

**NanoClaw** uses a 3-tier CLAUDE.md hierarchy (global/channel/group). Functional but no separation between identity, style, and skills. Default assistant name: "Andy" (configurable via `ASSISTANT_NAME`).

### 3. Advanced Memory Architecture

**OpenClaw** core has 2-tier memory:
1. **Daily logs** (`memory/YYYY-MM-DD.md`) -- append-only, today's + yesterday's load at session start
2. **Long-term MEMORY.md** -- curated durable facts, loads only in private sessions

Plus **semantic search** (core feature):
- `memory_search` tool: hybrid BM25 keyword + vector-based semantic matching
- Embedding providers: OpenAI, Gemini, Voyage, Mistral, Ollama, local GGUF models
- SHA-256 deduplication per chunk
- Automatic memory flushing before context compaction (writes durable info to disk before truncation)
- Optional QMD sidecar: MMR diversity re-ranking, temporal decay

Fork-level extensions demonstrate what's architecturally possible: **SoulClaw** (fork of OpenClaw v2026.3.1) implements 4-tier memory (Soul/Core/Temporal/Ephemeral) with progressive disclosure, vector search via Ollama bge-m3 (100+ languages), persona drift detection with automatic prompt reinforcement, and native swarm memory sync. It achieves ~62% fewer tokens per turn than OpenClaw's flat-load approach. While niche (1 GitHub star), SoulClaw's architecture informs what a well-designed custom build could achieve.

**NanoClaw** stores memory in SQLite + JSONL transcripts + CLAUDE.md. No semantic search, no deduplication, no flush-before-compact.

### 4. Massive Skill/Integration Ecosystem

**OpenClaw**: 13,729+ ClawHub skills with vector search discovery, semver versioning, CLI management (`clawhub install/update/publish`). The OpenClaw Foundry auto-generates new tools when usage patterns crystallize (5+ uses, 70%+ success rate).

**Caveat:** 12% of ClawHub skills were found to contain malicious code; 50K+ vulnerable instances reported. Moderation auto-hides skills with 3+ reports, but the attack surface is real.

**NanoClaw**: 4 skill types, no marketplace, no vector discovery.

### 5. Workflow Engine

**OpenClaw's Lobster Workflow Engine**: Deterministic YAML-based pipelines where code handles sequencing/routing, not LLMs. Features: explicit approval gates, resumable state, retry logic with fallback paths. Each skill becomes a composable pipeline building block.

**NanoClaw**: No workflow engine.

### 6. Multi-LLM / Multi-Provider Support

**OpenClaw** natively supports 14+ AI providers: Anthropic, OpenAI, Google (Gemini), MiniMax, xAI (Grok), OpenRouter, Mistral, DeepSeek, GLM, Perplexity, Hugging Face, Ollama, LM Studio, Vercel AI Gateway. Plus 100+ via LiteLLM proxy (official integration docs at docs.litellm.ai). Different agents can use different LLMs simultaneously.

**NanoClaw** is Claude-only.

### 7. Execution Security Tiers

**OpenClaw's** exec tool has 3 security tiers:
1. **Deny** -- blocks all execution
2. **Allowlist** -- only allowlisted binaries; chaining/redirections rejected
3. **Full** -- unrestricted (requires explicit approval)

Plus: foreground/background modes, PTY support, sandboxing, PATH override rejection.

**NanoClaw** relies on container-level isolation rather than tiered execution policies.

### 8. Integrations Breadth

**OpenClaw** supports 22+ messaging platforms (WhatsApp, Telegram, Discord, Slack, Signal, iMessage, Teams, Matrix, IRC, LINE, WeChat, Google Chat, and more), plus productivity (Notion, Obsidian, GitHub, Trello), smart home (Philips Hue, Home Assistant), music (Spotify, Sonos), and 500+ apps via Composio.

**NanoClaw** supports 5-6 channels.

### 9. Continuous Learning (Community-Driven)

**OpenClaw** has community-driven learning via ClawHub skills:
- `self-improvement` skill: Captures learnings, errors, corrections in `.learnings/` directory
- `self-improving-agent`: AI self-evolution engine
- **OpenClaw Foundry**: Meta-extension that monitors usage and auto-generates tools

**Important:** This is NOT a core automated engine feature -- it requires installing community skills.

**NanoClaw** has no equivalent.

### Summary Table: Backend Capabilities

| Capability | OpenClaw | NanoClaw | Gap Severity |
|---|---|---|---|
| Heartbeat / autonomous cycles | HEARTBEAT.md (30-min, configurable) | task-scheduler.ts (60s cron) | Medium |
| Soul / identity system | SOUL.md + 4 companion files | 3-tier CLAUDE.md | Low-Medium |
| Semantic memory search | BM25 + vector hybrid, SHA-256 dedup | SQLite + JSONL | High |
| Skill marketplace | 13,729+ ClawHub (vector search) | 4 skill types | High |
| Workflow engine | Lobster (deterministic YAML pipelines) | None | High |
| Multi-LLM support | 14+ native + LiteLLM (100+) | Claude-only | High |
| Exec security tiers | 3 tiers + sandboxing | Container isolation | Low |
| Integrations | 22+ messaging, 500+ via Composio | 5-6 channels | High |
| Continuous learning | Community-driven (ClawHub) | None | Medium |

---

## (c) System Features Deep Dive

### Heartbeat

**OpenClaw:** Core autonomous loop via `HEARTBEAT.md`. Default 30-minute cycle. On each tick, the agent reads the heartbeat file and acts on it. Replies under 300 chars (`ackMaxChars`) with `HEARTBEAT_OK` are silently suppressed. Configurable: `activeHours` (schedule window), `lightContext` (token savings), `isolatedSession` (fresh context per run), per-agent overrides. Known bugs: per-agent intervals may be ignored (#14986); timer stops after macOS sleep (#9084).

**NanoClaw:** No heartbeat. The `task-scheduler.ts` polls SQLite every 60 seconds for cron-style jobs. Reactive (runs predefined tasks on schedule) rather than proactive (autonomous self-initiated behavior).

**Claude Code:** No native heartbeat label, but the 4-tier scheduling system can approximate it. Cloud tasks (always-on, survive machine off, 1-hour minimum interval) are the closest equivalent. Desktop tasks offer 1-minute intervals. `/loop` provides session-scoped polling. Combined with hooks (26 events), this system is more flexible than a single heartbeat file, though it lacks the elegant simplicity of HEARTBEAT.md's "read file, act on it" model.

### Continuous Learning

**OpenClaw:** Community-driven, not core. The `self-improvement` ClawHub skill captures learnings in structured markdown (ID, timestamp, priority, area tags, summary, context, suggested fix). The OpenClaw Foundry auto-generates tools from repeated usage patterns. These require manual installation -- the core engine does not automatically learn.

**NanoClaw:** No continuous learning mechanism.

**Claude Code:** **Auto Memory** (`~/.claude/projects/<project>/memory/`) provides automatic memory extraction and persistence. The `MEMORY.md` index (first 200 lines loaded every session) with topic-specific files builds project knowledge over time. Combined with **Auto Dream**, this is the closest thing to automated continuous learning across all three tools.

### Automatic Memory Improvement

**OpenClaw:** 2-tier core memory with semantic search. Memory is structured and searchable but improvement requires manual curation or community skills. The automatic flush-before-compact mechanism prevents knowledge loss during context truncation, but doesn't actively consolidate or improve memories.

**NanoClaw:** 3-tier CLAUDE.md hierarchy + SQLite + JSONL transcripts. No automatic improvement, no consolidation, no semantic search.

**Claude Code:** Auto Memory writes to persistent files with a `MEMORY.md` index. **Auto Dream** (see below) actively consolidates and improves these memories. Four-phase process: read current memory, deduplicate, remove stale notes, reorganize into clean topic files, keep MEMORY.md under 200 lines. **This is the only tool with truly automatic memory improvement.**

### Soul File

**OpenClaw ONLY.** `SOUL.md` defines the agent's core personality, values, and behavioral guidelines. Injected into the system prompt of every LLM call -- not just conversations but also heartbeats and scheduled tasks. Recommended 500-1500 words; too short yields no apparent personality, too long wastes tokens. Works alongside `IDENTITY.md`, `STYLE.md`, `SKILL.md`, and `MEMORY.md` for composable identity. The SoulSpec open standard (soulspec.org) formalizes this.

**NanoClaw** does NOT have SOUL.md. It uses CLAUDE.md files (global/channel/group hierarchy) for persona configuration.

**Claude Code** uses `CLAUDE.md` files at three scopes: managed policy (org-wide), project (`./CLAUDE.md`), and user (`~/.claude/CLAUDE.md`). The community "soul.md" project (github.com/aaronjmars/soul.md) provides a SOUL.md + STYLE.md + SKILL.md framework that works with any tool that reads files. To replicate OpenClaw's soul system in Claude Code, place soul content in `~/.claude/CLAUDE.md` -- it loads at every session start.

### Dreaming Capabilities

**This is the headline finding of this research.**

**OpenClaw:** Dreaming was **proposed but rejected**. Issue #5644, titled "Clawd NEEDS sleep too," proposed a sleep/maintenance cycle inspired by biological REM sleep -- shallow sleep (health checks, security audits) and deep sleep (tiered memory consolidation, LLM-enhanced reflection). Closed as "not planned" on February 1, 2026, citing high issue volume (~30/hour) and prioritization of stability work. OpenClaw uses a cold-start/cron model with no memory consolidation.

**NanoClaw:** No dreaming capability. No equivalent exists or is planned.

**Claude Code: Auto Dream is the only working implementation across all three tools.** Rolling out March 2026, Auto Dream is a first-party Anthropic feature -- not a community skill or plugin. It is based on Anthropic's **Sleep-time Compute** research paper (April 2025).

How it works:
- Background subagent runs every 24 hours after 5+ sessions
- Four-phase process: read current memory -> deduplicate -> remove stale notes -> reorganize into clean topic files
- Keeps `MEMORY.md` index under 200 lines
- System prompt literally reads: *"You are performing a dream -- a reflective pass over your memory files"*
- Philosophically and mechanically maps onto REM sleep memory consolidation
- `/dream` command triggers it manually
- Server-side feature flag rollout (GA date TBD)

This is significant for three reasons:
1. Dreaming was the most-requested missing feature in OpenClaw -- and was rejected
2. NanoClaw has no equivalent and no plans for one
3. Claude Code -- the simplest of the three tools -- is the **only one that actually delivers it**
4. It is the hardest KPA/agent feature to build from scratch -- and it's already native

---

## (d) The Ideal Path: What Should You Build?

### The Three Options Evaluated

**Option 1: Extend NanoClaw**

*Pros:* 3,900 LOC starting point, container isolation and multi-channel messaging built in, active community (68 contributors, 25.8K stars). *Cons:* Multi-LLM requires replacing the agent loop core (effectively a rewrite), memory system is primitive, no dreaming, philosophy of "modify code instead of configure" conflicts with wanting composability. *Risk:* You end up with a Frankenstein system that lost NanoClaw's simplicity without gaining proper architecture.

**Option 2: Build Everything in Claude Code**

*Pros:* Leverage the mature ecosystem (150+ skills, 10K+ MCP servers, 72+ plugins), already has memory/dreaming/scheduling/subagents, Obsidian integration via MCP, low friction to start. *Cons:* Session-based (not always-on daemon), no multi-channel messaging, no container isolation (worktrees only), can't serve as a standalone service. *Risk:* You hit the plugin ceiling and need to rebuild.

**Option 3: Build Custom from Scratch**

*Pros:* Full architectural control, Claude Agent SDK provides same battle-tested agent loop, LiteLLM integration clean from day one, can architect proper memory (vector + graph + episodic), always-on daemon architecture is native. *Cons:* Most effort upfront, need to build channel adapters, memory, scheduling, UI. *Risk:* Scope creep (mitigated by using Claude Code as the build tool).

### Recommended Path: Hybrid Option 2+3

The research strongly supports a **phased hybrid approach**:

#### Phase 1: Immediate -- Use Claude Code as KPA (Zero Additional Cost)

- **Set `autoMemoryDirectory` to your Obsidian vault path** -- Auto Memory writes directly to your knowledge base. This is a configuration change, not an engineering project.
- Use **Auto Dream** for memory consolidation -- the feature no other tool has
- Use Claude Code's **4-tier scheduling** for recurring tasks (cloud tasks for always-on)
- Use **hooks** (26 events, 4 handler types) for automation workflows
- Connect Obsidian via MCP (`obsidian-claude-code-mcp`; Kepano's `obsidian-skills` plugin)
- **Cost: $0 additional** -- covered by Max subscription ($100-200/mo flat rate)

This phase gives immediate KPA value and teaches you exactly what features you need in the custom system.

#### Phase 2: Build Custom Layer (Claude Agent SDK + LiteLLM)

Using Claude Code as your build tool:

- **Claude Agent SDK** (TypeScript) as the core runtime -- same agent loop as Claude Code and NanoClaw, no pricing difference vs. direct API
- **LiteLLM Proxy** as a sidecar service for intelligent model routing:
  - Claude Opus for complex reasoning (~10% of traffic)
  - Claude Sonnet for standard conversation (~25%)
  - Claude Haiku for simple Q&A (~15%)
  - GPT-4o mini for routine tasks (~30%)
  - Local models via Ollama for memory consolidation and embeddings (~20%)
- Borrow NanoClaw's **container isolation patterns** (~200 LOC for the core container management)
- Borrow NanoClaw's **channel adapter patterns** (WhatsApp via @whiskeysockets/baileys, Telegram, etc.)
- Build **three-tier memory**: working (conversation context), episodic (interaction history in SQLite), semantic (vector-indexed knowledge with graph relationships)
- Make it **MCP-native** so existing Claude Code integrations work
- Add a **dreaming agent** on a schedule that consolidates knowledge (leverage Auto Dream patterns or build custom using Batch API at 50% discount)

**Cost optimization stack:**
- Prompt caching: 90% discount on cached input tokens (massive for a KPA re-reading the same knowledge base)
- Batch API: 50% off for dreaming/reflection tasks
- LiteLLM routing: 60-70% savings from intelligent model selection
- Local models: $0 API cost for embeddings and classification

#### Phase 3: Gradual Migration

- Keep Claude Code as your development tool and interactive KPA
- Run the custom system for production multi-agent and multi-channel workloads
- Migrate messaging integrations as needed
- Maintain NanoClaw patterns for container orchestration reference

### Why Not Just Improve NanoClaw?

NanoClaw's strength is its minimalism (~500 lines core logic, fits in one Claude session). The moment you bolt on workflow engines, semantic search, multi-LLM routing, and heartbeat systems, you've created a worse version of OpenClaw without the community, or a worse version of a custom build without the architectural freedom. Adding multi-LLM specifically requires replacing the Agent SDK integration at the core of the agent loop. Better to use NanoClaw's proven patterns as *input* to a custom system built on Claude Code's foundation.

### Why Not Just Use OpenClaw?

You already tried it and didn't like it. Beyond personal preference: ~430K LOC, 70+ dependencies, 12% malicious ClawHub skills, 50K+ vulnerable instances, and the creator's departure to OpenAI all present real risks. The project is now under an independent foundation, but the complexity, attack surface, and security track record remain concerns.

### What NOT to Do

- **Don't try to make NanoClaw into something it's not.** Its design philosophy is "bespoke over bloatware" -- fork and customize. Bolting on enterprise features fights this philosophy and produces a Frankenstein system.
- **Don't build a plugin-only solution in Claude Code.** You'll hit the always-on ceiling -- Claude Code is session-based and can't serve as a persistent daemon for 24/7 messaging. Plugins are great for development workflows, not for an always-on KPA.
- **Don't use LangGraph, CrewAI, or other orchestration frameworks** as the foundation. The Claude Agent SDK provides the same battle-tested agent loop you already know from Claude Code and NanoClaw. Adding a third-party orchestration layer introduces unnecessary complexity and abstraction mismatch.

---

## Feature Parity Comparison Table

| Feature | OpenClaw | NanoClaw | Claude Code | Custom (Recommended) |
|---|---|---|---|---|
| **Codebase** | ~430K LOC, 70+ deps | ~3,900 LOC, <10 deps | Proprietary | Your control |
| **Container isolation** | Process-level | 3 runtimes (Apple/Docker/micro-VM) | Worktrees (filesystem) | Borrow NanoClaw patterns |
| **Messaging platforms** | 22+ (WhatsApp to WeChat) | 5-6 (WhatsApp, Telegram, Discord, Slack, Gmail) | None (CLI/desktop/web/IDE) | Build as needed |
| **Multi-LLM** | 14+ native + LiteLLM (100+) | Claude-only | Claude + LiteLLM via proxy | Claude Agent SDK + LiteLLM |
| **Heartbeat** | HEARTBEAT.md (30-min, configurable) | task-scheduler.ts (60s cron) | 4-tier scheduling (cloud/desktop/loop/GHA) | Custom heartbeat |
| **Soul/Identity** | SOUL.md + IDENTITY/STYLE/SKILL/MEMORY | 3-tier CLAUDE.md | CLAUDE.md (3 scopes) + community soul.md | Custom identity system |
| **Memory** | 2-tier + hybrid semantic search | SQLite + JSONL + CLAUDE.md | Auto Memory + MEMORY.md index | Vector + graph + Auto Memory |
| **Dreaming** | Rejected (Issue #5644) | None | **Auto Dream (only working impl)** | Leverage Auto Dream + Batch API |
| **Continuous learning** | Community-driven (ClawHub skills) | None | Auto Dream + Auto Memory | Auto Dream + custom |
| **Workflow engine** | Lobster (deterministic YAML) | None | Hooks (26 events) + plugins | Custom workflows |
| **Skill ecosystem** | 13,729+ ClawHub | 4 types, no marketplace | 72+ plugins, 10K+ MCP, 150+ skills | Build on Claude Code ecosystem |
| **Credential mgmt** | Config-based + 1Password | OneCLI Agent Vault | Env vars + MCP config | Agent Vault pattern |
| **Scheduling** | Heartbeat-driven + cron | SQLite cron (60s) | 4-tier (cloud survives machine off) | Claude Code scheduling |
| **Security model** | 3 exec tiers + sandbox | Container isolation + MITM proxy | Worktree isolation + hooks | Container + tiered exec |
| **Multi-agent** | Gateway-routed agents | Swarms (sequential, max 5) | Agent Teams (mesh) + subagents | Agent Teams + custom |
| **Cost (heavy use)** | Varies by provider mix | $125-375/mo (all Claude) | Max subscription ($100-200/mo) | **$30-65/mo** (optimized) |

---

## Cost Model

### The Counterintuitive Finding

The custom system with MORE features costs LESS than NanoClaw. NanoClaw forces all traffic through Claude (like using a Ferrari for grocery runs). Intelligent model routing lets you match model capability to task complexity.

### Recommended Routing Model

| Task Type | Model | Cost (in/out per MTok) | % of Traffic |
|---|---|---|---|
| Complex reasoning, planning, coding | Claude Opus 4.6 | $5 / $25 | ~10% |
| Standard conversation, summarization | Claude Sonnet 4.6 | $3 / $15 | ~25% |
| Simple Q&A, classification, tagging | Claude Haiku 4.5 | $1 / $5 | ~15% |
| Routine tasks, note formatting | GPT-4o mini | $0.15 / $0.60 | ~30% |
| Memory consolidation, embeddings | Local model (Ollama) | $0 (compute only) | ~20% |

### Monthly Cost Comparison

Assuming heavy power-user workload (~50M input tokens, ~15M output tokens/month):

| Scenario | Estimated Monthly Cost |
|---|---|
| NanoClaw heavy use (all Sonnet) | ~$375/mo |
| NanoClaw heavy use (all Haiku) | ~$125/mo |
| Phase 1: Claude Code as KPA | $0 additional (Max subscription) |
| Phase 2: Custom system (early) | $50-100/mo (API billing, learning routing) |
| Phase 2: Custom system (optimized) | $25-50/mo (LiteLLM + caching + local models) |
| Dreaming/reflection agent add-on | +$5-15/mo (Batch API at 50% off) |
| **Steady state (all optimizations)** | **$30-65/mo** |

### Key Cost Optimization Levers

- **Prompt caching:** 90% discount on cached input tokens. A KPA re-reading the same knowledge base context benefits enormously -- effective input cost drops from $3/MTok to $0.30/MTok for cached reads.
- **Batch API:** 50% off for non-time-sensitive tasks (dreaming, consolidation). Combines with caching for up to 95% savings on those workloads.
- **LiteLLM routing:** 60-70% savings at the recommended sweet spot. Production data shows up to 88% possible but quality degrades; 40-60% with minimal quality impact. Production recommendation: "Optimize to 70-80% of theoretical maximum savings, not 100%."
- **Local models (Ollama):** $0 API cost for embeddings, classification, memory consolidation. Only electricity/compute cost.

### Pricing Clarifications

- The Claude Agent SDK has **no pricing difference** vs. direct API calls -- it's a library, not a separate pricing tier.
- For a custom always-on KPA system, you'd use **direct API billing** (per-token rates), not the Max subscription (which is tied to Claude Code/Desktop interactive use and can't be used for arbitrary Agent SDK deployments).
- **LiteLLM caveat:** 800+ open GitHub issues as of early 2026; a September 2025 release caused OOM errors on Kubernetes. Alternatives to evaluate: Portkey, Bifrost (Go-based), Vercel AI Gateway, Cloudflare AI Gateway.

---

## Key Takeaways

1. **Auto Dream is the differentiator.** Claude Code is the only tool with working memory consolidation/dreaming. This was proposed and rejected in OpenClaw (Issue #5644) and doesn't exist in NanoClaw. It makes Claude Code the strongest foundation for a KPA. It is also the hardest feature to build from scratch.

2. **NanoClaw's real value is its architectural patterns, not the framework itself.** Container isolation (~200 LOC), channel adapters, and credential vaulting are worth borrowing. The rest is better served by Claude Code natively.

3. **OpenClaw's scale is both its strength and its problem.** 430K LOC, 70+ dependencies, security concerns (12% malicious skills, 50K+ vulnerable instances), and leadership transition make it unsuitable for a user who values simplicity, security, and control.

4. **The hybrid path minimizes waste and cost.** Phase 1 costs nothing extra and delivers immediate KPA value. Phase 2 builds only what Claude Code can't do natively. Phase 3 keeps optionality. The custom system ends up cheaper ($30-65/mo) than NanoClaw's all-Claude approach ($125-375/mo) because you can route routine work to cheaper models -- "using a Ferrari for grocery runs" is expensive.

5. **HEARTBEAT.md and SOUL.md are OpenClaw concepts only.** NanoClaw uses `task-scheduler.ts` and `CLAUDE.md` files respectively. These are not equivalent -- they represent different design philosophies (structured identity system vs. bespoke fork-and-customize approach).

---

## Glossary of Key Concepts

### BM25 (Best Matching 25)

A classic text search ranking algorithm used in information retrieval. It scores documents by relevance to a query, accounting for three factors: how often a search term appears in a document (term frequency), how long the document is (longer documents get penalized to avoid false matches), and how rare the term is across all documents (rare terms are weighted higher). BM25 is the same algorithm behind Elasticsearch and Solr. In the context of agent memory, it provides precise keyword-based recall — when you search for "indemnification clause," BM25 finds documents containing those exact terms and ranks them by relevance. It complements vector/semantic search, which finds conceptually similar content even without matching keywords. The combination (hybrid search) gives best results: BM25 catches exact terminology, vectors catch meaning.

### Tiered Execution Security

OpenClaw's 3-level system for controlling what shell commands an agent can run on the host:

1. **Deny** — blocks all command execution entirely. The agent cannot run any shell commands.
2. **Allowlist** — only pre-approved binaries can execute (e.g., `git`, `npm`, `python`). Command chaining (`&&`, `||`, `;`), redirections (`>`, `|`), and PATH overrides are rejected to prevent circumventing the allowlist.
3. **Full** — unrestricted execution, requires explicit user opt-in.

This is a defense-in-depth approach: even if the LLM is tricked into running a malicious command, the execution layer blocks it. NanoClaw solves this problem differently — container isolation means even unrestricted execution inside the container can't affect the host. Claude Code uses interactive permission prompts plus hooks (which can programmatically block specific commands). For a custom system, the recommended approach is **container isolation (borrow NanoClaw's pattern) + an allowlist layer inside the container** for defense-in-depth.

### Lobster Workflow Engine

OpenClaw's deterministic pipeline system for multi-step agent tasks. Think of it as GitHub Actions or Apache Airflow, but for AI agent workflows. Key characteristics:

- **YAML-defined pipelines** — workflow steps are declared in YAML, not generated by the LLM. This means the LLM handles *reasoning within each step*, but the *sequencing and routing between steps* is deterministic code. This prevents the "LLM forgot step 3" failure mode.
- **Approval gates** — human-in-the-loop checkpoints where the workflow pauses for user confirmation before proceeding (e.g., before deploying, before sending emails).
- **Resumable state** — if a workflow fails at step 5 of 8, it can resume from step 5 after the issue is fixed, not from scratch.
- **Retry logic with fallback paths** — failed steps can retry N times, then fall back to alternative approaches.
- **Composable skills** — each OpenClaw skill becomes a reusable building block in workflows.

For a custom KPA system, you likely don't need a full workflow engine initially. Claude Code's hooks (26 events) + Agent Teams provide much of this functionality. If you later need deterministic multi-step pipelines (e.g., "every Monday: pull calendar → summarize week → draft report → send for review"), a lightweight YAML-based pipeline runner (~200-400 LOC) borrowing Lobster's patterns would be the right addition.

---

## Custom Build Priorities: Heartbeat, Soul, and Semantic Search

### Priority 1: Semantic Search (Must Have)

**Verdict: Essential for a KPA. Build this in Phase 2.**

If you're replacing Obsidian with a knowledge base, you need to find things by *meaning*, not just keywords. "What did I learn about contract indemnification?" needs semantic matching, not grep. This is the single biggest gap between "files on disk" and "knowledge system."

**Recommended implementation:**
- **Embeddings**: Local model via Ollama (`nomic-embed-text` for English, `bge-m3` for multilingual) — $0 API cost
- **Storage**: SQLite with `sqlite-vec` extension (keeps everything in one DB file, no separate vector DB to manage). Alternatives: ChromaDB or LanceDB if you want a more purpose-built solution
- **Hybrid search**: BM25 (keyword precision) + vector similarity (meaning-based recall). Weight BM25 ~40%, vector ~60% for knowledge base use cases
- **Indexing**: Hook into Claude Code's Auto Memory writes — whenever a memory file is created/updated, re-index it. Also index your Obsidian vault / knowledge base files
- **Effort**: ~500-800 LOC for a working implementation. Well-trodden path with mature libraries

### Priority 2: Heartbeat (Should Have)

**Verdict: Valuable but mostly covered by Claude Code scheduling. Build a lightweight version.**

The heartbeat pattern ("wake up periodically, check for work, act proactively") is valuable for a KPA. But Claude Code's 4-tier scheduling already covers most use cases:
- Cloud tasks (always-on, 1-hour intervals) for daily digests, inbox checks
- Desktop tasks (1-minute intervals) for frequent polling
- `/loop` for session-scoped monitoring

**What's worth adding:**
A single `HEARTBEAT.md` file that a scheduled agent reads — the elegant simplicity of OpenClaw's model. The agent reads the file, evaluates conditions, acts if needed, reports `OK` if not. This gives you a single place to define all proactive behaviors without creating separate scheduled tasks for each one.

**Recommended implementation:**
- A `HEARTBEAT.md` file defining checks and actions in structured markdown
- A Claude Code cloud task or desktop task that runs every 30-60 minutes and reads it
- A suppress mechanism (if nothing to do, no notification)
- **Effort**: ~100-200 LOC wrapper around Claude Code scheduling

### Priority 3: Soul (Nice to Have)

**Verdict: Get 90% of the value with zero code. Full system only if you run multiple distinct agent personas.**

A single `SOUL.md` file in `~/.claude/CLAUDE.md` (or project-level) already loads into every Claude Code session. For a single-user KPA, this is sufficient. The community `soul.md` project (github.com/aaronjmars/soul.md) provides templates.

**When you'd need more:**
If your custom system runs multiple agents with distinct personas (e.g., a research agent, a writing agent, a coding agent), then a composable identity system (SOUL.md + STYLE.md + SKILL.md per agent) becomes worthwhile. At that point, ~50-100 LOC to load persona files into each agent's system prompt.

**Recommendation:** Start with a single SOUL.md in CLAUDE.md. Only build a composable identity system if/when you actually deploy multiple distinct agent personas in Phase 2.

---

## Sources

### NanoClaw
- GitHub: https://github.com/qwibitai/nanoclaw
- Official site: https://nanoclaw.dev/
- Documentation: https://docs.nanoclaw.dev/
- Skills page: https://nanoclaw.dev/skills/
- Docker Sandboxes: https://nanoclaw.dev/blog/nanoclaw-docker-sandboxes/
- Ollama skill: https://nanoclaw.dev/skills/ollama
- Issue #70 (LiteLLM support): https://github.com/qwibitai/nanoclaw/issues/70
- Issue #80 (multi-provider): https://github.com/qwibitai/nanoclaw/issues/80
- Issue #839 (scheduled tasks): https://github.com/qwibitai/nanoclaw/issues/839
- Issue #1130 (MemOS memory): https://github.com/qwibitai/nanoclaw/issues/1130

### OpenClaw
- GitHub: https://github.com/openclaw/openclaw
- Official site: https://openclaw.ai/
- Heartbeat docs: https://docs.openclaw.ai/gateway/heartbeat
- Memory docs: https://docs.openclaw.ai/concepts/memory
- Exec tool docs: https://docs.openclaw.ai/tools/exec
- LiteLLM integration: https://docs.openclaw.ai/providers/litellm
- ClawHub docs: https://docs.openclaw.ai/tools/clawhub
- Lobster workflow engine: https://docs.openclaw.ai/tools/lobster
- Integrations page: https://openclaw.ai/integrations
- Issue #5644 (dreaming -- rejected): https://github.com/openclaw/openclaw/issues/5644
- ClawHub registry: https://clawhub.ai/
- Wikipedia: https://en.wikipedia.org/wiki/OpenClaw
- SoulClaw fork: https://github.com/clawsouls/soulclaw
- OpenClaw Foundry: https://github.com/lekt9/openclaw-foundry

### Claude Code
- Official documentation: https://code.claude.com/docs/en/
- Agent Teams: https://code.claude.com/docs/en/agent-teams
- Hooks guide: https://code.claude.com/docs/en/hooks-guide
- Memory: https://code.claude.com/docs/en/memory
- Scheduled tasks: https://code.claude.com/docs/en/scheduled-tasks
- Sub-agents: https://code.claude.com/docs/en/sub-agents
- Plugins: https://code.claude.com/docs/en/plugins
- Cost management: https://code.claude.com/docs/en/costs
- Claude Agent SDK: https://platform.claude.com/docs/en/agent-sdk/overview
- Claude API pricing: https://platform.claude.com/docs/en/about-claude/pricing

### LiteLLM & Cost Analysis
- LiteLLM documentation: https://docs.litellm.ai/
- LiteLLM + OpenClaw integration: https://docs.litellm.ai/docs/tutorials/openclaw_integration
- LiteLLM + Claude Code: https://docs.litellm.ai/docs/tutorials/claude_non_anthropic_models
- LiteLLM router/load balancing: https://docs.litellm.ai/docs/routing
- LiteLLM budget routing: https://docs.litellm.ai/docs/proxy/provider_budget_routing

### Auto Dream & Sleep-time Compute
- Auto Dream analysis: https://claudefa.st/blog/guide/mechanics/auto-dream
- Anthropic Sleep-time Compute testing: https://tessl.io/blog/anthropic-tests-auto-dream-to-clean-up-claudes-memory

### Community & Third-Party Analysis
- soul.md framework: https://github.com/aaronjmars/soul.md
- NanoClaw vs OpenClaw comparison: https://help.apiyi.com/en/nanoclaw-vs-openclaw-comparison-guide-en.html
- Claude Code as KMS (Matt Stockton): https://mattstockton.com/2025/09/19/how-claude-code-became-my-knowledge-management-system.html
- Multi-agent frameworks 2026: https://www.sitepoint.com/agent-orchestration-framework-comparison-2026/

---

*Research compiled from verified findings across all listed sources. All key claims verified against primary documentation. Date of research: 2026-03-29.*
