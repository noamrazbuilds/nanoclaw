---
name: gauntlet
description: Run a task through 3 LLM providers in structured adversarial debate. Models generate independently in parallel, critique each other across 2 rounds, then a judge synthesizes the pressure-tested result. Use when the user asks to gauntlet, debate, adversarial, multi-model debate, or wants cross-model reasoning diversity.
---

# /gauntlet -- Multi-Agent Structured Debate

Run a task through 3 different LLM providers in structured adversarial debate:
1. **Generate** -- 3 models independently produce responses in parallel (no anchoring)
2. **Critique Round 1** -- each model reviews the other two
3. **Rebuttal Round 2** -- each model defends its position and revises
4. **Judge** -- a synthesis model produces the final consolidated result

## Arguments

- `/gauntlet <task>` -- run debate with default models
- `/gauntlet --models <model1>,<model2>,<model3> <task>` -- override voice models
- `/gauntlet --models <model1>,<model2>,<model3>,<judge> <task>` -- override voices + judge
- `/gauntlet --models help` -- show available models and current routing defaults

## Process

### Step 0: Parse Arguments and Classify Task

**Parse `--models` flag:**
- If `--models help`: query available models and show routing table, then stop:
  ```bash
  LITELLM_KEY=$(grep LITELLM_API_KEY .env 2>/dev/null | cut -d= -f2 || echo "$LITELLM_API_KEY")
  curl -s http://localhost:4000/v1/models \
    -H "Authorization: Bearer $LITELLM_KEY" | \
    python3 -c "import sys,json; [print(f'  {m[\"id\"]}') for m in json.load(sys.stdin)['data']]"
  ```
  Then read and display `${CLAUDE_SKILL_DIR}/references/model-routing.md`.

- If `--models <list>`: split by comma. First 3 are Voice A, B, C. Optional 4th is Judge.
- If no `--models`: the runner auto-classifies and selects models from the routing table.

**Classify the task** into: `code`, `analysis`, `creative`, `factual`, `strategy`, `math`, or `default`.
Read `${CLAUDE_SKILL_DIR}/references/model-routing.md` for classification heuristics.

### Steps 1-4: Run the Gauntlet

All debate stages are handled by a single Python runner script. This avoids shell escaping issues with large LLM payloads and ensures consistent state across all 4 stages.

**Build the command:**

```bash
python3 ${CLAUDE_SKILL_DIR}/scripts/gauntlet.py \
  --task "THE TASK DESCRIPTION" \
  --prompts-file "${CLAUDE_SKILL_DIR}/references/prompt-templates.md" \
  --routing-file "${CLAUDE_SKILL_DIR}/references/model-routing.md" \
  --output-dir "gauntlet-logs"
```

**With model overrides** (from `--models` flag):

```bash
python3 ${CLAUDE_SKILL_DIR}/scripts/gauntlet.py \
  --task "THE TASK DESCRIPTION" \
  --model-a "claude-opus-4-6" \
  --model-b "gpt-4o" \
  --model-c "gemini-2.5-pro" \
  --judge "claude-opus-4-6" \
  --prompts-file "${CLAUDE_SKILL_DIR}/references/prompt-templates.md" \
  --routing-file "${CLAUDE_SKILL_DIR}/references/model-routing.md" \
  --output-dir "gauntlet-logs"
```

**With forced task type:**

```bash
python3 ${CLAUDE_SKILL_DIR}/scripts/gauntlet.py \
  --task "THE TASK DESCRIPTION" \
  --task-type "strategy" \
  --prompts-file "${CLAUDE_SKILL_DIR}/references/prompt-templates.md" \
  --routing-file "${CLAUDE_SKILL_DIR}/references/model-routing.md" \
  --output-dir "gauntlet-logs"
```

**With custom LiteLLM key** (if not in `.env`):

```bash
python3 ${CLAUDE_SKILL_DIR}/scripts/gauntlet.py \
  --task "THE TASK DESCRIPTION" \
  --litellm-key "sk-your-key" \
  --prompts-file "${CLAUDE_SKILL_DIR}/references/prompt-templates.md" \
  --routing-file "${CLAUDE_SKILL_DIR}/references/model-routing.md" \
  --output-dir "gauntlet-logs"
```

The runner handles everything: parallel execution, JSON escaping, retries, and file output. It prints progress to stderr and the judge's final result to stdout.

### Step 5: Present Results

After the runner completes, present to the user:

1. The judge's **Final Answer** section as the main response
2. Summary: models used, key points of agreement, resolved disagreements, unresolved tensions
3. Path to the full debate log

## Error Handling

The Python runner handles most errors automatically:

- **LiteLLM down**: Checks health endpoint before starting. Aborts with clear message if unreachable.
- **Model unavailable / timeout**: Retries each call up to 2 times with exponential backoff (2s, 4s). If all retries fail, logs the error and continues with remaining models.
- **Empty response**: Treated as a failure and retried.
- **JSON parse failure**: Retried automatically.

**Additional checks for you (the agent):**
- If the task seems trivial (simple factual question, one-line answer), tell the user that /gauntlet may be overkill but still run it if they confirm.
- If a model's slot shows `ERROR:` in the debate log, note this to the user and explain which perspective was lost.

## Important Notes

- NEVER show raw JSON responses to the user -- always parse and format
- The debate log must contain the COMPLETE transcript of every stage
- The runner cleans up after itself -- no temp file management needed
- The runner reads the LiteLLM API key from `.env` (`LITELLM_API_KEY=...`) or the `LITELLM_API_KEY` environment variable
