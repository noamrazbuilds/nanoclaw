# PKA Task & Inbox Integration

**Implemented:** 2026-04-06
**PKA docs:** `/home/nanoclaw/pka/docs/task-inbox-system.md` (full architecture)

## Summary

NanoClaw now integrates with the PKA inbox classification and task management system. Three scheduled tasks drive the automation, and the container agent (via `groups/global/CLAUDE.md`) handles user responses from any channel.

## What changed in NanoClaw

### global CLAUDE.md

Added "PKA Inbox & Task Handling" section with instructions for the container agent to:
- Recognize inbox review replies (`ok`, `1=ref`, `2=task due friday`, etc.) and route them via `inbox_route.py`
- Handle `done:` commands to mark tasks complete via `task_query.py`
- Answer task queries ("what are my tasks?") via `task_query.py --open`

### Scheduled tasks

Three new cron tasks in `store/messages.db`:

| ID | Schedule | What |
|----|----------|------|
| `task-1775493148476-spg5ul` | `0 5 * * 0-5` (8am IST, Sun–Fri) | Daily inbox review — script gates agent wake on >0 items |
| `task-1775493148487-epnnxo` | `0 13 * * 0-5` (4pm IST, Sun–Fri) | Afternoon check — script gates on >=3 items |
| `task-1775493148497-faeatt` | `0 17 * * 6` (8pm IST, Sat) | Weekly review — task summary + inbox count |

All use `model: haiku`, `context_mode: isolated`, `group_folder: telegram_main`.

### Daily update task

Task `task-1774572694013-gejcab` updated to include a "Tasks" section agent that runs `task_query.py --due-today` and formats overdue/due-today items. Omitted silently when empty.

## PKA scripts (not in this repo)

The actual scripts live in `/home/nanoclaw/pka/scripts/`:
- `inbox_classify.py` — classify captures, send Telegram review
- `inbox_route.py` — route items based on user reply
- `task_query.py` — query/update tasks

See the PKA docs for full architecture details.
