# myICOR / @myicor YouTube — Video Content
Research window: January 27 – March 28, 2026
30 videos found. Compiled: March 28, 2026

---

## ENTRY Y1: "Give Me 8 Min. You're Using Claude Wrong."

summary: Tom maps the full Claude product ecosystem — Chat, Code (browser/desktop/terminal), Cowork, Chrome Extension, Mobile, and Office integrations — arguing that Claude Chat is the wrong starting point. Claude Code on desktop is the recommended default, with Cowork as a middle layer and mobile as a "remote control" for Code. Most people never reach the tools that provide real productivity leverage.
key_claims:
- "Claude has 7 different versions and most people use the wrong one."
- Claude Chat has no persistent memory or real context; Claude Code on desktop does via local folders and CLAUDE.md.
- Mobile Claude is best used as a remote control for your Claude Code sessions, not as a standalone tool.
- Claude Cowork sits between Chat and Code; Code is more powerful.
entities:
  people: [Tom Solid]
  organizations: [Paperless Movement S.L., Anthropic]
  products: [Claude Chat, Claude Code, Claude Cowork, Claude Chrome Extension, Claude Mobile, Claude Desktop, Excel integration, PowerPoint integration, CLAUDE.md]
  tags: [Claude product map, Claude Code, Cowork, persistent memory, plan mode, March 2026]
sources:
- url: https://www.youtube.com/watch?v=EtpjdEWyjzo
  date: March 26, 2026
  credibility: high
  confidence: high
  confidence_reason: Video content directly accessed by browser agent; timestamps and descriptions verified.
conflicts: none

**Narrative:** This short-form video functions as an entry point for new Claude users overwhelmed by Anthropic's product suite. Tom's core argument is that the browser-based Claude Chat — which most users discover first — is also the least powerful version. It lacks persistent memory, local file access, and real tool integrations. Claude Code on the desktop, by contrast, can read and write local folders, runs CLAUDE.md files as persistent memory/instruction layers, supports plan mode (review before execution), and can run multiple parallel terminal sessions. Claude Cowork is a GUI layer on top of Code that's more accessible but somewhat less powerful. The Chrome Extension only becomes useful when run through Cowork or Code, not standalone. Mobile is reframed as a remote control: useful for issuing commands to your desktop Code session, not a primary interface.

---

## ENTRY Y2: "Claude Just Killed OpenClaw, Perplexity Computer and ChatGPT 5.4"

summary: Anthropic acquired a company giving Claude native Mac Computer Use — the ability to open apps, click buttons, control the desktop end-to-end without workarounds. Tom demonstrates exporting a pitch deck to PDF and attaching it to a calendar event, launching a dev server and sending a screenshot to his phone, and batch-processing 150 photos — all via natural language to Claude. Declares OpenClaw, Perplexity Computer, and ChatGPT Operator obsolete.
key_claims:
- Anthropic acquired a company enabling native Mac Computer Use (no AppleScript workarounds).
- Claude can now control macOS end-to-end: open apps, click buttons, export files, attach to calendar events.
- Recommends using a dedicated Mac Mini as a Claude agent machine.
- OpenClaw, Perplexity Computer, and ChatGPT Operator are now "dead" because Claude does this natively and more safely.
entities:
  people: [Tom Solid]
  organizations: [Anthropic, Paperless Movement S.L., OpenAI, Perplexity]
  products: [Claude (Mac Computer Use), OpenClaw, Perplexity Computer, ChatGPT Operator, PowerPoint, Pixel Forge app]
  tags: [Mac Computer Use, Anthropic acquisition, agentic AI, March 2026]
sources:
- url: https://www.youtube.com/watch?v=YMFzGo4nNac
  date: March 24, 2026
  credibility: high
  confidence: high
  confidence_reason: Direct browser access; 31,742 views corroborates high-interest claim.
conflicts: none

**Narrative:** This is the second-most-viral video in the 30-day window (31,742 views). The core news is Anthropic acquiring a company that enables true native Mac integration — Claude can now control macOS applications directly rather than through screenshot-and-click workarounds. Tom demos three use cases: (1) launching PowerPoint, building a pitch deck, exporting as PDF, and automatically attaching it to a Google Calendar event; (2) spinning up a dev server in Claude Code, verifying it's running, and sending a screenshot confirmation to his phone; (3) batch-processing 150 photos in an app called Pixel Forge via natural language. The Mac Mini recommendation (a dedicated always-on Claude machine) is a recurring theme in his content — he positions it as the "agent machine" that runs your AI team 24/7. The video is 3 minutes long — unusually short — suggesting it's designed as a news item rather than a tutorial.

---

## ENTRY Y3: "Don't Use Obsidian With Claude. Use VS Code."

summary: Part 3 of the PKA (Personal Knowledge Assistance) series. Tom demonstrates his daily workflow using a PKA folder opened in VS Code with multiple Claude Code terminal sessions running in parallel — no coding required. Key argument: VS Code is free, built by Microsoft (same foundation as Cursor and Windsurf), and offers full portability, whereas Obsidian creates hidden lock-in via wiki links, Dataview frontmatter, and plugin dependencies.
key_claims:
- VS Code is free and is the same foundation used by Cursor and Windsurf.
- Multiple Claude terminals can run in parallel within VS Code — each handling a different task simultaneously.
- Obsidian's "local files" promise is misleading because wiki links, Dataview, and plugin formats create system lock-in.
- Claude's /loop command enables recurring tasks inside the terminal.
- Claude's /model command lets you switch between Claude models mid-session.
entities:
  people: [Tom Solid]
  organizations: [Paperless Movement S.L., Anthropic, Microsoft]
  products: [VS Code, Claude Code, Obsidian, Cursor, Windsurf, Wispr Flow, Claude Mobile, /loop command, /model command]
  tags: [VS Code, PKA, portability, Claude Code, parallel sessions, March 2026]
sources:
- url: https://www.youtube.com/watch?v=1RIXGL5Vgag
  date: March 23, 2026
  credibility: high
  confidence: high
  confidence_reason: Direct browser access; 24-minute tutorial with verified timestamps.
conflicts: none

**Narrative:** This is the most technically detailed video in the last 30 days. Tom's daily workflow involves: opening his PKA folder in VS Code, spawning multiple Claude terminal sessions (each focused on a different agent/task), and issuing commands in natural language — converting Word docs to PDF, building SQLite database tables via plan mode, running AI agent research, and accessing everything from mobile via the Claude app. The Obsidian critique is pointed: he acknowledges Obsidian's "your files are local" promise is real in a narrow sense, but argues the system itself isn't portable because wiki links break when moved, Dataview frontmatter is Obsidian-specific, and plugin dependencies recreate the same fragility that cloud apps have. VS Code, by contrast, is a generic text editor that simply opens a folder — the folder works anywhere. The /loop and /model commands are Claude Code terminal features: /loop runs a prompt on a recurring interval, /model switches the underlying Claude model.

---

## ENTRY Y4: "Claude just killed ALL Note-Taking Apps. Here is proof."

summary: The most-viewed video in the 60-day window (117,520 views). A 55-minute walkthrough of building a complete Personal Knowledge Assistance (PKA) system from an empty folder using Claude Code — no code written manually. Tom creates an AI orchestrator named Larry, specialist agents (Pax for research, Nolan for HR, Sable the developer), a SQLite database covering journaling/contacts/files, processes 119 scanned PDFs via OCR, and generates a browser-based HTML dashboard. Concludes that all PKM apps are now obsolete.
key_claims:
- A complete knowledge management system can be built from an empty folder using only Claude Code and natural language — no manual coding.
- CLAUDE.md files serve as the AI's persistent memory and instruction set.
- Plan mode lets you review every proposed action before it executes.
- Local LLMs can be used for privacy-sensitive data processing.
- Obsidian's "local files" promise was "always a lie" due to system lock-in.
- Named AI agents (Larry, Pax, Nolan, Sable) with defined roles create a manageable AI team structure.
entities:
  people: [Tom Solid]
  organizations: [Paperless Movement S.L., Anthropic]
  products: [Claude Code, SQLite, CLAUDE.md, Larry (AI agent), Pax (AI agent), Nolan (AI agent), Sable (AI agent), Obsidian, Roam Research, Notion, Mem, Tana, Heptabase, ClickUp]
  tags: [PKA, Claude Code, SQLite, OCR, AI agents, named agents, plan mode, local LLM, flagship video, March 2026]
sources:
- url: https://www.youtube.com/watch?v=geIKyDaXwGg
  date: March 22, 2026
  credibility: high
  confidence: high
  confidence_reason: 117,520 views; directly accessed; 55-minute tutorial with verified chapter markers.
conflicts: none

**Narrative:** This is the flagship video of the research window and the clearest articulation of Tom's current thesis: all dedicated PKM apps are obsolete because Claude Code can build a better system from scratch in an afternoon. The live build runs 55 minutes and is entirely unscripted — he starts from an empty desktop folder. Key moments: (1) "Hiring" Larry as the orchestrator by writing a CLAUDE.md file describing his role; (2) Larry "hiring" Pax (research) and Nolan (HR) as specialists; (3) Nolan hiring Sable (developer) to build the system backend; (4) processing 119 scanned PDFs via OCR into the SQLite database; (5) Sable building a browser-based HTML dashboard with tabs for contacts, journal, and files. The plan mode demonstration is notable — before executing any significant change, Claude presents a numbered action plan and waits for approval, addressing the "AI going rogue" concern directly. The local LLM option (for privacy-sensitive data) is briefly shown — suggesting the system doesn't require Anthropic's servers for everything. The video ends with a pitch for an myICOR workshop where members can build this system together.

---

## ENTRY Y5: "Why your note-taking app will die in 2026"

summary: Follow-up to Entry Y4, addressing the concern "aren't you just depending on Claude now?" Tom argues Claude is the brain/intelligence layer, not the storage system — files remain local markdown and SQLite databases, fully portable if Anthropic disappeared. Reveals that co-founder Paco independently reached the same PKA conclusion from his own starting point (Tana). Both have quit their previous PKM apps.
key_claims:
- Claude is the intelligence layer; the files themselves (markdown, SQLite) are fully portable without Claude.
- Obsidian has MORE hidden lock-in than Claude-based systems because wiki links, Dataview, and plugins aren't standard formats.
- Paco independently built an equivalent system starting from Tana — validating the approach from a different angle.
- The two-folder system scales to 30+ AI specialists across business and personal domains.
- "PKM doesn't look like a note-taking app anymore."
entities:
  people: [Tom Solid, Paco Cantero]
  organizations: [Paperless Movement S.L., Anthropic]
  products: [Claude, Obsidian, Heptabase, Tana, ClickUp]
  tags: [PKA, portability, Anthropic dependency, Obsidian lock-in, Paco, two-folder system, March 2026]
sources:
- url: https://www.youtube.com/watch?v=5MzCFcPiJlg
  date: March 21, 2026
  credibility: high
  confidence: high
  confidence_reason: Direct browser access; 8-minute video with verified timestamps.
conflicts: none

**Narrative:** This video exists to preempt the most obvious objection to the PKA system: "What if Anthropic shuts down or changes its API?" Tom's answer is that the files are the system — Claude reads them, but doesn't own them. The actual data lives in local markdown files and SQLite databases. If Claude disappeared, the files would remain readable by any text editor or SQLite browser. He then inverts the comparison: Obsidian files look portable (they're markdown), but an Obsidian-based PKM system is actually locked in via wiki links (which break outside Obsidian), Dataview frontmatter (Obsidian-specific query syntax), and plugin dependencies. The Paco subplot is interesting — it validates the approach independently. Paco built his system starting from Tana (not from the Tom-recommended stack), and arrived at the same two-folder, Claude Code, SQLite conclusion. Tom frames this as "proof" the methodology is tool-agnostic.

---

## ENTRY Y6: "I Built 30 Claude AI Agents. They Replaced My PKM."

summary: Introductory video to the PKA series. Explains the conceptual shift from PKM (Personal Knowledge Management — organizing your own notes) to PKA (Personal Knowledge Assistance — AI agents managing knowledge on your behalf). Tom's system: two folders, 30+ Claude AI agents. Folder 1 is the business team; Folder 2 covers private life (health, finance, family).
key_claims:
- PKA replaces PKM: instead of organizing your own knowledge, AI agents do it for you.
- The system runs on two folders: business (30+ specialists) and personal life (health, finance, family).
- After 10+ years across Obsidian, Heptabase, Tana, and Notion, Tom stopped using all of them.
- ICOR methodology is the required foundation before building AI agents.
entities:
  people: [Tom Solid]
  organizations: [Paperless Movement S.L., Anthropic]
  products: [Claude, Obsidian, Heptabase, Tana, Notion, Mem, ICOR Framework]
  tags: [PKA, PKM, AI agents, two-folder system, March 2026]
sources:
- url: https://www.youtube.com/watch?v=XQOFLAE2WKI
  date: March 21, 2026
  credibility: high
  confidence: high
  confidence_reason: Direct browser access; 8-minute intro video with verified timestamps.
conflicts: none

**Narrative:** This is the conceptual entry point to the PKA series. The key terminological shift — from PKM to PKA — reframes the entire category. Traditional PKM assumes you do the knowledge work; PKA assumes AI agents do it and you interact with the results. The "two folders" architecture is the practical expression of this: one folder per life domain (business, personal), each containing CLAUDE.md instruction files and specialist agent definitions. Tom's claim of 10+ years across Obsidian, Heptabase, Tana, and Notion before quitting them all is a strong credibility signal for his target audience (people who have already tried multiple PKM apps and are frustrated). The ICOR prerequisite is notable — he explicitly says you need the methodology foundation before building AI agents, otherwise "you're just automating chaos." This is also the commercial pitch: learn ICOR at myICOR first, then build your AI team.

---

## ENTRY Y7: "Claude's Chrome Extension Is Useless (Without This)"

summary: The Claude Chrome Extension in isolation has no context, memory, or tool connections. The fix is running it through Claude Cowork or Claude Code, which gives it access to your working folder, CLAUDE.md memory, and MCP connectors. Side-by-side flight research demo shows the quality difference. Also demos Google Calendar MCP pulling live schedule data vs. slow screenshot-based calendar reading.
key_claims:
- Chrome Extension standalone = no context, no memory, no connections.
- Chrome Extension through Cowork/Code = full working folder access, persistent memory, MCP connectors.
- Google Calendar MCP connector is dramatically faster and more accurate than screenshot-based calendar reading.
- Most users are getting a fraction of Claude's capability because they use the extension standalone.
entities:
  people: [Tom Solid]
  organizations: [Paperless Movement S.L., Anthropic, Google]
  products: [Claude Chrome Extension, Claude Cowork, Claude Code, Google Calendar MCP, Wispr Flow, Heptabase, Tana, Todoist, Sunsama, ClickUp, Miro, Superhuman, MeetGeek, Raycast, Descript]
  tags: [Chrome Extension, MCP, Google Calendar, Cowork, March 2026]
sources:
- url: https://www.youtube.com/watch?v=Ea2EHpgv40I
  date: March 15, 2026
  credibility: high
  confidence: high
  confidence_reason: Direct browser access; 5-minute tutorial with verified timestamps.
conflicts: none

---

## ENTRY Y8: "Claude Cowork Can Show You Exactly Why Your Business Won't Scale"

summary: Using a single natural language prompt in Claude Cowork, Tom builds a complete interactive business growth dashboard — no code written. The dashboard maps client process flow, identifies that 18 hours of work creates 72 hours of delays, generates a delegation plan, and runs a growth simulator showing capacity scaling from 9 to 96 clients and revenue from $45K to $1.2M/month.
key_claims:
- One prompt in Claude Cowork generates a full interactive HTML business dashboard.
- Demo reveals 18 hours of client work causes 72 hours of downstream delays (cascade effect).
- Delegation simulator: removing 1 of 6 bottleneck tasks → 9 to 12 clients; removing all → capacity for 96 clients.
- Revenue growth simulator: $45K to $1.2M/month modeled interactively.
- Dashboard can connect to Excel, Google Sheets, or APIs for live data.
entities:
  people: [Tom Solid]
  organizations: [Paperless Movement S.L., Anthropic]
  products: [Claude Cowork, Excel, Google Sheets, Wispr Flow, Heptabase, Tana, Todoist, Sunsama, ClickUp, Miro, Superhuman, MeetGeek, Raycast]
  tags: [Claude Cowork, business scaling, dashboard, delegation, growth simulator, March 2026]
sources:
- url: https://www.youtube.com/watch?v=JYTsJcEXW3k
  date: March 14, 2026
  credibility: high
  confidence: high
  confidence_reason: Direct browser access; 8-minute tutorial with verified timestamps and chapter markers.
conflicts: none

---

## ENTRY Y9: "75% of Your Job Is AI-Exposed. Now What?"

summary: Drawing on an Anthropic study claiming 75% of professional tasks are AI-assisted or replaceable, plus Block's 4,000-person layoff citing AI, Tom argues that "learn AI" is bad advice without a system first. ICOR positions AI in the Refine stage — not as a replacement for the whole system, but as the engine within a structured workflow.
key_claims:
- Anthropic research: 75% of professional tasks can be AI-assisted or replaced.
- Block fired 4,000 people citing AI as partial justification.
- NBC poll: 56% of Americans use AI at work; 46% view it negatively.
- "Learn AI" without a system is ineffective and anxiety-inducing.
- Paper still wins for initial capture because it's low-friction.
- AI belongs in the ICOR "Refine" stage, not at the top of the workflow.
entities:
  people: [Tom Solid]
  organizations: [Paperless Movement S.L., Anthropic, Block Inc., NBC]
  products: [ICOR Framework]
  tags: [AI displacement, Block layoffs, Anthropic research, ICOR Refine, March 2026]
sources:
- url: https://www.youtube.com/watch?v=mvr-ialAR7Y
  date: March 11, 2026
  credibility: high
  confidence: medium
  confidence_reason: Direct browser access. The 75% Anthropic statistic and Block layoff reference are cited but not linked — independently verifiable but unverified here.
conflicts: none

---

## ENTRY Y10: "I Replaced ChatGPT With a 30-Person Claude AI Team"

summary: Against the backdrop of the #CancelChatGPT movement (295% increase in ChatGPT uninstalls after a Pentagon deal, Claude hitting #1 on the App Store), Tom explains his 30-person Claude AI team — Larry (orchestrator), Sage (LinkedIn), Marty (YouTube), Felix (coder), Penn (scriptwriter), Pixel (thumbnails), Jax (community). One content pipeline reached 36,000 impressions in 24 hours. Notes Claude became a "game changer since Opus 4.6."
key_claims:
- OpenAI Pentagon deal triggered a 295% increase in ChatGPT uninstalls and 775% increase in 1-star reviews.
- Claude hit #1 on the App Store in the weeks following.
- Both Claude and ChatGPT cost $20/month — the differentiator is whether the tool lets you build persistent systems (Claude does, ChatGPT does not).
- The 30-person AI team includes Larry, Sage, Marty, Felix, Penn, Pixel, Jax.
- One content pipeline: trend → script → thumbnail → post → 36,000 impressions in 24 hours.
- "Claude became a game changer since Opus 4.6."
entities:
  people: [Tom Solid]
  organizations: [Paperless Movement S.L., Anthropic, OpenAI, US Pentagon]
  products: [Claude Code, Claude Opus 4.6, ChatGPT, Larry, Sage, Marty, Felix, Penn, Pixel, Jax (AI agents), Wispr Flow]
  tags: [ChatGPT vs Claude, #CancelChatGPT, Claude Opus 4.6, AI team, content pipeline, March 2026]
sources:
- url: https://www.youtube.com/watch?v=yjJrwmKiats
  date: March 5, 2026
  credibility: high
  confidence: medium
  confidence_reason: Direct browser access. Uninstall/review statistics (295%, 775%) are cited without primary source link — treat as directional.
conflicts: none

---

## ENTRY Y11: "I Built a Full Learning Platform With Claude. Alone."

summary: Full walkthrough of myICOR 4.0, built entirely by Tom using Claude Code without an agency or dev team. The platform has 28 AI specialists with animal avatars, a full course system, ICOR glossary, MCP server for Claude Desktop, ICOR Tool Finder, Jax the AI community manager, Inner Circle coaching with timestamped transcripts, Readwise sync, journal creator, and workstream creator. 2,114 members at time of recording.
key_claims:
- myICOR 4.0 was built by one person (Tom) using Claude Code.
- 28 AI specialists with animal-themed personas manage different platform functions.
- myICOR MCP server connects members' Claude Desktop to the platform's knowledge base.
- ICOR Tool Finder filters tools by job title, industry, and company size using real member data.
- "95% of businesses fail to implement AI" — myICOR exists to be the exception framework.
- Platform has 2,114 members as of March 1, 2026.
entities:
  people: [Tom Solid, Paco Cantero]
  organizations: [Paperless Movement S.L., Anthropic, Mighty Networks]
  products: [myICOR 4.0, Claude Code, MCP Server, myICOR MCP, ICOR Tool Finder, Jax (AI community manager), Readwise, Inner Circle, Workstream Creator]
  tags: [myICOR platform, Claude Code, no-code development, MCP, March 2026]
sources:
- url: https://www.youtube.com/watch?v=o5JWJWbAooU
  date: March 1, 2026
  credibility: high
  confidence: high
  confidence_reason: Direct browser access; 27-minute platform tour with verified timestamps.
conflicts: none

---

## ENTRY Y12: "I Put Claude AI Inside Excel and PowerPoint. Here's What Happened."

summary: Claude as a Microsoft 365 add-in: requires an M365 Business plan with company add-in permissions enabled. Tom demos generating mock pharmaceutical production data in Excel, building pivot tables, and generating a 7-slide PowerPoint from that data. Draws on his pharma background (FDA audit prep) to explain the real-world use case. Warning: always use copies, never run on live production data.
key_claims:
- Claude works as a Microsoft 365 add-in (not a standalone integration) — requires M365 Business plan.
- Company IT admin must enable add-in permissions.
- Demo: Claude generates mock pharma production data → pivot tables → 7-slide PowerPoint.
- Warning: never run Claude on live production data — use copies.
entities:
  people: [Tom Solid]
  organizations: [Paperless Movement S.L., Anthropic, Microsoft, Hoffmann-La Roche (background reference)]
  products: [Claude (M365 add-in), Excel, PowerPoint, Microsoft 365 Business]
  tags: [Microsoft 365, Excel, PowerPoint, Claude add-in, pharma, February 2026]
sources:
- url: https://www.youtube.com/watch?v=K_7NnHw3nyE
  date: February 27, 2026
  credibility: high
  confidence: high
  confidence_reason: Direct browser access; 6-minute tutorial with verified timestamps.
conflicts: none

---

## ENTRY Y13: "Claude Cowork Now Schedules Itself. No Code Needed."

summary: Claude Cowork's new Scheduled Tasks tab enables recurring, autonomous task execution — daily, hourly, or weekly — without any code. Tom demos a scan inbox that auto-organizes documents at 7 AM and writes a report, and a daily AI trend report that pulls web news before you start your day. Team use case: shared folders where a scheduled AI aggregates deliverables across people, eliminating status-update overhead.
key_claims:
- Claude Cowork now has a Scheduled Tasks tab — no code required to set up recurring AI tasks.
- Tasks can run daily, hourly, or weekly and execute autonomously.
- Document scan automation: organizes files at 7 AM and generates a summary report.
- Daily trend report: pulls web news and has it ready when you sit down.
- Team use: shared folder + scheduled AI replaces status meetings and chasing updates.
entities:
  people: [Tom Solid]
  organizations: [Paperless Movement S.L., Anthropic]
  products: [Claude Cowork, Scheduled Tasks (Cowork feature), Wispr Flow, Heptabase, Tana, Todoist, Sunsama, ClickUp, Miro, Superhuman, MeetGeek, Raycast, Descript]
  tags: [Claude Cowork, scheduled tasks, automation, document scanning, February 2026]
sources:
- url: https://www.youtube.com/watch?v=uw4NTr8V56Y
  date: February 25, 2026
  credibility: high
  confidence: high
  confidence_reason: Direct browser access; 9-minute tutorial with verified timestamps.
conflicts: none

---

## ENTRY Y14: "He Uses Claude Code for Life Management (Not Programming)"

summary: 60-minute deep-dive featuring Paco's personal "mindset" system — a local Claude Code workspace managing his entire life. Includes 2,880+ journal entries, automatic CRM updates, AI coaching after every journal entry, and a read-only HTML dashboard. Connected to Tana, Readwise Reader, and Day One via MCP. Paco runs 4 businesses at age 50; total Claude subscription cost $100/month.
key_claims:
- Paco's "mindset" workspace is a local Claude Code folder managing his entire personal and professional life.
- 2,880+ journal entries feed AI context, enabling personalized coaching and CRM updates.
- SQLite is chosen over cloud tools for privacy and control.
- MCP connects the system to Tana (task/project), Readwise Reader (read later), and Day One (journaling).
- Dashboard is read-only; the only input is natural language conversation.
- Monthly cost: $100 Claude subscription on a standard laptop.
entities:
  people: [Paco Cantero]
  organizations: [Paperless Movement S.L., Anthropic]
  products: [Claude Code, Tana, Readwise Reader, Day One, SQLite, MCP, ICOR My Life methodology]
  tags: [Paco, mindset system, life management, journal, CRM, MCP, SQLite, February 2026]
sources:
- url: https://www.youtube.com/watch?v=HspEwH-AkbQ
  date: February 24, 2026
  credibility: high
  confidence: high
  confidence_reason: Direct browser access; 60-minute deep-dive with verified timestamps.
conflicts: none

---

## ENTRY Y15: "Claude Pro vs Max vs API: What I Actually Pay"

summary: Clear cost breakdown of Claude pricing tiers. Tom runs two Max plan subscriptions ($400/month total) due to all-day Claude Code usage. For most professionals, the $20 Pro plan is sufficient. Critical warning: tools like OpenClaw use the API (pay-per-token), and running them on a Pro/Max account violates Anthropic's ToS and risks account termination.
key_claims:
- Claude Pro = $20/month; Max = $100/month (5x usage limits); two Max plans = Tom's $400/month spend.
- Pro plan replaces $1,000+ in other tools according to Tom.
- API is pay-per-token and can drain money fast — "$50 in 30 minutes accidentally."
- Running OpenClaw (or similar API-consuming tools) on a Pro/Max account violates Anthropic ToS and can get accounts banned.
- Recommendation: start with Pro, upgrade to Max only if hitting usage limits regularly.
entities:
  people: [Tom Solid]
  organizations: [Paperless Movement S.L., Anthropic]
  products: [Claude Pro, Claude Max, Claude API, OpenClaw]
  tags: [Claude pricing, Pro vs Max, API costs, OpenClaw ToS, February 2026]
sources:
- url: https://www.youtube.com/watch?v=TdVDZnFL2F4
  date: February 23, 2026
  credibility: high
  confidence: high
  confidence_reason: Direct browser access; 5-minute explainer, 29,416 views.
conflicts: none

---

## ENTRY Y16: "I Gave Claude Cowork a Memory. Now It Runs My Work."

summary: Comprehensive guide to building a personal AI assistant workspace from scratch using Claude Code — under 10 minutes, no coding. Covers: creating the workspace folder, onboarding Claude with natural language, building the CLAUDE.md "brain," scaling to a full AI team, connecting ClickUp and Google Workspace, and automating document scanning (32 documents processed automatically in the demo).
key_claims:
- A full AI assistant workspace can be set up in under 10 minutes with no coding.
- CLAUDE.md is the "brain" — a plain text file Claude reads as its instruction set and memory.
- The same approach scales from a personal assistant to a full AI team.
- Claude (vs ChatGPT) is recommended for privacy — Claude doesn't use your content for training by default.
- Entry point: $20/month Claude Pro.
entities:
  people: [Tom Solid]
  organizations: [Paperless Movement S.L., Anthropic, OpenAI]
  products: [Claude Code, Claude Cowork, CLAUDE.md, ClickUp, Google Workspace, Wispr Flow]
  tags: [Claude Code, personal assistant, CLAUDE.md, workspace setup, Google Workspace, February 2026]
sources:
- url: https://www.youtube.com/watch?v=8ZRqKp0uWMk
  date: February 22, 2026
  credibility: high
  confidence: high
  confidence_reason: Direct browser access; 26-minute tutorial, 30,273 views.
conflicts: none

---

## ENTRY Y17: "I Taught Claude Who I Am. You're Still Starting Over."

summary: Tour of 15 Claude features most professionals never explore. Key revelation: Cowork mode is NOT the same as Projects — Projects give persistent memory and live Google Docs access; Cowork runs Claude Code with local folder access and CLAUDE.md files. Also covers Skills (SOPs stored as text), Connectors (Google Drive, Slack, Notion), Plugins (Productivity/Marketing/Sales/Data), and Styles.
key_claims:
- Claude Cowork and Claude Projects are fundamentally different — most users confuse them.
- Skills = SOPs: you can store standard operating procedures as text files Claude follows.
- Connectors give live access to Google Drive, Slack, and Notion from within Claude.
- Plugins extend Claude for Productivity, Marketing, Sales, and Data verticals.
- Memory feature allows Claude to remember things across sessions without CLAUDE.md files.
entities:
  people: [Tom Solid]
  organizations: [Paperless Movement S.L., Anthropic, Google, Slack, Notion]
  products: [Claude Desktop, Claude Chat, Claude Projects, Claude Cowork, Claude Code, Claude Memory, Claude Skills, Claude Connectors, Claude Plugins, Claude Chrome Extension, CLAUDE.md, Google Drive, Slack, Notion]
  tags: [Claude features, Cowork vs Projects, Skills, Connectors, Plugins, Memory, February 2026]
sources:
- url: https://www.youtube.com/watch?v=A4rrL4WAb_8
  date: February 21, 2026
  credibility: high
  confidence: high
  confidence_reason: Direct browser access; 21-minute feature tour with verified timestamps.
conflicts: none

---

## ENTRY Y18: "The System Behind Every Good AI Output"

summary: Short-form conceptual video arguing that prompt lists without context fail. AI is an amplifier — same model produces vastly different outputs with different context. The fix is building a context layer (not collecting prompts). Part of the myICOR "AI Like a Pro" course series.
key_claims:
- Prompt lists don't work because prompts without context lack the "kitchen" (infrastructure) to cook in.
- AI is an amplifier: same model + poor context = poor output; same model + rich context = excellent output.
- The solution is a context layer, not more prompts.
- Tool-agnostic approach is essential — the method works regardless of which AI tool you use.
entities:
  people: [Tom Solid]
  organizations: [Paperless Movement S.L.]
  products: [ICOR Framework, myICOR "AI Like a Pro" course]
  tags: [AI prompting, context layer, AI amplifier, February 2026]
sources:
- url: https://www.youtube.com/watch?v=9ykWNNj9_R4
  date: February 20, 2026
  credibility: high
  confidence: high
  confidence_reason: Direct browser access.
conflicts: none

---

## ENTRY Y19: "I Connected Claude Cowork to All My Tools. Game Changer."

summary: Demo of Claude Cowork's connector system giving live access to Gmail, Google Calendar, and ClickUp. Live inbox demo with 223 unread emails produces a triage result, automatically creates tasks in ClickUp, and flags a critical budget alert. Also explains MCP, Skills as SOPs, and the myICOR custom MCP connector.
key_claims:
- Claude Cowork can access live Gmail, Google Calendar, and ClickUp data via connectors.
- Demo: 223 unread emails → triage, ClickUp tasks created, budget alert flagged automatically.
- Skills = SOPs: standardized outputs stored as text, reusable without retyping instructions.
- myICOR has its own MCP connector that gives Claude access to the platform's methodology and context.
- "Work about work" (status meetings, email chasing) is the productivity killer Cowork eliminates.
entities:
  people: [Tom Solid]
  organizations: [Paperless Movement S.L., Anthropic, Google]
  products: [Claude Cowork, Gmail, Google Calendar, ClickUp, Superhuman, Wispr Flow, MeetGeek, myICOR MCP, MCP (Model Context Protocol)]
  tags: [Claude Cowork, connectors, MCP, Gmail triage, ClickUp, SOPs, February 2026]
sources:
- url: https://www.youtube.com/watch?v=LoDz4vcrr5M
  date: February 19, 2026
  credibility: high
  confidence: high
  confidence_reason: Direct browser access; 24-minute tutorial with verified timestamps.
conflicts: none

---

## ENTRY Y20: "I Connected 9 Productivity Apps to One AI (Not the Way You Think)"

summary: Introduction to MCP (Model Context Protocol) servers as the integration layer for AI productivity. First public reveal of the myICOR MCP. Live demo connects Claude simultaneously to ClickUp, Miro, Heptabase, Readwise, Gmail, and Todoist. Positions MCP as the evolution beyond NotebookLM/Gemini. Explains why they built MCP instead of an in-app AI coach.
key_claims:
- MCP (Model Context Protocol) is the real superpower for AI productivity — connecting Claude to any tool stack simultaneously.
- First reveal of the myICOR MCP connector.
- NotebookLM is "a step in the right direction but not far enough."
- ICOR methodology makes tool stacks AI-readable (structure precedes MCP effectiveness).
- The in-app AI coach approach was rejected because of cost and API key management complexity.
entities:
  people: [Tom Solid]
  organizations: [Paperless Movement S.L., Anthropic, Google, Mem]
  products: [Claude, MCP, myICOR MCP, NotebookLM, Gemini, ClickUp, Miro, Heptabase, Readwise, Gmail, Todoist]
  tags: [MCP, Model Context Protocol, myICOR MCP, NotebookLM, tool integration, February 2026]
sources:
- url: https://www.youtube.com/watch?v=LhXF_PWuciY
  date: February 16, 2026
  credibility: high
  confidence: high
  confidence_reason: Direct browser access.
conflicts: none

---

## ENTRY Y21: "I Built a Team of AI Employees (They Actually Work)"

summary: Introduction to Tom's 14-person AI team running on Claude Max. Named specialists include Larry (orchestrator), Pixel (designer), Penn (scriptwriter), Mack (automation), Silas (database architect), and others. MCP connections to ClickUp, Miro, Heptabase, Gmail, and Todoist. Tech stack: Claude Max, MCP servers, Telegram interface, SQLite backend.
key_claims:
- 14-person AI team runs on Claude Max; each specialist has a name, personality, and biography.
- Telegram is used as the interface for interacting with the AI team.
- Skills = SOPs: natural language replaces rigid automation rules.
- SQLite is the backend database; Supabase used for some functions.
- "No autopilot" rule: AI agents act only when approved, not autonomously.
- 2026 is when AI becomes accessible to everyone via natural language interfaces.
entities:
  people: [Tom Solid]
  organizations: [Paperless Movement S.L., Anthropic]
  products: [Claude Max, Larry, Pixel, Penn, Mack, Silas (AI agents), Telegram, SQLite, Supabase, MCP, ClickUp, Miro, Heptabase, Readwise, Gmail, Todoist, Perplexity]
  tags: [AI team, Claude Max, named agents, Telegram, SQLite, Supabase, SOPs, February 2026]
sources:
- url: https://www.youtube.com/watch?v=Caf19id9kEQ
  date: February 16, 2026
  credibility: high
  confidence: high
  confidence_reason: Direct browser access; 13-minute tutorial with verified timestamps.
conflicts: none

---

## ENTRY Y22: "Claude Cowork Analyzed 10 Years of My Data (It Knows More Than I Do)"

summary: Tom uses Claude Cowork to analyze his entire MacBook content plus the open web about himself. Claude searches Drive, Gmail, Readwise, ClickUp, and the web, finds old interviews and surprise profiles, and writes his 2018–2026 career timeline. Summary: "From Burnout to Building a Global Productivity Movement." Connects personal journal (Day One) for a private biography layer.
key_claims:
- Claude Cowork can analyze your entire digital footprint — local files plus the open web — in a single session.
- "The internet never forgets" — Claude found profiles Tom didn't know existed.
- Claude wrote Tom's career timeline: "From Burnout to Building a Global Productivity Movement" (2018–2026).
- Privacy wake-up call: full digital self-analysis reveals more than expected.
entities:
  people: [Tom Solid]
  organizations: [Paperless Movement S.L., Anthropic]
  products: [Claude Cowork, Google Drive, Gmail, Readwise, ClickUp, Day One]
  tags: [Claude Cowork, digital biography, privacy, career timeline, February 2026]
sources:
- url: https://www.youtube.com/watch?v=_G2TR7r1h5E
  date: February 15, 2026
  credibility: high
  confidence: high
  confidence_reason: Direct browser access.
conflicts: none

---

## ENTRY Y23: "How This Makes You the Bottleneck in Your Business"

summary: Email-centric management creates bottlenecks and communication chaos. Introduces ICOR's Team Communication System as the fix — moving from email dependency to a structured project management layer.
key_claims:
- Email dependency is the primary cause of being a bottleneck in your own business.
- ICOR's Team Communication System replaces email-centric management.
- Choosing the right project management tool is step one of the fix.
entities:
  people: [Tom Solid]
  organizations: [Paperless Movement S.L.]
  products: [ICOR Team Communication System, ICOR Framework]
  tags: [email, bottleneck, team communication, project management, February 2026]
sources:
- url: https://www.youtube.com/watch?v=Q_3fXf15P1k
  date: February 12, 2026
  credibility: high
  confidence: high
  confidence_reason: Direct browser access.
conflicts: none

---

## ENTRY Y24: "I Thought OpenClaw Was Scary… Then My Claude AI Assistant Went Rogue"

summary: Short clip demonstrating a Claude AI assistant exhibiting unexpected autonomous behavior in Tom's own workflow. Positioned as a contrast to the OpenClaw security concerns video (Entry Y30), acknowledging that even well-configured Claude agents can behave unexpectedly.
key_claims:
- Even a well-configured personal Claude AI assistant can "go rogue" with unexpected autonomous behavior.
- The incident is presented as a learning moment, not a reason to abandon AI agents.
entities:
  people: [Tom Solid]
  organizations: [Paperless Movement S.L., Anthropic]
  products: [Claude, Tana, Readwise Reader]
  tags: [AI safety, rogue AI, autonomous behavior, February 2026]
sources:
- url: https://www.youtube.com/watch?v=nuYELqhn06g
  date: February 10, 2026
  credibility: high
  confidence: medium
  confidence_reason: Direct browser access; 2.5-minute video — limited content depth.
conflicts: none

---

## ENTRY Y25: "The One Productivity App You REALLY Need in 2026"

summary: Full tour of the myICOR platform as the "one app" answer — ICOR Journey Starter Kit (free), advanced courses, task/project management, certification, Tool Finder, community, workstreams, automation, live events, and Inner Circle coaching. Also teases a proprietary productivity app launch.
key_claims:
- myICOR is the one platform housing framework, courses, tools, certification, community, and coaching.
- ICOR Tool Finder filters tools by job title, industry, and company size using real member data.
- A proprietary productivity app is in development (teased, not released).
entities:
  people: [Tom Solid]
  organizations: [Paperless Movement S.L.]
  products: [myICOR platform, ICOR Journey, ICOR Certification, ICOR Tool Finder, Inner Circle, Workstream Creator]
  tags: [myICOR platform tour, product, February 2026]
sources:
- url: https://www.youtube.com/watch?v=gi9547CWPz0
  date: February 9, 2026
  credibility: high
  confidence: high
  confidence_reason: Direct browser access; 16-minute platform walkthrough.
conflicts: none

---

## ENTRY Y26: "Stop Firefighting: How to See ALL Your Tasks in One Place"

summary: Task consolidation system using Sunsama as daily planner, integrating email triage, calendar, and recurring tasks. Covers the structure behind daily task management: priorities, where recurring tasks live, weekly reviews.
key_claims:
- Scattered action items (email, calendar, chat) need a single consolidation point.
- Sunsama is the recommended daily planner for consolidation.
- Email triage and task management must be integrated, not run in separate silos.
entities:
  people: [Tom Solid]
  organizations: [Paperless Movement S.L.]
  products: [Sunsama, Wispr Flow]
  tags: [task management, Sunsama, daily planner, email triage, February 2026]
sources:
- url: https://www.youtube.com/watch?v=bhN3IVFw9cs
  date: February 7, 2026
  credibility: high
  confidence: high
  confidence_reason: Direct browser access.
conflicts: none

---

## ENTRY Y27: "I Connected My Read Later App to Claude. This Changes Everything."

summary: Integration of Readwise Reader with Claude via MCP. Shows Reader + Claude as a knowledge intake combination, with Wispr Flow for hands-free interaction, AI categorizing and triaging saved articles, and connections to Tana and Heptabase.
key_claims:
- Readwise Reader + Claude MCP = AI-powered read-later triage (auto-categorize and prioritize).
- Wispr Flow enables hands-free voice interaction with the system.
- The combined stack: Readwise Reader (intake) → Claude (processing) → Tana/Heptabase (storage).
entities:
  people: [Tom Solid]
  organizations: [Paperless Movement S.L., Anthropic, Readwise]
  products: [Readwise Reader, Claude, MCP, Wispr Flow, Tana, Heptabase]
  tags: [Readwise, MCP, read-later, Wispr Flow, Tana, Heptabase, February 2026]
sources:
- url: https://www.youtube.com/watch?v=hrcdltJsD4I
  date: February 5, 2026
  credibility: high
  confidence: high
  confidence_reason: Direct browser access.
conflicts: none

---

## ENTRY Y28: "From Goals to Done: The Complete Productivity System (Team + Personal)"

summary: 32-minute full walkthrough of team + personal productivity integration. Real example: creating the ICOR Journey book. Tools used: ClickUp (project management), Sunsama (personal task management), Tana (outlining), Heptabase (book structure).
key_claims:
- A complete team + personal system requires at minimum: a project management tool, a daily planner, a capture tool, and a deep work tool.
- The ICOR Journey book was created using this exact four-tool stack.
- Quarterly reviews are the structural mechanism that keeps goals connected to daily work.
entities:
  people: [Tom Solid, Paco Cantero]
  organizations: [Paperless Movement S.L.]
  products: [ClickUp, Sunsama, Tana, Heptabase, ICOR Journey book]
  tags: [team productivity, project management, ClickUp, Sunsama, Tana, Heptabase, February 2026]
sources:
- url: https://www.youtube.com/watch?v=GUqTUyP7S90
  date: February 4, 2026
  credibility: high
  confidence: high
  confidence_reason: Direct browser access; 32-minute tutorial.
conflicts: none

---

## ENTRY Y29: "Tana + Claude Killed Heptabase. Here's the Proof."

summary: Full PKM system using Tana + Claude, arguing Heptabase is no longer needed. Covers capture, organize, and retrieve functions using the Tana + Claude combination as the primary stack.
key_claims:
- Tana + Claude replaces Heptabase for PKM purposes.
- The Tana + Claude combination handles capture, organize, and retrieve functions that previously required Heptabase.
entities:
  people: [Tom Solid]
  organizations: [Paperless Movement S.L., Anthropic]
  products: [Tana, Claude, Heptabase]
  tags: [Tana, Heptabase, PKM, Claude, February 2026]
sources:
- url: https://www.youtube.com/watch?v=aqI0lkGIyE4
  date: February 3, 2026
  credibility: high
  confidence: high
  confidence_reason: Direct browser access.
conflicts: Note: Entry Y5 shows Tom later quit Tana too (by March 2026), having moved to the full two-folder PKA system. The Tana + Claude combination in this video appears to be a transitional step.

---

## ENTRY Y30: "OpenClaw Has a Security Problem. I Checked."

summary: Security investigation of OpenClaw (and related tools clawdBot, Moltbot). Findings: exposed API keys, scam risks, full system access vulnerabilities. Tom reset his Mac after installing OpenClaw. Offers Claude Code / Claude Cowork as safer alternatives.
key_claims:
- OpenClaw, clawdBot, and Moltbot have security problems including exposed API keys and full system access risks.
- Tom personally reset his Mac after installing OpenClaw.
- These tools are framed as unnecessary risks given Claude Code and Cowork offer similar functionality safely.
entities:
  people: [Tom Solid]
  organizations: [Paperless Movement S.L., Anthropic]
  products: [OpenClaw, clawdBot, Moltbot, Claude API, Claude Code, Claude Cowork]
  tags: [security, OpenClaw, API keys, February 2026]
sources:
- url: https://www.youtube.com/watch?v=Wq6j-tNNZHA
  date: February 2, 2026
  credibility: high
  confidence: high
  confidence_reason: Direct browser access.
conflicts: none

---

## YOUTUBE ENTITY INDEX

### People
| Entity | Appears In |
|--------|------------|
| Tom Solid (Dr. Thomas Roedl) | Y1–Y30 (all) |
| Paco Cantero | Y5, Y14, Y28 |

### Organizations
| Entity | Appears In |
|--------|------------|
| Paperless Movement S.L. | Y1–Y30 (all) |
| Anthropic | Y1, Y2, Y3, Y4, Y5, Y6, Y7, Y8, Y9, Y10, Y11, Y12, Y13, Y14, Y15, Y16, Y17, Y19, Y20, Y22, Y24, Y27, Y29, Y30 |
| OpenAI | Y2, Y10, Y16 |
| Microsoft | Y3, Y12 |
| Google | Y7, Y19, Y22 |
| Readwise | Y20, Y27 |
| Block Inc. | Y9 |
| NBC | Y9 |
| US Pentagon | Y10 |
| Perplexity | Y2, Y21 |
| Mighty Networks | Y11 |

### AI Products (Claude family)
| Entity | Appears In |
|--------|------------|
| Claude (general) | Y1–Y30 |
| Claude Code | Y1, Y3, Y4, Y6, Y11, Y12, Y14, Y16, Y17, Y21, Y30 |
| Claude Cowork | Y1, Y7, Y8, Y11, Y13, Y17, Y19, Y22 |
| Claude Chat | Y1, Y17 |
| Claude Desktop | Y1, Y11, Y17 |
| Claude Pro | Y15, Y16 |
| Claude Max | Y15, Y21 |
| Claude API | Y15, Y30 |
| Claude Chrome Extension | Y1, Y7, Y17 |
| Claude Mobile App | Y1, Y3 |
| Claude Opus 4.6 | Y10 |
| Claude Projects | Y17 |
| Claude Memory | Y17 |
| Claude Skills | Y17 |
| Claude Connectors | Y17 |
| CLAUDE.md | Y1, Y4, Y16 |

### AI Agents (Named)
| Entity | Appears In |
|--------|------------|
| Larry (orchestrator) | Y4, Y10, Y21 |
| Pax (research) | Y4 |
| Nolan (HR) | Y4 |
| Sable (developer) | Y4 |
| Sage (LinkedIn) | Y10 |
| Marty (YouTube) | Y10 |
| Felix (coder) | Y10 |
| Penn (scriptwriter) | Y10, Y21 |
| Pixel (designer/thumbnails) | Y10, Y21 |
| Jax (community) | Y10, Y11 |
| Mack (automation) | Y21 |
| Silas (database architect) | Y21 |

### Productivity Tools
| Entity | Appears In |
|--------|------------|
| ClickUp | Y7, Y8, Y11, Y19, Y20, Y21, Y22, Y28 |
| Tana | Y5, Y6, Y14, Y17, Y24, Y27, Y28, Y29 |
| Heptabase | Y5, Y6, Y7, Y20, Y21, Y27, Y28, Y29 |
| Obsidian | Y3, Y4, Y5, Y6 |
| Notion | Y6, Y17 |
| Sunsama | Y7, Y8, Y26, Y28 |
| Wispr Flow | Y3, Y7, Y8, Y13, Y16, Y19, Y26, Y27 |
| Readwise Reader | Y14, Y20, Y27 |
| Day One | Y14, Y22 |
| Todoist | Y7, Y20, Y21 |
| Miro | Y7, Y8, Y20, Y21 |
| Superhuman | Y7, Y8, Y19 |
| MeetGeek | Y7, Y8, Y13 |
| Raycast | Y7, Y8, Y13 |
| Descript | Y7, Y13 |
| Mem | Y6, Y20 |
| Roam Research | Y4 |
| SQLite | Y3, Y4, Y14, Y21 |
| Supabase | Y21 |
| MCP (Model Context Protocol) | Y7, Y14, Y17, Y19, Y20, Y21, Y27 |
| myICOR MCP | Y11, Y19, Y20 |
| VS Code | Y3 |
| Cursor | Y3 |
| Windsurf | Y3 |

### Third-Party / Competitor Products
| Entity | Appears In |
|--------|------------|
| ChatGPT | Y2, Y10, Y16 |
| OpenClaw | Y2, Y15, Y24, Y30 |
| clawdBot | Y30 |
| Moltbot | Y30 |
| Perplexity Computer | Y2 |
| ChatGPT Operator | Y2 |
| NotebookLM | Y20 |
| Gemini | Y20 |
| Pixel Forge | Y2 |
| Excel | Y12 |
| PowerPoint | Y1, Y12 |
| Microsoft 365 | Y12 |
| Telegram (as interface) | Y21 |

### Key Themes / Tags
| Theme | Entries |
|-------|---------|
| PKA (Personal Knowledge Assistance) | Y3, Y4, Y5, Y6 |
| Claude Code as no-code platform | Y4, Y11, Y16 |
| CLAUDE.md as AI memory | Y1, Y4, Y16 |
| Plan mode (review before execution) | Y1, Y3, Y4 |
| MCP / tool integration | Y7, Y14, Y17, Y19, Y20, Y21, Y27 |
| AI agents with names/roles | Y4, Y6, Y10, Y21 |
| PKM app obsolescence thesis | Y4, Y5, Y6, Y29 |
| OpenClaw security/obsolescence | Y2, Y15, Y24, Y30 |
| Claude vs ChatGPT | Y10, Y16 |
| Portability / no lock-in | Y3, Y5 |
| Business scaling / delegation | Y8, Y9 |
| Sunsama / daily planning | Y26, Y28 |
| Readwise integration | Y27, Y28 |
