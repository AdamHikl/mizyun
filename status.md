# Mizyun current status

> Fast-changing operational snapshot. Last updated: **2026-09-23**. Historical handoffs are preserved in the [latest dated archive](docs/archive/status/STATUS_HISTORY_2026-09-13_THROUGH_2026-09-22.md) and older files beside it; they are evidence, not current instructions.

## Active priority — InVenture, October 2–3

Founder decision 2026-09-23: prioritize a presentable, distinctive demo and program partnerships toward a longer-term ambition of over 100,000 users. [INVENTURE-001 / #125](https://github.com/AdamHikl/mizyun/issues/125) is ready for execution; the [program plan](docs/INVENTURE_PROGRAM_PLAN_2026-09-23.md) defines the nine-day schedule, pitch, acceptance checks and growth experiments. Planning documents are updated; demo assets, interviews, pilot commitments and event-build acceptance remain outstanding. Defer SIMPLIFY-03 and unrelated feature expansion. All release gates below remain in force.

## Existing engineering work

| Work                                | State                                                       | Qualified evidence                                                                                                                                        | Blocker / next exact action                                                                                 |
| ----------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `CODEBASE-SIMPLIFY-001` / #124      | Stages 1–2 implemented and automatically verified           | Startup is 236 lines; 38/38 fixtures cover typo/alias/unknown, instruction symlinks, impact, shallow freshness, coverage and inert commands               | Commit only when requested; keep `SIMPLIFY-03` as a separate low-risk public-interface pilot                |
| #117 meal history pagination/search | Source committed and automatically verified                 | `32b7344` contains contracts, adapter, API, mobile pagination/search and explicit search-failure regressions; fresh full `pnpm check` passed              | Push, deploy the accepted SHA to Hetzner Dev, run synthetic full-history device acceptance, then close #117 |
| #102 meal grouping/portion UX       | Source committed; mixed acceptance                          | Portion-weight backend is deployed to Dev at `ed70df7`; `32b7344` contains the mobile portion/grouping stack; specific physical journeys remain unchecked | Confirm grouped-meal containment and portion edit/save/reopen on physical Dev builds                        |
| #44 native meal draft               | Device accepted and closed                                  | Founder verified photo/text draft, editable nutrition and explicit save on physical iOS against Hetzner Dev                                               | Accuracy benchmarking remains separate under #29                                                            |
| #99 auth callback bridge            | Implemented, remotely configured and automatically verified | Public HTTPS callback and Hetzner Auth allowlists were verified in the originating session                                                                | Retain account-lifecycle and full Production-device gates below                                             |
| #109/#110/#114 CI and dashboard     | Implemented and automatically verified in the working tree  | Clean-checkout quality workflow and bounded dashboard refresh regressions passed; branch-protection configuration is not acceptance evidence              | Commit/push coherent source; separately configure and verify the required GitHub check                      |
| #115 workout session start          | Source committed and automatically verified                 | `cbf4f39` uses native-safe UUIDs and guarantees busy-state cleanup; mobile regressions and full `pnpm check` passed                                       | Push the source; retain historical device acceptance as separate evidence                                   |

## Current environment authority

| Environment | Authority                                                          | Last evidenced source                                                                            | Scope                                                                             |
| ----------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Local       | `/Users/adam/Documents/mizyun`                                     | `32b73446039bee396548ef8a8adc33bf68d0e13b` plus substantial remaining modified/untracked work    | Preserve and isolate the remaining auth, dashboard, operations and asset packages |
| Dev         | Hetzner CX23, `/var/lib/mizyun/dev/repo`, `mizyun-api-dev.service` | `ed70df727fdb38940b686b1dd2647d519f8478cd`; public health was HTTP 200 in the deployment session | Dev deployment only; later local working-tree changes are not deployed            |
| Production  | Hetzner CX23, `/var/lib/mizyun/repo`, `mizyun-api.service`         | `43917fa4b69acff04b931c4ef927dab21466a932`; public health was HTTP 200 in the cutover session    | No current-session Production verification or release                             |
| Recovery    | Raspberry Pi 5                                                     | Encrypted daily Production archive workflow and accepted restore point `20260919T103343Z`        | Recovery storage only; not a deployment target or writable failover               |

## Rules and open gates that must survive handoff

- AI access is consent-based for authenticated adult-eligible users. `AI_ALLOWED_EMAILS` is deprecated and ignored. Preserve consent/revocation, authentication, provider kill switches and usage limits. Dev retains its explicit shared-Gemini testing exception.
- The local Qwen/MLX/OpenCode worker is paused by user decision and must not receive tasks. Built-in repository subagents remain required for substantive work.
- Keep **implemented**, **automatically verified**, **Dev deployed**, **device accepted** and **Production released** separate. Historical checks are not fresh verification.
- Q1–Q9 remain governed by [`docs/REMEDIATION_EVIDENCE_CHECKLIST.md`](docs/REMEDIATION_EVIDENCE_CHECKLIST.md). Known open release work includes Q2 durable unknown-outcome persistence, Q7 consent-context continuation, Q8 live model evaluation, Q9 effective-target/rollback proof, signed distribution evidence and Gate R8 physical-device plus off-device restore acceptance.
- Account export/deletion (#25), founder alpha (#37), provider/live-evaluation work (#29/#30/#36) and store publication remain separate work packages; simplification does not close them.
- Production promotion requires an explicit accepted 40-character SHA, fresh local `pnpm check`, accepted Dev/device evidence, pre-promotion backup/migration safeguards and explicit user authorization.

## Historical verification — preceding engineering package

- Stages 1–2 are documentation/navigation tooling only: no deployment, database, credentials, device install or provider call occurred or is claimed. `SIMPLIFY-02` source commit: `25150e7c60e58e2269df3635ce25683d180c5ab0`.
- Focused Stage 2 checks pass after independent-review fixes: 38/38 navigation fixtures and `pnpm navigation:check` with 0 errors. Its 22 warnings remain visible and classified: 11 committed review-drift warnings, 10 local review-drift warnings and 1 broader mapped-source-coverage warning (175/501 relevant files currently unmapped).
- Fresh post-Stage-2 `pnpm check` passed from the shared working tree: repository formatting, all 15 workspace typechecks, iOS/Android Hermes exports, 493 mobile tests, 565 API tests (15 policy-gated E2E tests skipped), 39 deployment safeguards and 56/56 offline AI invariants. `git diff --check` also passed; detailed evidence is in [`docs/AGENT_NAVIGATION_ACCEPTANCE.md`](docs/AGENT_NAVIGATION_ACCEPTANCE.md).

## Verification — committed source packages, 2026-09-23

- InVenture planning is committed at `1ae68abd49dc573dbaf6596d3baef2d49be3a9ea`; official program/competitor sources were checked and a helper independently inspected positioning and source-supported demo capabilities. No new device, provider, deployment or traction evidence.
- Workout recovery is committed at `cbf4f395734b71ec21c86ff03c5ee2b9f0e59a5b`; Slovak Coach intent classification at `bea8b2e7e4526afa94fb05592da6e16639be13d3`; and the combined meal portion/history package at `32b73446039bee396548ef8a8adc33bf68d0e13b`.
- Fresh `pnpm check` passed after the meal-search failure repair: navigation 0 errors / 22 warnings, formatting, all workspace typechecks, iOS/Android Hermes exports, 496 mobile tests, 565 API tests (15 policy-gated E2E tests skipped), 39 deployment safeguards, Hetzner operations, backup/OAuth/build/IPA tooling and 56/56 offline AI invariants. Focused meal-search state regressions passed 3/3. No commit is deployed or device-accepted by this verification.

## Next exact action

For #125, record the proposed 90-second journey on the current physical build, identify its source/build/environment, and rank interruptions and unsupported claims. Select only the smallest demo/first-use repair slice; prepare interviews and the pitch alongside acceptance work. No public access expansion until its existing gates pass.

## Evidence index

- [InVenture preparation and growth plan](docs/INVENTURE_PROGRAM_PLAN_2026-09-23.md)
- [Codebase simplification plan](docs/CODEBASE_SIMPLIFICATION_PLAN_2026-09-22.md)
- [Navigation acceptance register](docs/AGENT_NAVIGATION_ACCEPTANCE.md)
- [Status history: 2026-09-13 through 2026-09-22](docs/archive/status/STATUS_HISTORY_2026-09-13_THROUGH_2026-09-22.md)
- [Status history: 2026-09-10 through 2026-09-12](docs/archive/status/STATUS_HISTORY_2026-09-10_THROUGH_2026-09-12.md)
- [Status history through 2026-09-09](docs/archive/status/STATUS_HISTORY_THROUGH_2026-09-09.md)
- [Hetzner backend guide](docs/tutorials/HETZNER_BACKEND_GUIDE.md)
