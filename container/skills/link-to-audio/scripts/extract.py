#!/usr/bin/env python3
"""
Extract article content from a URL using trafilatura.

Usage:
  python3 extract.py --url "https://example.com/article"
  python3 extract.py --url "https://example.com/article" --json

Output: plain text (default) or JSON with title, text, word_count.
"""

import argparse
import json
import re
import sys
import urllib.request
import urllib.error

import trafilatura


USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
)

PAYWALL_SIGNALS = [
    "subscribe to continue",
    "sign in to read",
    "create a free account",
    "premium article",
    "members only",
    "paywall",
]


def fetch_html(url, timeout=15):
    """Fetch raw HTML from URL."""
    req = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")


def extraction_is_adequate(text, html):
    """Check if extracted text is good enough."""
    if text is None:
        return False
    if len(text) < 200:
        return False
    # Paywall detection: short text + paywall signals in HTML
    html_lower = html.lower()
    if any(sig in html_lower for sig in PAYWALL_SIGNALS) and len(text) < 500:
        return False
    # Content-to-boilerplate ratio check
    if len(text) < len(html) * 0.02:
        return False
    return True


def extract_article(url):
    """Extract article content from URL. Returns (title, text, word_count, is_paywalled)."""
    html = fetch_html(url)

    # Extract with trafilatura
    text = trafilatura.extract(
        html,
        include_comments=False,
        include_tables=False,
        favor_recall=True,
    )

    # Get metadata for title
    metadata = trafilatura.extract_metadata(html)
    title = metadata.title if metadata and metadata.title else None

    # If no title from metadata, try to get from HTML
    if not title:
        title_match = re.search(r"<title[^>]*>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
        if title_match:
            title = title_match.group(1).strip()

    # Check extraction quality
    is_paywalled = False
    if not extraction_is_adequate(text, html):
        # Check if it looks paywalled
        html_lower = html.lower()
        if any(sig in html_lower for sig in PAYWALL_SIGNALS):
            is_paywalled = True
            if text and len(text) > 50:
                # Return what we got with paywall flag
                pass
            else:
                return title, None, 0, True
        else:
            return title, None, 0, False

    word_count = len(text.split()) if text else 0
    return title, text, word_count, is_paywalled


def main():
    parser = argparse.ArgumentParser(description="Extract article from URL")
    parser.add_argument("--url", required=True, help="URL to extract")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    args = parser.parse_args()

    try:
        title, text, word_count, is_paywalled = extract_article(args.url)
    except urllib.error.HTTPError as e:
        if args.json:
            print(json.dumps({"error": f"HTTP {e.code}", "code": e.code}))
        else:
            print(f"ERROR: HTTP {e.code}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        if args.json:
            print(json.dumps({"error": str(e.reason)}))
        else:
            print(f"ERROR: {e.reason}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        if args.json:
            print(json.dumps({"error": str(e)}))
        else:
            print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

    if text is None:
        if args.json:
            print(json.dumps({
                "error": "no_content",
                "title": title,
                "is_paywalled": is_paywalled,
            }))
        else:
            msg = "paywalled" if is_paywalled else "no extractable content"
            print(f"ERROR: {msg}", file=sys.stderr)
        sys.exit(1)

    if args.json:
        print(json.dumps({
            "title": title,
            "text": text,
            "word_count": word_count,
            "char_count": len(text),
            "is_paywalled": is_paywalled,
        }))
    else:
        if title:
            print(f"# {title}\n")
        print(text)


if __name__ == "__main__":
    main()
