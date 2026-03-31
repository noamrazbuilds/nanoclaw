---
name: triangulate
description: Run any task through a 3-stage cross-model pipeline (generate, critique, resolve) using different LLM providers via LiteLLM. Produces a final result plus a process log showing what each model contributed. Use when the user asks to triangulate, 3way, three-way, cross-check, or wants multi-model verification of a task.
---

# /triangulate — Cross-Model Triangulation

Run a task through 3 LLM providers for maximum reasoning diversity:
1. **Generate** — primary model produces the initial output
2. **Critique** — different-provider model reviews and finds gaps
3. **Resolve** — third-provider model synthesizes the final result

## Process

### Step 1: Classify the Task

Read the user's request and classify it into one of these types:
- **code**: implementation, debugging, refactoring, scripts
- **research**: investigation, comparison, evidence gathering
- **writing**: drafting, creative content, documentation
- **architecture**: system design, technical decisions, infrastructure
- **math**: calculations, proofs, statistical analysis
- **factcheck**: verification, accuracy review

If unclear, use **default**.

### Step 2: Select Models

Read the routing table in `${CLAUDE_SKILL_DIR}/references/model-routing.md` and pick the 3 models for the classified task type.

### Step 3: Run the Pipeline

For each stage, call LiteLLM via curl. Use this function pattern in Bash:

```bash
call_llm() {
  local model="$1"
  local system_prompt="$2"
  local user_prompt="$3"
  local response

  # Escape the prompts for JSON
  local sys_json=$(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$system_prompt")
  local usr_json=$(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$user_prompt")

  response=$(curl -s http://localhost:4000/v1/chat/completions \
    -H "Authorization: Bearer $(grep LITELLM_API_KEY .env 2>/dev/null | cut -d= -f2 || echo 'sk-6e2940152162a6a90ac9fc5f6636c975')" \
    -H "Content-Type: application/json" \
    -d "{
      \"model\": \"$model\",
      \"messages\": [
        {\"role\": \"system\", \"content\": $sys_json},
        {\"role\": \"user\", \"content\": $usr_json}
      ],
      \"max_tokens\": 4000
    }")

  echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['choices'][0]['message']['content'])"
}
```

**Stage 1 — Generate:**
```
System: "You are completing a task. Produce a thorough, well-structured response."
User: <the user's original request>
```

**Stage 2 — Critique:**
```
System: "You are reviewing another AI's work. Find gaps, errors, missed considerations, and areas for improvement. Be specific and constructive. Do not rewrite the work — identify issues only."
User: "TASK: <original request>\n\nRESPONSE TO REVIEW:\n<Stage 1 output>"
```

**Stage 3 — Resolve:**
```
System: "You are synthesizing a final response from an initial draft and its critique. Produce the definitive answer that addresses the original task while incorporating valid critique points. Where the critique and draft conflict, use your independent judgment."
User: "TASK: <original request>\n\nINITIAL RESPONSE:\n<Stage 1 output>\n\nCRITIQUE:\n<Stage 2 output>"
```

### Step 4: Save Process Log

Write the full process log to `uploads/triangulate-<YYYY-MM-DD-HHMMSS>.md` with this format:

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
| Generate | <model> | <provider> | <why this model for this task type> |
| Critique | <model> | <provider> | <why> |
| Resolve | <model> | <provider> | <why> |

## Summary
- **Generate:** <1-line summary>
- **Critique:** <key issues found>
- **Resolve:** <how conflicts were resolved>
```

### Step 5: Present Results

Show the user:
1. The **final resolved output** (Stage 3) as the main response
2. A brief note: which models were used, key critique points addressed
3. The **log file path** for full process transparency

## Error Handling

- If a LiteLLM call fails, show the error and continue with remaining stages
- If Stage 1 fails, abort and report the error
- If Stage 2 fails, present Stage 1 output as-is with a note that critique was unavailable
- If Stage 3 fails, present both Stage 1 and Stage 2 outputs for the user to resolve manually
