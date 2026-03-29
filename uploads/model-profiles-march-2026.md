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
| **Triage / routing** | Claude Haiku 4.5 | Gemini 2.5 Flash / Ollama SLM | Cheapest capable models; local SLMs eliminate API cost entirely |
| **Judge / synthesizer** | Claude Opus 4.6 | — | Most capable model for evaluating competing arguments |
| **Content classification** | Claude Haiku 4.5 | Ollama: Qwen3-4B / Phi-4-mini | Local models match cloud for simple classification at zero API cost |
| **Entity extraction** | Claude Sonnet 4.6 | Ollama: Qwen3-4B | Local good enough for structured extraction; cloud for ambiguous cases |
| **Embeddings / semantic search** | OpenAI text-embedding-3-small | Ollama: nomic-embed-text-v2 / bge-m3 | Local embeddings match or beat ada-002; deterministic, free, private |
| **Tag suggestion / labeling** | Claude Haiku 4.5 | Ollama: Gemma-3-4B / Phi-4-mini | Simple structured output tasks ideal for local models |
| **Simple Q&A routing** | Claude Haiku 4.5 | Ollama: Qwen3-1.7B / Gemma-3-1B | Ultra-lightweight; runs on 4GB RAM for intent classification |
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

## Local Models (Ollama)

Local models via Ollama serve two distinct roles in team assembly: **embedding models** for semantic search/RAG, and **small language models (SLMs)** for classification, extraction, and routing tasks. They cost $0 in API fees but consume local compute. They never send data to external servers — ideal for privacy-sensitive workflows.

### When Local Models Make Sense

| Scenario | Local Model? | Why |
|----------|-------------|-----|
| Embeddings for semantic search | **Yes** | Local models match or beat OpenAI ada-002; deterministic, private, free |
| Simple classification / triage | **Yes** | 90%+ accuracy on structured tasks; eliminates API latency and cost |
| Entity extraction (structured) | **Yes** | Good enough for well-defined schemas; Qwen3-4B rivals GPT-4o-mini |
| Tag suggestion / labeling | **Yes** | Structured output tasks are SLM sweet spot |
| Intent routing (simple Q&A) | **Yes** | Ultra-lightweight models (1-4B) handle intent classification well |
| Complex reasoning | **No** | Cloud models significantly better; local SLMs hallucinate more |
| Creative writing | **No** | Quality gap too large; cloud models produce far better prose |
| Multi-step analysis | **No** | Local models lack the depth for sustained reasoning chains |
| Judge / synthesizer role | **No** | Must be most capable model; local models can't fill this role |
| Debate agent | **Maybe** | Only if the local model is genuinely capable enough for the domain; usually not |

### Embedding Models

| Model | Params | RAM | Dimensions | Context | MTEB | Languages | Best For |
|-------|--------|-----|------------|---------|------|-----------|----------|
| **nomic-embed-text v1.5** | 137M | ~0.5 GB | 768 (→256 via Matryoshka) | 8K | Beats ada-002 on MTEB & LoCo | English-focused | English RAG, general-purpose semantic search |
| **nomic-embed-text-v2-moe** | 475M (305M active) | ~1 GB | 768 (→256) | 8K | SOTA on BEIR (52.86), MIRACL (65.80) | 100+ languages | Multilingual RAG, cross-language retrieval |
| **bge-m3** | 568M | ~1.4 GB | 1024 | 8K | MIRACL nDCG@10: 70.0 (best in class) | 100+ languages | Multilingual semantic memory, cross-lingual search |
| **Qwen3-Embedding-8B** | 8B | ~5 GB | 4096 (→32 via flex) | 32K | #1 MTEB multilingual (70.58) | 100+ languages | Highest quality local embeddings; long-context |
| **Qwen3-Embedding-0.6B** | 0.6B | ~0.5 GB | flexible | 32K | Competitive for size | 100+ languages | Ultra-lightweight; resource-constrained hardware |

**vs. Cloud Embedding Models:**

| Model | Dimensions | Cost/M tokens | Quality (MTEB avg) | Notes |
|-------|-----------|---------------|--------------------|----|
| OpenAI text-embedding-ada-002 | 1536 | $0.10 | Baseline | Legacy; still widely used |
| OpenAI text-embedding-3-small | 1536 (→256) | $0.02 | ~75.8% retrieval accuracy | Cheap cloud option |
| OpenAI text-embedding-3-large | 3072 (→256) | $0.13 | ~80.5% retrieval accuracy | Best cloud quality |
| nomic-embed-text v1.5 (local) | 768 | **$0** | ~71% retrieval accuracy | Beats ada-002; free |
| bge-m3 (local) | 1024 | **$0** | Beats ada-002 multilingual | Best free multilingual |
| Qwen3-Embedding-8B (local) | 4096 | **$0** | #1 MTEB multilingual | Best overall quality; needs 5GB RAM |

**Recommendation:** For most PKA/NanoClaw use cases, **nomic-embed-text v1.5** (English-focused) or **bge-m3** (multilingual) are the right picks. They match or beat OpenAI ada-002, run on minimal hardware (0.5-1.4 GB RAM), and keep all data local. Use Qwen3-Embedding-8B only if you need the absolute best quality and have 5+ GB RAM to spare.

### Small Language Models (SLMs) for Classification/Triage

| Model | Params | RAM (Q4) | Context | Speed (CPU) | Best For |
|-------|--------|----------|---------|-------------|----------|
| **Qwen3-0.6B** | 0.6B | ~1 GB | 32K | ~30 tok/s | Ultra-light intent routing, simple classification |
| **Gemma-3-1B** | 1B | ~1.5 GB | 32K | ~25 tok/s | Simple classification, label assignment |
| **Qwen3-1.7B** | 1.7B | ~2 GB | 32K | ~20 tok/s | Intent routing, entity extraction, tag suggestion |
| **Phi-4-mini** | 3.8B | ~3 GB | 16K | ~15-20 tok/s | Math-heavy classification, structured reasoning |
| **Gemma-3-4B** | 4B | ~3.5 GB | 128K | ~15 tok/s | Multimodal triage (text+image), long-context classification |
| **Qwen3-4B** | 4B | ~3.5 GB | 32K | ~15 tok/s | Entity extraction, classification, rivals GPT-4o-mini on structured tasks |
| **Llama-3.2-3B** | 3B | ~2.5 GB | 128K | ~18 tok/s | General-purpose chat, Q&A routing |
| **Qwen3-8B** | 8B | ~5 GB | 32K | ~10 tok/s | Most capable local SLM; complex classification, nuanced extraction |

**Hardware Requirements:**

| RAM Available | Recommended Models | Can Run Simultaneously |
|--------------|-------------------|----------------------|
| **4 GB** | Qwen3-0.6B, Gemma-3-1B | 1 SLM + 1 embedding model |
| **8 GB** | Up to Qwen3-4B / Phi-4-mini | 1 SLM + 1 embedding model comfortably |
| **16 GB** | Up to Qwen3-8B | 1 SLM + 1 embedding model + headroom |
| **32 GB** | Any local model | Multiple models concurrently |

**Latency: Local vs. API:**

| Approach | First-token latency | Throughput | Notes |
|----------|-------------------|------------|-------|
| Local SLM (3-4B, CPU) | 200-500ms | 15-20 tok/s | No network; consistent; slower throughput |
| Local SLM (3-4B, GPU) | 50-100ms | 80-120 tok/s | Fast if GPU available |
| Cloud API (Haiku/Flash) | 300-800ms | 50-100 tok/s | Network dependent; may spike under load |
| Cloud API (Sonnet/4o) | 500-1500ms | 30-60 tok/s | Higher quality but slower first-token |

For classification and triage, local SLMs often have **lower latency** than cloud APIs because they eliminate the network round-trip. Throughput is lower on CPU but irrelevant for short-output tasks (a classification label is 1-5 tokens).

### Cost Comparison: Local vs. Cloud

| Volume | Cloud (Haiku) | Cloud (Gemini Flash) | Local (Qwen3-4B) |
|--------|--------------|---------------------|-------------------|
| 1K classifications/day | ~$0.18/day | ~$0.09/day | $0 (+ ~$0.02 electricity) |
| 10K classifications/day | ~$1.80/day | ~$0.90/day | $0 (+ ~$0.05 electricity) |
| 100K classifications/day | ~$18/day | ~$9/day | $0 (+ ~$0.15 electricity) |
| 1M embeddings (one-time) | ~$20-130 | N/A | $0 (+ ~$0.50 electricity) |

**Break-even:** At ~1K+ classifications per day, local models pay for themselves immediately. For embeddings computed once and stored, local is always cheaper since you pay $0 regardless of corpus size.

### Quality Trade-offs: Where Local Is "Good Enough"

| Task | Local Quality vs. Cloud | Verdict |
|------|------------------------|---------|
| Binary/multi-class classification | 90-95% of cloud accuracy | **Good enough** — use local |
| Named entity extraction (well-defined schema) | 85-90% of cloud accuracy | **Good enough** for structured schemas |
| Named entity extraction (ambiguous/novel) | 60-70% of cloud accuracy | **Use cloud** — local models hallucinate entities |
| Intent routing (5-15 categories) | 90-95% of cloud accuracy | **Good enough** — ideal local use case |
| Sentiment classification | 90%+ of cloud accuracy | **Good enough** — well-studied task for small models |
| Summarization | 70-80% of cloud quality | **Use cloud** — quality gap too noticeable |
| Open-ended generation | 50-60% of cloud quality | **Use cloud** — not competitive |
| Embeddings for semantic search | 90-100% of cloud quality | **Good enough** — local models match or beat ada-002 |

### Local Model Integration in Team Specs

When a team spec uses local models, the agent's `model` field should specify:

```yaml
model:
  provider: "ollama"
  model_id: "qwen3:4b"  # or "nomic-embed-text", "bge-m3", etc.
  assignment_reason: "classification task; local model eliminates API cost and latency"
  hardware_requirement: "4GB RAM minimum"
```

For the NanoClaw adapter, local models are accessed via the Ollama MCP server (see `/add-ollama-tool` skill). For Claude Code, the orchestrating agent can call Ollama via `run_command` or an MCP tool.

---

*Last updated: March 2026. Pricing and benchmarks shift frequently. Verify current pricing at platform docs before quoting costs to users.*
