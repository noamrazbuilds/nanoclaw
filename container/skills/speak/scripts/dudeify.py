#!/usr/bin/env python3
"""
Dude-ify text for ElevenLabs TTS with The Dude's voice.

Adds Dude expressions with decreasing intensity as text gets longer:
  - First 200 chars: heavy (every ~50 chars)
  - 200-500 chars: moderate (every ~100 chars)
  - 500-1000 chars: light (every ~200 chars)
  - 1000+ chars: very sparse (every ~400 chars)

Rules:
  - Never changes factual meaning
  - Must remain understandable
  - Entertaining but not annoying

Usage:
  python3 dudeify.py "Your text here"
  python3 dudeify.py --file input.txt
  echo "text" | python3 dudeify.py
"""

import argparse
import random
import re
import sys

# Insertions — short phrases that fit naturally between sentences or clauses
INSERTIONS = [
    "man",
    "dude",
    "you know",
    "like",
    "far out",
    "right on",
    "yeah well",
]

# Sentence starters — prepend to a sentence occasionally
STARTERS = [
    "Look, man, ",
    "Yeah, well, ",
    "Dude, ",
    "Man, ",
    "The thing is, ",
]

# Closers — append after the final sentence occasionally
CLOSERS = [
    " The Dude abides.",
    " That's just, like, my opinion, man.",
    " And, you know, that's cool.",
    " Far out.",
]


def dudeify(text: str) -> str:
    """Add Dude expressions to text with decreasing intensity."""
    sentences = re.split(r'(?<=[.!?])\s+', text.strip())
    if not sentences:
        return text

    total_chars = len(text)
    result = []
    chars_so_far = 0
    last_insertion_at = 0
    rng = random.Random(hash(text) % 2**32)  # deterministic per text

    for i, sentence in enumerate(sentences):
        chars_so_far += len(sentence)

        # Determine insertion interval based on position
        if chars_so_far < 200:
            interval = 50
        elif chars_so_far < 500:
            interval = 100
        elif chars_so_far < 1000:
            interval = 200
        else:
            interval = 400

        gap = chars_so_far - last_insertion_at

        if gap >= interval and i > 0 and rng.random() < 0.6:
            # Choose between comma-insertion and sentence-starter
            if rng.random() < 0.4 and len(sentence) > 20:
                # Prepend a starter
                starter = rng.choice(STARTERS)
                sentence = starter + sentence[0].lower() + sentence[1:]
            else:
                # Insert a short phrase after the previous sentence
                insertion = rng.choice(INSERTIONS)
                if result:
                    prev = result[-1]
                    if prev.endswith(('.', '!', '?')):
                        result[-1] = prev[:-1] + f", {insertion}" + prev[-1]
            last_insertion_at = chars_so_far

        result.append(sentence)

    # Maybe add a Dude closer (more likely for short texts)
    if total_chars < 500 and rng.random() < 0.7:
        closer = rng.choice(CLOSERS)
        result[-1] = result[-1].rstrip() + closer
    elif total_chars < 1000 and rng.random() < 0.3:
        closer = rng.choice(CLOSERS)
        result[-1] = result[-1].rstrip() + closer

    return " ".join(result)


def main():
    parser = argparse.ArgumentParser(description="Dude-ify text")
    parser.add_argument("text", nargs="?", help="Text to Dude-ify")
    parser.add_argument("--file", help="Read from file")
    args = parser.parse_args()

    if args.file:
        with open(args.file) as f:
            text = f.read()
    elif args.text:
        text = args.text
    elif not sys.stdin.isatty():
        text = sys.stdin.read()
    else:
        print("No text provided", file=sys.stderr)
        sys.exit(1)

    print(dudeify(text.strip()))


if __name__ == "__main__":
    main()
