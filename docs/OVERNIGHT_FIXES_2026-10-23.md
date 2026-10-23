# Overnight issue fixes (2026-10-23)

Claude Code coordinated five parallel worktree sessions (max three at a time),
each limited to source and tests. No device, deployment or server access.
The branches were merged into local `main` without fast-forward. The tip of
`main` is `3645bb76` (on top of `792b38f7`, #321). Not pushed and not deployed.

## Changes

| Issues           | Branch commit(s)       | Change                                                                                                                                                                                                                                                                                   | Review                    |
| ---------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| #316, #310       | `0bd8db48`             | Coach nutrition history, grounding and meal-history tools use the profile timezone's local day and local times (`apps/api/src/modules/coach/local-time.ts`).                                                                                                                             | Opus subagent             |
| #317             | `0bd8db48`, `2dcb5c5d` | An explicit `AGENT_PROVIDER=disabled` switches Coach off (`ServerConfig.coachKillSwitch`). Coach routes refuse, status reports disabled, and Coach meal drafts use the disabled vision provider. Leaving it unset keeps Coach on its routed provider. ADR-0077 note, RESEARCH_LOG entry. | Opus subagent (2 passes)  |
| #309             | tests only             | Already fixed on main by `f7b1f49c`. Added envelope-after-tools regression tests.                                                                                                                                                                                                        | —                         |
| #284, #285, #286 | `0d3d8b44`             | All-null workout set bodies are rejected (contracts and core). The Log past workout picker and the plate calculator exclude timed exercises.                                                                                                                                             | none (no sensitive paths) |
| #315             | `4c3f4b87`             | `goal-repository` always writes `review_date` (null clears it).                                                                                                                                                                                                                          | Opus subagent             |
| #301             | `4c3f4b87`             | Meal, activity and stretch draft routes release the in-memory slot on a durable denial and honour a durable `minute` denial. This is stricter, never looser.                                                                                                                             | Opus subagent             |
| #320, #318       | `8bd339c1`             | Community share and detail screens unwrap retired-read errors. Cached and meal times follow the device 12/24-hour setting.                                                                                                                                                               | none (display only)       |
| #245             | `7f72809d`             | Log-meal test mocks return a complete food-history result (test only).                                                                                                                                                                                                                   | —                         |

Already satisfied on `main` and needing no change: #243 (`recipe-presentation.ts`
`met` state with a #243 test), #246 (20 s timeout, `1642d9dd`), #287 (explicit
timeout).

## Verification

- Each branch passed `pnpm check` in its worktree.
- Merged `main` `3645bb76`: `pnpm check` exit 0. mobile 3614, api 1365 + 15
  skipped, core 837, contracts 412, supabase-server 313, config 130,
  anthropic 138, gemini 145, agent-runtime 127. Hetzner safeguards 74/74.

## Open

- Push, `deploy:dev`, and iPhone checks for the Coach local times, the meal
  and Home times (24-hour), the workout pickers and the Community messages.
- Before deploying, confirm that neither Hetzner env explicitly sets
  `AGENT_PROVIDER=disabled` unless Coach should be off (#317).
- #309/#310/#316: re-run the AI eval against Dev once deployed.
