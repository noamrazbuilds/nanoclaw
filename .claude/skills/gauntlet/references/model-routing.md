# Model Routing for /gauntlet

## Default Models

| Role | Model ID | Provider |
|------|----------|----------|
| Voice A | `claude-opus-4-6` | Anthropic |
| Voice B | `gpt-4o` | OpenAI |
| Voice C | `gemini-2.5-pro` | Google |
| Judge | `claude-opus-4-6` | Anthropic |

## Task-Based Routing

Override defaults based on task type. Edit this table to change permanent defaults.

| Task Type | Voice A | Voice B | Voice C | Judge |
|-----------|---------|---------|---------|-------|
| `code` | claude-opus-4-6 | gpt-4o | gemini-2.5-pro | claude-opus-4-6 |
| `analysis` | claude-opus-4-6 | gemini-2.5-pro | gpt-4o | claude-opus-4-6 |
| `creative` | gemini-2.5-pro | claude-opus-4-6 | gpt-4o | claude-opus-4-6 |
| `factual` | gpt-4o | gemini-2.5-pro | claude-opus-4-6 | claude-opus-4-6 |
| `strategy` | claude-opus-4-6 | gpt-4o | gemini-2.5-pro | claude-opus-4-6 |
| `math` | gemini-2.5-pro | claude-opus-4-6 | gpt-4o | claude-opus-4-6 |
| `default` | claude-opus-4-6 | gpt-4o | gemini-2.5-pro | claude-opus-4-6 |

## Task Classification Heuristics

Classify based on these signals (no API call needed):

- **code**: mentions code, programming, implementation, debugging, refactoring, API design
- **analysis**: mentions analyze, evaluate, compare, assess, review, audit
- **creative**: mentions write, design, brainstorm, create, imagine, story, marketing
- **factual**: mentions what is, explain, define, how does X work, history of
- **strategy**: mentions plan, strategy, architecture, roadmap, decision, tradeoffs
- **math**: mentions calculate, prove, derive, optimize, algorithm complexity

If ambiguous, use `default`.

## Fallback Chains

If a model is unavailable, substitute:
- Claude Opus -> Claude Sonnet -> skip (2-model debate)
- GPT-4o -> o3 -> skip
- Gemini 2.5 Pro -> Gemini 2.5 Flash -> skip

## Temperature Settings

| Stage | Temperature | Rationale |
|-------|-------------|-----------|
| Generation | 0.7 | Encourage diverse independent responses |
| Critique Round 1 | 0.3 | Precise, focused critique |
| Rebuttal Round 2 | 0.4 | Some flexibility in revision |
| Judge/Synthesis | 0.2 | Authoritative synthesis |

## Max Tokens

| Stage | Max Tokens |
|-------|------------|
| Generation | 4096 |
| Critique Round 1 | 2048 |
| Rebuttal Round 2 | 3072 |
| Judge/Synthesis | 4096 |
