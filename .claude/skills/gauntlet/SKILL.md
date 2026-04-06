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
  curl -s http://localhost:4000/v1/models \
    -H "Authorization: Bearer $LITELLM_KEY" | \
    python3 -c "import sys,json; [print(f'  {m[\"id\"]}') for m in json.load(sys.stdin)['data']]"
  ```
  Then read and display `${CLAUDE_SKILL_DIR}/references/model-routing.md`.

- If `--models <list>`: split by comma. First 3 are Voice A, B, C. Optional 4th is Judge. Fill missing slots from defaults.
- If no `--models`: use routing table defaults based on task classification.

**Classify the task** into: `code`, `analysis`, `creative`, `factual`, `strategy`, `math`, or `default`.
Read `${CLAUDE_SKILL_DIR}/references/model-routing.md` for classification heuristics and pick the model assignments.

**Set the LiteLLM key:**
```bash
LITELLM_KEY=$(grep LITELLM_API_KEY .env 2>/dev/null | cut -d= -f2 || echo 'sk-6e2940152162a6a90ac9fc5f6636c975')
LITELLM_URL="http://localhost:4000/v1/chat/completions"
```

### Step 1: Independent Parallel Generation

Call all 3 models in parallel. Each model receives the SAME prompt with NO knowledge of the other models. This prevents anchoring bias.

Read the generation prompt template from `${CLAUDE_SKILL_DIR}/references/prompt-templates.md` (Stage 1).

Use this function for all LLM calls:

```bash
call_llm() {
  local model="$1"
  local system_prompt="$2"
  local user_prompt="$3"
  local temperature="${4:-0.7}"
  local max_tokens="${5:-4096}"

  local sys_json=$(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$system_prompt")
  local usr_json=$(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$user_prompt")

  curl -s --max-time 180 "$LITELLM_URL" \
    -H "Authorization: Bearer $LITELLM_KEY" \
    -H "Content-Type: application/json" \
    -d "{
      \"model\": \"$model\",
      \"messages\": [
        {\"role\": \"system\", \"content\": $sys_json},
        {\"role\": \"user\", \"content\": $usr_json}
      ],
      \"max_tokens\": $max_tokens,
      \"temperature\": $temperature
    }" | python3 -c "import sys,json; print(json.load(sys.stdin)['choices'][0]['message']['content'])"
}
```

**Launch all 3 in parallel:**
```bash
call_llm "$MODEL_A" "$SYS_PROMPT" "$USER_PROMPT" 0.7 4096 > /tmp/gauntlet_a_$$.txt &
PID_A=$!
call_llm "$MODEL_B" "$SYS_PROMPT" "$USER_PROMPT" 0.7 4096 > /tmp/gauntlet_b_$$.txt &
PID_B=$!
call_llm "$MODEL_C" "$SYS_PROMPT" "$USER_PROMPT" 0.7 4096 > /tmp/gauntlet_c_$$.txt &
PID_C=$!
wait $PID_A $PID_B $PID_C
```

Tell the user which models are generating and that you're waiting for all 3.

### Step 2: Cross-Critique Round 1

Each model reviews the OTHER TWO responses. Read the critique prompt template from `${CLAUDE_SKILL_DIR}/references/prompt-templates.md` (Stage 2).

- Model A critiques B and C's responses
- Model B critiques A and C's responses
- Model C critiques A and B's responses

Run all 3 in parallel (same background process pattern). Temperature: 0.3, max_tokens: 2048.

### Step 3: Rebuttal & Revision (Round 2)

Each model receives:
- Its own original response
- The FULL critiques from the other two models (the model self-selects relevant parts)

Read the rebuttal prompt template from `${CLAUDE_SKILL_DIR}/references/prompt-templates.md` (Stage 3).

Each model must:
1. Rebut critiques it disagrees with (with reasoning)
2. Acknowledge valid critiques
3. Produce a REVISED response incorporating valid feedback

Run all 3 in parallel. Temperature: 0.4, max_tokens: 3072.

### Step 4: Judge / Synthesis

A judge model receives the COMPLETE debate transcript and produces the final consolidated result. Read the judge prompt template from `${CLAUDE_SKILL_DIR}/references/prompt-templates.md` (Stage 4).

Single API call to the judge model. Temperature: 0.2, max_tokens: 4096.

The judge prompt includes all 3 initial responses, all 3 critiques, and all 3 rebuttals/revisions.

### Step 5: Output & Process Log

**Save the debate log** to `gauntlet-logs/gauntlet-YYYY-MM-DD-HHMMSS.md`:

```markdown
# Debate Log: <timestamp>

## Metadata
- **Task**: <task description>
- **Task Type**: <classified type>
- **Duration**: <total time>
- **Voice A**: <model> | **Voice B**: <model> | **Voice C**: <model>
- **Judge**: <model>
- **API Calls**: 10

## Stage 1: Independent Generation

### Voice A (<model>)
<full response>

### Voice B (<model>)
<full response>

### Voice C (<model>)
<full response>

## Stage 2: Cross-Critique Round 1

### Voice A critiques B and C
<full critique>

### Voice B critiques A and C
<full critique>

### Voice C critiques A and B
<full critique>

## Stage 3: Rebuttal & Revision

### Voice A
<full rebuttal + revision>

### Voice B
<full rebuttal + revision>

### Voice C
<full rebuttal + revision>

## Stage 4: Judge Synthesis (<model>)
<full judge output>
```

**Present to the user:**

1. The judge's **Final Answer** section as the main response
2. Summary: models used, key points of agreement, resolved disagreements, unresolved tensions
3. Path to the full debate log

## Error Handling

- **LiteLLM down**: Check `curl -s --max-time 5 http://localhost:4000/health` before starting. If down, tell the user and abort.
- **Model unavailable**: Retry once. If still failing, substitute with the fallback chain from `model-routing.md`. If only 2 models available, run 2-model debate (each critiques the other, single rebuttal round). If only 1, fall back to self-critique (warn user this provides much less value).
- **Timeout**: `--max-time 180` on each curl. If a model times out, skip it for that stage and note in the log.
- **JSON parse failure**: Retry once. If still failing, log the raw response and skip that model for that stage.
- **Simple tasks**: If the task seems trivial (simple factual question, one-line answer), tell the user that /gauntlet may be overkill but still run it if they confirm.

## Important Notes

- NEVER show raw JSON responses to the user -- always parse and format
- ALWAYS run parallel stages actually in parallel (background processes), not sequentially
- The debate log must contain the COMPLETE transcript of every stage
- Clean up temp files (`/tmp/gauntlet_*_$$.txt`) after the debate completes
- Use unique filenames with `$$` (process ID) to avoid conflicts with concurrent runs
