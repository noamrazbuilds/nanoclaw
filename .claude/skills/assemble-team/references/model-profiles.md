# Model Profiles for Cross-Model Team Assembly

Practical model selection guide for the assemble-team skill. Based on benchmark data, pricing, and practitioner reports as of March 2026. Use this to assign specific models to agent roles when cross-model diversity is warranted.

**Default:** Claude (Anthropic) is always the default and primary model. Other providers are used when the team structure calls for cross-model diversity in debate, review, or critique roles.

---

## Quick Reference: Model Selection by Agent Role

| Agent Role | Primary Pick | Cross-Model Alternative | Rationale |
|------------|-------------|------------------------|-----------|
| **Complex reasoning / analysis** | Claude Opus 4.6 | Gemini 2.5 Pro | Both top-tier; Gemini edges on abstract reasoning (ARC-AGI-2) |
| **Code generation** | Claude Sonnet 4.6 | GPT-4o | Claude leads SWE-bench; GPT strong on agentic execution |
| **Code review / debugging** | Claude Opus 4.6 | GPT-4o | Different training → different blind spots in review |
| **Creative writing** | Claude Opus 4.6 | GPT-4o | Claude has "most soul"; GPT stronger on technical/structured prose |
| **Research / evidence gathering** | Claude Sonnet 4.6 | Gemini 2.5 Pro | Gemini's 1M default context helps with large document sets |
| **Fact-checking / accuracy** | Claude (any tier) | GPT-4o | Claude abstains when uncertain rather than hallucinating |
| **Data analysis** | Gemini 2.5 Pro | Claude Sonnet 4.6 | Gemini strong on quantitative reasoning and large datasets |
| **Triage / routing** | Claude Haiku 4.5 | Gemini 2.5 Flash | Cheapest capable models for classification tasks |
| **Judge / synthesizer** | Claude Opus 4.6 | — | Most capable model for evaluating competing arguments |
| **Debate opponent (to Claude)** | — | GPT-4o or Gemini 2.5 Pro | Must be different provider for genuine diversity |
| **Multimodal analysis** | Gemini 2.5 Pro | Claude Opus 4.6 | Gemini native multimodal; Claude added vision later |
| **Legal / financial analysis** | Claude Opus 4.6 | GPT-4o | Claude leads enterprise benchmarks; lower hallucination |
| **Math / formal reasoning** | Gemini 2.5 Pro | Claude Opus 4.6 | Gemini Deep Think leads math benchmarks |

---

## Provider Profiles

### Anthropic (Claude) — Default Provider

**Models:**
| Model | Input $/M | Output $/M | Context | Best For |
|-------|-----------|------------|---------|----------|
| Opus 4.6 | $5.00 | $25.00 | 1M | Complex reasoning, analysis, judge/synthesizer roles |
| Sonnet 4.6 | $3.00 | $15.00 | 1M | Code generation, research, general-purpose agent work |
| Haiku 4.5 | $1.00 | $5.00 | 200K | Triage, routing, fast classification, high-volume tasks |

**Strengths:**
- Lowest hallucination rate (~3% in practitioner reports); abstains when uncertain rather than guessing
- Best writing quality — natural cadence, nuanced prose, strong tone adherence
- Leads SWE-bench Verified (80.8%) for real-world software engineering
- 30% hallucination reduction over prior generation
- Strong at sustained multi-step reasoning
- Constitutional AI training produces more cautious, accurate outputs
- Best for tasks where being wrong has consequences

**Weaknesses:**
- Conservative — may hedge or refuse where other models would attempt an answer
- Not the cheapest option at the Opus tier
- Sonnet 4.6 pricing increases above 200K context ($6/$22.50)

**Best agent roles:** Judge, synthesizer, complex reasoner, code reviewer, writer, fact-checker

### OpenAI (GPT) — Primary Cross-Model Alternative

**Models:**
| Model | Input $/M | Output $/M | Context | Best For |
|-------|-----------|------------|---------|----------|
| GPT-4o | $2.50 | $10.00 | 128K | General-purpose, coding, debate opponent |
| GPT-4o-mini | $0.15 | $0.60 | 128K | Budget triage, simple classification |
| o3 | varies | varies | 200K | Deep reasoning tasks requiring extended thinking |

**Strengths:**
- Leads Terminal-Bench 2.0 for agentic/CLI execution tasks
- Strong code generation across multiple benchmarks
- Good at structured/technical writing
- Lower hallucination than Gemini on factual tasks
- Mature ecosystem and tooling
- Competitive pricing at the 4o tier ($2.50/$10)

**Weaknesses:**
- Writing can feel more mechanical/formulaic than Claude
- 128K context limit (vs 1M for Claude/Gemini)
- o3 pricing can be very high for extended reasoning

**Best agent roles:** Debate opponent to Claude, code generator, agentic executor, technical writer

### Google (Gemini) — Cost-Effective + Reasoning Diversity

**Models:**
| Model | Input $/M | Output $/M | Context | Best For |
|-------|-----------|------------|---------|----------|
| 2.5 Pro | $1.25 | $10.00 | 1M | Research, reasoning, large-context analysis |
| 2.5 Flash | $0.30 | $2.50 | 1M | Fast tasks, triage, high-volume processing |

**Strengths:**
- Leads ARC-AGI-2 abstract reasoning (77.1%) — genuinely different reasoning approach
- Deep Think mode leads formal mathematical reasoning
- 1M token context window at standard pricing — best for large document analysis
- Cheapest capable models (Flash at $0.30/$2.50)
- Native multimodal (text, images, code, audio, video)
- Free tier available (5-15 RPM, 1000/day)
- Strong on quantitative and data analysis tasks

**Weaknesses:**
- Higher hallucination rates than Claude in practitioner reports
- Writing quality generally below Claude and GPT
- Less mature agentic/tool-use ecosystem
- Pricing jumps above 200K context for Pro ($2.50/$15)

**Best agent roles:** Debate opponent to Claude, research/data agent, math reasoner, cost-sensitive tasks, multimodal analysis, third voice in triangulation

---

## Cross-Model Pairing Strategies

### For Generator-Critic Pairs (2 models)

| Generator | Critic | Why This Pairing |
|-----------|--------|-----------------|
| Claude Sonnet 4.6 | GPT-4o | Different training data and biases; GPT catches what Claude misses in code |
| Claude Sonnet 4.6 | Gemini 2.5 Pro | Gemini's different reasoning approach catches logical gaps; cheaper critic |
| Claude Opus 4.6 | Gemini 2.5 Pro | Best for research/analysis — Gemini's abstract reasoning complements Claude's careful logic |

### For Adversarial Debate (2 models)

| Debater A | Debater B | Judge | Why |
|-----------|-----------|-------|-----|
| Claude Opus 4.6 | GPT-4o | Claude Opus 4.6 | Claude and GPT have most divergent training approaches; Claude judges best |
| Claude Sonnet 4.6 | Gemini 2.5 Pro | Claude Opus 4.6 | Cost-effective debate; Opus judges from a higher capability tier |

### For Triangulation (3 models)

| Agent A | Agent B | Agent C | Resolution | Why |
|---------|---------|---------|------------|-----|
| Claude Opus 4.6 | GPT-4o | Gemini 2.5 Pro | Majority vote or Claude Opus synthesis | Maximum reasoning diversity; 3 different training paradigms |
| Claude Sonnet 4.6 | GPT-4o | Gemini 2.5 Flash | Claude Opus 4.6 judge | Cost-optimized triangulation; Opus judges from above |

---

## Cost Optimization Rules

1. **Use the cheapest model that can fill the structural role.** Haiku/Flash for triage, Sonnet/4o for generation, Opus/Pro only for judge/complex reasoning.
2. **Prompt caching saves 50-90% on input tokens** — use it for agents that receive similar context repeatedly.
3. **Batch API saves 50%** for non-urgent async workloads (both Anthropic and OpenAI offer this).
4. **A 3-model triangulation costs ~3x a single-agent run.** Only use for high-stakes decisions where correctness justifies the cost.
5. **Gemini Flash is the cheapest capable model** ($0.30/$2.50) — use it for any role where speed and cost matter more than peak quality.

### Approximate Cost Per Full Workflow Run

| Pattern | Models Used | Est. Cost (10K token task) |
|---------|------------|---------------------------|
| Single agent | Claude Sonnet | ~$0.18 |
| Generator-Critic | Sonnet + GPT-4o | ~$0.31 |
| 2-way Debate + Judge | Sonnet + Gemini Pro + Opus judge | ~$0.55 |
| 3-way Triangulation + Judge | Sonnet + 4o + Gemini Pro + Opus | ~$0.85 |

---

## When to Override Defaults

The table above gives general guidance, but override when:

- **The task is domain-specific and one model has known advantages** (e.g., Gemini for math, Claude for legal)
- **Context size is a constraint** — if the agent needs >200K tokens, prefer Gemini (1M default) or Claude Opus/Sonnet (1M available)
- **The user reports that a specific model handles their domain better** — practitioner experience trumps benchmarks
- **Cost is critical** — swap Opus for Sonnet, Pro for Flash, or 4o for 4o-mini where the quality difference won't matter for that role

---

*Last updated: March 2026. Pricing and benchmarks shift frequently. Verify current pricing at platform docs before quoting costs to users.*
