---
name: remarkable
description: Fetch and view pages from the user's reMarkable tablet as images. Use when the user asks to see, get, show, or read a page/notebook from their reMarkable (e.g. "get my Quick notes page", "show me my Bullet Journal", "what's on my reMarkable").
---

# reMarkable

You can fetch pages from the user's reMarkable tablet and deliver them as images.
This is **read-only** — you can view notebooks and render pages, but you cannot
delete, move, or modify anything on the reMarkable (by design).

## Tools

- `mcp__remarkable__remarkable_list` — list notebooks + folders (no arguments). Use
  this first if you don't already know the exact notebook path.
- `mcp__remarkable__remarkable_get_page` — render a page (or all pages) of a
  notebook to PNG. Args: `notebook` (path from the list), optional `page`
  (1-based; omit for all pages). Returns saved `.png` path(s).

## How to handle a request

1. If the notebook name is ambiguous, call `remarkable_list` and match the user's
   words to a `path` (e.g. "quick notes" → `Quick notes`).
2. Call `remarkable_get_page` with that notebook (and a page number if the user
   specified one; otherwise omit to get all pages).
3. For each returned `.png` path, deliver it with `send_file` (path = the .png).
   Send the actual image — do not just describe it.
4. If a page comes back marked "(appears blank)", mention that rather than sending
   an empty image.

## Notes

- Fetching downloads + renders on the host and can take 10–30s for a multi-page
  notebook — that's normal.
- The notebook list excludes trash.
- If the tools report the proxy is unreachable or unconfigured, tell the user the
  reMarkable bridge isn't available right now (don't retry in a loop).
