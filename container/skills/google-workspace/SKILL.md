---
name: google-workspace
description: Access Google Workspace services (Gmail, Drive, Calendar, Sheets, Docs, Slides, People, Chat, Forms, Keep, Meet) via the gws CLI. Use when the user asks about email, calendar, files, spreadsheets, documents, or any Google Workspace service.
---

# Google Workspace Integration

You have access to Google Workspace via MCP tools that wrap the `gws` CLI.

## PREFER THE TYPED TOOLS

For the common operations there are **typed tools** that build the exact gws
invocation for you. Use them first — you fill in structured params and cannot get
the CLI syntax wrong. Reach for `gws_run` only for operations not covered here.

| Tool | Does | R/W |
|------|------|-----|
| `mcp__gws__sheets_read` `{ spreadsheetId, range }` | Read a sheet range (JSON rows) | read |
| `mcp__gws__sheets_update` `{ spreadsheetId, range, values }` | Overwrite cells from a 2D array | write |
| `mcp__gws__sheets_append` `{ spreadsheetId, range, values }` | Append rows after the last data row | write |
| `mcp__gws__sheets_clear` `{ spreadsheetId, range }` | Clear cell values (how you EMPTY a tab) | write |
| `mcp__gws__drive_find` `{ query }` | Search Drive (`q` syntax) | read |
| `mcp__gws__drive_get` `{ fileId }` | File metadata | read |
| `mcp__gws__drive_download` `{ fileId, output }` | Download CONTENT (CSV/PDF/image). NOT "export" | read |
| `mcp__gws__gmail_search` `{ query, maxResults }` | Search messages → ids | read |
| `mcp__gws__gmail_read` `{ id }` | Read a message | read |
| `mcp__gws__gmail_send` `{ to, subject, body }` | Send an email | write |

- `range` always includes the tab name, e.g. `"Upcoming Concerts!A:H"`.
- `values` is a 2D array, e.g. `[["June 1","Blue Note","NYC"]]` — NOT a JSON string.
- To download a non-Google file (a `.csv`/`.pdf` already in Drive) use `drive_download`. Do **not** use Drive *export* — that only works on native Docs/Sheets/Slides and 403s on everything else.
- Write tools return `confirmation_required` with a `nonce` on first call (see the confirmation flow below); re-call with `confirmed_nonce`. Scheduled tasks auto-confirm.

## Lower-level tools (fallback)

### `mcp__gws__gws_discover`
List available services or explore methods within a service.

### `mcp__gws__gws_help`
Get detailed help for a specific command, including parameters and usage examples.

### `mcp__gws__gws_run`
Execute any gws command — the escape hatch for operations without a typed tool
(Calendar, Docs, Slides, Forms, Chat, less-common Gmail/Drive ops).

## gws_run syntax rules (READ FIRST — getting these wrong causes 400/validation errors)

These are the exact, verified forms. The CLI is strict; do not improvise.
- **`--format=json`** uses an `=` (NOT `--format json` — the space form is parsed as a service name and fails).
- **API parameters go in `--params '<json>'`** — a single JSON object, single-quoted. NOT individual `--spreadsheetId`/`--range` flags, and NOT a dotted subcommand like `spreadsheets.values` (use spaces: `spreadsheets values get`).
- **`--json '<json>'`** carries a request body (e.g. row values). Inline it — `--json` does NOT accept `@file.json`.
- Subcommand names are camelCase for the underlying API (`getProfile`, `batchUpdate`).
- If a form fails, call `gws_help({ service, command })` to get the exact usage rather than guessing.

## Common Operations (verified syntax)

### Gmail
```
gws_run({ command: "gmail +triage --query 'is:unread'" })                 # Unread inbox summary (read)
gws_run({ command: "gmail +read --id MESSAGE_ID" })                       # Read a specific email (read)
gws_run({ command: "gmail +send --to user@example.com --subject 'Subject' --body 'Body line1\\nline2'" })  # Send (needs confirmation)
gws_run({ command: "gmail +reply --id MESSAGE_ID --body 'Reply'" })       # Reply (needs confirmation)
# Trash a message — note: `gmail +trash` does NOT exist; use the API form:
gws_run({ command: "gmail users messages trash --params '{\"userId\":\"me\",\"id\":\"MESSAGE_ID\"}'" })  # (needs confirmation)
```

### Sheets  (use these to read/clear/write a sheet — NEVER use Drive ops to modify sheet contents)
```
# Read a range:
gws_run({ command: "sheets spreadsheets values get --params '{\"spreadsheetId\":\"ID\",\"range\":\"'Tab Name'!A:G\"}' --format=json" })
# Clear a range (this is how you EMPTY a sheet — do NOT delete/trash the file):
gws_run({ command: "sheets spreadsheets values clear --params '{\"spreadsheetId\":\"ID\",\"range\":\"'Tab Name'!A2:G\"}'" })  # (needs confirmation)
# Overwrite values at a range:
gws_run({ command: "sheets spreadsheets values update --params '{\"spreadsheetId\":\"ID\",\"range\":\"'Tab Name'!A2\",\"valueInputOption\":\"RAW\"}' --json '{\"values\":[[\"a\",\"b\"]]}'" })  # (needs confirmation)
# Append rows:
gws_run({ command: "sheets spreadsheets values append --params '{\"spreadsheetId\":\"ID\",\"range\":\"Sheet1!A:H\",\"valueInputOption\":\"RAW\",\"insertDataOption\":\"INSERT_ROWS\"}' --json '{\"values\":[[\"x\",\"y\"]]}'" })  # (needs confirmation)
```

### Drive  (READ ONLY — destructive ops are blocked)
```
gws_run({ command: "drive files list --params '{\"q\":\"name contains '\\''report'\\''\",\"fields\":\"files(id,name)\"}' --format=json" })  # Search
gws_run({ command: "drive files get --params '{\"fileId\":\"FILE_ID\",\"fields\":\"id,name,trashed\"}' --format=json" })                  # Metadata
gws_run({ command: "drive files get --params '{\"fileId\":\"FILE_ID\",\"alt\":\"media\"}' -o filename.csv" })                              # Download content (prefer the drive_download tool)
```
⚠️ **`drive files delete`, `drive files trash`, and trash-via-update are BLOCKED by policy and will be rejected.** Two Google Sheets were lost this way. To empty a spreadsheet, use `sheets spreadsheets values clear` (above) — that wipes the cells WITHOUT touching the file. Never try to delete or trash a Drive file to "reset" it.

### Calendar / Docs / Slides / Forms / Chat
Use `gws_discover({ service: "SERVICE_NAME" })` then `gws_help` to get exact operations + syntax before calling.

## Write Operation Confirmation Flow

Write operations (send, create, update, delete, etc.) require user confirmation:

1. Call `gws_run` with the command → returns `confirmation_required` with a `nonce`
2. Use `mcp__nanoclaw__send_message` to tell the user what you're about to do and ask for approval
3. Wait for the user to approve
4. Call `gws_run` again with the same command and `confirmed_nonce` set to the nonce

**Never skip the confirmation flow for write operations.** The tool enforces this — write commands without a valid nonce will not execute.

### Email — ALWAYS confirm with user

Email operations (gmail +send, +reply, +forward) MUST ALWAYS go through user confirmation — no exceptions. Even if the user asked for something that involves email, confirm the specific recipient, subject, and body before sending. NEVER:
- Send email as a "fallback" when another delivery method fails
- Guess or fabricate email addresses
- Self-confirm email operations

Read operations (list, get, search, read, triage) execute immediately without confirmation.

## Argument Passing — No Shell Substitution

`gws_run` does NOT evaluate a shell. The command string is passed as-is to the underlying API. This means shell features never expand:

- `$(cat /path/to/file)` — delivered as the literal 7-byte text `$(cat ` followed by the path.
- `` `cat ...` `` — backticks never expand.
- `< file` redirection — the `<` character is treated as literal input.
- `$VAR` / `${VAR}` — variables are not interpolated.

For `gmail +send --body "..."`, always pass the full body inline as a literal string argument with embedded `\n` for newlines. If the body is already written to a file, Read the file first, then inline its contents into the `--body` argument.

**Real incident — 2026-04-17T13:14Z:** A daily update was sent with `--body "$(cat /tmp/daily_update_apr17.txt)"`; the recipient received the literal string `$(cat /tmp/daily_update_apr17.txt)` instead of the email body. Do not repeat.

## Audit Log

All tool calls are logged to `/workspace/agent/logs/gws-audit.jsonl` with timestamps, commands, classification, and results.
