---
name: assemble-team
description: Design and assemble agent teams using research-backed structural patterns. Creates optimized multi-agent workflows with clear task boundaries, focused context, appropriate tool access, and review loops. Generates reusable team specification files. Use when the user wants to create agent teams, orchestrate multi-agent workflows, or apply the Knowledge to a task. Triggers on "assemble team", "build a team", "create agents", "agent team", "multi-agent", or references to team assembly.
---

# Assemble Team

You design and assemble agent teams grounded in the Knowledge — a research-backed framework for multi-agent system design. Read the Knowledge and spec format before proceeding:

- `${CLAUDE_SKILL_DIR}/references/knowledge.md` — the distilled research findings
- `${CLAUDE_SKILL_DIR}/references/spec-format.md` — the YAML team spec format

## Core Principle

**Constraint-based design over identity-based design.** Agents are defined by what they can see, do, and must produce — not by who they "are." Every agent in a team must justify its existence against the single-agent test: "Would a single agent with clear instructions do this equally well?"

## Modes

The skill operates in three modes. Ask the user which mode they prefer, or infer from context.

### Mode 1: Automatic

The user provides a natural-language description of what they want to accomplish. You:

1. Analyze the task for structural complexity (does it actually need multiple agents?)
2. If a single agent with phased instructions would suffice, recommend that instead and explain why
3. If multi-agent is warranted, determine the minimum viable team:
   - Identify phases that need different tool access
   - Identify phases that need different context
   - Identify where review/critique loops add value
   - Identify where deterministic checks can replace LLM review
4. Ask 1-3 focused follow-up questions if critical information is missing (target environment, team size, constraints). Do not ask unnecessary questions.
5. Generate the team spec

### Mode 2: Guided

Walk the user through structured questions to build the team spec. Ask questions in batches, not one at a time:

**Batch 1 — Goal & Scope:**
- What is the team's goal? (one sentence)
- What does success look like? (concrete deliverable)
- What is the target environment? (Claude Code, NanoClaw, generic, multiple)

**Batch 2 — Structure:**
- What are the distinct phases of work? (e.g., research -> draft -> review)
- Which phases need different tools or permissions?
- Where does human approval/review fit in the workflow?

**Batch 3 — Constraints:**
- Are there cost/latency concerns? (affects team size)
- Are there security/access control requirements?
- Should agents have specific model preferences? (e.g., Haiku for triage, Opus for complex reasoning)

Then generate the spec based on answers.

### Mode 3: Manual

The user provides detailed specifications about:
- The task, team structure, goals, agent roles
- Tool access per agent
- Workflow and handoff patterns
- Review/critique structure

Apply the Knowledge to validate and improve their design:
- Flag agents that fail the single-agent test
- Suggest tool restrictions they may have missed
- Recommend review loops where appropriate
- Warn about context pollution risks
- Suggest deterministic checks before LLM review

Generate the spec incorporating your recommendations (with explanations for each change).

## Generation Process

Regardless of mode, follow this process:

### Step 1: Single-Agent Test

Before designing a team, explicitly evaluate whether a single agent with phased instructions would accomplish the task. Document this evaluation in the spec's `meta.rationale`. If single-agent is sufficient, tell the user and offer to write a single well-structured agent prompt instead.

### Step 2: Minimum Viable Team

If multi-agent is warranted, apply the minimum viable team principle:
- Start with the fewest agents that structurally require separation
- Every agent must have a different tool access profile, context scope, or structural role
- Merge agents that would have identical tool access and context

### Step 3: Apply the Four Structural Levers

For each agent:
1. **Task Boundaries:** Define explicit input/output contracts
2. **Context:** Specify what each agent receives and what is deliberately excluded
3. **Tools:** Whitelist tools and explicitly deny dangerous ones with reasons
4. **Review:** Design review loops with specific criteria and external grounding

### Step 4: Write Agent Prompts

Use the constraint-based template (see Knowledge). Never use "you are an expert in X" framing. Instead:
- Lead with the action verb: "You investigate/implement/review/validate..."
- Define boundaries: "You do not..."
- Specify input/output contracts
- List tools (allowed and denied)
- Set hard constraints

### Step 5: Generate Spec File

Produce the full YAML spec following the format in `${CLAUDE_SKILL_DIR}/references/spec-format.md`.

Ask the user where to save it. Default suggestion: `.claude/teams/<name>.yaml` for Claude Code, or a project-appropriate location.

### Step 6: Environment Adapters

If the user specified target environments, populate the adapter sections:

**Claude Code:** Generate `.claude/agents/*.md` files with YAML frontmatter (`allowed-tools`, model selection). Offer to write these files.

**NanoClaw:** Map to container skills. Identify which MCP servers each agent needs.

**Generic:** Provide framework-agnostic descriptions sufficient for any agent SDK.

## Rebuilding from Spec

When the user references an existing spec file:

1. Read the spec file
2. Offer three options:
   - **Exact rebuild:** Recreate the same team (generate agent files for the target environment)
   - **Adapt:** Modify the team for a different task while keeping the structure
   - **Evolve:** Update the team based on what worked/didn't work (user provides feedback)

For adapt/evolve, apply the Knowledge to validate changes against the same structural principles.

## Output

Always produce:
1. **The team spec YAML file** saved to the user's chosen location
2. **A brief rationale** explaining why this structure was chosen
3. **Environment-specific files** if a target environment was specified (offer to write them)

If the user chose automatic or guided mode, also produce:
4. **The single-agent alternative** that was considered and why it was rejected (or recommended)

## Anti-Patterns to Flag

When reviewing user designs (manual mode) or your own output, flag:
- Agents defined by identity ("you are a senior engineer") rather than constraints
- Agents with identical tool access and context scope (should be merged)
- Review loops without external grounding (ungrounded self-critique doesn't work)
- More than 5 review/debate rounds (diminishing returns)
- Teams larger than necessary (token cost, coordination overhead, debugging complexity)
- Agents that forward full conversation history instead of filtered handoffs
- Missing phase gates between critical transitions
