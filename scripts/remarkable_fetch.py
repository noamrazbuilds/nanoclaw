#!/usr/bin/env python3
"""
remarkable_fetch.py — READ-ONLY reMarkable fetch + render, for the host-side bridge.

The reMarkable cloud CLI (rmapi) + render stack (rmc + cairosvg) live on the host
and are authenticated there (~/.config/rmapi). Agent containers must NOT carry the
cloud token or rmapi's destructive verbs (rm/mv/put) — see the sheet-deletion
incident. This helper is invoked by src/remarkable-proxy.ts (host) and uses ONLY
rmapi's read verbs (find/get). It never deletes, moves, or uploads anything.

Modes:
  --list                       → JSON {notebooks:[{path,type}]} (rmapi find)
  --notebook NAME [--page N]   → JSON {notebook, pages:[{index, png_b64, blank}]}
                                 (rmapi get → unzip → .rm → SVG → PNG; --page is
                                  1-based; omit for all pages)

Output: a single JSON line on stdout. Errors → JSON {error:...} + exit 1.
Stdlib + (rmc, cairosvg) which are host-only. Designed to run with HOME set so
rmapi finds its auth.
"""
import argparse
import base64
import json
import os
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

RMAPI = os.environ.get("RMAPI_BIN", "/home/nanoclaw/bin/rmapi")
RMC = os.environ.get("RMC_BIN", "/home/nanoclaw/.local/bin/rmc")
HOME = os.environ.get("RMAPI_HOME", "/home/nanoclaw")
RENDER_WIDTH = 1404            # native reMarkable page width
MAX_PAGES = 50                 # safety cap
BLANK_PNG_BYTES = 2000         # tiny PNG ≈ blank template page


def _rmapi(*args, timeout=120) -> str:
    env = {**os.environ, "HOME": HOME}
    r = subprocess.run([RMAPI, *args], capture_output=True, text=True, timeout=timeout, env=env)
    if r.returncode != 0:
        raise RuntimeError(f"rmapi {' '.join(args)} failed: {r.stderr.strip()[:200]}")
    return r.stdout


def list_notebooks() -> dict:
    # rmapi find "" prints a tree; lines like "[f] /path" or "[d] /path".
    out = _rmapi("find", "")
    items = []
    for line in out.splitlines():
        s = line.strip()
        if s.startswith("[f]") or s.startswith("[d]"):
            kind = "file" if s.startswith("[f]") else "dir"
            path = s[3:].strip()
            if path and not path.startswith("/trash/") and path != "/trash":
                items.append({"path": path, "type": kind})
    return {"notebooks": items}


def _render_rm_to_png(rm_file: Path, out_dir: Path, idx: int) -> dict | None:
    svg = out_dir / f"p{idx}.svg"
    png = out_dir / f"p{idx}.png"
    try:
        r = subprocess.run([RMC, "-t", "svg", "-o", str(svg), str(rm_file)],
                           capture_output=True, text=True, timeout=60)
        if r.returncode != 0 or not svg.exists():
            return None
        import cairosvg  # type: ignore
        cairosvg.svg2png(url=str(svg), write_to=str(png), output_width=RENDER_WIDTH)
    except Exception as e:
        print(f"render p{idx} failed: {e}", file=sys.stderr)
        return None
    if not png.exists():
        return None
    data = png.read_bytes()
    return {"index": idx, "png_b64": base64.standard_b64encode(data).decode(),
            "bytes": len(data), "blank": len(data) < BLANK_PNG_BYTES}


def fetch_pages(notebook: str, page: int | None) -> dict:
    with tempfile.TemporaryDirectory(prefix="rmfetch-") as td:
        tmp = Path(td)
        # rmapi get writes <basename>.rmdoc (a zip) into cwd.
        env = {**os.environ, "HOME": HOME}
        r = subprocess.run([RMAPI, "get", notebook], capture_output=True, text=True,
                           timeout=180, cwd=str(tmp), env=env)
        if r.returncode != 0:
            raise RuntimeError(f"rmapi get {notebook!r} failed: {r.stderr.strip()[:200]}")
        archives = list(tmp.glob("*.rmdoc")) + list(tmp.glob("*.zip"))
        if not archives:
            raise RuntimeError(f"rmapi get produced no archive for {notebook!r}")
        ext = tmp / "ext"
        ext.mkdir()
        with zipfile.ZipFile(archives[0]) as zf:
            zf.extractall(ext)
        rm_files = sorted(ext.rglob("*.rm"))
        if not rm_files:
            raise RuntimeError(f"no page (.rm) files inside {notebook!r}")
        if page is not None:
            if page < 1 or page > len(rm_files):
                raise RuntimeError(f"page {page} out of range (notebook has {len(rm_files)} pages)")
            selected = [(page, rm_files[page - 1])]
        else:
            selected = list(enumerate(rm_files[:MAX_PAGES], start=1))
        pages = []
        for idx, rm in selected:
            rendered = _render_rm_to_png(rm, tmp, idx)
            if rendered:
                pages.append(rendered)
        if not pages:
            raise RuntimeError("rendering produced no images")
        return {"notebook": notebook, "page_count": len(rm_files), "pages": pages}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--notebook")
    ap.add_argument("--page", type=int, default=None)
    args = ap.parse_args()
    try:
        if args.list:
            print(json.dumps(list_notebooks()))
        elif args.notebook:
            print(json.dumps(fetch_pages(args.notebook, args.page)))
        else:
            print(json.dumps({"error": "specify --list or --notebook NAME"}))
            sys.exit(2)
    except Exception as e:
        print(json.dumps({"error": str(e)[:300]}))
        sys.exit(1)


if __name__ == "__main__":
    main()
