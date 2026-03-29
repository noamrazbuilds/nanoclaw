# Agent Team Design Knowledge Base

Distilled from persona/specialization research (March 2026). This is the knowledge base that informs all team assembly decisions.

## Core Principle

**Constraint-based design outperforms identity-based design.** Define agents by what they can see, do, and must produce — not by who they "are."

## What Actually Drives Multi-Agent Performance

| Factor | Impact | Notes |
|--------|--------|-------|
| Context isolation | High | Each agent maintains focused context, avoiding distraction |
| Tool restriction | High | Limiting tools prevents misuse and focuses behavior |
| Workflow enforcement | High | Structured handoffs enforce process |
| Error catching / review | Medium-High | Multiple agents catch each other's mistakes |
| Diverse sampling | Medium | Multiple agents provide diverse outputs |
| Persona/role description | Low-Medium | The "you are an expert X" text contributes least |

## When NOT to Use Multi-Agent

- Task is straightforward and doesn't require different tool access or context
- A single well-prompted agent with clear instructions would perform equally well
- The coordination overhead (token cost, latency, debugging complexity) exceeds the quality gain
- The team would have fewer than 3 agents (below this threshold, a single agent with phased instructions is usually better)

Research finding: "A single-LLM baseline can match the performance of multi-agent alternatives with less computational cost" (Xu et al., 2026). Benefits of multi-agent "diminish as LLM capability improves" (Gao et al., 2025).

## The Four Structural Levers

### 1. Clear Task Boundaries

Each agent has explicit input/output contracts. No ambiguity about what it receives or must produce.

**Pattern: Input/Output Contracts**
```
BAD:  "Research agent — help with research tasks"
GOOD: "Research agent — receives a specific question (string),
       returns {answer, sources: [{title, url, relevance_score}],
       confidence: float, caveats: string[]}"
```

**Pattern: Single-Responsibility Agents**
Each agent does exactly one thing. Inspired by the Single Responsibility Principle.

**Pattern: Phase Gates**
Require explicit validation before moving between phases.
```
Plan -> [GATE: reviewed?] -> Implement -> [GATE: tests pass?] -> Deploy
```

### 2. Focused Context

Context window pollution is one of the most significant performance degraders.

**Pattern: Context Filtering at Handoffs**
Summarize or filter rather than forwarding raw conversation history.
```
BAD:  Pass entire 50-message conversation history
GOOD: Pass structured summary: deliverable, decisions, open questions, artifacts
```

**Pattern: Scoped Context Windows**
Each agent only sees what it needs.

**Pattern: Progressive Disclosure**
Start with minimal context; let agents request more as needed.

### 3. Appropriate Tool Access

Giving an agent tools it doesn't need increases error probability and consumes context.

**Pattern: Tool Whitelisting Per Agent**
Explicitly define which tools each agent can use. Read-only agents can't modify. Review agents can't fix.

**Pattern: Progressive Tool Escalation**
Start read-only, escalate to write tools only when needed.

**Pattern: Tool Descriptions as Constraints**
When you can't remove tools, make descriptions encode constraints.

### 4. Review/Critique Loops

The most consistently positive structural pattern in research.

**Critical finding:** Self-correction ONLY works with external signals (test results, search results, different model's evaluation, deterministic checks). Without external grounding, self-correction is essentially random (Kamoi et al., 2024, 213 citations).

**Pattern: Generator-Critic Pairs**
One generates, another critiques against specific criteria. Max 2-3 rounds.

**Pattern: Reflection with Memory**
Agent maintains memory of past failures and consults it before acting.

**Pattern: Adversarial Debate**
Two agents argue positions; judge synthesizes. Best for high-stakes decisions. 2-3 rounds optimal, hard ceiling at 5.

**Pattern: Cross-Model Review and Debate**
Using different LLM providers for debate/review agents produces genuinely independent reasoning — same-model debate shares training biases and blind spots. See the Cross-Model Diversity section below for full guidance.

**Pattern: Deterministic Verification Layer**
Use linters, type checkers, tests before LLM review. Reserve LLM review for subjective/complex judgments.

## Minimum Viable Team Principle

The default recommendation is the **fewest agents that structurally require separation**. An agent should only exist if it needs:
- Different tool access than other agents
- Different context (seeing different information)
- A structural role in the workflow (e.g., reviewer who can't also be the implementer)

Every agent must pass the test: "Would a single agent with clear instructions do this equally well?" If yes, don't create the agent.

## Persona Guidance (When Used at All)

- Generic personas ("you are an expert") provide **no measurable improvement** on objective benchmarks
- Richly detailed, task-specific descriptions help 5-15% on open-ended/creative tasks
- Personas can **actively hurt** by introducing biases, sycophancy, or consuming context
- Expert personas make models more assertive, **not more correct** (Chhikara, 2025)
- If personas are used, they should describe capabilities and constraints, not identity

## Agent Prompt Template

```
You [action verb — investigate/implement/review/validate]. You do not [boundary].

INPUT:
  - [Exactly what this agent receives]

PROCESS:
  1. [Step-by-step procedure]

OUTPUT:
  - [Exactly what this agent must produce, with schema]

TOOLS: [whitelist]
DO NOT USE: [explicit exclusions with reasons]

CONSTRAINTS:
  - [Hard rules this agent must follow]
```

## Cross-Model Diversity

When multiple LLM providers are available, cross-model assignment improves debate, review, and critique quality. Same-model agents share training biases and failure modes; cross-model agents produce genuinely independent reasoning.

### Model Assignment by Structural Role

Model assignment follows structure — the team design dictates which agents benefit from different models, not the reverse. However, model availability can enable patterns (like majority voting) that wouldn't be viable with a single provider.

| Structural Role | Model Assignment Strategy |
|----------------|--------------------------|
| Debate agents | Different models — the whole point is independent reasoning |
| Judge / synthesizer | Most capable model available — must evaluate competing arguments |
| Generator vs. critic | Different models — cross-model critique catches more (Kamoi et al.) |
| Implementation / data gathering | Most cost-effective model — no diversity benefit here |
| Triage / routing | Cheapest sufficient model — latency matters more than depth |

### When 2 Models Suffice

- Generator-critic patterns (structurally a 2-party interaction)
- Cost/latency is a constraint and the quality gain from a third is marginal
- The task doesn't have multiple valid approaches worth comparing

### When 3 Models Add Value

- **Majority voting:** 2v1 is decisive; 1v1 is a deadlock requiring a separate judge. With 3 models, the debate itself can converge without a tiebreaker.
- **Triangulation:** If 2 of 3 independently reach the same conclusion via different reasoning, that's stronger evidence than any single critique.
- **Blind spot coverage:** Each model family has different failure modes. Three models maximize the chance of catching errors no single model would find.
- **High-stakes decisions** where correctness matters more than cost.

### Diminishing Returns

The jump from 1→2 models is much larger than 2→3. Beyond 3, the coordination overhead almost always exceeds the diversity benefit. The round ceiling (2-3 optimal, 5 max) still applies regardless of model count.

### Model Availability Discovery

The skill should ask about available models/providers early in the process. This information shapes the review/critique design:
- **1 provider (e.g., Claude only):** Use intra-family diversity (Opus vs Sonnet vs Haiku by role) and lean more heavily on deterministic verification to compensate for shared blind spots.
- **2 providers:** Enable cross-model generator-critic pairs and 2-way debate.
- **3+ providers:** Enable triangulation and majority-vote patterns for high-stakes decisions.

## Reference Architectures

### Software Engineering
Planner -> Implementer -> Reviewer (+ deterministic checks)

### Content Pipeline
Research -> Outline -> Draft -> Edit (+ fact-check gate)

### Business Analysis
Market Analysis -> SWOT/Evaluation -> Recommendation

### Product Development
Discovery -> Specification -> Design -> Implementation -> QA

### Incident Response
Assess (read-only) -> Diagnose (+diagnostics) -> Mitigate (+write) -> Verify (-write, +tests) -> Document
