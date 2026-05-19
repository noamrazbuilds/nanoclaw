# U5c — host-ops.ts (predefined host operations from container)

## Source (v1)
- File: `docs/v1-fork-reference/src/host-ops.ts` (231 LOC).
- IPC integration: `docs/v1-fork-reference/src/ipc.ts:16` imports `executeHostOp` + `isValidHostOp`; line 841 dispatches `data.op` through the host-op handler when an IPC frame carries `{op, args}`.
- Exports: `HostOp` (type), `isValidHostOp(op)`, `executeHostOp(op, args)`. Internal: `refreshOauth()`, `restartService()`, `rebuildContainer()`, `updateAllowlist(args)`.
- **Allowlist of ops (actual count is 4, not 3):**
  - `refresh_oauth` — re-read `~/.claude/.credentials.json` and update `.env`. Cheap, no shell-out.
  - `restart_service` — systemctl/launchctl restart NanoClaw. Heavy.
  - `rebuild_container` — Docker container rebuild. Heaviest.
  - `update_allowlist` — modify the sender-allowlist file (`SENDER_ALLOWLIST_PATH`). Cheap.
- Reference: this is "Variant C: predefined ops" from [[project_deferred_work]] § "Host Operations Variant B" — already implemented. Variant B (arbitrary Claude Code prompts on the host) remains deferred.

## Behavioral spec (one paragraph)
The container agent occasionally needs to trigger host-side operations: re-reading credentials after an OAuth refresh, restarting the NanoClaw service after a config change, rebuilding the container after a code update, modifying the sender allowlist. v1 implements this as a **predefined allowlist + IPC trigger** pattern: the container writes an IPC frame `{op: '<op_name>', args: {...}}`, the host's IPC handler validates against `ALLOWED_OPS`, dispatches to the corresponding function, and writes the result back via IPC. Each op is hard-coded in `host-ops.ts` — no arbitrary shell execution from the agent. The allowlist IS the security boundary: agents can ONLY invoke ops that exist in the source. The reason for this design: it gives the agent autonomy to fix host-side state without prompt-injection or hallucinated-command escalation risk. Per [[project_deferred_work]], a future "Variant B" would let the agent run arbitrary Claude Code prompts on the host with guardrails — explicitly deferred until ~10+ predefined ops emerge as the cost of rigidity.

## v2 hook point(s)
- **Port `host-ops.ts`** verbatim to `src/host-ops.ts` (231 LOC, ~no v2 surface dependencies — pure Node + fs + child_process). Adapt imports (`./config.js` → v2 config, `./logger.js` → v2 `./log.js`).
- **IPC integration (the architectural shift)**: v1's IPC was stdio-frame; v2's IPC is two-SQLite-file (inbound.db + outbound.db). Container-side host-op invocations need a new **outbound kind** for the host to recognize. v2 outbound vocabulary currently: `chat | edit | reaction | ask_question | card`. Need to add a discriminator for host-side actions. See OQ#1.
- **Host-side handler**: where v1's `src/ipc.ts:841` dispatched on the in-stream frame, v2 needs equivalent logic at the outbound-poll site (`src/delivery.ts` reads outbound, sees `kind='host_op'`, calls `executeHostOp(content.op, content.args)`, writes result back as inbound `kind='host_op_result'` for the container to read).
- **Result delivery back to container**: v2's inbound vocabulary is mostly user-message-shaped. The host-op result needs a kind the container can recognize and route back into the agent's tool-call return path. This may require a new inbound kind too.

## v2-native equivalent that might suffice?
**PARTIAL-OVERLAP.** v2's `mcp-tools/self-mod.ts` has `installPackages` + `addMcpServer` — similar in shape (agent invokes host-side mutation), but at a finer granularity (package installs, MCP server config) and through a different surface (MCP tools, not IPC kind). v2 main doesn't have the host-ops-style coarse-grained operations (service restart, OAuth refresh, etc.). The allowlist pattern + IPC dispatch is fork-original. Port required.

## Decisions / open questions
1. **Outbound kind shape** — the central architectural OQ, same flavor as F5's `register_group` OQ:
   - (a) Dedicated kind: `kind='host_op'` with content `{op, args}`. Mirrors v1 closely. Easy host-side dispatch.
   - (b) Generic kind: `kind='host_action'` with content `{type: 'host_op' | 'register_group' | ..., ...}`. Shared envelope for all host-targeted actions; F5's `register_group` shares the kind.
   - (c) Reuse v2's existing MCP-tool result mechanism — make host-ops callable as MCP tools (via a new `mcp-tools/host-ops.ts`) that internally write a structured outbound. Most v2-idiomatic.
   - **Recommend (c)**: register host-ops as MCP tools at the container side (one tool per allowed op: `refresh_oauth`, `restart_service`, `rebuild_container`, `update_allowlist`). Each tool emits a structured outbound row that v2's host reads + dispatches. Aligns with v2's "MCP tool = agent capability" pattern; the allowlist enforcement moves from host-side `isValidHostOp` check to "tools that aren't registered can't be called." Best of both worlds.
2. **Per-op MCP tools vs single tool with op param**: under (c), should there be 4 separate tools or one `host_op(op, args)` tool? Recommend **4 separate tools** — better tool descriptions, simpler args validation per op, prevents the agent from passing arbitrary op names. Matches v2's tool granularity pattern.
3. **`update_allowlist` semantics**: this op modifies the sender allowlist (who can talk to the bot). In v2, sender allowlist might live in v2's `pending_sender_approvals` table (per migration 011) instead of a flat file. Verify at port time — `update_allowlist` may need to call v2's permission-module API rather than rewriting a file.
4. **Host-op-result return path**: with (c), the MCP tool returns the result synchronously to the agent (no separate inbound message needed). This is cleaner than the (a)/(b) variants where the result rides back via inbound. **Recommend (c) for this reason alone.**

## Notes for Porter
- **Per the unlock-4 row clarification**: host-ops is U5c scope; F5 row text mentioned `host_op` but no MCP tool of that name exists in v1. The fork's pattern is "outbound IPC frame → host executes from allowlist," not "MCP tool the agent calls." If implementing per OQ#1's (c) recommendation, the MCP-tool surface is **new** in v2 — closer to v2-idiomatic but architecturally different from v1.
- **Allowlist is the security boundary**: do NOT introduce a generic `execute_command` tool. Each op must be explicitly enumerated. The 4 current ops cover most real needs; new ops should be added one at a time with review.
- **Read [[project_deferred_work]] § Host Operations Variant B** for the design discussion behind Variant C (current) vs Variant B (deferred).
- **`update_allowlist` collides with v2's permission module**: spec extraction will likely surface that this op needs a different implementation in v2 (call permission-module functions instead of file rewrite). Port time will resolve.
- **Test**: invoke `refresh_oauth` from a test session, verify the `.env` token updates. Invoke `restart_service` cautiously in dev (it really restarts the host process — test in a sandbox).
