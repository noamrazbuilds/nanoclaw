# PKA Agent Definitions v1

**Date:** 2026-03-29
**Design basis:** agent-persona-specialization-research.md findings
**Principle:** Constraint-based design (I/O contracts, tool restriction, context scoping) over persona-based design

---

## Design Notes

These agents are defined by what they **do, see, and produce** — not by who they "are." Per the research:

- Tool restriction and context isolation provide the largest performance gains
- I/O contracts constrain behavior more effectively than persona descriptions
- Single-responsibility agents outperform multi-purpose ones
- Review/critique loops work only when grounded in external signals (test results, search results, deterministic checks)
- 2-3 review rounds optimal; hard ceiling at 5

Each definition follows this structure:
- **Purpose** — one sentence
- **Input** — what it receives (the I/O contract)
- **Output** — what it must produce (structured, verifiable)
- **Tools** — explicit allowlist (principle of least privilege)
- **Disallowed** — what it must NOT do
- **Context** — what information it receives at invocation (scoped, not everything)
- **Model recommendation** — which model tier fits the task complexity
- **Trigger** — when this agent is invoked

---

## Tier 1: Essential

These cover 80%+ of daily PKA interactions. Build in Phase 1-2.

---

### 1.1 Knowledge Retrieval Agent

**Purpose:** Answer questions from the user's knowledge base with citations.

**Input:**
```
{
  question: string,          // natural language question
  scope?: string,            // optional: "journal", "contacts", "projects", "all"
  time_range?: {from, to},   // optional: limit to date range
  max_sources?: number        // optional: cap on sources to cite (default: 5)
}
```

**Output:**
```
{
  answer: string,                // direct answer (2-10 sentences)
  sources: [{
    file_path: string,           // path to source file
    excerpt: string,             // relevant excerpt (max 200 chars)
    relevance_score: float       // 0-1 from search ranking
  }],
  confidence: "high" | "medium" | "low",
  no_results_note?: string       // if nothing relevant found, say so explicitly
}
```

**Tools:** `semantic_search`, `sqlite_query`, `read_file`, `glob`
**Disallowed:** `write_file`, `web_search`, `send_message`, any mutation tool
**Context:** The question only. NOT the full conversation history. If follow-up context is needed, the orchestrator summarizes prior turns into the question field.
**Model:** Sonnet (fast, sufficient for retrieval + synthesis)
**Trigger:** Any incoming message that is a question or lookup request

**Constraints:**
- Every claim in the answer must cite a specific source from the knowledge base
- If the knowledge base doesn't contain relevant information, say so — do not fabricate
- If results span multiple topics, group by topic with separate source lists
- Do not editorialize or add information beyond what the sources contain
- If confidence is "low", suggest what the user might search for instead

---

### 1.2 Capture/Ingest Agent

**Purpose:** Process incoming raw input into a structured knowledge base entry.

**Input:**
```
{
  content: string,              // raw text, URL, or file path
  content_type: "text" | "url" | "file" | "voice_transcript",
  source_channel: string,       // "whatsapp", "telegram", "cli", etc.
  sender_context?: string       // optional: who sent it and any surrounding context
}
```

**Output:**
```
{
  note_path: string,            // path to created/updated markdown file
  db_record_id: string,         // SQLite record ID
  classification: {
    type: "note" | "task" | "bookmark" | "contact" | "journal" | "reference",
    tags: string[],             // suggested tags (max 5)
    folder: string              // suggested destination folder
  },
  extracted_entities: [{
    name: string,
    type: "person" | "place" | "org" | "date" | "concept",
    context: string             // sentence where entity appears
  }],
  requires_review: boolean,     // true if classification confidence is low
  embedding_queued: boolean     // whether embedding generation was scheduled
}
```

**Tools:** `write_file` (inbox/ and staging/ only), `sqlite_insert`, `read_file`, `embed_text`, `web_fetch` (for URL content extraction only)
**Disallowed:** `delete_file`, `sqlite_delete`, `send_message`, `web_search`
**Context:** The raw input only. No knowledge base context needed — this agent processes, it doesn't connect.
**Model:** Haiku (fast, cheap — classification and entity extraction are straightforward tasks)
**Trigger:** Any incoming message containing content to save (not a question)

**Constraints:**
- All new files go to inbox/ or staging/ — never directly to the organized knowledge base
- Frontmatter follows the standard PKA schema (title, created, type, tags)
- Content is written as clean CommonMark markdown — no custom syntax
- If content_type is "url", extract the main content (not boilerplate/nav/ads)
- If classification confidence is below 0.7, set requires_review: true
- Never modify existing files — create new ones only
- Tag suggestions must draw from the existing tag taxonomy (query sqlite for current tags)

---

### 1.3 Memory Consolidation Agent (Dreamer)

**Purpose:** Consolidate, deduplicate, and reorganize the PKA's memory and knowledge index.

**Input:**
```
{
  scope: "memory" | "knowledge_base" | "both",
  since?: string,               // ISO date — only process changes since this date
  dry_run?: boolean             // if true, report what would change without changing
}
```

**Output:**
```
{
  actions_taken: [{
    action: "merged" | "deduplicated" | "reorganized" | "archived" | "reindexed",
    files_affected: string[],
    reason: string
  }],
  memory_stats: {
    total_files: number,
    memory_index_lines: number,  // MEMORY.md line count (target: under 200)
    stale_entries_removed: number,
    duplicates_merged: number
  },
  embedding_stats: {
    total_embedded: number,
    newly_embedded: number,
    stale_reembedded: number
  },
  suggestions: string[]          // things requiring human decision
}
```

**Tools:** `read_file`, `write_file` (memory files only), `sqlite_query`, `sqlite_update`, `embed_text`, `glob`
**Disallowed:** `web_search`, `send_message`, `delete_file` (archive, don't delete)
**Context:** Current MEMORY.md index + list of files modified since last consolidation. NOT the full knowledge base — progressive disclosure as needed.
**Model:** Sonnet (needs reasoning for deduplication and reorganization decisions)
**Trigger:** Scheduled — daily at low-usage hours (e.g., 3 AM). Also triggerable manually.

**Constraints:**
- Never delete files — move to archive/ with a dated suffix
- MEMORY.md must stay under 200 lines after consolidation
- When merging duplicate entries, preserve the most detailed version
- Log every action to the consolidation audit table in SQLite
- If a memory entry conflicts with current file state, trust the file (memory is stale)
- In dry_run mode, produce the full actions_taken list but execute nothing
- Embeddings: skip files unchanged since last embedding (use content_hash comparison)
- Suggest (don't auto-apply) folder reorganization, tag consolidation, or structural changes

---

### 1.4 Research Agent

**Purpose:** Gather evidence to answer a specific research question from external sources.

**Input:**
```
{
  question: string,             // specific research question
  scope: {
    time_range?: string,        // e.g., "last 6 months", "2025-2026"
    source_types?: string[],    // e.g., ["academic", "news", "documentation"]
    geographic_focus?: string,
    max_sources?: number        // default: 10
  },
  output_format: "findings" | "comparison" | "timeline"
}
```

**Output:**
```
{
  findings: [{
    claim: string,              // the specific finding
    source: {
      title: string,
      url: string,
      date: string,
      reliability: "high" | "medium" | "low"
    },
    direct_quote?: string,      // exact quote when possible
    methodology_note?: string   // how the source reached this finding
  }],
  conflicts: [{
    finding_a_index: number,
    finding_b_index: number,
    nature: string              // description of the conflict
  }],
  gaps: string[],               // aspects of the question with no evidence found
  queries_used: string[],       // search queries executed (for reproducibility)
  confidence_summary: string    // overall assessment of evidence quality
}
```

**Tools:** `web_search`, `web_fetch`, `read_file` (for scope documents provided as context)
**Disallowed:** `write_file`, `sqlite_insert`, `send_message` — research agent gathers, it does not store or communicate
**Context:** The question and scope only. If the user wants research connected to existing knowledge, the orchestrator includes relevant excerpts from the knowledge base in the question field.
**Model:** Opus for complex/high-stakes research. Sonnet for routine lookups.
**Trigger:** On demand — user explicitly requests research (`#research` slot or direct request)

**Constraints:**
- Never paraphrase a statistic — quote it exactly with its source
- Distinguish primary research from secondary reporting
- If a finding seems too good to be true, look for the original source
- Mark opinion pieces separately from empirical research
- If the question can't be adequately answered from available sources, say so in gaps[]
- Maximum 8 search queries per research task (prevents runaway token burn)
- All URLs must be from the actual search results — never fabricate or guess URLs

---

## Tier 2: Valuable

Build when the need arises. Each addresses a specific workflow gap.

---

### 2.1 Review/Critique Agent

**Purpose:** Evaluate an artifact against specific criteria and produce structured pass/fail feedback.

**Input:**
```
{
  artifact: string | file_path, // the thing to review
  artifact_type: "code" | "document" | "plan" | "report" | "schema",
  criteria: [{
    id: string,                 // e.g., "accuracy", "completeness"
    description: string,        // what to check
    weight: "blocking" | "important" | "nice_to_have"
  }],
  deterministic_results?: [{    // pre-run automated checks (linter, tests, etc.)
    check: string,
    result: "pass" | "fail",
    details?: string
  }]
}
```

**Output:**
```
{
  verdict: "pass" | "fail" | "conditional_pass",
  criteria_results: [{
    id: string,
    result: "pass" | "fail" | "unclear",
    evidence: string,           // specific quote or reference supporting the judgment
    fix_suggestion?: string     // for fail items: what to change (described, not implemented)
  }],
  blocking_issues: string[],    // items that caused verdict: fail
  non_blocking_notes: string[], // suggestions that don't block
  review_confidence: "high" | "medium" | "low"
}
```

**Tools:** `read_file`, `sqlite_query`, `web_search` (only for fact-checking claims against external sources)
**Disallowed:** `write_file`, `edit_file`, `run_command` — review does not fix. Fixes go back through the appropriate agent.
**Context:** The artifact + criteria only. NOT the history of how the artifact was created.
**Model:** Sonnet (needs judgment but not deep reasoning)
**Trigger:** Inserted into workflows after generation steps. Also invocable on demand.

**Constraints:**
- For criteria covered by deterministic_results, use those — don't re-evaluate
- Every fail must include specific evidence (quote, line number, or concrete reference)
- Cannot waive criteria — if a criterion seems wrong, flag it but still enforce it
- If the artifact needs more than minor fixes (>30% of criteria fail), recommend sending back to the generating agent rather than itemizing every issue
- Maximum 2 review rounds per artifact before escalating to human

---

### 2.2 Task Decomposition Agent

**Purpose:** Break a project or goal into concrete, actionable, verifiable tasks.

**Input:**
```
{
  goal: string,                 // what needs to be accomplished
  constraints: {
    timeline?: string,          // e.g., "2 weeks"
    available_effort?: string,  // e.g., "1 person, evenings only"
    dependencies?: string[],    // external dependencies or blockers
    definition_of_done: string  // how we know the goal is achieved
  },
  existing_tasks?: string[]     // tasks already created (avoid duplication)
}
```

**Output:**
```
{
  tasks: [{
    id: string,                 // e.g., "T1", "T2"
    title: string,
    description: string,        // 1-3 sentences: what to do and why
    definition_of_done: string, // specific, verifiable completion criteria
    estimated_effort: string,   // e.g., "2-3 hours", "1 day"
    dependencies: string[],     // IDs of tasks that must complete first
    can_parallelize: boolean
  }],
  critical_path: string[],     // ordered task IDs on the longest dependency chain
  external_blockers: string[], // things waiting on outside input
  total_effort_estimate: string,
  feasibility_note?: string    // if goal seems too large for constraints, say so
}
```

**Tools:** `read_file`, `sqlite_query`, `glob` (to check current project state)
**Disallowed:** `write_file`, `run_command` — decomposition is planning, not execution
**Context:** The goal + constraints. If relevant, include current project state summary from the orchestrator.
**Model:** Sonnet
**Trigger:** On demand — user requests project planning or breakdown

**Constraints:**
- Tasks must be completable in 1-3 days by one person (break further if larger)
- Every task must have a verifiable definition of done — not "improve X" but "reduce X from A to B"
- Don't create tasks for things already done — check existing_tasks
- If the goal is too large for the stated constraints, say so rather than producing an unrealistic plan
- Separate research/investigation tasks from implementation tasks

---

### 2.3 Synthesis Agent

**Purpose:** Synthesize pre-gathered findings into coherent analysis with confidence assessment.

**Input:**
```
{
  question: string,             // the original research question
  findings: [{                  // from the Research Agent's output
    claim: string,
    source: { title, url, date, reliability },
    direct_quote?: string
  }],
  conflicts: [{finding_a, finding_b, nature}],
  gaps: string[],
  audience: string,             // who will read this — affects vocabulary and depth
  purpose: "decision_support" | "learning" | "briefing"
}
```

**Output:**
```
{
  executive_summary: string,    // 2-3 sentence answer to the question
  analysis: [{
    theme: string,
    body: string,               // analysis text with inline citations [source_index]
    evidence_strength: "strong" | "moderate" | "weak"
  }],
  confidence_assessment: string, // how well-supported is the overall conclusion
  limitations: string[],        // what the evidence doesn't cover
  recommendations: string[],    // next steps if question isn't fully answered
  open_questions: string[]      // questions that emerged from the analysis
}
```

**Tools:** `read_file` (the evidence package only)
**Disallowed:** `web_search` (work with what the research agent provided — if insufficient, flag the gap), `write_file`, `send_message`
**Context:** The findings package only. NOT the research agent's search process or conversation.
**Model:** Opus for high-stakes synthesis. Sonnet for routine.
**Trigger:** After the Research Agent completes, when synthesis is requested

**Constraints:**
- Every claim in the analysis must cite a specific finding from the input
- If findings conflict, present both sides with their evidence quality — don't pick a winner without strong basis
- Clearly label speculation vs. evidence-supported conclusions
- Match vocabulary and depth to the stated audience
- If the evidence is insufficient to answer the question, say so in the first sentence — don't pad with weak analysis

---

### 2.4 Report Generation Agent

**Purpose:** Produce formatted reports from structured data sources.

**Input:**
```
{
  report_type: "daily_briefing" | "weekly_summary" | "project_status" | "custom",
  template?: string,            // path to markdown template (if custom)
  data_sources: [{
    type: "sqlite_query" | "file_glob" | "git_log",
    query: string               // the query/pattern/command
  }],
  time_range: { from: string, to: string },
  format: "markdown" | "html",
  max_length?: number           // word count cap
}
```

**Output:**
```
{
  report_path: string,          // path to generated report file
  sections: [{
    title: string,
    word_count: number,
    data_points_used: number
  }],
  generation_metadata: {
    total_words: number,
    data_sources_queried: number,
    empty_sections: string[]    // sections with no data (flagged, not omitted)
  }
}
```

**Tools:** `sqlite_query`, `read_file`, `glob`, `write_file` (reports/ directory only)
**Disallowed:** `web_search`, `send_message`, `delete_file`
**Context:** The data source queries and template. Results are fetched by the agent itself via tools.
**Model:** Haiku for templated reports. Sonnet for custom/narrative reports.
**Trigger:** Scheduled (daily briefing) or on demand

**Constraints:**
- Reports go to reports/ directory only
- If a data source returns no results, include the section with a "No data for this period" note — don't silently omit
- All dates in ISO format
- If the report exceeds max_length, summarize sections rather than truncating
- Include a generation timestamp and data freshness note at the bottom
- For daily briefings: keep under 500 words. Brevity over completeness.

---

## Orchestration Notes

These agents don't need a dedicated "orchestrator agent." NanoClaw's message routing + the container's CLAUDE.md instructions handle orchestration:

1. **Message arrives** via WhatsApp/Telegram
2. **NanoClaw routes** to the appropriate group container
3. **Container CLAUDE.md** determines the task type:
   - Question/lookup → Knowledge Retrieval (1.1)
   - Content to save → Capture/Ingest (1.2)
   - Research request → Research (1.4), optionally followed by Synthesis (2.3)
   - Planning request → Task Decomposition (2.2)
   - Report request → Report Generation (2.4)
4. **Review Agent (2.1)** is inserted into workflows where quality matters (research → synthesis, report generation)
5. **Consolidation Agent (1.3)** runs on schedule, never triggered by messages

### Handoff Pattern

When one agent's output feeds another (e.g., Research → Synthesis):
- Pass the **structured output** (the JSON-like result), not the conversation
- Summarize at the boundary — the synthesis agent doesn't need to know which search queries the research agent tried and abandoned
- Cap handoff context at 2000 tokens for simple tasks, 5000 for complex

### When to Add a New Agent

Add a new agent definition only when:
1. An existing agent is being asked to do something outside its I/O contract
2. The task requires a different tool set than any existing agent has
3. The task requires fundamentally different context (e.g., you wouldn't want knowledge base context polluting a pure web research task)

Do NOT add a new agent when:
- You just want a different "personality" — adjust the output format in the existing contract
- The task is a sub-step of an existing agent's work — add it to that agent's process
- You want to name it something cool — that's a persona, not a capability
