# Tom Solid / Paperless Movement — PKA Agent System Research
## Compiled: March 28, 2026

This document aggregates everything extractable from open web sources about Tom Solid's (Dr. Thomas Roedl) and Paco Cantero's Claude-based PKA (Personal Knowledge Assistance) system. Sources include videohighlight.com summaries, myicor.com blog excerpts, official Claude Code documentation, and web search results. Direct transcripts were not accessible; the detail level reflects what could be confirmed across multiple corroborating sources.

---

## PART 1 — CORE ARCHITECTURE (confirmed across multiple sources)

### The Fundamental Shift: PKM → PKA

Tom Solid spent 13+ years using note-taking apps (Obsidian, Heptabase, Tana, Notion). His conclusion: "I was spending more time organizing than thinking." The move is from **Personal Knowledge Management** (you manage, file, tag, review notes) to **Personal Knowledge Assistance** (AI agents do the management; you only interact with the outputs).

Key framing:
- "Claude is the brain, not the system" — AI is a stateless processor; files stay in standard formats
- "If Anthropic disappeared tomorrow, I would not lose a single file"
- The tool-agnostic ICOR methodology (Input, Control, Output, Refine) is the foundation; tools are secondary

### The Two-Folder Structure

The system uses exactly **two top-level folders**:

1. **Business folder** — contains the full team of 30+ specialist Claude agents
2. **Personal/Private life folder** — covers health, finance, family domains with its own agent team

Both folders follow the same internal structure (described below). This separation keeps business and personal contexts isolated while using the same architecture.

### Internal Folder Structure (within each folder)

Confirmed components:
```
[root folder]/
├── CLAUDE.md                    ← main context/instructions for the session
├── .claude/                     ← hidden config folder
│   ├── memory/                  ← system context, persistent knowledge base
│   └── skills/                  ← specialized capability files
├── [agent-name].md              ← individual agent definition files
├── owner's inbox/               ← items awaiting user review/decision
├── team inbox/                  ← shared document repository for agents
└── app/                         ← generated HTML frontend interface
```

The `.claude/` folder follows the standard Claude Code convention:
- `memory/` contains CLAUDE.md-style persistent context files
- `skills/` contains SKILL.md reusable workflow files
- Agent definitions are `.md` files with YAML frontmatter

### Why Plain Folders, Not a Note-Taking App

Problems with Obsidian specifically (as stated):
- Wiki-style links create format lock-in
- Dataview frontmatter creates metadata dependencies
- Plugin dependencies silently bind users to the platform

Plain folders solve this:
- Standard files accessible from any tool (VS Code, Finder, Cursor, mobile)
- 100% portable — no proprietary format
- Claude Code treats the folder as its workspace
- The same folder works regardless of which AI tool processes it in the future

### Why VS Code Over Obsidian

VS Code is preferred because:
- Free, built by Microsoft
- Shares the same foundation as Cursor and Windsurf (AI-native IDEs)
- Can run multiple Claude Code terminals side-by-side (parallel agents)
- Supports the full Claude Code feature set
- No vault lock-in
- Can open any folder structure natively

Demonstrated VS Code capabilities:
- Side-by-side Claude Code terminals (parallel processing)
- `/model` command for switching between Claude versions
- `/loop` function for recurring automation
- Word-to-PDF conversion tasks
- Database table creation
- Agent-based web research inline
- Browser automation from within Claude Code environment

---

## PART 2 — THE AGENT TEAM

### Named Agents (confirmed)

**Larry** — The Orchestrator
- Primary interface; acts as team lead / fox mascot
- Routes work to appropriate specialists
- Reads foundational context on startup
- Never implements directly — delegates to specialist sub-agents
- Manages team coordination
- Reads MEMORY.md at session start, updates before session end
- Coordinates 27-30+ specialists

**Nolan** — HR Director
- Responsible for "hiring" new AI agents
- When a new capability is needed, Nolan is asked to create a new agent
- Maintains team roster (likely in a markdown table)
- Manages agent onboarding — writes the .md definition files for new agents
- This is how the system scales: the system hires itself

**Pax** — Senior Researcher
- Model: Claude Opus (the most capable/expensive model)
- Tools: Online research capabilities
- Can run background research tasks
- Operates independently while other work continues

**Pixel** — Content Creation
- Scalable to 20 parallel instances
- Used for content production at scale
- Likely handles thumbnails, scripts, social media content

**Sable** — Developer
- Hired specifically for frontend interface creation
- Builds browser-based visualization layers
- Creates simple HTML viewers over complex data/applications

Total team: approximately 28-30+ specialist agents by the time of the March 2026 videos.

### Agent Definition File Format (YAML frontmatter + Markdown)

Based on official Claude Code documentation (confirmed as the format Tom uses):

```markdown
---
name: agent-name
description: When Claude should delegate to this agent. Use proactively for [specific tasks].
tools: Read, Write, Bash, Grep, Glob  # or inherit all
model: sonnet  # or opus, haiku, inherit
memory: user  # or project, local — enables persistent memory directory
skills:
  - skill-name-1
  - skill-name-2
---

You are [persona description].

## Your Role
[What this agent does]

## Standard Operating Procedure
[Step-by-step workflow]

## Rules
- Rule 1
- Rule 2

## Memory
Update your agent memory as you discover patterns, decisions, and key insights.
```

Key fields:
- `name`: lowercase-with-hyphens identifier
- `description`: critical — Claude uses this to decide when to auto-delegate
- `tools`: allowlist (inherits all if omitted)
- `model`: which Claude model this agent uses (Pax uses Opus for research quality)
- `memory`: enables persistent memory directory that survives across sessions
- `skills`: preloaded SKILL.md files injected into this agent's context

The body (below frontmatter) becomes the agent's system prompt — persona, SOPs, rules.

### How Agent Communication Works

- Agents run in separate context windows (prevents context exhaustion)
- Larry (orchestrator) uses the `Agent` tool (formerly `Task` tool) to spawn sub-agents
- Sub-agents receive specific prompts, work independently, return summaries
- Results return to Larry who synthesizes and presents to user
- Background agents can run while user continues working
- Agents can be resumed — transcripts saved at `~/.claude/projects/{project}/{sessionId}/subagents/agent-{agentId}.jsonl`
- Direct inter-agent messaging possible via `SendMessage` tool with agent ID

### How "Hiring" New Agents Works

The self-scaling pattern:
1. User identifies a need for a new capability
2. User asks Larry: "We need an agent that can do X"
3. Larry delegates to Nolan (HR Director)
4. Nolan creates the new agent definition (.md file with YAML frontmatter)
5. New agent is immediately available for delegation
6. The team roster (markdown table) is updated

This means the system bootstraps itself — no external scaffolding needed beyond the initial setup.

---

## PART 3 — MEMORY & PERSISTENCE

### The Memory Stack

**Layer 1 — CLAUDE.md files** (you write these)
- Located at `./CLAUDE.md` or `./.claude/CLAUDE.md`
- Loaded at every session start
- Contains: architecture decisions, team structure, rules, conventions
- Should be under 200 lines for best adherence
- Can import other files via `@path/to/file` syntax
- Survives `/compact` — re-read from disk after compaction

**Layer 2 — Auto Memory** (Claude writes these)
- Located at `~/.claude/projects/<project>/memory/`
- `MEMORY.md` = index file, first 200 lines loaded at session start
- Topic files (`debugging.md`, `patterns.md`) loaded on demand
- Each agent can have its own memory directory
- Machine-local, not synced across devices

**Layer 3 — Agent-specific memory** (per sub-agent)
- `memory: user` → `~/.claude/agent-memory/<agent-name>/`
- `memory: project` → `.claude/agent-memory/<agent-name>/`
- `memory: local` → `.claude/agent-memory-local/<agent-name>/`
- Each agent maintains its own MEMORY.md + topic files

**Layer 4 — Databases** (SQLite)
The system creates SQLite databases for structured data:
- Journaling system
- Contact management / CRM
- Meeting notes repository
- Project tracking
- File indexing (with OCR integration)

"Files and databases, that's it" is the explicit design philosophy — no proprietary formats, no plugin dependencies.

### Cross-Session Continuity Pattern

Orchestrator (Larry) CLAUDE.md instructs:
- Read MEMORY.md at session start
- Update MEMORY.md before session end
- Never implement directly — delegate to specialist sub-agents
- Parallelize independent tasks with simultaneous Agent calls

---

## PART 4 — DATABASES & DATA ARCHITECTURE

### SQLite as the Foundation

Confirmed databases in the system:
1. **Journals database** — entries from daily journaling
2. **Contacts/CRM database** — people, relationships, interaction history
3. **Meeting notes** — structured meeting records
4. **Project tracking** — project status, tasks, milestones
5. **File index** — searchable index of all documents (with OCR content)

The file indexing + OCR integration means:
- Documents can be drag-and-dropped into the system
- PDFs are automatically processed (119 files demonstrated in one video)
- OCR extracts text content
- Extracted content is stored in the SQLite index
- Agents can search across all documents via SQL queries

### HTML Interface Generation

Tom demonstrates generating a simple HTML frontend:
- Agent (Sable the Developer) creates this
- Renders a browser-based view over complex data
- Lives in the `app/` folder
- No external dependency — pure HTML/JS/CSS
- Provides visual dashboard without needing a separate tool

---

## PART 5 — WORKFLOW & DAILY USAGE

### The Build Sequence (from the 55-min walkthrough video)

Based on videohighlight.com summary of `geIKyDaXwGg`:
1. Start with an empty folder — just a folder, nothing else
2. Create the `.claude/memory/` and `.claude/skills/` subfolders
3. Write the foundational CLAUDE.md (context, team overview, rules)
4. Define Larry first (the orchestrator agent .md file)
5. Have Larry delegate to Nolan to "hire" the first specialists
6. Nolan creates specialist agent .md files one by one
7. Build out SQLite database structure via Claude
8. Have Sable build the HTML interface
9. Set up OCR/document processing pipeline
10. Set up mobile access (Claude app)
11. Enable remote control features

### Information Flow: Capture → Processing

```
Input sources:
  Mobile capture (Claude app, voice mode)
  Document drag-and-drop → OCR → SQLite file index
  Web research (Pax agent runs background research)
  Daily journaling

→ Team Inbox (shared repository agents can read/write)

→ Larry routes to appropriate specialist agents

→ Specialists process, create outputs, update databases

→ Owner's Inbox (items needing human review/decision)

→ User reviews, approves, or redirects

→ Refine loop
```

### The ICOR Mapping onto Agents

ICOR = Input, Control, Output, Refine

- **Input**: capture mechanisms → team inbox, document processing, voice/mobile
- **Control**: Larry orchestrates; Nolan manages team composition; agents have SOPs
- **Output**: specialist agents produce content, updates, reports; HTML dashboard shows status
- **Refine**: owner's inbox for human review; system learns via agent memory updates

### Daily Workflow Pattern

1. Open Claude Code in VS Code
2. Larry reads session context (CLAUDE.md + MEMORY.md)
3. User gives natural language input to Larry
4. Larry delegates: Pax researches, Pixel creates content, etc.
5. Background agents work while user does other things
6. User reviews items in Owner's Inbox
7. Voice mode (spacebar hold) for hands-free interaction
8. Mobile app (Claude) for on-the-go access with same folder

### Plan Mode for Safety

Before executing large operations:
- Use Claude's "planning mode" (`/plan` or `permissionMode: plan`)
- Review proposed actions before execution
- Especially important for database operations and large-scale file changes

---

## PART 6 — MCP TOOLS & CONNECTORS

### Confirmed MCP Usage

From the myICOR blog and related content:
- **Readwise MCP** — for importing highlights and reading notes
- **Todoist MCP** — for task management integration
- **ClickUp MCP** — project management integration
- **Miro MCP** — visual knowledge management (newly highlighted)
- **General file system MCP** — for file read/write operations

The system uses `.mcp.json` at the project level to configure which MCP servers each session has access to. Individual agents can have their own `mcpServers` list in their frontmatter, scoping tools to only that agent.

### The MCP Architecture

```json
// .claude/.mcp.json (or .mcp.json at project root)
{
  "mcpServers": {
    "filesystem": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/folder"]
    },
    "sqlite": { ... },
    "readwise": { ... }
  }
}
```

Agent-scoped MCP (in agent .md frontmatter):
```yaml
mcpServers:
  - readwise  # references already-configured server
  - todoist
```

---

## PART 7 — CLAUDE PLAN/MODEL DETAILS

### Plan Required

Confirmed: The system requires **Claude Max plan** (or Team/Enterprise). Reason:
- Claude Code access is required (not available on basic Claude.ai)
- Multiple agent sessions running simultaneously require Max plan token limits
- Claude Pro ($20/month) gives access to Claude Code + Cowork — mentioned as the entry point
- Max plan recommended for heavy usage with 28-30+ agents

### Model Selection per Agent

- **Larry (Orchestrator)**: Sonnet (balance of speed + capability for routing)
- **Pax (Researcher)**: Opus (highest capability for research quality)
- **Other specialists**: Sonnet default; Haiku for fast/cheap tasks (context preservation)
- The `/model` command in Claude Code lets you switch mid-session

### Cost Framing

Tom states: approximately **$100/month** for the full system (versus ~$50K/year for equivalent human staff). This covers Claude Max plan + API costs for background agents.

---

## PART 8 — DESIGN PRINCIPLES

### Why This Is Different From Claude Chat

1. **Persistent memory**: CLAUDE.md + agent memory directories survive across sessions
2. **Specialized agents**: each has focused context, not a generalist chat
3. **File-based architecture**: outputs are real files, not conversation artifacts
4. **Parallel processing**: multiple agents work simultaneously
5. **Self-scaling**: Nolan can hire new agents without user doing configuration
6. **Tool access**: agents have bash, file system, MCP servers — not just text generation
7. **Vendor independence**: all files are plain text/markdown/SQLite — portable

### The "AI Makes the Capable Faster" Principle

Explicit warning from Tom: "AI makes the capable faster, not the clueless capable"

The system requires solid foundational processes (ICOR methodology) before AI automation. This is why ~95% of companies struggle with AI implementation — they lack structured thinking frameworks before deployment.

### Portability Philosophy

- All files are standard formats (Markdown, SQLite, HTML)
- No proprietary schemas
- Folder works in VS Code, Cursor, Windsurf, Finder, any editor
- If Claude Code disappears, files remain intact
- If Anthropic disappears, not a single file is lost
- Can switch to local LLMs (mentioned as an option for privacy)

---

## PART 9 — PACO CANTERO'S SYSTEM (Video 5: k_F6Ui0yiA8)

### Architecture Overview

Paco came from deep Tana usage (hundreds of structured nodes: supertags, fields, hierarchies, daily journals, meeting notes, project plans). He abandoned Tana for the same plain-folder + Claude approach.

His system is more database-heavy than Tom's:
- **150+ database tables** in his custom PKA interface
- Built using the same Claude Code + plain folder approach

### The Mindset System

The central organizing concept in Paco's system. What it does:
- Integrates scattered personal data into a cohesive AI-powered experience
- Transforms daily journaling into actionable insights
- Automatically updates CRM records from journal entries
- Described as "no coding skills required" — Claude built it

The journaling → CRM pipeline:
1. User writes journal entry (daily capture)
2. AI coach (real-time) provides coaching feedback on entries (timestamp: 44:30)
3. System extracts mentions of people, projects, commitments from journal
4. CRM database auto-updates with new information about contacts
5. Related project records updated
6. Insights filed for later retrieval

### AI Coach Personas (timestamp 53:00)

Three exemplar coaching personas embedded in the system:
- **Yoda** — wisdom/principle-based coaching style
- **Socrates** — dialectical/questioning coaching style
- **Shane Parrish** (Farnam Street) — mental models/clear thinking coaching style

These are likely implemented as separate sub-agents or skills with distinct system prompts that embody each persona's approach to questioning and feedback.

### Mobile Capture (timestamp 58:00)

Paco's mobile workflow: **Tana + Claude combination**
- Tana used as structured capture tool on mobile
- Claude AI integration transforms captured nodes into the PKA system
- MCP connection bridges Tana → Claude → database
- This solves the problem Paco articulated: "Your PKM holds everything. Your AI knows nothing."

The Tana → Claude MCP connection (from his Feb 2026 article):
- Tana's structured data (supertags, fields, hierarchies) connects via MCP
- Claude can read and write Tana nodes
- Eliminates "start from zero every single time" in Claude chat
- Takes "minutes, not months" to set up

### The 150+ Table Database

While specific schema not publicly documented, the scope suggests:
- People/contacts table + relationship tables
- Projects table + sub-tables (tasks, milestones, notes)
- Journal entries table
- Learning/insights tables
- Health/fitness tracking
- Finance tracking
- Books/reading tables
- Meeting records
- Goal tracking
- Habit tracking
- (And many more domain-specific tables)

Paco's system is more relational/interconnected than Tom's — the CRM that auto-updates from journaling requires proper foreign key relationships across tables.

### Tom's System Elements (from same video, timestamp 1:06:30)

- Dashboard view (built by Sable agent)
- AI coaches (similar persona approach)
- Daily briefing (Larry generates this)

---

## PART 10 — CLAUDE CODE TECHNICAL FOUNDATION

### The .claude/ Folder Structure (Official)

```
project-root/
├── CLAUDE.md                    # Project-level persistent instructions
└── .claude/
    ├── settings.json            # Permissions, model, hooks config
    ├── settings.local.json      # Personal overrides (gitignored)
    ├── rules/                   # Path-scoped modular instructions
    │   ├── topic-a.md
    │   └── topic-b.md
    ├── skills/                  # Reusable SKILL.md workflow files
    │   └── skill-name/
    │       └── SKILL.md
    ├── agents/                  # Sub-agent definitions
    │   └── agent-name.md
    ├── commands/                # Custom slash commands
    └── .mcp.json                # MCP server configurations
```

User-level (applies to all projects):
```
~/.claude/
├── CLAUDE.md                    # Personal preferences, all projects
├── agents/                      # Personal agents, all projects
├── skills/                      # Personal skills, all projects
└── projects/
    └── <project>/
        └── memory/
            ├── MEMORY.md        # Auto memory index
            └── topic-files.md   # Detailed topic notes
```

### Key Claude Code Commands

- `/agents` — manage sub-agents interactively
- `/memory` — view/edit CLAUDE.md and auto memory files
- `/model` — switch Claude model mid-session
- `/loop` — schedule recurring tasks (cron-like, up to 50 concurrent)
- `/voice` — push-to-talk voice mode (spacebar)
- `/plan` — enter plan mode (review before execution)
- `/compact` — compact context (CLAUDE.md reloaded fresh after)
- `/init` — generate initial CLAUDE.md from codebase analysis
- `/btw` — side question without adding to context history
- `/hooks` — manage event-triggered automation

### Sub-Agent Definition (Full YAML Frontmatter Fields)

```yaml
---
name: agent-name                  # required, lowercase-hyphenated
description: When to delegate     # required, drives auto-delegation
tools: Read, Write, Bash, Grep    # optional, inherits all if omitted
disallowedTools: Write, Edit      # optional, denylist approach
model: sonnet                     # optional: sonnet, opus, haiku, inherit
permissionMode: acceptEdits       # optional: default, acceptEdits, dontAsk, bypassPermissions, plan
maxTurns: 20                      # optional, max agentic turns
skills:                           # optional, preload skill content
  - skill-name
mcpServers:                       # optional, scoped MCP servers
  - server-name
  - custom-server:
      type: stdio
      command: npx
      args: [...]
hooks:                            # optional, lifecycle hooks
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./validate.sh"
memory: user                      # optional: user, project, local
background: false                 # optional, run as background task
effort: medium                    # optional: low, medium, high, max
isolation: worktree               # optional, run in isolated git worktree
initialPrompt: "..."              # optional, auto-submitted first turn
---

[System prompt / persona / SOPs in markdown below]
```

### /loop Feature (New in 2026)

Scheduled recurring tasks:
- Natural language: `/loop 5m check for new files in team inbox`
- Maximum 50 concurrent loop tasks per session
- Auto-expires after 3 days
- Useful for: monitoring inboxes, periodic reports, background research
- Best for: PR monitoring, deployment status, quality audits, inbox processing

### Remote Control

- Launch Claude Code on desktop
- Manage from web interface or iOS/Android app
- Code stays local; only encrypted chat messages go through Anthropic servers
- Enables mobile → desktop workflow for the PKA system

### Voice Mode Details

- Activated with `/voice` command
- Push-to-talk (hold spacebar)
- Supports 20 languages (as of March 2026)
- Does NOT use always-on listening
- Useful for hands-free task submission to Larry

---

## PART 11 — RESOURCES, TEMPLATES, COMMUNITY

### Where Tom Distributes Content

- **YouTube**: Primary content channel (Tom Solid / Paperless Movement videos)
- **myicor.com**: Main platform (redirects from paperlessmovement.com since late 2025)
- **blog.myicor.com**: Blog posts and video articles (redirects to myicor.com)
- **Inner Circle Program**: Paid membership with direct access to Tom and Paco
- **Community platform**: Circle-based community with resources, golden nuggets, announcements

### Downloadable Resources Mentioned

No public GitHub repos for the actual PKA system were found. Tom mentions:
- ICOR Journey Starter Kit (myicor.com/starter-kit/) — builds productivity system in 7 days
- ICOR Journey Book (myicor.com/book/)
- The community/course membership includes templates and walkthroughs

### Jax AI Manager + MCP Server

Found referenced on myicor.com features page:
- "Jax AI manager + MCP server for your AI"
- Appears to be a tool within the myICOR platform
- Possibly an MCP server that connects to the ICOR system/community data
- Details unclear from public sources

### Related Community Discussion

No significant Reddit or Hacker News discussion found (videos are very new — late March 2026, not yet widely indexed). The community discussion appears to live primarily within the myICOR membership platform.

---

## PART 12 — BUILD SEQUENCE RECONSTRUCTION

Based on aggregated sources, here is the likely build sequence from the 55-minute walkthrough:

### Phase 1: Foundation (first 15 min)
1. Create root folder (business or personal)
2. Create `.claude/` subfolder with `memory/` and `skills/` inside
3. Write initial CLAUDE.md: project name, purpose, rules, team overview placeholder
4. Open VS Code, point Claude Code at the folder

### Phase 2: Orchestrator Setup (15-25 min)
5. Create `larry.md` in `.claude/agents/` (or root)
6. Larry's YAML: model=sonnet, tools=all, memory=project
7. Larry's body: persona as team lead fox, SOPs for delegation, rules (read MEMORY.md first, never implement directly, parallelize)
8. Test: ask Larry to introduce himself

### Phase 3: HR Agent + First Hires (25-35 min)
9. Create `nolan.md` (HR Director)
10. Ask Larry to have Nolan hire a researcher (Pax)
11. Nolan creates `pax.md`: model=opus, tools=Bash+Read+Write (web search), memory=project
12. Ask Larry to have Nolan hire a developer (Sable)
13. Sable: tools=all, focus on HTML/frontend creation

### Phase 4: Database Architecture (35-45 min)
14. Ask Larry to have Sable create the SQLite database structure
15. Database created with tables: journals, contacts, meetings, projects, files
16. File indexing table with OCR integration pathway
17. Test with sample data insert

### Phase 5: Interface & OCR (45-55 min)
18. Ask Sable to build HTML dashboard in `app/` folder
19. Set up document processing: drag PDF → OCR → insert to file_index table
20. Test with 5-10 documents
21. Verify search works across indexed content

### Phase 6: Content Team (if business folder)
22. Have Nolan hire Pixel (content creation, model=sonnet, background=true)
23. Set Pixel to spawn up to 20 parallel instances for scale
24. Define content workflows as skills

### Phase 7: Daily Workflow Setup
25. Configure Larry's daily briefing prompt
26. Set up Owner's Inbox monitoring with /loop
27. Enable voice mode
28. Test mobile access via Claude app

---

## PART 13 — WHAT MAKES THIS DIFFERENT FROM STANDARD CLAUDE CODE USAGE

Standard Claude Code: coding assistant for software development
Tom's PKA system: entire knowledge management and business operations infrastructure

Key differentiators:
1. **Two-folder structure** (business + personal) as the complete "operating system"
2. **Named, persistent agents** with individual memory directories and SOPs
3. **Self-scaling via Nolan** — the system hires itself
4. **SQLite as the persistent store** for all structured knowledge (not just files)
5. **HTML interface** generated and maintained by an agent
6. **OCR + document processing** pipeline as standard infrastructure
7. **ICOR methodology as the organizing principle** — not ad hoc
8. **Owner's Inbox pattern** for human-in-the-loop review
9. **Team Inbox** as the shared workspace between agents
10. **Full cost accounting** (~$100/mo vs $50K+ in human time)

---

## NOTES ON INFORMATION QUALITY

**High confidence (confirmed in multiple sources):**
- Two-folder structure (business + personal)
- Named agents: Larry, Nolan, Pax, Pixel, Sable
- SQLite databases for journals, contacts, meetings, projects, files
- HTML interface in `app/` folder
- Owner's Inbox + Team Inbox pattern
- Claude Max plan required
- VS Code as preferred interface
- ICOR = Input, Control, Output, Refine methodology
- Plain folders over note-taking apps philosophy
- Paco's 150+ table database
- Paco's Tana + Claude MCP integration
- AI coach personas: Yoda, Socrates, Shane Parrish
- Journaling → CRM auto-update pipeline

**Medium confidence (from single source - videohighlight summaries):**
- Pax uses Opus model specifically
- Pixel scales to 20 parallel instances
- Sable hired for HTML interface work
- Drag-and-drop OCR for 119 PDF files demonstrated
- $100/month cost figure

**Lower confidence (inferred from architecture context):**
- Exact CLAUDE.md content and structure
- Specific SOP wording in agent files
- Exact database schemas
- Whether Nolan's "hiring" is conversational delegation or scripted workflow
- Mobile workflow details beyond "Claude app" access

**Not found publicly:**
- Actual template files or GitHub repo
- Exact build sequence from video
- Detailed chapter timestamps for video 1 (geIKyDaXwGg)
- Full transcript of any video
- Specific MCP server configurations used
- Whether system uses Claude Code's Agent Teams feature or just sub-agents

---

## SOURCES CONSULTED

- videohighlight.com summaries for: geIKyDaXwGg, aoc_NQfxjy8, XQOFLAE2WKI, 1RIXGL5Vgag, k_F6Ui0yiA8, 5MzCFcPiJlg
- myicor.com (homepage, features/icor-framework, features/community)
- blog.myicor.com (index page — excerpts and descriptions)
- paperlessmovement.com/podcast-episode/how-ai-agents-will-redefine-our-productivity-systems/
- code.claude.com/docs/en/memory (official Claude Code memory documentation)
- code.claude.com/docs/en/sub-agents (official Claude Code sub-agent documentation)
- github.com/FlorianBruniaux/claude-code-ultimate-guide
- glenrhodes.com/claude-code-multi-agent-architecture...
- groff.dev/blog/implementing-claude-md-agent-skills
- sidsaladi.substack.com (CLAUDE.md and SKILL.md technical guide)
- producttalk.org/how-to-use-claude-code-features/
- help.apiyi.com (Claude Code 2026 new features: /loop, voice, remote)
- turingcollege.com/blog/claude-agent-teams-explained
- openaitoolshub.org/en/blog/claude-code-multi-agent-tutorial
- dsebastien.net/your-ai-doesnt-know-you-why-pkm-is-the-missing-foundation-for-ai-agents/
- shipyard.build/blog/claude-code-multi-agent/
- Multiple web searches for community discussion (Reddit, HN — none found for these specific videos)
