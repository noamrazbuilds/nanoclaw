# Obsidian: Features Research -- Consensus Draft

**Date:** 2026-03-27
**Status:** Consensus (merged from Alpha and Beta drafts after peer critique)

---

## 1. Core Features: What Is Obsidian?

Obsidian is a knowledge management and note-taking application developed by **Dynalist Inc.**, founded by **Shida Li** and **Erica Xu**, who met while studying at the University of Waterloo. It is written in JavaScript, HTML, and CSS. The first public beta launched on **March 30, 2020**, with version 1.0.0 released on **October 13, 2022**. Steph Ango joined as CEO in February 2023. The current stable release is **1.12.7** (as of March 23, 2026).

### Local-First Architecture

Obsidian's defining architectural principle is **local-first storage**. All notes are stored as plain-text **Markdown (.md) files** in a regular folder on the user's own computer. There is no proprietary database, no mandatory cloud dependency, and no vendor lock-in. Notes can be opened and edited with any text editor, ensuring long-term durability and portability. The app works fully offline with zero functionality loss. Even if Obsidian ceases to exist, the Markdown files remain usable indefinitely.

### Vaults

A **vault** is simply a folder on the local filesystem that Obsidian treats as a self-contained workspace. Each vault has its own:

- Notes (Markdown `.md` files)
- Configuration (settings, hotkeys, CSS snippets)
- Plugin installations and settings
- Theme preferences

Users can maintain multiple vaults for different contexts (e.g., work, personal, research), each completely independent. All notes within a vault are searchable, linkable, and visualizable.

### Supported Platforms

Obsidian runs on **Windows, macOS, Linux, iOS, and Android**. There is no web-based version -- all clients are native applications. Mobile versions support the same core feature set, though the editing experience is adapted for touch interfaces.

### Pricing (as of 2025-2026)

The core application is **completely free for both personal and commercial use**, with no feature limitations. Since 2025, the previous commercial license requirement has been removed. Optional paid services:

- **Obsidian Sync**: $4/month (billed annually) or $5/month (billed monthly)
- **Obsidian Publish**: $8/month (billed annually) or $10/month (billed monthly)

---

## 2. Linking & Relationship System

Obsidian's linking system is central to its identity as a knowledge management tool. Understanding what is manual versus automatic is essential.

### Wiki-Style Internal Links (User-Created)

Users **manually** create links between notes by typing `[[`, which triggers an autocomplete popup. Obsidian supports two link formats:

- **Wikilink format** (default): `[[Note Name]]`
- **Standard Markdown format**: `[display text](path/to/note.md)`

Both formats are tracked identically in Obsidian's internal metadata cache.

Internal links support multiple reference types:

| Reference Type | Syntax | Example | Purpose |
|---|---|---|---|
| File link | `[[filename]]` | `[[Meeting Notes]]` | Basic note connection |
| Heading link | `[[file#heading]]` | `[[Research#Methods]]` | Link to a specific section |
| Block link | `[[file#^blockid]]` | `[[Notes#^ab123c]]` | Paragraph-level precision |
| Same-file heading | `[[#heading]]` | `[[#Conclusion]]` | Internal navigation |
| Alias display | `[[file\|display text]]` | `[[AI\|Artificial Intelligence]]` | Custom display text |

**Link creation is manual by default.** Obsidian does NOT automatically generate links between notes. The user must explicitly type `[[` and select or type a target note name. The system assists with autocomplete but does not create links on its own.

### Backlinks (Automatic Detection of Incoming Links)

The **Backlinks** core plugin automatically detects and displays all notes that link TO the currently active note. This is passive detection, not link creation. The panel shows two categories:

**Linked Mentions:** Notes containing explicit `[[current note]]` or `[[current note|alias]]` links pointing to the active note. These are the bidirectional counterpart to forward links.

**Unlinked Mentions:** Text occurrences of the active note's name (or its aliases) that appear in other notes but are NOT wrapped in `[[]]` link syntax. Obsidian detects these automatically by scanning note content for string matches. This is a particularly powerful discovery mechanism -- it reveals connections the user may not have been aware of when writing.

The Backlinks panel can be displayed in three locations:
1. **Sidebar tab** -- updates dynamically as the active note changes
2. **Linked tab** -- pinned to a specific note
3. **In-document** -- shown at the bottom of the note content

The search filter within backlinks uses the same operator syntax as the core Search plugin (e.g., `tag:#meeting -task`).

### Converting Unlinked Mentions to Links

When an unlinked mention is displayed in the Backlinks panel, the user can click a **"Link"** button next to it. Obsidian then wraps that text occurrence in `[[]]` syntax, converting it into an explicit link. This is a **user-initiated action** -- Obsidian surfaces the suggestion but does not auto-link.

### Tags and Nested Tags

Tags are created by the user with the `#` prefix anywhere in a note (e.g., `#project`, `#meeting`). Obsidian indexes them automatically for search and filtering. Tags can also be defined in YAML frontmatter (properties).

**Nested tags** use `/` as a hierarchy separator: `#projects/mobile`, `#learning/spanish`. Searching for a parent tag (e.g., `#learning`) returns all notes with that tag *and* any nested children (e.g., `#learning/spanish`, `#learning/math`).

**Limitation:** Obsidian does **not** support tag aliases natively. A workaround is to use nested tags (e.g., `#learning/lernen` as a sub-tag of `#learning`).

### Aliases

Aliases provide **alternative names** for a note, defined in YAML frontmatter:

```yaml
---
aliases:
  - AI
  - Machine Intelligence
---
```

When a user types `[[AI` in any note, the autocomplete system matches both filenames and defined aliases, generating `[[Artificial Intelligence|AI]]` format links. Aliases also affect unlinked mention detection -- if a note has an alias "AI," Obsidian will detect unlinked mentions of "AI" across the vault.

### Summary: Manual vs. Automatic

| Feature | Manual or Automatic? |
|---|---|
| Creating `[[internal links]]` | **Manual** -- user types them |
| Backlinks (linked mentions) | **Automatic detection** of existing manual links |
| Unlinked mentions | **Automatic detection** of note-name text matches |
| Converting unlinked to linked | **Manual** -- user clicks "Link" button |
| Tag creation | **Manual** -- user types `#tag` |
| Tag indexing | **Automatic** -- Obsidian indexes all tags |
| Link integrity on rename/move | **Automatic** -- Obsidian updates all links when files are renamed or moved |

**Community plugins for auto-linking:** Plugins like **Automatic Linker**, **Auto Keyword Linker**, and **PhraseSync** can automate link creation by scanning notes for text matching existing note names and converting them to wiki-links. However, this is not core Obsidian functionality.

---

## 3. Search

Search is a **core plugin** with its own query syntax that underpins several other features (Graph View filters, Backlinks filters). It supports:

- Full-text search across the vault
- Operators: `tag:`, `path:`, `file:`, `line:`, `section:`, `property:`
- Boolean operators: `AND`, `OR`, `-` (negation)
- Regex support
- Search results display matched lines with context and can be copied or navigated directly

The same query syntax is reused in Graph View filters and Backlinks panel filters.

---

## 4. Graph View

The Graph View is a core plugin that renders the vault's link structure as an interactive **force-directed graph**.

### Global Graph

The **global graph** displays all notes in the vault (subject to active filters). Each note is a **node** (circle), and each internal link between notes is an **edge** (connecting line). Node size is proportional to the number of incoming links. Opened via the ribbon icon or the "Open graph view" command.

### Local Graph

The **local graph** shows only notes connected to the currently active note, within a configurable **depth**:

- **Depth 1:** Only directly linked notes
- **Depth 2:** Adds notes linked to depth-1 notes
- **Depth N:** Recursively includes notes N hops away

The local graph updates dynamically when the active note changes (unless pinned).

### Node Types

| Node Appearance | Represents |
|---|---|
| Standard circle | Markdown files (.md) |
| Standard circle | Canvas files (.canvas) |
| Smaller circle | Non-existent files (referenced but not yet created) |
| Isolated circle | Orphan notes (zero connections) |
| Circle (when enabled) | Tags |
| Circle (when enabled) | Attachments |

### Filters

The graph view provides a **search filter** that accepts the same query syntax as Obsidian's core Search plugin. Additional toggle filters:

- **Tags** (off by default) -- shows tags as nodes
- **Attachments** (off by default) -- shows attachment files as nodes
- **Existing files only** (off by default) -- hides unresolved/non-existent links
- **Orphans** (on by default) -- shows notes with zero connections

### Groups (Color Coding)

Users can create **groups** that apply color to nodes matching a search query. Multiple groups can be active simultaneously. If a node matches multiple groups, it displays the color of the first matching group.

### Display Settings

| Setting | Function |
|---|---|
| Arrows | Toggle directional indicators on edges |
| Text fade threshold | Control when note labels become visible (0-100 slider) |
| Node size | Scale node circle sizes |
| Link thickness | Scale edge line width |
| Animate | Enable time-lapse animation of graph construction |

### Forces (Layout Physics)

The force-directed layout is controlled by four parameters:

| Force | Effect |
|---|---|
| Center force | Gravitational pull drawing nodes toward the center |
| Repel force | Nodes push away from each other |
| Link force | Spring-like tension between linked nodes |
| Link distance | Target length of edges |

Clusters of heavily interlinked notes naturally emerge from the link topology.

---

## 5. Unique Capabilities

### Properties (Frontmatter)

Notes can include structured metadata via **YAML frontmatter** at the top of the file:

```yaml
---
tags:
  - research
  - ai
aliases:
  - ML Notes
date: 2026-03-27
status: draft
---
```

Properties are indexed and searchable, and can be used in graph view filters, Dataview queries, Bases views, and search operators. Obsidian 1.4+ introduced a **visual Properties editor** for editing frontmatter without writing raw YAML.

### Canvas (Infinite Whiteboard)

**Canvas** is a core plugin providing an infinite spatial workspace for visual thinking.

- **Card types supported:** Text cards, embedded Markdown notes (editable in-place), images, videos, PDFs, web pages (including YouTube), and nested Canvas files
- **Connections:** Cards can be connected with labeled, colored lines
- **Storage format:** Canvas files use the **JSON Canvas** open format (`.canvas` files)
- **Features:** Auto-resizing cards, grid snapping, alignment tools, card grouping, color customization, and export to image
- **Limitation:** Canvas does not support real-time collaboration

### Bases (New in 2025)

Bases is a **core plugin** released in Obsidian 1.9 that brings database-like functionality to the vault.

- Creates dynamic **table views** from note properties (YAML frontmatter data)
- Users can sort, filter, and edit notes through database-style views
- **v1.10:** Calculated fields (totals, averages, counts), grouping by property, interactive map views, list views
- **v1.11:** CSV-to-Markdown conversion
- **v1.12:** Search within Bases
- All data remains in standard Markdown files with YAML properties -- no proprietary database

Bases represents a direct competitive response to Notion's database functionality, achieved while preserving Obsidian's plain-Markdown data model.

### Daily Notes

The **Daily Notes** core plugin creates a new note for the current date with a single click or command.

- Configurable date format (default: `YYYY-MM-DD`)
- Custom folder location (supports nested structures like `YYYY/MM-MMMM/YYYY-MM-DD-dddd`)
- Template integration -- a template file is automatically applied when a new daily note is created
- Accessible via ribbon calendar icon or Command Palette

### Templates

The **Templates** core plugin allows users to insert pre-defined content into notes. Template files are regular Markdown files stored in a designated folder. Built-in variables: `{{title}}`, `{{date}}`, and `{{time}}` with configurable formats. For advanced templating, see the Templater community plugin below.

### Obsidian Publish

Publish is a paid service ($8-10/month) that turns selected vault notes into a **hosted website**. Features include:

- Custom domain support
- Navigable graph view for visitors
- Password protection for private sites
- Hover previews, backlinks display, and stacked page navigation
- SEO optimization and mobile responsiveness
- Up to 4 GB hosting per site
- Customizable themes

Publish is a hosted service, not a static site generator (free alternatives like Quartz exist for self-hosted publishing).

### Obsidian Sync

Sync is a paid service ($4-5/month) providing:

- **End-to-end AES-256 encryption** (Obsidian cannot read your data)
- Sync across unlimited devices
- **12 months of version history** per note
- Selective folder syncing

Sync is optional -- users can also sync vaults via iCloud, Dropbox, Git, or any file-syncing service since vaults are just folders of files.

---

## 6. Plugin Ecosystem

### Scale and Architecture

As of early 2026, there are approximately **2,700+ community plugins** available through the built-in plugin browser. The ecosystem sees continuous growth, with roughly 6-7 new plugins and ~85-96 plugin updates per week.

Plugins are divided into two categories:

- **Core plugins:** Built-in, maintained by the Obsidian team (e.g., Backlinks, Graph View, Canvas, Daily Notes, Templates, Search, Bases, File Explorer, Outgoing Links, Outline, Bookmarks). These can be individually enabled or disabled.
- **Community plugins:** Third-party plugins built using Obsidian's public API. Installing community plugins requires the user to disable **Restricted Mode** (a safety setting). Plugins are reviewed before listing in the community directory.

### Notable Community Plugins

**Dataview** -- Treats your vault as a queryable database. Users write queries in a SQL-like language (DQL) or JavaScript (DataviewJS) to generate dynamic tables, lists, and task views from note metadata (frontmatter properties, tags, links, inline fields).

**Templater** -- A significantly more powerful alternative to the core Templates plugin:
- Full templating language with variables and functions
- JavaScript execution within templates
- Date math and manipulation
- Dynamic content generation on note creation
- Integration with other plugins (Dataview, Buttons)
- Ability to read/write YAML frontmatter programmatically

**Other widely-used plugins:** Calendar (visual daily notes navigation), Kanban (trello-style boards), Excalidraw (hand-drawn diagrams), Periodic Notes (weekly/monthly/yearly notes), Tasks (task management with due dates and queries), Obsidian Git (automatic vault backup to Git repositories).

### Extensibility Model

Obsidian's API allows plugins to:
- Add new views and panes
- Register commands and hotkeys
- Modify the editor behavior
- Process and transform Markdown
- Add settings tabs
- Access the vault's file system and metadata cache
- Create custom code blocks with rendered output
- Create custom view types for Bases (as of v1.10)

Plugins are written in JavaScript/TypeScript. Themes are also customizable via CSS snippets, and the community maintains hundreds of themes.

---

## 7. What Makes Obsidian Genuinely Unique

### Local-First Ownership in a Cloud-Dominated Landscape

While competitors like Notion, Roam Research, and Evernote store data on their servers, Obsidian stores everything locally as plain Markdown. No vendor lock-in, no data loss risk from service shutdown, full offline functionality, and privacy by default.

### Bidirectional Linking + Unlinked Mentions Discovery

While Roam Research pioneered bidirectional linking in the PKM space, Obsidian's combination of backlinks and **unlinked mentions** creates a unique discovery mechanism. The ability to see where a concept is mentioned across the vault -- even without explicit links -- and selectively convert those mentions into links is a distinctly powerful workflow.

### Unmatched Extensibility

With 2,700+ community plugins and an open API, Obsidian can be transformed into a task manager, CRM, habit tracker, writing studio, academic research tool, or project management system. The depth of customization far exceeds Notion (closed block system) and Roam (smaller plugin ecosystem).

### Bases: Databases in Plain Markdown

The Bases core plugin (2025) gives Obsidian database-like capabilities while keeping data in plain Markdown -- something competitors like Notion achieve only through proprietary formats. Structured data views without sacrificing data portability.

### Performance at Scale

Obsidian handles vaults with tens of thousands of notes efficiently because it operates on local files with an in-memory metadata cache, rather than querying a remote database.

### Free Core Product

The full-featured core application is free with no limitations, no user caps, and no feature gating. Paid services (Sync and Publish) are entirely optional and replaceable with third-party alternatives. This is unusual in the PKM space.

### Canvas as an Integrated Visual Layer

Unlike competitors that require separate whiteboard tools (Miro, FigJam), Obsidian's Canvas operates directly on vault notes -- embedding and editing actual notes within the canvas, maintaining a single source of truth.

### Open File Format as a Feature

The use of plain Markdown and JSON Canvas as storage formats is a deliberate philosophical choice. Notes created today will remain readable decades from now by any text editor.

---

## Sources

- [Obsidian Official Site](https://obsidian.md/)
- [Obsidian Wikipedia](https://en.wikipedia.org/wiki/Obsidian_(software))
- [Obsidian Pricing](https://obsidian.md/pricing)
- [Obsidian Help - Backlinks](https://help.obsidian.md/plugins/backlinks)
- [Obsidian Help - Graph View](https://help.obsidian.md/plugins/graph)
- [Obsidian Help - Properties](https://help.obsidian.md/Editing+and+formatting/Properties)
- [Obsidian Help - Tags](https://help.obsidian.md/tags)
- [Obsidian Help - Aliases](https://help.obsidian.md/aliases)
- [Obsidian Help - Daily Notes](https://help.obsidian.md/plugins/daily-notes)
- [Obsidian Help - Bases](https://help.obsidian.md/bases)
- [Obsidian Canvas](https://obsidian.md/canvas)
- [Obsidian Plugins Directory](https://obsidian.md/plugins)
- [DeepWiki - Internal Links and Graph View](https://deepwiki.com/obsidianmd/obsidian-help/4.2-internal-links-and-graph-view)
- [DeepWiki - Graph View](https://deepwiki.com/victor-software-house/obsidian-help/3.3-graph-view)
- [DeepWiki - Canvas Visual System](https://deepwiki.com/obsidianmd/obsidian-help/6-canvas-visual-system)
- [ObsidianStats](https://www.obsidianstats.com/)
- [Costbench - Obsidian Pricing](https://costbench.com/software/note-taking/obsidian/)
- [Eesel.ai - Obsidian Overview](https://www.eesel.ai/blog/obsidian-overview)
- [Neowin - Obsidian 1.10 Release](https://www.neowin.net/news/obsidian-1100-released-with-new-features-and-improvements-for-bases/)
- [XDA Developers - Graph View](https://www.xda-developers.com/how-to-visualize-your-notes-in-obsidian-with-graph-view/)
- [GitHub - Templater](https://github.com/SilentVoid13/Templater)
- [Obsidian Forum - Backlinks](https://forum.obsidian.md/t/how-do-backlinks-work/52280)
- [ObsidianStats - Auto-linking Plugins](https://www.obsidianstats.com/tags/auto-linking)
- [Medium - Unlinked Mentions](https://medium.com/a-voice-in-the-conversation/obsidian-core-plugin-unlinked-mentions-4c8659bd299f)
- [dsebastien - Best Obsidian Plugins 2026](https://www.dsebastien.net/the-must-have-obsidian-plugins-for-2026/)
- [Sinapsus - Obsidian vs Notion vs Roam](https://sinapsus.com/blog/obsidian-vs-notion-vs-roam-2025)
- [dannb.org - Daily Note Template](https://dannb.org/blog/2022/obsidian-daily-note-template/)
