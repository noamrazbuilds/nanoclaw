---
name: update-model-profiles
description: Research current LLM benchmarks, pricing, and model releases, then update the model-profiles reference document used by /assemble-team. Run when models are stale, a major model launches, or pricing changes. Triggers on "update model profiles", "refresh model data", "update benchmarks", "new model released".
---

# Update Model Profiles

This skill updates the model-profiles reference document that powers `/assemble-team` model selection decisions. The **standalone repo** at `/home/nanoclaw/assemble-team` is the source of truth — update there first, then sync to NanoClaw.

## Source of Truth

```
Source:  /home/nanoclaw/assemble-team/references/model-profiles.md
Copies:  .claude/skills/assemble-team/references/model-profiles.md  (NanoClaw skill)
         uploads/model-profiles.md                       (project reference)
```

## Process

### Step 1: Read Current State

Read `/home/nanoclaw/assemble-team/references/model-profiles.md` to understand what's currently documented — models, pricing, benchmarks, local models.

### Step 2: Research Updates

Web search for current data on each of these areas. Search for each independently:

1. **New model releases** — "new LLM model release 2026" / "[provider] new model announcement"
2. **Benchmark updates** — "LLM benchmark comparison [current month] 2026" / "SWE-bench ARC-AGI MTEB leaderboard"
3. **Pricing changes** — "Claude API pricing [current month] 2026" / "OpenAI API pricing" / "Gemini API pricing"
4. **Local model updates** — "best Ollama models [current month] 2026" / "new embedding models MTEB"
5. **Hallucination/accuracy data** — "LLM hallucination rate comparison 2026"

### Step 3: Identify Changes

Compare research findings against the current document. Categorize changes:

- **Price changes** — update pricing tables
- **New models** — add to appropriate provider section and quick reference table
- **Benchmark shifts** — update scores and adjust role recommendations if rankings changed
- **Deprecated/replaced models** — mark or remove
- **New local models** — add to Ollama section if they're Ollama-compatible and competitive

Present a summary to the user before making edits:

```
## Proposed Updates

### Pricing
- Claude Opus: $5/$25 → $X/$Y (changed [date])
- ...

### New Models
- [Model name]: [brief description], [key benchmark]
- ...

### Benchmark Shifts
- [Role]: recommendation changes from X to Y because [reason]
- ...

### No Changes
- [Areas where current data is still accurate]
```

Use `AskUserQuestion` to confirm before proceeding.

### Step 4: Apply Updates

Edit `/home/nanoclaw/assemble-team/references/model-profiles.md` with the confirmed changes.

Update the "Last updated" line at the bottom to reflect the current date.

Do NOT change:
- The document structure or section organization
- The Knowledge-based principles (cross-model diversity rationale, structural role assignments)
- Content in other reference files (knowledge.md, spec-format.md) — those are research-based, not data-based

### Step 5: Sync and Push

After editing the source of truth, sync to all copies and push both repos:

```bash
# 1. Commit and push source of truth (standalone repo)
cd /home/nanoclaw/assemble-team
git add references/model-profiles.md
git commit -m "update: model profiles [month] [year] — [brief summary of changes]"
git push origin main

# 2. Sync to NanoClaw copies
cp /home/nanoclaw/assemble-team/references/model-profiles.md \
   /home/nanoclaw/NanoClaw/.claude/skills/assemble-team/references/model-profiles.md
cp /home/nanoclaw/assemble-team/references/model-profiles.md \
   /home/nanoclaw/NanoClaw/uploads/model-profiles.md

# 3. Commit and push NanoClaw
cd /home/nanoclaw/NanoClaw
git add .claude/skills/assemble-team/references/model-profiles.md uploads/model-profiles.md
git commit -m "sync: model profiles from assemble-team repo — [brief summary]"
git push origin main
```

### Step 6: Verify

Confirm both repos are clean:
```bash
cd /home/nanoclaw/assemble-team && git status --short
cd /home/nanoclaw/NanoClaw && git status --short
```

Report what changed to the user.

## What NOT to Update

- **knowledge.md** — research-based principles; only update if new research invalidates findings
- **spec-format.md** — YAML schema; only update if new fields are needed
- **SKILL.md** — skill logic; only update if the update process or model selection workflow changes
- Don't remove models that are still available — mark as "legacy" if superseded but still in use
- Don't change recommendations based on a single benchmark — look for consensus across sources
