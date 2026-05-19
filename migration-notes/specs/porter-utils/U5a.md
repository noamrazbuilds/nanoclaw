# U5a — slots.ts (multi-slot agent sessions per group)

## Source (v1)
- File: `docs/v1-fork-reference/src/slots.ts` (87 LOC).
- Exports: `parseSlotPrefix(text)`, `slotSessionKey(groupFolder, slotId)`, `slotIpcSubdir(slotId)`, types `SlotParseResult` + `SlotState`.
- Call sites: `docs/v1-fork-reference/src/index.ts:90` (parseSlotPrefix + slotSessionKey), `docs/v1-fork-reference/src/group-queue.ts:12` (SlotState + slotIpcSubdir).
- Origin: pre-fork v1 feature. No hotfix.

## Behavioral spec (one paragraph)
The slot system lets a single chat group run **multiple parallel agent sessions** with independent contexts. Users prefix a message with `#<slot-id>` (alphanumeric + dashes, up to 32 chars) to route to a named slot. Three message types: (1) `#1 do something` → routes the body to slot `"1"` (creating it if not active); (2) `#slots` (or `#slot`) → lists active slots; (3) `#1 close` → closes slot `1`. Messages without a `#` prefix go to the primary (default) container. Each active slot gets: its own session ID (key: `${groupFolder}/slots/${slotId}`), its own container instance, its own IPC input directory (`slots/<slotId>/input`). Session contexts don't bleed between slots — `#research summarize X` doesn't see `#1`'s history, and vice versa. The reason: long-running tasks (research, multi-turn analyses, agent-driven workflows) can run in parallel with normal conversation without context contamination. Used in production for things like "spin up a `#research` slot for a deep dive while keeping `@Andy` available for normal questions." Slot IDs are case-insensitive (lowercased on parse).

## v2 hook point(s)
- **Primitive port (small)**: copy `slots.ts` to v2 worktree as `src/slots.ts`. The functions are pure (no I/O, no DB) — `parseSlotPrefix` is a regex on text, `slotSessionKey`/`slotIpcSubdir` are path builders. ~87 LOC, no adapter work needed.
- **Orchestration port (larger — see OQ#1)**: the feature requires plumbing into v2's session lookup + container-runner + delivery pipeline. v2's session model (one session per agent-group + messaging-group + thread-id) does NOT natively support "multiple parallel sessions per group" — the slot concept needs a representation in v2's data model.
- **Likely orchestration shape** (recommendation, see OQ#1): use v2's existing `thread_id` column on sessions. Each slot becomes a thread: thread_id = `slot:<slot-id>` for slot messages, thread_id = `primary` (or null) for unslotted. This gives slot-scoped session lookup for free via v2's existing `findSessionForAgent(agent_group_id, thread_id)`.

## v2-native equivalent that might suffice?
**PARTIAL-OVERLAP.** v2's `thread_id` column on sessions provides the mechanism for parallel sessions per group — the missing piece is the **routing convention** (parse `#<id>` from inbound text → set `thread_id = "slot:<id>"`). The slots.ts parser is the bridge between v1's `#<id>` user syntax and v2's `thread_id` data model. Once parsed, v2's session lookup handles the rest natively.

## Decisions / open questions
1. **Orchestration mechanism (the load-bearing OQ)**: how do slot-prefixed inbound messages reach a slot-scoped session?
   - **(a) Map slot ID to thread_id** (recommended). At inbound message receive, call `parseSlotPrefix(content)`. If `type === 'slot-message'`, set the session lookup `thread_id` to `slot:<slotId>` (and strip the `#<id>` prefix from content). v2's existing session-by-thread lookup creates the slot-scoped session lazily.
   - (b) Maintain a per-group slot map (matches v1 closer). Adds an in-memory slot registry. More code, no clear benefit over (a).
   - (c) Skip orchestration entirely — port only the parser as a leaf utility, leave the feature non-functional until someone needs it. Saves time now, defers the work indefinitely.
   - **Recommend (a)** — leverages v2's thread_id for ~zero structural cost.
2. **`#slots` listing semantics**: with approach (a), "list active slots" becomes "list distinct thread_ids in sessions table where agent_group_id = ? and thread_id LIKE 'slot:%'". Query lives at the message handler that sees `type === 'slot-list'`. Add to v5's slots.ts as `listActiveSlots(db, agentGroupId)` helper.
3. **`#1 close` semantics**: with approach (a), close → terminate the slot's container + mark its session 'closed'. v2 already has session-close logic; wire `type === 'slot-close'` to call it with the slot's thread_id.
4. **Group-queue.ts slot integration**: v1's `group-queue.ts` imports `SlotState` + `slotIpcSubdir`. The whole group-queue orchestration may not need porting if v2's session-manager + container-runner do the equivalent. Verify at port time — likely U5a-out-of-scope, but flag for Porter to check.
5. **Slot ID validation**: regex enforces alphanumeric + dashes, 1-32 chars. Preserve verbatim — no need to relax or tighten.

## Notes for Porter
- **The "import-path fixes only" estimate in the queue is OPTIMISTIC** — for the PRIMITIVES that's true; for the FEATURE, the orchestration plumbing is real work. Spec acknowledges both. If feature-orchestration is out of scope for this Porter cycle, document the deferred work explicitly and ship just the parser.
- **Coordinate with v2's session lookup path**: read `src/session-manager.ts` and `src/db/sessions.ts` before deciding on the orchestration approach. The thread_id mapping is the cleanest path but requires confirming no semantic conflict with v2's other thread_id uses (e.g., Slack channel threads, agent-to-agent return paths).
- **Don't preserve `ChildProcess` import**: v1's `SlotState` interface includes `process: ChildProcess | null`. v2's container model is different (no direct ChildProcess handling at this layer). Drop the field; v2's container_status on sessions tracks liveness.
- **Test**: send `#research summarize this article`, verify a new session creates with thread_id `slot:research`. Send `#slots`, verify the list includes "research". Send `#research close`, verify the session marks closed. Send `#research summarize this article` again, verify a NEW session creates (closed sessions don't resume).
- **Test cross-slot isolation**: send `#1 my secret is X`, then `#2 what's my secret?` — `#2` should NOT know about `#1`'s content.
