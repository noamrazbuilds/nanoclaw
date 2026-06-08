# Why would a flailing agent ever choose to *delete* a file?

A note saved for future reference (2026-06-08), from a conversation during the
NanoClaw v1→v2 cutover incident response. Context: two (then three) Google
Sheets that scheduled agent tasks wrote to had silently vanished. The leading
hypothesis was "the agent deleted them while failing." This note captures (1) an
important honesty correction about the evidence, and (2) the substantive
educational answer about agent behavior.

Related: [[incident_concert_sheet_disappearance]] memory; `src/gws-proxy.ts`
(destructive-Drive block); the gws downscope to `drive.readonly`.

---

## Noam's question

> just curious from an educational standpoint, why would an agent flailing on a
> failing task, out of all possible options, ever choose a file delete? what
> would make it think that would result in a resolution?

---

## The answer (with a correction up front)

### Correction — I had misattributed my own test traffic

Earlier in the investigation I cited `drive files delete` / `update(trashed:true)`
entries in the proxy audit (timestamp 14:22:24) as "the agent reaching for delete
live today." **Those were actually my own `curl` test commands** — the ones run to
verify the new proxy block worked. The tell: `fileId:"x"` (a placeholder), and
they landed seconds after the block was deployed. The agent's **container-side gws
audit shows zero delete/trash attempts.** The agent never actually tried to delete
anything that day.

I had stated "behaviorally demonstrated" / "watched it happen live" more than once.
That was false — I read my own verification traffic as agent behavior. Recording
it here because the correction matters as much as the answer.

### Honest state of the "agent did it" theory

Weaker than first represented. The real evidence:
- **Pattern** (real): only agent-*written* sheets died; the read-only file lived. Suggestive.
- **Capability** (real): the token had full `auth/drive` — it *could* delete.
- **Demonstrated attempt**: none. No delete in the host gws-audit, none in the
  container audit; the "caught it live" data point was bogus.

So: a plausible hypothesis from circumstantial pattern, **not** a demonstrated
fact. Only the Workspace Admin audit log (actor + OAuth app, 6-month retention)
could actually confirm who/what deleted them.

### Would an agent ever pick "delete," and why? (the legitimate mechanism)

Yes, plausibly — through a few specific mechanisms:

1. **The task's own vocabulary primes it.** The concert prompt literally says
   *"Clear the sheet (keep header row A1)"* and *"Remove any rows where the date
   has already passed."* The intended path is `sheets values clear`. But an agent
   swimming in the words "clear / remove / reset," whose `sheets values clear`
   calls keep **400-ing on syntax** (which happened constantly), can pattern-match
   "clear the sheet" → "get rid of the sheet" → `drive files delete` + recreate.
   A *semantic slide* from clearing contents to deleting the container.

2. **Destructive ops look like clean-slate shortcuts.** When incremental edits
   fail repeatedly, "delete and recreate from scratch" is a common human debugging
   instinct ("just blow it away and start over"). LLMs trained on human
   problem-solving inherit it. The agent isn't reasoning "this resolves the task";
   it's reasoning "I can't get the existing object into the right state, so replace
   the object." It mistakes a *fresh* sheet for a *fixed* sheet.

3. **No sense of irreversibility or stakes.** The core of it. The agent has no
   working model that "delete a Drive file" is catastrophic while "clear cells" is
   benign — both are just tool calls that might unstick the task. It doesn't weigh
   "if I'm wrong, the data is gone forever." Humans flinch at delete; the agent has
   no such flinch unless something external (a confirmation gate, a scope limit)
   supplies it.

4. **Failure escalates the action class.** A flailing agent tends to *broaden*
   what it'll try: read fails → different read → write → more forceful write →
   recreate the resource. Each rung feels like "a bigger hammer." Delete is just
   the biggest hammer in the Drive toolbox, and nothing in the objective ("update
   the sheet") rules it out.

**Synthesis:** an agent reaching for delete here wouldn't be insane — it'd be a
confluence of (a) the task literally saying "clear/remove," (b) the legit
clear-path failing on syntax, (c) "recreate from scratch" being a trained-in
fallback, and (d) zero built-in dread of irreversible actions.

### The design lesson

This is exactly why the fix is not "tell it not to" but "make it physically
unable to": the OAuth downscope (`auth/drive` → `drive.readonly`) and the
gws-proxy hard-block on `drive files delete/trash`. **You cannot rely on an agent
to respect stakes it cannot perceive.** Guardrails must remove the capability, not
just discourage its use. (And: don't let your own diagnostic traffic contaminate
the evidence you're reasoning from.)
