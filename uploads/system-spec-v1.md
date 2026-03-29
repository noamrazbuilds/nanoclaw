# Personal Knowledge Management System — Draft Spec v1

**Date:** 2026-03-27
**Status:** First draft — for review and discussion

---

## 1. Philosophy & Core Principles

### 1.1 The Separation Principle

The system is built on one foundational rule: **the intelligence layer never modifies the format of your content files.**

- **Content layer**: Plain CommonMark markdown files in a folder. No non-standard syntax. Any text editor on any platform renders them correctly.
- **Intelligence layer**: A parallel database + AI system that *reads* the content files, indexes them, computes relationships, and provides advanced features — but stores all metadata, links, annotations, and query results in its own database, never injected into the markdown.

If the intelligence layer is removed, 100% of content survives intact.

### 1.2 Additional Principles

- **Provider-agnostic AI**: The AI layer abstracts over providers (Claude, OpenAI, local models via Ollama, etc.) through a clean interface. Any provider can be swapped without changing the system.
- **Flexible automation**: AI processing supports three modes — on-demand only, background watcher + on-demand heavy tasks, and fully automatic. The user chooses.
- **Works with any folder structure**: The system adapts to whatever it finds. It can also propose an initial structure and periodically suggest reorganization.
- **Full PKM scope**: Notes, tasks, projects, bookmarks, contacts, code snippets, reference material, media — all content types are first-class.
- **Dual interface**: Claude Code for power-user operations and natural language interaction; a cross-platform app UI for browsing, visualization, search, and mobile access. Both are equal citizens.

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    USER INTERFACES                       │
│                                                         │
│   ┌──────────────┐     ┌──────────────────────────┐    │
│   │  Claude Code  │     │    Cross-Platform App    │    │
│   │  (CLI / IDE)  │     │  (Browse, Visualize,     │    │
│   │               │     │   Search, Mobile)        │    │
│   └──────┬───────┘     └───────────┬──────────────┘    │
│          │                         │                    │
├──────────┴─────────────────────────┴────────────────────┤
│                   INTELLIGENCE LAYER                     │
│                                                         │
│   ┌─────────────┐  ┌──────────┐  ┌─────────────────┐  │
│   │  AI Engine   │  │ Indexer  │  │  Query Engine   │  │
│   │ (Embeddings, │  │ (Watch / │  │  (SQL, FTS,     │  │
│   │  Linking,    │  │  Scan /  │  │   Semantic,     │  │
│   │  Categorize, │  │  Parse)  │  │   Graph)        │  │
│   │  Summarize)  │  │          │  │                 │  │
│   └──────┬───────┘  └────┬─────┘  └───────┬─────────┘  │
│          │               │                │             │
│   ┌──────┴───────────────┴────────────────┴──────┐     │
│   │              DATABASE (SQLite)                │     │
│   │  Metadata, embeddings, links, annotations,   │     │
│   │  tags, tasks, queries, spatial layouts        │     │
│   └──────────────────────┬───────────────────────┘     │
│                          │                              │
├──────────────────────────┴──────────────────────────────┤
│                    CONTENT LAYER                         │
│                                                         │
│   ┌──────────────────────────────────────────────┐     │
│   │         Markdown Files in Folders             │     │
│   │    (Clean CommonMark — no custom syntax)      │     │
│   │    + Images, PDFs, media alongside            │     │
│   └──────────────────────────────────────────────┘     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 2.1 Layer Responsibilities

| Layer | Owns | Never Does |
|-------|------|------------|
| **Content** | Markdown files, folder structure, embedded media | Contains non-standard syntax, query code, block IDs, or metadata beyond standard YAML frontmatter |
| **Intelligence** | Database, embeddings, computed links, annotations, spatial layouts, query results | Modifies markdown format; injects non-standard syntax into files |
| **UI (App)** | Visualization, browsing, dashboards, search results display | Writes directly to markdown without going through the intelligence layer |
| **UI (Claude Code)** | Natural language queries, bulk operations, system maintenance | Injects non-portable syntax into files |

---

## 3. Content Layer

### 3.1 File Format

All content files are **CommonMark markdown** with optional **YAML frontmatter** (widely supported across editors and platforms).

Example note:
```markdown
---
title: Neural Network Fundamentals
created: 2026-03-27
type: note
---

# Neural Network Fundamentals

A neural network is a computational model inspired by biological neurons...

## Backpropagation

The backpropagation algorithm computes gradients...
```

Permitted in files:
- CommonMark markdown (headings, lists, bold, italic, code, tables, images, standard links)
- YAML frontmatter with standard keys
- Standard `[text](path)` links (not wikilinks)
- GitHub Flavored Markdown extensions (task lists, strikethrough, tables, footnotes)
- LaTeX math (`$...$`, `$$...$$`) — widely supported
- Mermaid code blocks — widely supported

NOT permitted in files (these live in the database):
- Wikilinks, block IDs, embeds, highlights, comments
- Query code of any kind
- Plugin-specific syntax
- AI-generated metadata beyond standard frontmatter

### 3.2 Frontmatter Convention

The system reads and respects existing frontmatter. It may *propose* adding standard keys but never writes non-standard ones. Proposed standard keys:

```yaml
---
title: Note Title            # Display name (optional — filename is fallback)
created: 2026-03-27          # ISO date
modified: 2026-03-27         # ISO date (can also be derived from filesystem)
type: note                   # Content type: note, task, bookmark, contact, snippet, reference, journal
tags:                        # User-defined tags (standard YAML list)
  - machine-learning
  - research
---
```

The system should confirm with the user before writing or modifying frontmatter.

### 3.3 Folder Structure

The system works with **any** folder structure. On first use, it scans and adapts.

The AI can propose an initial structure and periodically analyze the corpus to suggest reorganization. Suggestions are presented to the user — never auto-applied. Example of a suggested structure:

```
vault/
├── notes/              # General knowledge notes
├── journal/            # Daily/periodic entries
│   └── 2026/
│       └── 03/
├── projects/           # Active projects
├── tasks/              # Task-oriented notes
├── references/         # Bookmarks, citations, saved articles
├── contacts/           # People notes
├── snippets/           # Code snippets, templates
├── media/              # Images, PDFs, attachments
└── inbox/              # Unsorted capture (triage target)
```

### 3.4 Links Between Files

Links in markdown use **standard syntax only**: `[Display Text](relative/path/to/note.md)` or `[Display Text](relative/path/to/note.md#heading)`.

The intelligence layer maintains a parallel link graph in the database that includes:
- Links explicitly written by the user in markdown (parsed from files)
- AI-suggested semantic links (stored in DB only, never written to files)
- User-confirmed AI links (can optionally be written as standard markdown links upon user approval)

---

## 4. Intelligence Layer

### 4.1 Database

**SQLite** is the primary database. Rationale:
- Single file, zero configuration, no server process
- Runs on every platform (Mac, Windows, Linux, Android, iOS)
- Full-text search via FTS5 with BM25 ranking
- Can store vector embeddings for semantic search (via extensions or application-level cosine similarity)
- Handles tens of thousands of notes with negligible performance impact

The database stores everything the content layer does not:

#### Core Tables (conceptual — final schema TBD)

**`files`** — Metadata index of all content files
- `id`, `path`, `filename`, `title`, `type`, `created`, `modified`, `content_hash`, `word_count`

**`frontmatter`** — Parsed YAML properties (key-value per file)
- `file_id`, `key`, `value`, `value_type`

**`links`** — All relationships between files
- `id`, `source_file_id`, `target_file_id`, `link_type` (explicit, semantic_ai, user_confirmed), `context` (surrounding text), `confidence` (for AI links), `created`

**`embeddings`** — Vector representations for semantic search
- `file_id`, `chunk_id`, `chunk_text`, `embedding` (BLOB or JSON array), `model`, `created`

**`annotations`** — Highlights, comments, bookmarks (parallel to content, not in files)
- `id`, `file_id`, `line_start`, `line_end`, `content_hash` (for resilience to edits), `annotation_type` (highlight, comment, bookmark), `text`, `created`

**`tags`** — Unified tag index (from frontmatter + AI-suggested)
- `file_id`, `tag`, `source` (frontmatter, ai_suggested, user_confirmed)

**`tasks`** — Extracted/managed tasks
- `id`, `file_id`, `line_number`, `content_hash`, `text`, `status` (open, done, cancelled), `due_date`, `priority`, `project`, `created`

**`spatial_layouts`** — Canvas/board layouts (replaces Obsidian Canvas)
- `id`, `name`, `layout_data` (JSON — positions, connections, groups), `created`, `modified`

**`queries`** — Saved queries/views (replaces Dataview)
- `id`, `name`, `query_type` (sql, semantic, graph), `query_text`, `display_format` (table, list, calendar, kanban), `created`

**`activity_log`** — Tracks indexing, AI operations, user actions
- `id`, `action`, `details`, `timestamp`

### 4.2 Indexer

The indexer is the bridge between the content layer and the database. It operates in three modes (user-configurable):

**Mode 1: On-demand**
- User explicitly triggers indexing via Claude Code command or app UI button
- Scans all files (or changed files since last index), updates database
- Suitable for users who want full control

**Mode 2: Background watcher + on-demand heavy tasks**
- A lightweight filesystem watcher detects file changes (create, modify, delete, rename)
- On change: re-indexes the affected file(s) immediately (fast — parsing + metadata extraction)
- Heavy tasks (embedding generation, semantic link discovery, summarization) run on-demand only
- Recommended default for most users

**Mode 3: Fully automatic**
- Background watcher as in Mode 2
- Additionally: embedding generation and semantic link discovery run automatically when idle or on a schedule
- Suitable for users who want a fully hands-off experience

#### What the indexer does on each file:

1. **Parse** — Extract frontmatter, headings, content blocks, standard links, task items
2. **Hash** — Compute content hash to detect changes efficiently
3. **Index text** — Update FTS5 full-text search index
4. **Extract metadata** — Tags, dates, mentioned entities (people, places, concepts)
5. **Parse links** — Identify all outgoing `[text](path)` links, update link graph
6. **Queue AI tasks** — If in Mode 2/3, queue embedding generation and semantic analysis

### 4.3 AI Engine

The AI engine handles all intelligence operations. It is provider-agnostic — operations are defined as abstract tasks, with provider-specific adapters.

#### Provider Interface (abstract)

```
EmbeddingProvider:
  embed(text: string) -> vector (float array)
  embed_batch(texts: string[]) -> vector[]

CompletionProvider:
  complete(prompt: string, system: string) -> string
  complete_structured(prompt: string, schema: JSONSchema) -> object
```

Adapters to implement:
- **Claude (Anthropic API)** — via `@anthropic-ai/sdk` or `anthropic` Python SDK
- **OpenAI** — via `openai` SDK
- **Local models (Ollama)** — via local HTTP API
- **Other** — extensible by adding new adapters

#### AI Operations

Each operation is a discrete, auditable action. The system logs what it did and why.

**4.3.1 Semantic Embedding Generation**
- Input: File content (chunked into paragraphs or sections)
- Output: Vector embeddings stored in `embeddings` table
- Trigger: On index (Mode 2/3) or on-demand
- Purpose: Powers semantic search and similarity-based linking

**4.3.2 Semantic Link Discovery**
- Input: A file's embedding compared against all other file embeddings
- Output: Candidate links with confidence scores, stored in `links` table as `link_type = 'semantic_ai'`
- Trigger: On-demand or automatic (Mode 3)
- The user reviews and confirms/rejects suggested links. Confirmed links can optionally be written as standard markdown links in the source file (with user approval).
- Threshold: Configurable similarity threshold. Default: suggest links above 0.75 cosine similarity.

**4.3.3 Auto-Categorization**
- Input: File content
- Output: Suggested tags, content type, and folder placement
- Trigger: On new file creation (inbox triage) or on-demand
- Uses completion provider to analyze content and suggest categories based on existing tag taxonomy and folder structure

**4.3.4 Summarization**
- Input: File content (or group of files)
- Output: Summary stored in database (not in the file)
- Trigger: On-demand
- Use cases: Generate note summaries for search results, create overview notes for topic clusters, daily digest of recent additions

**4.3.5 Entity Extraction**
- Input: File content
- Output: Extracted entities (people, places, organizations, concepts, dates) stored in database
- Trigger: On index or on-demand
- Powers: "Show me all notes mentioning [person]" without requiring explicit tags

**4.3.6 Structure Analysis & Suggestions**
- Input: Entire corpus metadata (folder structure, file distribution, tag usage, link density)
- Output: Suggestions for reorganization, orphan detection, tag consolidation, knowledge gaps
- Trigger: On-demand or periodic (e.g., weekly)
- Presented as suggestions — never auto-applied

**4.3.7 Natural Language Query**
- Input: User question in plain English
- Output: Answer synthesized from relevant notes, with citations
- Trigger: On-demand via Claude Code or app UI
- Process: Semantic search to find relevant chunks -> pass to completion provider with context -> return answer with source references

**4.3.8 Content Generation**
- Input: User instruction (e.g., "create a meeting note for today's standup with team members from my contacts")
- Output: New markdown file with generated content
- Trigger: On-demand via Claude Code
- Uses database context (contacts, projects, recent notes) to generate relevant content

---

## 5. Claude Code Integration

Claude Code serves as both a power-user interface and the system builder/maintainer.

### 5.1 User-Facing Operations (via Claude Code)

These are the things a user can ask Claude Code to do in natural language:

**Knowledge operations:**
- "What do I know about [topic]?" — semantic search + synthesis
- "Find notes related to [concept]" — semantic similarity search
- "Summarize my notes on [topic]" — multi-note summarization
- "What connections am I missing?" — run link discovery, report new suggestions
- "Show me orphan notes" — notes with zero links
- "What have I written about this week?" — temporal query

**Content operations:**
- "Create a note about [topic]" — generates clean markdown
- "Create a daily journal entry" — from template, with context
- "Add a task: [description] due [date]" — creates/updates task in appropriate file
- "Capture this bookmark: [url]" — fetches title/summary, creates reference note

**Maintenance operations:**
- "Re-index everything" — full re-scan and re-index
- "Generate embeddings for new notes" — process unembedded files
- "Suggest tag consolidation" — analyze tag usage, propose merges
- "Analyze my folder structure" — suggest reorganization
- "Run link discovery" — find new semantic connections
- "Show system status" — index freshness, embedding coverage, DB size

**Bulk operations:**
- "Retag all notes in /projects/old from #active to #archived"
- "Move all notes mentioning [person] to /contacts/[person]/"
- "Convert all wikilinks in imported files to standard markdown links"
- "Extract all tasks from my journal entries into a tasks overview"

### 5.2 System Building & Maintenance (Claude Code as developer)

Claude Code also builds and maintains the system itself:
- Writing and updating the indexer scripts
- Building and modifying the database schema
- Creating and updating AI operation implementations
- Building the app UI components
- Debugging, optimizing, and extending the system

---

## 6. Cross-Platform App UI

### 6.1 Purpose

The app provides what Claude Code cannot: visual browsing, interactive graphs, dashboards, spatial canvases, and mobile access. It reads from the same SQLite database the intelligence layer writes to.

### 6.2 Technology Options (Trade-offs)

This decision is deferred. The spec presents options:

| Approach | Platforms | Pros | Cons |
|----------|-----------|------|------|
| **Progressive Web App (PWA)** | All (any browser) | Single codebase. Works on Mac, Windows, Android, iOS, Linux. Installable. Offline-capable via service worker. | Limited native integration. File system access via File System Access API (Chrome/Edge) or manual folder selection. No background processing on mobile. |
| **Web app + local server** | All (browser connects to localhost) | Full file system access. SQLite access via server. Works on all desktop platforms. Mobile access if server is network-accessible. | Requires running a local server process. Mobile requires network connectivity to the server (not truly local on device). |
| **Tauri (desktop) + PWA (mobile)** | Mac, Windows, Linux (native) + mobile (browser) | Native performance on desktop. Full file system and SQLite access. Small binary size. Mobile via PWA or responsive web. | Two codebases to maintain (Tauri + web). More complexity. |
| **Electron (desktop) + React Native (mobile)** | All | Full native capabilities on every platform. | Two codebases. Electron is heavy (~100MB+). Significant development effort. |
| **Web app hosted on a server you control** | All (browser) | True cross-platform including mobile. Single codebase. Accessible from anywhere. | Requires a server. Data leaves local machine. Latency for remote access. |

**Recommendation to evaluate first:** A **web app with a local server** (e.g., a lightweight Python/Node HTTP server that serves the UI and provides API access to SQLite) is likely the simplest starting point. It gives full database and filesystem access, runs on all desktop platforms, and the same UI can later be deployed to a remote server for mobile access. If native mobile is needed, a PWA wrapper or Tauri Mobile (experimental) could be added later.

### 6.3 Core UI Features

The app replaces and extends the Obsidian features that require a visual interface:

#### 6.3.1 File Browser
- Tree view of the folder structure
- File metadata display (type, tags, link count, last modified)
- Quick preview of note content
- Drag-and-drop organization (with confirmation — moves actual files)

#### 6.3.2 Note Viewer / Editor
- Renders clean CommonMark markdown
- Displays annotations from the database as overlays (highlights, comments) without modifying the file
- Shows backlinks panel (from database link graph)
- Shows AI-suggested links (from semantic analysis) with accept/reject controls
- Shows entity references (people, places, concepts extracted by AI)
- Optional: basic markdown editing. For full editing, user opens their preferred editor (VS Code, Typora, etc.)

#### 6.3.3 Graph View
Replaces Obsidian's graph. Powered by the database link graph.

- **Global graph**: All notes as nodes, all links as edges (explicit + confirmed semantic)
- **Local graph**: Neighborhood of a selected note with depth control
- **Semantic graph**: Nodes positioned by embedding similarity (t-SNE/UMAP projection) — notes cluster by meaning, not just explicit links
- **Temporal graph**: Shows how the knowledge base evolved over time (filterable by date range)
- **Filters**: By tag, type, folder, date range, link type (explicit vs. AI-suggested), minimum connection count
- **Color coding**: By tag, type, folder, or custom grouping
- **Interaction**: Click node to open note, hover for preview, drag to rearrange

Technology: D3.js force-directed graph for 2D, optional 3d-force-graph (ThreeJS) for 3D exploration.

#### 6.3.4 Search
- **Full-text search**: SQLite FTS5 with BM25 ranking
- **Semantic search**: "Find notes about [concept]" — uses embeddings
- **Structured search**: Filter by tags, type, date range, link count, etc.
- **Combined**: Natural language queries that combine all three
- Results display: Ranked list with matched context snippets, relevance scores, and source highlighting

#### 6.3.5 Dashboards / Saved Views (Replaces Dataview)
- User creates saved queries (SQL, semantic, or natural language)
- Results rendered as: table, list, calendar, kanban board, or timeline
- Dashboards combine multiple saved views on one screen
- Views update automatically when underlying data changes (database triggers or polling)
- All query logic and results live in the database — nothing in the markdown files

Example saved views:
- "Active projects" — table of notes with `type: project` and tag `#active`
- "This week's journal" — calendar view of journal entries from the past 7 days
- "Tasks due soon" — kanban board of tasks grouped by status, sorted by due date
- "Most connected notes" — ranked list by link count
- "Knowledge gaps" — orphan notes or clusters with low inter-linking

#### 6.3.6 Canvas / Spatial View (Replaces Obsidian Canvas)
- Infinite zoomable canvas
- Place notes (by reference — no duplication), images, text cards
- Connect elements with labeled arrows
- Group elements into clusters
- Layout data stored in `spatial_layouts` table as JSON — files are never modified
- Opening a note from the canvas opens it in the viewer

#### 6.3.7 Inbox / Triage
- Shows files in the inbox folder (or untagged/uncategorized files)
- AI suggests: tags, type, destination folder, related notes
- User confirms/edits suggestions
- One-click to apply (moves file, updates frontmatter with user approval)

#### 6.3.8 Activity & Analytics
- Recent activity timeline (new notes, edits, AI operations)
- Knowledge base statistics (total notes, links, tags, coverage)
- Growth over time charts
- Tag usage distribution
- Link density heatmap

---

## 7. Feature Map: Obsidian Equivalents & Beyond

| Obsidian Feature | This System's Equivalent | Where It Lives |
|-----------------|-------------------------|---------------|
| `[[Wikilinks]]` | Standard `[text](path.md)` links + AI-suggested links | Explicit links in files; AI links in database |
| Backlinks panel | Database query of all files linking to current file | Database + app UI |
| Unlinked mentions | AI semantic similarity (goes beyond exact title matching) | Database + app UI |
| Graph View | Multiple graph types: force-directed, semantic, temporal | App UI (D3.js / ThreeJS) |
| Dataview queries | Saved SQL/semantic queries with table/list/calendar/kanban rendering | Database + app UI |
| Bases | Direct database views over frontmatter properties | Database + app UI |
| Canvas | Spatial layouts stored as JSON in database | Database + app UI |
| Daily Notes | Claude Code command or app UI button; template-based generation | Claude Code + app UI |
| Templates | Claude Code generates from templates or natural language | Claude Code |
| Tags | Standard YAML frontmatter tags + AI-suggested tags in database | Files (frontmatter) + database |
| Highlights | Annotation overlay in app UI; stored in database | Database + app UI |
| Comments | Annotation overlay; stored in database | Database + app UI |
| Search | FTS5 + semantic search + structured queries | Database + app UI + Claude Code |
| Publish | Static site generator (Hugo/Astro) + Git-based CI/CD | External tooling (Claude Code sets up) |
| Sync | Git for version control; file sync service for multi-device | External tooling |
| Community plugins | Claude Code builds custom features as needed | Claude Code |
| Mobile app | Cross-platform app UI (see Section 6.2) | App UI |

**Beyond Obsidian:**

| Capability | Description |
|-----------|-------------|
| AI auto-linking | Semantic similarity discovers connections without manual linking |
| Natural language queries | "What do I know about X?" with synthesized answers and citations |
| Entity extraction | Automatic detection of people, places, concepts across all notes |
| Auto-categorization | AI suggests tags, type, and folder for new content |
| Bulk operations | Claude Code operates on thousands of files programmatically |
| Knowledge gap analysis | AI identifies under-connected topics, suggests areas to develop |
| Structure suggestions | Periodic analysis of folder/tag organization with improvement proposals |
| Semantic map | 2D/3D visualization of notes positioned by meaning (embedding projection) |
| Multi-format dashboards | Saved queries rendered as tables, calendars, kanban, timelines |
| Activity analytics | Growth tracking, link density heatmaps, contribution patterns |

---

## 8. AI Processing Pipeline

When a new file is created or modified, the intelligence layer processes it through this pipeline:

```
File created/modified
        │
        ▼
  ┌─────────────┐
  │ 1. Parse     │  Extract frontmatter, headings, links, tasks, content blocks
  └──────┬──────┘
         ▼
  ┌─────────────┐
  │ 2. Hash      │  Compute content hash; skip if unchanged
  └──────┬──────┘
         ▼
  ┌─────────────┐
  │ 3. Index     │  Update FTS5 index, file metadata, parsed links, tags
  └──────┬──────┘
         ▼
  ┌─────────────────────────────────────────┐
  │ 4. AI Tasks (on-demand or auto)         │
  │                                         │
  │  a. Generate embeddings (per chunk)     │
  │  b. Extract entities                    │
  │  c. Discover semantic links             │
  │  d. Suggest categorization (if inbox)   │
  │  e. Generate summary (if requested)     │
  └─────────────────────────────────────────┘
         ▼
  ┌─────────────┐
  │ 5. Notify    │  Update UI (if running), log activity
  └─────────────┘
```

Steps 1-3 are always immediate (fast, local-only).
Step 4 depends on the automation mode (Section 4.2).
Step 5 notifies the app UI via WebSocket or polling.

---

## 9. Deployment Architecture Options

This decision is deferred. The spec presents trade-offs:

### Option A: Fully Local

```
Your Machine
├── /vault (markdown files)
├── /vault/.knowledge/db.sqlite (database)
├── Local server process (serves app UI on localhost)
└── Claude Code (CLI access)
```

- **Pros**: Data never leaves your machine. No server costs. No internet needed (except for cloud AI API calls). Simplest setup.
- **Cons**: No mobile access unless you're on the same machine. Multi-device requires file sync (Git/Dropbox) + separate SQLite instance per device (potential divergence).

### Option B: Local + Optional Self-Hosted Server

```
Your Machine (primary)
├── /vault (markdown files, synced via Git/Syncthing)
├── Local SQLite database
├── Local server for app UI
└── Claude Code

Optional: Self-Hosted Server (VPS, NAS, home server)
├── Synced /vault copy
├── Central SQLite database (source of truth)
├── App UI served over HTTPS
└── API for mobile access
```

- **Pros**: Local-first with optional remote access. Mobile devices connect to the server. Central database avoids divergence. Can run AI tasks on the server.
- **Cons**: Requires maintaining a server. Data is on a remote machine (your own, but still). More moving parts.

### Option C: Cloud-Hosted (Self-Managed)

```
VPS / Cloud Server
├── /vault (Git repo, authoritative copy)
├── SQLite database
├── App UI served over HTTPS
├── AI processing
└── API for all clients

Your Devices (Mac, Windows, phone)
├── Thin clients (browser) connecting to server
└── Optional: synced local copy of /vault for offline editing
```

- **Pros**: True multi-device from day one. Central database. Can scale AI processing. Accessible from anywhere.
- **Cons**: Data on a server (encrypted, but still remote). Requires internet. Server cost ($5-20/month VPS). More complex setup.

### Recommendation

Start with **Option A** (fully local). It's the simplest, works immediately, and avoids premature complexity. The architecture is designed so that migrating to Option B or C later requires only:
1. Moving the SQLite file to a server
2. Pointing the app UI at a remote URL instead of localhost
3. Setting up file sync for the vault

The database schema and API are the same regardless of deployment model.

---

## 10. What to Build First (Suggested Phases)

### Phase 1: Foundation
- SQLite database with core schema (files, frontmatter, links, embeddings, tags)
- Indexer: file scanner + parser + FTS5 indexing
- Claude Code commands: index, search (full-text), status
- Standard markdown link parsing and backlink computation

### Phase 2: AI Intelligence
- Embedding generation (provider-agnostic, start with Claude or OpenAI)
- Semantic search (query by meaning)
- Semantic link discovery (suggest connections)
- Entity extraction
- Claude Code commands: semantic search, discover links, extract entities

### Phase 3: App UI (Minimum Viable)
- Local web server serving the app
- File browser with metadata
- Note viewer with backlinks and AI-suggested links
- Full-text + semantic search interface
- Basic force-directed graph view

### Phase 4: Advanced App Features
- Saved queries / dashboards (Dataview replacement)
- Canvas / spatial view
- Inbox triage with AI suggestions
- Activity analytics
- Graph view enhancements (semantic map, temporal, 3D)

### Phase 5: Multi-Device & Polish
- Deployment to a server (Option B or C)
- Mobile-optimized UI
- Background watcher (filesystem events)
- Fully automatic mode (Mode 3)
- Performance optimization for large vaults

---

## 11. Open Questions

These need answers before or during implementation:

1. **Embedding model choice**: Which model for embeddings? Trade-offs: Claude embeddings (if available), OpenAI `text-embedding-3-small` (cheap, good), local models via Ollama (free, private, slower). This affects vector dimensions and storage.

2. **Chunk strategy**: How to chunk notes for embedding? By paragraph, by heading section, by fixed token count? Affects search granularity vs. cost.

3. **Frontmatter policy**: Should the system ever write to frontmatter automatically (e.g., adding `modified` date)? Or always require user confirmation?

4. **Link writing policy**: When the user confirms an AI-suggested link, should the system write a standard markdown link into the source file? Or keep it database-only?

5. **Conflict resolution**: If the same vault is edited on two devices before syncing, how are database conflicts handled? (File conflicts are handled by Git/sync tool, but the database needs its own strategy.)

6. **App framework final decision**: PWA, local web server, Tauri, or Electron? (See Section 6.2 trade-offs.)

7. **Offline AI**: Should the system support fully offline AI via local models (Ollama)? This affects architecture — local models need significant RAM/GPU.

8. **Cost management**: Cloud AI API calls cost money. Should the system track and budget API costs? Alert when spending exceeds a threshold?

---

## 12. Non-Goals (Explicit Exclusions)

To keep the system simple:

- **Not a real-time collaborative editor.** This is a personal knowledge management system. Multi-user collaboration is out of scope.
- **Not a proprietary format.** The system never creates file formats that require this system to read.
- **Not a replacement for a text editor.** The app UI provides viewing and basic editing. For serious writing, the user uses their preferred editor.
- **Not an Obsidian clone.** The goal is not to replicate Obsidian's UI. It's to provide the capabilities Obsidian offers (and more) while maintaining full portability.

---

*This is a first draft. Every section is open for discussion, revision, or removal.*
