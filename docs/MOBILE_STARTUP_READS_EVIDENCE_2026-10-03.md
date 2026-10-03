# MOBILE-LOAD-001 evidence and Dev acceptance (#182)

Date: 2026-10-03. Source base: `6d262b1a05ef43e2a2648f818258c5a076c90e9b`, with local changes on `codex/ai-advanced-nutrients`. Pre-existing Community, nutrition and navigation tooling changes are preserved. This evidence does not identify an installed or deployed candidate.

## Observed failure and implementation

The original Workouts focus callback unconditionally called `loadData()`, which set loading and fetched list/routines/exercises followed by session sets. Meals reset to its first history page on each focus, losing appended pages. Home marked all sections loading on every focus; Body and Photos also showed loading again. Account requested the already-loaded Auth profile on entry.

The shared personal display store now deduplicates startup/screen reads and retains validated results with the bounded policy in [ADR-0037](adr/0037-personal-screen-startup-reads.md). Workouts/Meals skip fresh focus loads; Home/Body reuse their transport reads while retaining completed screen state. Meals retains loaded pages on ordinary tab returns. Photos keeps its list while revalidating signed URLs. All focused screens refresh on foreground resume. Workouts has pull-to-refresh; Home's existing refresh invalidates the shared store. Mutation completion and failure/lost response both invalidate personal data, including multipart Coach messages and shared routine import.

Startup reads are independent and non-blocking after authentication: main workout/catalog/set and meal data, body history, current Home/week/recent-meal metrics, Account profile/goal and existing Coach thread after live readiness. Community first-page warming requires adult eligibility and active membership and uses the existing ten-second scoped store. It never enables participation. User-selected searches, additional pages, media and details remain demand-driven; sensitive authority endpoints remain live.

## Verification

- Helpers performed a disjoint screen audit/implementation and independent cache/auth/lifecycle review. Coordinator inspected the actual changes and runs the final combined-tree gate.
- Initial focused combined run: `pnpm --filter @mizyun/mobile test src/composition src/features/workouts src/features/dashboard src/features/log-meal src/features/log-weight src/features/progress-photos src/features/settings src/features/coach/coach-data.test.ts` — 43 files /556 tests PASS, before final additional cache regressions. Log `/private/tmp/mizyun-startup-focused.log`.
- New rendered Workouts regressions: repeated focus without a new fetch/loader, invalidation while retaining content, late old-account response rejection and foreground resume. New Meals regressions: retained pagination, write invalidation, account switch and foreground resume. These use a hook harness and synthetic data; they are isolated screen behavior evidence, not native UI acceptance.
- Cache regressions cover shared pending requests, account/token/sign-out retirement, query/schema separation, five-minute/day expiry, caller lifetime, failed/lost writes, timeout/retry, concurrent rewarming and multipart Coach invalidation. Startup regressions check bounded initial route reads, active/withdrawn/underage Community gating and independent partial failure. Partial workout routine/catalog/sets failures remain retryable.
- Original HEAD Workouts source was run with the new hook harness in an isolated temporary directory, with matching automatic JSX transformation and repeated-read fixture support: four expected baseline failures, including a second focus fetch (actual2 versus expected1), repeated loader and late old-account state. Source files in the checkout were untouched by reproduction. Log `/private/tmp/mizyun-workouts-baseline-regression.log`. The missing original resume listener also fails the new resume case. An initial temporary runner attempt failed JSX setup and is not accepted as behavioral evidence.
- Fresh final `pnpm check` PASS (exit0): mobile1199/API794(15 existing gated skips), contracts165/core351/server-adapter144; formatting/typechecks/navigation116/dualHermes/all safeguards. Log `/private/tmp/mizyun-startup-check-final-2026-10-03.log`. Final cache14/startup3 regressions PASS, plus the eight screen regressions. A formatting stop in the first final attempt was corrected before rerunning the complete gate.
- Final gate and counts are recorded in status.md, with log `/private/tmp/mizyun-startup-check-final-2026-10-03.log`.
- No live model, provider evaluation, database migration, backend deployment, native install or Production operation was performed. Existing credential-gated API/provider acceptance remains excluded.

## Exact next acceptance action

Build/install a standalone Dev candidate from the final verified source, record its SHA/artifact/device identifiers, then run:

1. Cold start on Home with a seeded synthetic test account; immediately visit Workouts, Meals, Coach and Account. Requests start after authentication; pending requests are shared; no false empty state precedes Workouts' first completion. The app shell remains usable while fetching.
2. Switch Workouts/Home/Meals repeatedly within five minutes. Lists and Home values remain visible; Workouts/Meals do not fetch again. Load an older Meals page, switch tabs and confirm it remains present.
3. Create/edit/delete a routine, complete a workout/set, save/edit/delete/copy a meal and save a weight. Return to the affected page and Home; new values appear rather than a cached pre-write result.
4. Pull to refresh Workouts/Home. Confirm a new read and updated content; force an offline/failed refresh and verify existing content plus an error. Retry successfully.
5. Background/resume while the affected page is visible. Confirm a new read and updates without clearing the completed list. Repeat after cache expiry and local date change.
6. Sign out/switch accounts while a request is delayed. Prior-account values never appear for the new account. Refresh/rotate the same account token; all startup sections remain available.
7. Adult active Community member: visit within and beyond its original ten-second lease; verify server revalidation and existing withdrawal/background behavior. Underage, withdrawn or unenrolled accounts must not preload a feed or enroll.
8. Coach: existing messages load; startup never sends a prompt, creates a conversation or invokes a model. Progress Photos: revisit after signed URL expiry and confirm fresh URL reads without automatic upload/permission prompts.

Record PASS/FAIL/NOT TESTED/BLOCKED with the exact source and redacted evidence. Installed-device acceptance is still pending; #182 remains open until it is recorded.
