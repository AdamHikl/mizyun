# ADR-0042: Compact agent continuity and serialized stable checks

Status: Accepted for local implementation, 2026-10-04.

## Context

Two UI chats took 10m25s and 20m15s. Their navigation commands took approximately 1–2 seconds, while oversized/repeated status reads, premature full checks, concurrent source changes and a BSD temporary-file collision consumed time. The existing startup size warnings did not prevent the live status reaching 116,566 bytes. These observations establish workflow problems, not a measured savings estimate.

## Decision

- Preserve complete chronological handoffs in dated linked archives. Keep current authorities, unresolved acceptance and one active next action in `status.md`; enforce 120 lines and 12,288 UTF-8 bytes in the existing navigation gate. Combined startup limits remain advisory so mandatory safety instructions are retained.
- Keep bounded source/doc reading and the existing full startup/instruction reads in the shared client-neutral workflow. Read required files separately; reuse unchanged context and expand complete focused selections as needed. Index freshness remains advisory.
- Route `pnpm check` through a local POSIX runner with one private same-host/user lock across chats, worktrees and temporary copies. Its internal `check:steps` preserves every previous gate in order and adds runner regressions. No acceptance result is shared or cached between candidates. Finish edits and focused tests before invoking the full gate; wait on its process instead of repeatedly tailing logs.
- Fingerprint inputs before and after checks and watch for changes during execution, including ignored environment/native configuration while excluding generated/dependency/cache output. Reject changed or unprovable inputs. Keep the lock until the gate process group stops; propagate failures and cancellation. Never silently steal stale or unknown locks.
- Use trailing-X BSD/GNU-compatible temporary templates and exit/signal cleanup for device discovery. Retain all native/signed Apple capability and device-target safeguards.

## Consequences and limits

Full gates remain required before commit/merge/deployment. The lock coordinates full checks only, not arbitrary native builds, deployments or database operations. Known concurrent writes require a stable isolated candidate and exact source correspondence; they must not be overwritten. `check:steps` is internal and direct execution does not establish compliant acceptance.

The runner requires POSIX process groups and process inspection on macOS/Linux; restricted execution may need approved local process access. Windows support is not claimed. A stale/unknown lock fails visibly: inspect the owner and all gate children, prove they have stopped, then remove only the reported lock as a deliberate recovery action. Hard termination can leave a lock rather than admit overlapping checks.

The live status has bounded growth; authors replace summaries and link detailed evidence instead of silently deleting open gates. Actual accepted-task latency, token/context use and aggregate helper cost require fresh comparable Codex/Antigravity observations under #54. No RAG, embedding store or daemon is introduced; ADR-0022 and ADR-0036 remain applicable.

## Sources and verification

Checked 2026-10-04: [Node file-system flags and operations](https://nodejs.org/api/fs.html), [child processes/process groups](https://nodejs.org/api/child_process.html), [process signals](https://nodejs.org/api/process.html), [Codex repository instructions](https://learn.chatgpt.com/docs/agent-configuration/agents-md), [Antigravity skills](https://www.antigravity.google/docs/skills?tab=ide), macOS `man mktemp` trailing-X template, and [GNU mktemp source](https://raw.githubusercontent.com/coreutils/coreutils/master/src/mktemp.c). [Qualified evidence](../AGENT_WORKFLOW_EVIDENCE_2026-10-04.md) records regression, preservation, independent review and final gate results separately from installed-client measurement.
