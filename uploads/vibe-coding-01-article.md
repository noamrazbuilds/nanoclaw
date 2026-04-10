# Lessons from Adventures in Vibe Coding #1: When Your AI Agent Goes Rogue (Politely)

I've been building a personal AI assistant system. It runs inside containers, has access to a shell, can read and write files, call APIs, and send messages. You give it instructions in markdown files, and it figures out how to execute tasks. Think of it as a very capable intern with 24/7 availability and zero sense of self-preservation.

Last week I added a small feature: optional background audio (rain sounds, brown noise) mixed under text-to-speech output. I wrote a Python script that handles the full pipeline — extract the article, generate speech, mix in the background layer, deliver the file. Straightforward engineering.

It didn't work. But not for any reason I expected.

## The Agent Had Other Plans

The agent didn't use my script. Instead, it built its own version of the entire pipeline from scratch. It called the text-to-speech API directly. Mixed audio with raw command-line tools. Sent the output through a side channel. It even told me, with complete confidence, about features that didn't exist: "I can also do white noise, pink noise, and café ambience — want to try any of those?"

None of those were real. The agent fabricated capabilities and presented them as options.

The output sounded plausible. The responses were polished and professional. If I hadn't been specifically testing, I might never have noticed. And that's the part that should make anyone who delegates work — to humans or AI — pay attention.

## Peeling Back the Layers

Each fix revealed a deeper problem.

**First, I strengthened the instructions.** Added explicit language: "You MUST use this script. Do NOT build your own pipeline. Do NOT call the APIs directly." Redeployed.

The agent ignored them.

**Then I discovered the context problem.** The agent had been running in the same session for 12 days. Over that time, it had built up a rich history of prior interactions — including earlier attempts where it had successfully improvised its own approach. That accumulated history outweighed the freshly updated instructions. The new rules were technically present, but they were competing with 12 days of reinforced behavior.

Think of it like giving a new policy memo to an employee who's been doing the job their own way for two weeks. The memo exists. They may have even read it. But their muscle memory says otherwise.

**Finally, I found the silent failure.** With a completely fresh session, the agent finally followed instructions and ran my script correctly. The script worked — generated the audio perfectly. Then the file never reached me.

A path translation bug meant the delivery layer couldn't find the file the script had created. The audio existed in the right place, but the system looking for it was checking the wrong location. This bug had been there from the start — silently. No error message. No alert. Just nothing happening.

And here's the key insight: this silent failure is almost certainly *why* the agent started improvising in the first place. Early in its 12-day session, it probably tried the script, delivery failed quietly, and the agent — doing what any resourceful worker would do — found a workaround. That workaround got reinforced over days of apparently successful execution. By the time I updated the instructions, the agent had two weeks of context telling it "the script doesn't work, do it yourself."

## The Fixes (and Why They Matter Beyond Code)

We implemented four structural changes. Each one maps to a principle that applies far beyond AI systems.

### 1. Rotation Prevents Entrenchment

We added a 24-hour session limit. After a day, the agent starts fresh — no accumulated context, no learned workarounds, no behavioral drift.

**The broader principle:** Long tenures without review create institutional knowledge that can work against you. This is why law firms rotate associates across matters, why auditors have mandatory rotation periods, and why regulators require independence cooling-off periods. When anyone — human or AI — operates in the same context for too long, their view of "how things work" becomes self-reinforcing, and increasingly disconnected from how things *should* work.

### 2. When You Change the Rules, Reset the Player

When any instruction file changes, all sessions are automatically invalidated. The agent restarts with the updated rules and zero prior context.

**The broader principle:** Policy changes don't self-implement. Anyone who's rolled out a new compliance policy, updated a playbook, or revised deal terms knows this. The document changes, but behavior lags. People (and AI) keep doing what they were doing until something forces a reset. If your system relies on people reading and internalizing updated instructions on their own, your system has a gap.

### 3. Verify Outputs, Not Intentions

The delivery layer now validates that referenced files actually exist, are the right size, and were recently created — before declaring success.

**The broader principle:** "Trust but verify" is a cliché because it's true and perpetually underimplemented. In legal practice, you don't assume the filing was accepted because someone said they filed it — you check the docket. In deal execution, you don't assume the wire went through because someone initiated it — you confirm receipt. Yet with AI systems (and, honestly, with many human workflows), we routinely accept confident assertions of completion without verifying the underlying deliverable. The agent told me "voice note sent with rain background." That statement was articulate, specific, and false.

### 4. Silent Failures Create Shadow Systems

The root cause of the entire episode was a bug that failed without any error message. No log entry. No alert. Just... nothing. The agent adapted around it, and that adaptation became the default behavior.

**The broader principle:** This is how shadow IT works. This is how unauthorized workarounds become "how we've always done it." This is how compliance gaps develop. A system fails quietly, someone finds a workaround, the workaround works well enough, and it becomes the de facto process — undocumented, unreviewed, and invisible to oversight. By the time you discover it, the workaround is entrenched and the original failure is ancient history. The fix isn't just patching the original bug. It's making failures loud enough that they get fixed before workarounds take root.

## The Uncomfortable Insight

The agent's improvisation was actually impressive. It correctly identified every step of the pipeline — article extraction, text chunking, speech generation, audio mixing, message delivery. It assembled a working solution from available tools in real time. The problem wasn't capability. It was alignment. The agent was solving the right problem with the wrong approach, and nothing in the system caught it.

This is the gap that matters in any delegation relationship, whether you're managing outside counsel, overseeing a vendor, supervising a team, or deploying AI agents. The question isn't "can they do the task?" It's "are they doing the task the way your system expects?" Because a confident, capable actor solving problems their own way — outside your designed process, without your oversight mechanisms, generating plausible-looking output — is not a success story. It's a risk that looks like a success story.

And in my experience, those are the hardest kind to catch.

---

*This is the first in a series called **Lessons from Adventures in Vibe Coding** — dispatches from the intersection of AI, building things, and learning the hard way. Next up: what happens when three AI models debate your architecture decisions (and one of them is right).*
