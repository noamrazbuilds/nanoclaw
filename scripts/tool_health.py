#!/usr/bin/env python3
"""
tool_health.py — watch the C5 tool-call ledger for broken INTEGRATION tools.

Every agent tool call is already recorded (success/failure + ts) in each session's
outbound.db `tool_calls` table — but nothing watches it. That's how the gws_run
proxied-400 failures (6/8 failed) sat unnoticed until found by accident. This
scans those ledgers and alerts via Telegram when an INTEGRATION tool's failure
rate over a window crosses a threshold — the kind of failure that means a broken
integration, not normal agent trial-and-error (Bash typos, missing-file Reads,
WebFetch 404s are deliberately NOT watched).

Exception-biased + deduped (like cron_healthcheck.py): alerts on a NEWLY-broken
tool and on RECOVERY; stays silent for an already-reported persistent problem and
when everything is healthy.

Usage:
  python3 scripts/tool_health.py            # scan + alert on new problems/recoveries
  python3 scripts/tool_health.py --check    # print the table, send nothing
  python3 scripts/tool_health.py --hours 72 # custom window (default 24h)
"""
import argparse
import json
import os
import sqlite3
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SESSIONS_DIR = ROOT / "data" / "v2-sessions"
STATE_PATH = ROOT / "data" / ".tool-health-state.json"
ENV_FILE = ROOT / ".env"

# --- tunables ---
WINDOW_HOURS = 24
MIN_ATTEMPTS = 3        # don't judge a tool on <3 attempts (avoid noise)
FAIL_THRESHOLD = 0.40   # flag a tool failing ≥40% of the time

# INTEGRATION tools only — substrings matched against the ledger `tool` name.
# A sustained failure here means a broken integration, not normal trial-and-error.
WATCH = [
    "gws_run",
    "remarkable_",
    "anylist",
    "send_file",
    "send_message",
    "generate_image",
    "add_reaction",
]


def load_env(keys):
    out = {}
    try:
        for line in ENV_FILE.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            if k in keys:
                out[k] = v
    except Exception:
        pass
    return out


def is_watched(tool: str) -> bool:
    return any(w in tool for w in WATCH)


def scan(window_hours: int) -> dict[str, dict]:
    """Return {tool: {total, fails}} over the window, watched tools only."""
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=window_hours)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    agg: dict[str, dict] = {}
    for db in SESSIONS_DIR.rglob("outbound.db"):
        try:
            con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=5)
            con.execute("PRAGMA busy_timeout=3000")
            rows = con.execute(
                "SELECT tool, status FROM tool_calls WHERE ts >= ?", (cutoff,)
            ).fetchall()
            con.close()
        except Exception as e:
            print(f"tool_health: skip {db}: {e}", file=sys.stderr)
            continue
        for tool, status in rows:
            if not is_watched(tool):
                continue
            a = agg.setdefault(tool, {"total": 0, "fails": 0})
            a["total"] += 1
            if status == "failure":
                a["fails"] += 1
    return agg


def flagged(agg: dict[str, dict]) -> dict[str, dict]:
    out = {}
    for tool, a in agg.items():
        if a["total"] >= MIN_ATTEMPTS and a["fails"] / a["total"] >= FAIL_THRESHOLD:
            out[tool] = {"total": a["total"], "fails": a["fails"],
                         "rate": round(a["fails"] / a["total"], 2)}
    return out


def short(tool: str) -> str:
    return tool.split("__")[-1] if "__" in tool else tool


def tg_alert(text: str) -> None:
    env = load_env(["TELEGRAM_BOT_TOKEN", "WATCHDOG_ALERT_CHAT_ID"])
    token = os.environ.get("TELEGRAM_BOT_TOKEN") or env.get("TELEGRAM_BOT_TOKEN", "")
    chat = os.environ.get("WATCHDOG_ALERT_CHAT_ID") or env.get("WATCHDOG_ALERT_CHAT_ID", "145958767")
    if not token:
        print("tool_health: no TELEGRAM_BOT_TOKEN, cannot alert", file=sys.stderr)
        return
    try:
        data = urllib.parse.urlencode({"chat_id": chat, "text": text, "parse_mode": "Markdown"}).encode()
        urllib.request.urlopen(
            urllib.request.Request(f"https://api.telegram.org/bot{token}/sendMessage", data=data),
            timeout=10,
        )
    except Exception as e:
        print(f"tool_health: telegram send failed: {e}", file=sys.stderr)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="print table, send nothing")
    ap.add_argument("--hours", type=int, default=WINDOW_HOURS)
    args = ap.parse_args()

    agg = scan(args.hours)
    now_flagged = flagged(agg)

    if args.check:
        print(f"window: last {args.hours}h | watched tools seen: {len(agg)} | flagged: {len(now_flagged)}")
        for tool, a in sorted(agg.items()):
            mark = "  <<< FLAGGED" if tool in now_flagged else ""
            print(f"  {short(tool):24} {a['fails']}/{a['total']} failed{mark}")
        return

    # Dedup against last run.
    try:
        prev = set(json.loads(STATE_PATH.read_text()).get("flagged", []))
    except Exception:
        prev = set()
    cur = set(now_flagged)

    new_problems = cur - prev
    recovered = prev - cur

    if new_problems:
        lines = ["🚨 *NanoClaw integration health*", ""]
        for tool in sorted(new_problems):
            f = now_flagged[tool]
            lines.append(f"• `{short(tool)}`: {f['fails']}/{f['total']} failed ({int(f['rate']*100)}%) in last {args.hours}h")
        lines.append("")
        lines.append("A tool is failing repeatedly — likely a broken integration (proxy/gateway/auth). Check the logs.")
        tg_alert("\n".join(lines))

    if recovered:
        tg_alert("✅ *Recovered*: " + ", ".join(f"`{short(t)}`" for t in sorted(recovered)))

    try:
        STATE_PATH.write_text(json.dumps({"flagged": sorted(cur),
                                          "updated_at": datetime.now(timezone.utc).isoformat()}, indent=2))
    except Exception as e:
        print(f"tool_health: state write failed: {e}", file=sys.stderr)

    print(f"OK: flagged={len(cur)} new={len(new_problems)} recovered={len(recovered)}")


if __name__ == "__main__":
    main()
