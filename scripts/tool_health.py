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
ERROR_LOG = ROOT / "logs" / "nanoclaw.error.log"

# A permanently-dropped user-facing message currently leaves ONLY this error-log
# line (delivery.ts give-up branch) — no alert, agent thinks it sent. This marker
# is the general "fail loud" net: any silent delivery drop (malformed markdown,
# network, adapter bug) surfaces here.
DELIVERY_FAIL_MARKER = "Message delivery failed permanently"

# --- tunables ---
WINDOW_HOURS = 24
MIN_ATTEMPTS = 3        # don't judge a tool on <3 attempts (avoid noise)
FAIL_THRESHOLD = 0.40   # flag a tool failing ≥40% of the time

# INTEGRATION tools only — substrings matched against the ledger `tool` name.
# A sustained failure here means a broken EXTERNAL integration (proxy/gateway/auth),
# not normal agent trial-and-error.
#
# Deliberately EXCLUDED: send_message / send_file / add_reaction. Their MCP handlers
# only QUEUE a row to the outbound DB (the host delivers later) or resolve a local
# destination — so a tool-call "failure" there is the AGENT calling with a bad
# destination name or empty text and then self-correcting (cf. Bash typos), NOT a
# broken integration. Counting them produced false "50% failed" alerts (2026-06-13).
# Actual message-DELIVERY health is covered separately below by the
# "Message delivery failed permanently" error-log scan (scan_delivery_failures).
WATCH = [
    "gws_run",        # → host gws proxy → Google Workspace
    "remarkable_",    # → host reMarkable bridge → reMarkable cloud
    "anylist",        # → AnyList MCP → AnyList service
    "generate_image", # → LiteLLM → image API
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


def scan_delivery_failures(prev_offset: int) -> tuple[int, int]:
    """Read the error log from prev_offset; return (new_failure_count, new_offset).
    Byte-offset tracking so each permanent-drop is counted once; resets on rotation."""
    try:
        size = ERROR_LOG.stat().st_size
        start = 0 if size < prev_offset else prev_offset  # rotated/truncated → reread
        with open(ERROR_LOG, "r", errors="replace") as f:
            f.seek(start)
            chunk = f.read()
        return chunk.count(DELIVERY_FAIL_MARKER), start + len(chunk.encode("utf-8", "replace"))
    except FileNotFoundError:
        return 0, prev_offset
    except Exception as e:
        print(f"tool_health: error-log scan failed: {e}", file=sys.stderr)
        return 0, prev_offset


def tg_alert(text: str) -> None:
    env = load_env(["TELEGRAM_BOT_TOKEN", "WATCHDOG_ALERT_CHAT_ID"])
    token = os.environ.get("TELEGRAM_BOT_TOKEN") or env.get("TELEGRAM_BOT_TOKEN", "")
    chat = os.environ.get("WATCHDOG_ALERT_CHAT_ID") or env.get("WATCHDOG_ALERT_CHAT_ID", "145958767")
    if not token:
        print("tool_health: no TELEGRAM_BOT_TOKEN, cannot alert", file=sys.stderr)
        return
    try:
        # No parse_mode: tool names contain underscores (send_file, gws_run) which
        # break Telegram's Markdown parser (unbalanced italic → HTTP 400). Plain
        # text is robust; the *…* / `…` markers read fine literally.
        data = urllib.parse.urlencode({"chat_id": chat, "text": text}).encode()
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

    # Load prior state once (flagged set + error-log read offset).
    try:
        st = json.loads(STATE_PATH.read_text())
    except Exception:
        st = {}
    prev = set(st.get("flagged", []))
    prev_offset = int(st.get("errlog_offset", 0))

    # General net: count NEW permanently-dropped messages since last scan.
    new_drops, new_offset = scan_delivery_failures(prev_offset)

    if args.check:
        print(f"window: last {args.hours}h | watched tools seen: {len(agg)} | flagged: {len(now_flagged)}")
        for tool, a in sorted(agg.items()):
            mark = "  <<< FLAGGED" if tool in now_flagged else ""
            print(f"  {short(tool):24} {a['fails']}/{a['total']} failed{mark}")
        print(f"new permanently-dropped messages since last scan: {new_drops}")
        return

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

    if new_drops > 0:
        tg_alert(
            f"🚨 NanoClaw delivery — {new_drops} message(s) were permanently DROPPED "
            f"(could not be delivered to the user after retries) since the last check. "
            f"The agent thinks it replied but the message never arrived. Check logs/nanoclaw.error.log "
            f"for 'Message delivery failed permanently'."
        )

    try:
        STATE_PATH.write_text(json.dumps({
            "flagged": sorted(cur),
            "errlog_offset": new_offset,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }, indent=2))
    except Exception as e:
        print(f"tool_health: state write failed: {e}", file=sys.stderr)

    print(f"OK: flagged={len(cur)} new={len(new_problems)} recovered={len(recovered)} new_drops={new_drops}")


if __name__ == "__main__":
    main()
