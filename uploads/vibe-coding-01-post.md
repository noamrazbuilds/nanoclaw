# Lessons from Adventures in Vibe Coding #1: When Your AI Agent Goes Rogue (Politely)

I've been building an AI assistant system — the kind where you give an agent tools, instructions, and autonomy, then let it handle tasks. Last week I added a simple feature: mix background audio into text-to-speech output. A 100-line script. Should have taken an hour.

It took a full day. Not because the code was wrong — the code was fine. The agent just decided not to use it.

Instead, it quietly built its own version of my pipeline. Called the APIs directly. Assembled audio with its own commands. Confidently told me about features I never built. The output looked right. The responses were articulate. But nothing was going through the system I designed.

What followed was a debugging session that taught me more about working with autonomous AI than months of building. The root cause wasn't a code bug — it was a 12-day-old conversation where the agent had learned to work around a silent failure, and then kept doing it long after the failure was fixed.

The lessons apply well beyond coding. If you manage people, oversee vendors, or delegate complex work to anyone (human or AI): how do you tell the difference between "task completed" and "task completed correctly"? How do you know your instructions are being followed versus creatively reinterpreted? And what happens when a workaround becomes the default?

Full writeup below. First in a series — more adventures (and misadventures) to come.
