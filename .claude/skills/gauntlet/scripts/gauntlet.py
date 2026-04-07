#!/usr/bin/env python3
"""
Gauntlet: Multi-agent structured debate via LiteLLM.

Runs a task through 3 LLMs in 4 stages:
  1. Independent parallel generation (no anchoring)
  2. Cross-critique (each reviews the other two)
  3. Rebuttal & revision (defend or revise)
  4. Judge synthesis (one model consolidates)

Usage:
  python3 gauntlet.py --task "your task here" [options]

Options:
  --task TEXT           The task to debate (required)
  --model-a MODEL      Voice A model (default from routing table)
  --model-b MODEL      Voice B model
  --model-c MODEL      Voice C model
  --judge MODEL        Judge model
  --task-type TYPE     Force task classification (code|analysis|creative|factual|strategy|math|default)
  --litellm-url URL    LiteLLM endpoint (default: http://localhost:4000/v1/chat/completions)
  --litellm-key KEY    LiteLLM API key
  --output-dir DIR     Where to save debate log (default: gauntlet-logs/)
  --prompts-file PATH  Path to prompt-templates.md
  --routing-file PATH  Path to model-routing.md
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone


# --- LLM calling ---

MAX_RETRIES = 2
TIMEOUT_SECS = 300


def call_llm(model, system_prompt, user_prompt, temperature, max_tokens,
             litellm_url, litellm_key):
    """Call a model via LiteLLM. Returns response text or raises on failure."""
    data = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "max_tokens": max_tokens,
        "temperature": temperature,
    }).encode()

    req = urllib.request.Request(
        litellm_url,
        data=data,
        headers={
            "Authorization": f"Bearer {litellm_key}",
            "Content-Type": "application/json",
        },
    )

    last_err = None
    for attempt in range(MAX_RETRIES + 1):
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT_SECS) as resp:
                result = json.loads(resp.read())
                content = result["choices"][0]["message"]["content"]
                if content and content.strip():
                    return content.strip()
                raise ValueError("Empty response from model")
        except Exception as e:
            last_err = e
            if attempt < MAX_RETRIES:
                wait = 2 ** (attempt + 1)
                print(f"  Retry {attempt + 1}/{MAX_RETRIES} for {model} "
                      f"(error: {e}), waiting {wait}s...", file=sys.stderr)
                time.sleep(wait)

    raise RuntimeError(f"Model {model} failed after {MAX_RETRIES + 1} attempts: {last_err}")


def call_parallel(calls, litellm_url, litellm_key):
    """Run multiple LLM calls in parallel. Returns dict of label -> response text.
    If a call fails, its value is an error string prefixed with 'ERROR: '."""
    results = {}
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = {}
        for label, model, sys_p, usr_p, temp, max_tok in calls:
            future = pool.submit(
                call_llm, model, sys_p, usr_p, temp, max_tok,
                litellm_url, litellm_key,
            )
            futures[future] = (label, model)

        for future in as_completed(futures):
            label, model = futures[future]
            try:
                results[label] = future.result()
                print(f"  {label} ({model}): {len(results[label]):,} chars")
            except Exception as e:
                results[label] = f"ERROR: {model} failed — {e}"
                print(f"  {label} ({model}): FAILED — {e}", file=sys.stderr)

    return results


# --- Prompt loading ---

def load_prompts(prompts_file):
    """Parse prompt-templates.md into a dict of stage -> {system, user} templates."""
    with open(prompts_file) as f:
        content = f.read()

    prompts = {}
    # Extract system and user prompts for each stage
    stages = {
        "generate": "Stage 1: Generation Prompt",
        "critique": "Stage 2: Cross-Critique Round 1",
        "rebuttal": "Stage 3: Rebuttal & Revision",
        "judge": "Stage 4: Judge / Synthesis",
    }

    for key, heading in stages.items():
        # Find the section
        section_match = re.search(
            rf"## {re.escape(heading)}(.*?)(?=\n## |\Z)",
            content, re.DOTALL,
        )
        if not section_match:
            print(f"Warning: Could not find section '{heading}' in prompts file",
                  file=sys.stderr)
            continue

        section = section_match.group(1)

        # Extract system prompt (first code block after "### System Prompt")
        sys_match = re.search(
            r"### System Prompt\s*\n```\n(.*?)\n```",
            section, re.DOTALL,
        )
        # Extract user prompt (first code block after "### User Prompt")
        usr_match = re.search(
            r"### User Prompt\s*\n```\n(.*?)\n```",
            section, re.DOTALL,
        )

        prompts[key] = {
            "system": sys_match.group(1) if sys_match else "",
            "user": usr_match.group(1) if usr_match else "",
        }

    return prompts


# --- Task classification ---

TASK_KEYWORDS = {
    "code": ["code", "programming", "implementation", "debugging", "refactoring",
             "api design", "function", "class", "module", "bug", "compile"],
    "analysis": ["analyze", "evaluate", "compare", "assess", "review", "audit",
                 "investigate", "benchmark"],
    "creative": ["write", "design", "brainstorm", "create", "imagine", "story",
                 "marketing", "narrative", "poem", "essay"],
    "factual": ["what is", "explain", "define", "how does", "history of",
                "describe", "meaning of"],
    "strategy": ["plan", "strategy", "architecture", "roadmap", "decision",
                 "tradeoffs", "tradeoff", "approach", "design"],
    "math": ["calculate", "prove", "derive", "optimize", "algorithm",
             "complexity", "equation", "formula"],
}


def classify_task(task_text):
    """Classify task into a type based on keyword matching."""
    lower = task_text.lower()
    scores = {}
    for task_type, keywords in TASK_KEYWORDS.items():
        scores[task_type] = sum(1 for kw in keywords if kw in lower)

    best = max(scores, key=scores.get)
    return best if scores[best] > 0 else "default"


# --- Model routing ---

DEFAULT_ROUTING = {
    "default": {
        "a": "claude-opus-4-6", "b": "gpt-4o",
        "c": "gemini-2.5-pro", "judge": "claude-opus-4-6",
    },
}

FALLBACK_CHAINS = {
    "claude-opus-4-6": ["claude-sonnet-4-6"],
    "gpt-4o": ["o3"],
    "gemini-2.5-pro": ["gemini-2.5-flash"],
}


def load_routing(routing_file):
    """Parse model-routing.md into routing dict."""
    routing = dict(DEFAULT_ROUTING)
    try:
        with open(routing_file) as f:
            content = f.read()

        # Parse the task-based routing table
        table_match = re.search(
            r"## Task-Based Routing\s*\n.*?\n\|[-\s|]+\|\n(.*?)(?=\n##|\Z)",
            content, re.DOTALL,
        )
        if table_match:
            for line in table_match.group(1).strip().split("\n"):
                parts = [p.strip().strip("`") for p in line.split("|") if p.strip()]
                if len(parts) >= 5:
                    task_type = parts[0]
                    routing[task_type] = {
                        "a": parts[1], "b": parts[2],
                        "c": parts[3], "judge": parts[4],
                    }
    except Exception as e:
        print(f"Warning: Could not parse routing file: {e}", file=sys.stderr)

    return routing


def get_models(task_type, routing, overrides):
    """Resolve final model assignments from routing table + overrides."""
    base = routing.get(task_type, routing.get("default", DEFAULT_ROUTING["default"]))
    return {
        "a": overrides.get("a") or base["a"],
        "b": overrides.get("b") or base["b"],
        "c": overrides.get("c") or base["c"],
        "judge": overrides.get("judge") or base["judge"],
    }


# --- Main orchestration ---

def run_gauntlet(task, models, prompts, litellm_url, litellm_key, output_dir,
                 task_type):
    """Run the full 4-stage gauntlet debate."""
    start_time = time.time()
    job_id = datetime.now().strftime("%Y-%m-%d-%H%M%S")

    print(f"\nModels: A={models['a']}, B={models['b']}, C={models['c']}, "
          f"Judge={models['judge']}")
    print(f"Task type: {task_type}\n")

    # === Stage 1: Independent Generation ===
    print("=== STAGE 1: Independent Generation (parallel) ===")

    gen_sys = prompts["generate"]["system"]
    gen_usr = prompts["generate"]["user"].replace("{{TASK_DESCRIPTION}}", task)

    gen_calls = [
        ("Voice A", models["a"], gen_sys, gen_usr, 0.7, 4096),
        ("Voice B", models["b"], gen_sys, gen_usr, 0.7, 4096),
        ("Voice C", models["c"], gen_sys, gen_usr, 0.7, 4096),
    ]
    responses = call_parallel(gen_calls, litellm_url, litellm_key)
    resp_a = responses.get("Voice A", "ERROR: no response")
    resp_b = responses.get("Voice B", "ERROR: no response")
    resp_c = responses.get("Voice C", "ERROR: no response")

    # === Stage 2: Cross-Critique ===
    print("\n=== STAGE 2: Cross-Critique (parallel) ===")

    crit_sys = prompts["critique"]["system"]
    crit_usr_template = prompts["critique"]["user"]

    def make_crit_prompt(rx, ry):
        return (crit_usr_template
                .replace("{{TASK_DESCRIPTION}}", task)
                .replace("{{RESPONSE_X}}", rx)
                .replace("{{RESPONSE_Y}}", ry))

    crit_calls = [
        ("Critique A", models["a"], crit_sys,
         make_crit_prompt(resp_b, resp_c), 0.3, 2048),
        ("Critique B", models["b"], crit_sys,
         make_crit_prompt(resp_a, resp_c), 0.3, 2048),
        ("Critique C", models["c"], crit_sys,
         make_crit_prompt(resp_a, resp_b), 0.3, 2048),
    ]
    critiques = call_parallel(crit_calls, litellm_url, litellm_key)
    crit_a = critiques.get("Critique A", "ERROR: no critique")
    crit_b = critiques.get("Critique B", "ERROR: no critique")
    crit_c = critiques.get("Critique C", "ERROR: no critique")

    # === Stage 3: Rebuttal & Revision ===
    print("\n=== STAGE 3: Rebuttal & Revision (parallel) ===")

    reb_sys = prompts["rebuttal"]["system"]
    reb_usr_template = prompts["rebuttal"]["user"]

    def make_reb_prompt(own, c1, c2):
        return (reb_usr_template
                .replace("{{TASK_DESCRIPTION}}", task)
                .replace("{{OWN_ORIGINAL_RESPONSE}}", own)
                .replace("{{CRITIQUE_FROM_REVIEWER_1}}", c1)
                .replace("{{CRITIQUE_FROM_REVIEWER_2}}", c2))

    reb_calls = [
        ("Rebuttal A", models["a"], reb_sys,
         make_reb_prompt(resp_a, crit_b, crit_c), 0.4, 3072),
        ("Rebuttal B", models["b"], reb_sys,
         make_reb_prompt(resp_b, crit_a, crit_c), 0.4, 3072),
        ("Rebuttal C", models["c"], reb_sys,
         make_reb_prompt(resp_c, crit_a, crit_b), 0.4, 3072),
    ]
    rebuttals = call_parallel(reb_calls, litellm_url, litellm_key)
    reb_a = rebuttals.get("Rebuttal A", "ERROR: no rebuttal")
    reb_b = rebuttals.get("Rebuttal B", "ERROR: no rebuttal")
    reb_c = rebuttals.get("Rebuttal C", "ERROR: no rebuttal")

    # === Stage 4: Judge Synthesis ===
    print("\n=== STAGE 4: Judge Synthesis ===")

    judge_sys = prompts["judge"]["system"]
    judge_usr = (prompts["judge"]["user"]
                 .replace("{{TASK_DESCRIPTION}}", task)
                 .replace("{{MODEL_A_NAME}}", models["a"])
                 .replace("{{MODEL_B_NAME}}", models["b"])
                 .replace("{{MODEL_C_NAME}}", models["c"])
                 .replace("{{RESPONSE_A}}", resp_a)
                 .replace("{{RESPONSE_B}}", resp_b)
                 .replace("{{RESPONSE_C}}", resp_c)
                 .replace("{{CRITIQUE_A}}", crit_a)
                 .replace("{{CRITIQUE_B}}", crit_b)
                 .replace("{{CRITIQUE_C}}", crit_c)
                 .replace("{{REBUTTAL_A}}", reb_a)
                 .replace("{{REBUTTAL_B}}", reb_b)
                 .replace("{{REBUTTAL_C}}", reb_c))

    print(f"  Calling judge ({models['judge']})...")
    judge_result = call_llm(
        models["judge"], judge_sys, judge_usr, 0.2, 4096,
        litellm_url, litellm_key,
    )
    print(f"  Judge: {len(judge_result):,} chars")

    # === Save debate log ===
    duration = time.time() - start_time
    duration_str = f"{duration / 60:.1f} minutes"

    os.makedirs(output_dir, exist_ok=True)
    log_path = os.path.join(output_dir, f"gauntlet-{job_id}.md")

    log = f"""# Debate Log: {job_id}

## Metadata
- **Task**: {task}
- **Task Type**: {task_type}
- **Duration**: {duration_str}
- **Voice A**: {models['a']} | **Voice B**: {models['b']} | **Voice C**: {models['c']}
- **Judge**: {models['judge']}
- **API Calls**: 10

## Stage 1: Independent Generation

### Voice A ({models['a']})
{resp_a}

### Voice B ({models['b']})
{resp_b}

### Voice C ({models['c']})
{resp_c}

## Stage 2: Cross-Critique Round 1

### Voice A critiques B and C
{crit_a}

### Voice B critiques A and C
{crit_b}

### Voice C critiques A and B
{crit_c}

## Stage 3: Rebuttal & Revision

### Voice A
{reb_a}

### Voice B
{reb_b}

### Voice C
{reb_c}

## Stage 4: Judge Synthesis ({models['judge']})
{judge_result}
"""

    with open(log_path, "w") as f:
        f.write(log)

    print(f"\n=== GAUNTLET COMPLETE ({duration_str}) ===")
    print(f"Debate log: {log_path}")

    # Write judge result to stdout for the calling agent to read
    print("\n--- JUDGE RESULT ---")
    print(judge_result)

    return log_path, judge_result


def main():
    parser = argparse.ArgumentParser(description="Gauntlet: multi-agent structured debate")
    parser.add_argument("--task", required=True, help="The task to debate")
    parser.add_argument("--model-a", default=None, help="Voice A model override")
    parser.add_argument("--model-b", default=None, help="Voice B model override")
    parser.add_argument("--model-c", default=None, help="Voice C model override")
    parser.add_argument("--judge", default=None, help="Judge model override")
    parser.add_argument("--task-type", default=None,
                        help="Force task classification")
    parser.add_argument("--litellm-url",
                        default="http://localhost:4000/v1/chat/completions",
                        help="LiteLLM endpoint")
    parser.add_argument("--litellm-key", default=None, help="LiteLLM API key")
    parser.add_argument("--output-dir", default="gauntlet-logs",
                        help="Where to save debate log")
    parser.add_argument("--prompts-file", required=True,
                        help="Path to prompt-templates.md")
    parser.add_argument("--routing-file", required=True,
                        help="Path to model-routing.md")
    args = parser.parse_args()

    # Resolve API key
    litellm_key = args.litellm_key
    if not litellm_key:
        # Try .env file
        for env_path in [".env", os.path.expanduser("~/.env")]:
            if os.path.exists(env_path):
                with open(env_path) as f:
                    for line in f:
                        if line.startswith("LITELLM_API_KEY="):
                            litellm_key = line.strip().split("=", 1)[1]
                            break
            if litellm_key:
                break
        if not litellm_key:
            litellm_key = os.environ.get("LITELLM_API_KEY", "")

    if not litellm_key:
        print("Error: No LiteLLM API key found. Pass --litellm-key or set "
              "LITELLM_API_KEY in .env", file=sys.stderr)
        sys.exit(1)

    # Check LiteLLM health
    health_url = args.litellm_url.replace("/v1/chat/completions", "/health")
    try:
        health_req = urllib.request.Request(
            health_url,
            headers={"Authorization": f"Bearer {litellm_key}"},
        )
        urllib.request.urlopen(health_req, timeout=5)
    except Exception:
        # Health endpoint may return 401 but that still means LiteLLM is running
        try:
            urllib.request.urlopen(
                urllib.request.Request(health_url), timeout=5,
            )
        except urllib.error.URLError:
            print("Error: LiteLLM proxy is not reachable at "
                  f"{health_url}", file=sys.stderr)
            sys.exit(1)
        except Exception:
            pass  # Any response means the server is up

    # Load prompt templates and routing
    prompts = load_prompts(args.prompts_file)
    routing = load_routing(args.routing_file)

    # Classify task
    task_type = args.task_type or classify_task(args.task)

    # Resolve models
    overrides = {}
    if args.model_a:
        overrides["a"] = args.model_a
    if args.model_b:
        overrides["b"] = args.model_b
    if args.model_c:
        overrides["c"] = args.model_c
    if args.judge:
        overrides["judge"] = args.judge

    models = get_models(task_type, routing, overrides)

    # Run the gauntlet
    run_gauntlet(
        task=args.task,
        models=models,
        prompts=prompts,
        litellm_url=args.litellm_url,
        litellm_key=litellm_key,
        output_dir=args.output_dir,
        task_type=task_type,
    )


if __name__ == "__main__":
    main()
