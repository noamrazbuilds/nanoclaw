# PKA Project Structure: Separate Project vs Extend NanoClaw

**Date:** 2026-03-29
**Context:** Deciding whether the PKA system should be a separate project or built into NanoClaw, given multi-machine deployment (VM server, laptop, future Mac mini(s)).

---

## The Core Question

Should the PKA be a separate project (`~/pka/`) that NanoClaw talks to, or PKA features added into NanoClaw itself?

---

## Option A: PKA as a Separate Project

```
~/NanoClaw/          <- messaging daemon, channels, container orchestration
~/pka/               <- knowledge base, SQLite, indexer, semantic search, MkDocs
```

NanoClaw talks to PKA via filesystem (shared mount in containers) or IPC. PKA is its own repo, its own CLAUDE.md, its own agents.

**Pros:**
- Clean separation of concerns: NanoClaw does messaging, PKA does knowledge
- PKA works without NanoClaw (from Claude Code CLI, VS Code, laptop, Mac mini)
- Multiple NanoClaw instances (The Dude + future Mac mini agents) can share one PKA
- Doesn't bloat NanoClaw's codebase with unrelated knowledge management code
- The research report explicitly recommends against extending NanoClaw: "NanoClaw's real value is as an architectural reference, not as a long-term platform"
- Easier to sync PKA across machines (it's just a folder + SQLite, the exact thing Syncthing + CR-SQLite were chosen for)

**Cons:**
- Two projects to maintain
- Integration layer needed (how does NanoClaw's container agent access PKA's search/DB?)
- Configuration in two places

---

## Option B: PKA Built Into NanoClaw

```
~/NanoClaw/
├── src/                 <- existing NanoClaw code
├── pka/                 <- knowledge base, indexer, search
│   ├── vault/
│   ├── db/
│   └── ...
```

**Pros:**
- One project, one repo, one deployment
- Container agents already have filesystem access to everything
- No integration layer needed -- it's all local

**Cons:**
- NanoClaw is a messaging orchestrator. PKA is a knowledge system. These are different things.
- When you duplicate to your laptop or Mac mini, you'd clone NanoClaw to get PKA -- but you may not want NanoClaw running there (just Claude Code + PKA)
- Future NanoClaw instances (Mac mini agents) would each carry a full PKA, creating sync complexity
- Upstream NanoClaw updates become harder if you've woven PKA deeply into the codebase
- The research report warns: "The moment you bolt on workflow engines, semantic search, multi-LLM routing, you've created a worse version of OpenClaw"

---

## Option C (Recommended): PKA as Separate Project, NanoClaw as One Client

```
Machine 1 (VM - server):     Machine 2 (laptop):        Machine 3 (Mac mini):
├── ~/NanoClaw/ (The Dude)   ├── ~/pka/  <-- Syncthing   ├── ~/pka/  <-- Syncthing
├── ~/pka/  <-- Syncthing    └── Claude Code              ├── ~/NanoClaw/ (new agent)
│   ├── vault/                   accesses PKA directly     └── Claude Code
│   ├── db/  <-- CR-SQLite                                    accesses PKA directly
│   ├── .claude/ (PKA agents)
│   └── mkdocs.yml
└── MkDocs (serves vault)
    ^ phone accesses via Tailscale
```

**How it works:**
- PKA is a standalone folder (`~/pka/`) with vault, SQLite DB, agent definitions, indexer. It's its own Claude Code project with its own CLAUDE.md.
- Syncthing syncs the vault (markdown files) across all machines over Tailscale.
- CR-SQLite syncs the database across all machines over Tailscale.
- NanoClaw is a client of PKA -- its container agents mount `~/pka/vault/` read-write and `~/pka/db/` read-only (or read-write for capture). NanoClaw doesn't own the knowledge; it accesses it.
- Claude Code on any machine can work with PKA directly -- just `cd ~/pka && claude`.
- VS Code on any machine opens `~/pka/` as a workspace with Claude Code extension.
- Each Mac mini gets its own NanoClaw instance (different personality/purpose) but shares the same PKA via sync.
- MkDocs runs on the server, serves the vault for mobile browsing.

**Why this is the right answer for your setup:**

1. **Multi-machine is the deciding factor.** Laptop + VM + Mac mini(s). If PKA is inside NanoClaw, every machine needs NanoClaw to access PKA. With Option C, the laptop just needs the `~/pka/` folder and Claude Code -- no NanoClaw daemon needed.

2. **Multiple NanoClaw instances sharing one knowledge base.** The Dude on the VM and a future agent on the Mac mini should both read/write to the same PKA. If PKA is inside NanoClaw, you'd need to sync NanoClaw's internal state -- messy. If PKA is separate, both NanoClaw instances just mount the same synced folder.

3. **Claude Code is the primary interface, not NanoClaw.** You'll spend more time in Claude Code (planning, building, querying) than in WhatsApp. PKA should be a first-class Claude Code project, not a subdirectory of a messaging daemon.

4. **Clean upgrade path.** NanoClaw updates don't touch PKA. PKA schema changes don't break NanoClaw. The integration surface is small: "mount this folder, query this DB."

---

## The Integration Layer

How NanoClaw's container agents access PKA:

```
NanoClaw container
├── /mnt/pka/vault/     <- mounted from ~/pka/vault/ (read-write for capture)
├── /mnt/pka/db/        <- mounted from ~/pka/db/ (read for retrieval, write for capture)
└── container CLAUDE.md  <- includes PKA agent definitions + paths
```

This is already how NanoClaw works -- `container-runner.ts` mounts group directories into containers. Adding PKA as another mount is ~10-20 lines of config change.

---

## Next Steps (if Option C is confirmed)

1. Create `~/pka/` on the server with initial folder structure
2. Initialize it as a Claude Code project (CLAUDE.md, .claude/ directory)
3. Build semantic search there (SQLite + sqlite-vec + indexer)
4. Configure NanoClaw to mount it into containers
5. Set up Syncthing for `~/pka/vault/` to laptop
6. Set up MkDocs serving from `~/pka/vault/`
