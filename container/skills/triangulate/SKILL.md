---
name: triangulate
description: Run any task through a 3-stage cross-model pipeline (generate, critique, resolve) using different LLM providers via LiteLLM. Produces a final result plus a process log showing what each model contributed. Use when the user asks to triangulate, 3way, three-way, cross-check, or wants multi-model verification of a task.
---

# /triangulate — Cross-Model Triangulation

Run a task through 3 LLM providers for maximum reasoning diversity:
1. **Generate** — primary model produces the initial output
2. **Critique** — different-provider model reviews and finds gaps
3. **Resolve** — third-provider model synthesizes the final result

## Model Routing by Task Type

| Task Type | Generate | Critique | Resolve |
|-----------|----------|----------|---------|
| code | claude-sonnet-4-6 | gpt-4o | gemini-2.5-pro |
| research | claude-sonnet-4-6 | gemini-2.5-pro | gpt-4o |
| writing | claude-sonnet-4-6 | gpt-4o | gemini-2.5-pro |
| architecture | claude-opus-4-6 | gemini-2.5-pro | gpt-4o |
| math | gemini-2.5-pro | claude-sonnet-4-6 | gpt-4o |
| factcheck | claude-sonnet-4-6 | gpt-4o | gemini-2.5-pro |
| default | claude-sonnet-4-6 | gpt-4o | gemini-2.5-pro |

**Classification guide:**
- **code**: implementation, debugging, refactoring, scripts
- **research**: investigation, comparison, evidence gathering
- **writing**: drafting, creative content, documentation
- **architecture**: system design, technical decisions, infrastructure
- **math**: calculations, proofs, statistical analysis
- **factcheck**: verification, accuracy review

## Process

### Step 1: Classify the Task

Read the user's request and classify into one of the types above. If unclear, use **default**.

### Step 2: Run the Pipeline

Call LiteLLM via curl for each stage. The LiteLLM proxy is at `$LITELLM_HOST` with key `$LITELLM_API_KEY`.

Use this Bash function:

```bash
call_llm() {
  local model="$1"
  local system_prompt="$2"
  local user_prompt="$3"

  local sys_json=$(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$system_prompt")
  local usr_json=$(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$user_prompt")

  curl -s "$LITELLM_HOST/v1/chat/completions" \
    -H "Authorization: Bearer $LITELLM_API_KEY" \
    -H "Content-Type: application/json" \
    -d "{
      \"model\": \"$model\",
      \"messages\": [
        {\"role\": \"system\", \"content\": $sys_json},
        {\"role\": \"user\", \"content\": $usr_json}
      ],
      \"max_tokens\": 4000
    }" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['choices'][0]['message']['content'])"
}
```

**Stage 1 — Generate:**
- System: `You are completing a task. Produce a thorough, well-structured response.`
- User: the original request

**Stage 2 — Critique:**
- System: `You are reviewing another AI's work. Find gaps, errors, missed considerations, and areas for improvement. Be specific and constructive. Do not rewrite the work — identify issues only.`
- User: `TASK: <original request>\n\nRESPONSE TO REVIEW:\n<Stage 1 output>`

**Stage 3 — Resolve:**
- System: `You are synthesizing a final response from an initial draft and its critique. Produce the definitive answer that addresses the original task while incorporating valid critique points. Where the critique and draft conflict, use your independent judgment.`
- User: `TASK: <original request>\n\nINITIAL RESPONSE:\n<Stage 1 output>\n\nCRITIQUE:\n<Stage 2 output>`

### Step 3: Save Process Log

Write the full process log to `/workspace/group/logs/triangulate-<YYYY-MM-DD-HHMMSS>.md`:

```markdown
# Triangulation Report
**Task:** <user's request (first 200 chars)>
**Task Type:** <classified type>
**Timestamp:** <ISO timestamp>

## Stage 1: Generate (<model name>)
<full Stage 1 output>

## Stage 2: Critique (<model name>)
<full Stage 2 output>

## Stage 3: Resolve (<model name>)
<full Stage 3 output>

## Model Assignments
| Stage | Model | Provider | Rationale |
|-------|-------|----------|-----------|
| Generate | <model> | <provider> | <why> |
| Critique | <model> | <provider> | <why> |
| Resolve | <model> | <provider> | <why> |

## Summary
- **Generate:** <1-line summary>
- **Critique:** <key issues found>
- **Resolve:** <how conflicts were resolved>
```

### Step 4: Present Results

Show the user:
1. The **final resolved output** (Stage 3) as the main response
2. A brief note: which models were used, key critique points addressed
3. The **log file path** for full process details

## Error Handling

- If Stage 1 fails, abort and report the error
- If Stage 2 fails, present Stage 1 output with a note that critique was unavailable
- If Stage 3 fails, present both Stage 1 and Stage 2 outputs for manual resolution
