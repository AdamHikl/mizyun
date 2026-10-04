# Agent workflow efficiency fixes — 2026-10-04

AGENT-NAV-007 / [#207](https://github.com/AdamHikl/mizyun/issues/207), [ADR-0042](adr/0042-compact-agent-continuity-and-serialized-checks.md). Baseline HEAD `f08aff45e7a481a785e8e930752ad08595cdd3fd`, dirty shared `codex/recurring-meals` tree; unrelated runtime changes are preserved. No commit, push, deployment, device installation or Production action is part of this package.

## Implemented scope

Compact live continuity with enforced status limits; complete prior handoffs preserved in [the dated archive](archive/status/STATUS_PRE_AGENT_WORKFLOW_2026-10-04.md). Same-host/user serialized `pnpm check`, all old gates retained, change detection and process/cancellation boundaries. Unique BSD/GNU-compatible device-discovery files and cleanup. Shared client-neutral skills/instructions now require late focused tests, settled candidates, bounded ordinary reads and completion waits.

## Preservation

Original status: 381 lines / 116,566 bytes, SHA256 `1b759f9197beb20dbc4c4a921f96b2a84da93a077e357046bab3187356098ef9`. All 41 original sections are preserved. Removing the archive's historical preamble and reversing only relative-link rebasing exactly reproduces the saved original bytes. Independent non-author review repeated this comparison and checked current/open package, environment and Community/release gate coverage. Historical results remain dated; archive next actions are not current instructions.

Coordinator saved pre-existing source hashes before edits in `/private/tmp/mizyun-agent-workflow-2026-10-04/preexisting-hashes.json`; final preservation comparison PASS: 39 unrelated captured paths remain byte-identical. Only package metadata, research, feature-map/ADR continuity and explicitly owned tooling/guidance are integrated into those existing changes.

## Regression and review evidence

- New status line and UTF-8 byte-budget regressions reproduced both missing enforcement boundaries before implementation. Focused boundary suite passes after enforcement; final navigation suite117/117PASS, zero skips; `navigation:check`0errors/27existing advisories.
- macOS BSD `mktemp` reproduction in an owned temporary directory: suffix template created a literal `XXXXXX.json` path, then failed `File exists` on its second allocation. Trailing-X repair passes existing seven Apple capability boundaries, two overlapping discovery processes with distinct live paths, success/denied-device and HUP/INT/TERM cleanup. Four concurrent whole-fixture processes passed. No real device command was executed; all platform commands are fixture mocks. Linux runtime is unverified; GNU primary source supports the template.
- Independent non-author installer and archive/continuity review found no blocking issue; coordinator inspected actual diffs and reran focused evidence. Final runner regression16/16PASS, zero skips; independent non-author runner review repeats16/16 and has no blocking findings. Coordinator inspected actual runtime/test/package diffs; all18HEAD gates and the pre-existing Coach gate remain in order. Shared skill validators and scoped diff checks PASS.

## Final gate

Fresh serialized shared `pnpm check` PASS(exit0), `/private/tmp/mizyun-agent-workflow-2026-10-04/full-check.log`. All owned/helper writes settled before the run; focused final tests, formatting and independent review completed first. The runner's before/after input SHA256 is identical: `2f8ae3bc1c94fc5e6f6fd5785138cfcbd5f9f2f290bb88bdc5ced0053b1cc27e`. This covers the combined preserved dirty working tree at baseline f08aff45, not a committed candidate or deployment.

Runner16/navigation117, mobile1407/API843, contracts203/core373/server-adapter154, runtime90/provider55 PASS; formatting, all typechecks, dual Hermes bundles, analytics/importer/Coach knowledge and every configured deployment/operations/backup/OAuth/build/signing/offline-evaluation/Community/Apple safeguard passed. API retains15existing credential-gated E2E skips; all81config tests ran and passed against current bundle output (no config path skips in this run). No live-provider/database/native-device acceptance is inferred. All10owned source/config/skill hashes and39unrelated captured paths remained unchanged through the gate.

Live status before final evidence wording:59lines/12,002bytes versus381lines/116,566bytes; normal startup255lines/31,897bytes versus573lines/135,283bytes. These are source-size proxies, not measured model-token or task-latency savings. Final documentation-only handoff wording receives fresh scoped format/navigation checks without repeating unchanged runtime checks.

## Measurement boundary

Status bytes/lines and local command timing are context/tooling proxies. The runner prevents concurrent full gates and rejects stale evidence; it cannot prevent every external edit or automatically infer semantic impact. It supports the current macOS/Linux POSIX workflow; restricted process inspection may require approved local access. No installed Codex/Antigravity behavior, model-token savings, actual account cost or accepted-task speedup is claimed. Controlled client/aggregate-helper comparisons remain [#54](https://github.com/AdamHikl/mizyun/issues/54).

## Candidate inputs

Owned source/config hashes are captured in `/private/tmp/mizyun-agent-workflow-2026-10-04/verified-owned-inputs.json`. The full check covered the combined preserved dirty tree at the stated HEAD; this is no committed-candidate, deployment, native-device or live-provider claim. Documentation-only handoff updates after the gate receive scoped format/link checks and do not change the owned executable/skill inputs.
