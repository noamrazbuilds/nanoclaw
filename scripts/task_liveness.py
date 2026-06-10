#!/usr/bin/env python3
"""
task_liveness.py — catch scheduled tasks that fail by NOT running ("failure by absence").

The 2026-06-10 missing-daily-update was invisible to every existing monitor: a
session rotated, its recurring task rows were stranded in a closed session's DB
that nothing sweeps, and the tasks silently stopped. No error line, no failed
tool call, no status column flipped — pure silence. The tool-health watchdog and
honest-failure guard only see *recorded* faults, so they can't catch a job that
simply never fired. You can't grep for what didn't happen — you need an
expected-activity check.

This is that check. For every recurring task series (baseline taken from the
central task_audit_log, which survives session rotation by design — migration
018), it verifies the recurrence chain is still alive: a healthy recurring series
ALWAYS has a pending occurrence scheduled in the future (its next run), whether
it's daily or weekly. A series with no future-scheduled occurrence in any active
session has a broken chain — orphaned, stuck, or never re-scheduled — and is
reported. This works across cadences without parsing cron.

Exception-biased + deduped (like tool_health.py): alerts on a newly-dead series
and on recovery; silent when everything's alive. A weekly heartbeat (Sundays)
proves the monitor itself is alive.

Usage:
  python3 scripts/task_liveness.py            # scan + alert on new problems/recoveries
  python3 scripts/task_liveness.py --check    # print the table, send nothing
"""
import argparse
import json
import os
import sqlite3
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CENTRAL_DB = ROOT / "data" / "v2.db"
SESSIONS_DIR = ROOT / "data" / "v2-sessions"
STATE_PATH = ROOT / "data" / ".task-liveness-state.json"
ENV_FILE = ROOT / ".env"

# A pending occurrence overdue by more than this is "stuck" — the host sweep fires
# due tasks within ~60s, so 90min late means it isn't running, not just delayed.
OVERDUE_MINUTES = 90
# A completion this recent counts as alive even before the next occurrence is
# inserted, covering the brief gap between a run finishing and the sweep's
# recurrence fan-out (~60s).
RECENT_COMPLETE_MINUTES = 60
# Sunday heartbeat so prolonged silence isn't ambiguous ("is it fine, or dead?").
HEARTBEAT_WEEKDAY = 6  # Mon=0 … Sun=6


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


def parse_ts(s):
    """Tolerant timestamp parse → aware UTC datetime, or None. Handles ISO-8601
    with Z and sqlite 'YYYY-MM-DD HH:MM:SS'."""
    if not s:
        return None
    s = s.strip()
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00").replace(" ", "T", 1) if "T" not in s and " " in s else s.replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        for fmt in ("%Y-%m-%dT%H:%M:%S.%f%z", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
            try:
                dt = datetime.strptime(s, fmt)
                return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
            except Exception:
                continue
    return None


def series_label(after_snapshot):
    """A short human label for a series from its audit create-snapshot."""
    try:
        snap = json.loads(after_snapshot)
        content = json.loads(snap.get("content", "{}"))
        for key in ("name", "task_name"):
            v = content.get(key)
            if isinstance(v, str) and v.strip():
                return v.strip()[:70]
        for raw in (content.get("prompt") or "").split("\n"):
            line = raw.lstrip("# ").strip()
            if line:
                return line[:70]
    except Exception:
        pass
    return "(unnamed)"


def load_baseline(con):
    """Recurring series that should be alive: created-with-recurrence, not cancelled.
    Keyed by series root (the create row's task_id == series_id)."""
    cancelled = {r[0] for r in con.execute("SELECT task_id FROM task_audit_log WHERE action='cancel'")}
    baseline = {}
    for task_id, recurrence, snap in con.execute(
        "SELECT task_id, json_extract(after_snapshot,'$.recurrence'), after_snapshot "
        "FROM task_audit_log WHERE action='create'"
    ):
        if not recurrence or task_id in cancelled:
            continue
        baseline[task_id] = {"recurrence": recurrence, "label": series_label(snap)}
    return baseline


def active_inbound_dbs(con):
    paths = []
    for sid, agid in con.execute("SELECT id, agent_group_id FROM sessions WHERE status='active'"):
        p = SESSIONS_DIR / agid / sid / "inbound.db"
        if p.exists():
            paths.append(p)
    return paths


def collect_rows(db_paths, series_ids):
    """{series_id: [(status, process_after_dt)]} gathered across active sessions."""
    rows = {s: [] for s in series_ids}
    for db in db_paths:
        try:
            con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=5)
            con.execute("PRAGMA busy_timeout=3000")
            cur = con.execute(
                "SELECT series_id, status, process_after FROM messages_in WHERE kind='task'"
            )
            for series_id, status, process_after in cur.fetchall():
                if series_id in rows:
                    rows[series_id].append((status, parse_ts(process_after)))
            con.close()
        except Exception as e:
            print(f"task_liveness: skip {db}: {e}", file=sys.stderr)
    return rows


def judge(rows, now):
    """Classify a series → 'ok' | 'stuck' | 'dead'. Alive iff it has a pending
    occurrence that is either future-scheduled (next run) OR only recently due
    (still inside the normal fire window — a task due now and running must not be
    called dead), a recent completion, or is intentionally paused. Stuck if its
    only pending occurrence is long overdue. Dead if there's no upcoming run at
    all anywhere active (orphaned / recurrence chain broke)."""
    if any(status == "paused" for status, _ in rows):
        return "ok"  # intentionally not running
    pendings = [pa for status, pa in rows if status == "pending"]
    # A pending row with no process_after is immediately due; a future or
    # recently-due process_after is the healthy "next run scheduled / firing now"
    # state. Only a pending row overdue beyond the fire window is suspect.
    live_pending = any(pa is None or (now - pa).total_seconds() < OVERDUE_MINUTES * 60 for pa in pendings)
    if live_pending:
        return "ok"
    recent_complete = any(
        status == "completed" and pa and (now - pa).total_seconds() <= RECENT_COMPLETE_MINUTES * 60
        for status, pa in rows
    )
    if recent_complete:
        return "ok"
    if pendings:  # a pending occurrence exists but is overdue past the fire window
        return "stuck"
    return "dead"  # no future run scheduled anywhere active — orphaned or chain broken


def tg_alert(text):
    env = load_env(["TELEGRAM_BOT_TOKEN", "WATCHDOG_ALERT_CHAT_ID"])
    token = os.environ.get("TELEGRAM_BOT_TOKEN") or env.get("TELEGRAM_BOT_TOKEN", "")
    chat = os.environ.get("WATCHDOG_ALERT_CHAT_ID") or env.get("WATCHDOG_ALERT_CHAT_ID", "145958767")
    if not token:
        print("task_liveness: no TELEGRAM_BOT_TOKEN, cannot alert", file=sys.stderr)
        return
    try:
        # Plain text (no parse_mode): task labels contain underscores/asterisks
        # that break Telegram Markdown — the watchdog must not fail the way the
        # things it watches do.
        data = urllib.parse.urlencode({"chat_id": chat, "text": text}).encode()
        urllib.request.urlopen(
            urllib.request.Request(f"https://api.telegram.org/bot{token}/sendMessage", data=data),
            timeout=10,
        )
    except Exception as e:
        print(f"task_liveness: telegram send failed: {e}", file=sys.stderr)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="print table, send nothing")
    args = ap.parse_args()

    now = datetime.now(timezone.utc)
    try:
        con = sqlite3.connect(f"file:{CENTRAL_DB}?mode=ro", uri=True, timeout=5)
    except Exception as e:
        print(f"task_liveness: cannot open central DB: {e}", file=sys.stderr)
        sys.exit(1)
    baseline = load_baseline(con)
    db_paths = active_inbound_dbs(con)
    con.close()

    rows = collect_rows(db_paths, set(baseline))
    verdict = {sid: judge(rows[sid], now) for sid in baseline}
    broken = {sid: v for sid, v in verdict.items() if v != "ok"}

    if args.check:
        print(f"recurring series: {len(baseline)} | active sessions scanned: {len(db_paths)} | broken: {len(broken)}")
        for sid, meta in sorted(baseline.items(), key=lambda kv: kv[1]["label"]):
            v = verdict[sid]
            mark = "" if v == "ok" else f"  <<< {v.upper()}"
            print(f"  [{v:5}] {meta['label'][:48]:48} {meta['recurrence']}{mark}")
        return

    try:
        st = json.loads(STATE_PATH.read_text())
    except Exception:
        st = {}
    prev = set(st.get("broken", []))
    cur = set(broken)

    new_problems = cur - prev
    recovered = prev - cur

    if new_problems:
        lines = ["🚨 NanoClaw scheduled-task liveness", "",
                 "These recurring tasks have NO upcoming run scheduled — they have"
                 " silently stopped firing (orphaned by a session rotation, stuck,"
                 " or their recurrence chain broke):", ""]
        for sid in sorted(new_problems, key=lambda s: baseline[s]["label"]):
            m = baseline[sid]
            lines.append(f"• {m['label']}  ({m['recurrence']}) — {verdict[sid]}")
        lines.append("")
        lines.append("Nothing logged an error — the task just isn't running. Check session"
                     " rotation / the active session's inbound.db.")
        tg_alert("\n".join(lines))

    if recovered:
        tg_alert("✅ Scheduled tasks recovered: " +
                 ", ".join(sorted(baseline[s]["label"] for s in recovered if s in baseline)))

    # Weekly heartbeat so prolonged quiet isn't mistaken for a dead monitor.
    last_hb = st.get("last_heartbeat", "")[:10]
    today = now.strftime("%Y-%m-%d")
    if now.weekday() == HEARTBEAT_WEEKDAY and last_hb != today and not new_problems:
        tg_alert(f"✅ Task-liveness heartbeat: all {len(baseline)} recurring tasks have a next run scheduled.")
        st["last_heartbeat"] = now.isoformat()

    try:
        STATE_PATH.write_text(json.dumps({
            "broken": sorted(cur),
            "last_heartbeat": st.get("last_heartbeat", ""),
            "updated_at": now.isoformat(),
        }, indent=2))
    except Exception as e:
        print(f"task_liveness: state write failed: {e}", file=sys.stderr)

    print(f"OK: series={len(baseline)} broken={len(cur)} new={len(new_problems)} recovered={len(recovered)}")


if __name__ == "__main__":
    main()
