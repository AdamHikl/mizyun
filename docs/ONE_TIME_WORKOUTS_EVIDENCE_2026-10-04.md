# One-time workout evidence — 2026-10-04

Scope: WO-07 / GitHub #187. Base source `55338240639e44e0c609477db0cfa09a3abe8655`. Local uncommitted changes, including pre-existing analytics in the logger; no task-only commit or deployment SHA is claimed.

## Behavior

Workouts → Start One-time Workout → Add Exercise → enter weight/reps and save each set → Finish Workout → private history. Uses the existing cards, exercise library, unit conversion, timers, minimize/active-session recovery, and separate optional sharing preview. Session exercise selections save before their first set; failure does not falsely confirm a selection. One-time sessions never prescribe targets or update exercise/routine targets. Same-account start retry preserves operation identity across uncertain responses and token refresh.

## Automated evidence

- Before implementation: four expected failures for the absent start action and stale Coach draft contamination; `/private/tmp/mizyun-187-baseline.log`.
- `pnpm --filter @mizyun/mobile test src/features/workouts src/features/log-workout`: 15 files / 174 tests PASS, `/private/tmp/mizyun-187-focused-final.log`. Includes selection/reopen before the first set, full-list preservation, duplicate taps, failed-add/retry, actual weight/reps submission, neutral card copy, progression suppression, start response loss/token refresh and stale result after account change.
- `pnpm --filter @mizyun/api test src/modules/workouts src/modules/workout-sets src/modules/exercises`: 3 files / 75 tests PASS, `/private/tmp/mizyun-187-api.log`. Existing API/schema/lifecycle paths are reused; no migration.
- Mobile TypeScript, feature formatting, navigation/boundaries and diff whitespace checks PASS.
- Independent helper authored only the new screen test file, audited the task-only source diff and caught progression computation despite an empty planned list. Fixed by skipping the computation entirely for one-time sessions; strengthened test retains the actual saved set and asserts no target mutation/copy. Final review: no concrete blocker.
- Final `pnpm check` in the isolated snapshot: PASS (exit 0), `/private/tmp/mizyun-187-isolated-check-final.log`. Mobile1320/API835 (15 existing credential-gated E2E skips), contracts200/core368/server-adapter154/navigation116; formatting/typechecks/dual Hermes and all existing safeguards. Config retains3 stale-default-bundle-path skips; the same3 existing purity assertions passed separately against each actual iOS/Android Hermes artifact (6 total), `/private/tmp/mizyun-187-bundle-purity.log`. No live provider or real ownership/database tests are implied.

## Candidate provenance

Isolated checkout `/private/tmp/mizyun-one-time-187-check` contains a snapshot of shared uncommitted source. Earlier shared full gate stopped on formatting in eight concurrently edited meal files; a later shared attempt stopped on two concurrent analytics document anchors. No other session source was changed. Only isolated copies were formatted/link-normalized. Initial isolated full gate passed before the final same-account token-refresh refinement. Final gate log: `/private/tmp/mizyun-187-isolated-check-final.log`. All eight feature runtime/test files match the final candidate exactly. Final source hashes:

| Path                                                                    | SHA256                                                             |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `apps/mobile/src/features/log-workout/log-workout-screen.tsx`           | `0a6577b1fdfe6a4a03d65285b1ddd405c401f383e7ccc6d65c4faeebc3808411` |
| `apps/mobile/src/features/log-workout/log-workout-data.ts`              | `22b91fb5af7c6eab5bfe26e5f2dc70efe7f50831829c6e2e399e760e451d3eba` |
| `apps/mobile/src/features/log-workout/log-workout-data.test.ts`         | `7b5ba39b916946e23620312b6d28c6925a673e4b4b620dd47c3cf87dec1bab9f` |
| `apps/mobile/src/features/log-workout/one-time-workout-screen.test.tsx` | `83a148dbc27b0e3ee4b1d9d213ece97c453af9a81147eb6cc6bd55bd60cc1065` |
| `apps/mobile/src/features/workouts/workouts-hub-screen.tsx`             | `b5c9aae384b4a147441bbc0fe714c1763b721a498e09dfcc3416f78e9046cb99` |
| `apps/mobile/src/features/workouts/workouts-hub-screen.test.tsx`        | `47fcbbbacea17120eab6fe37e61f9cee1539b9b48eb2c3570d24b472beac36d9` |
| `apps/mobile/src/features/workouts/workouts-hub-data.ts`                | `72e4af95f0991e8bbf289690822dbf0567b07c5146ea0cc2c301582c8ac46e31` |
| `apps/mobile/src/features/workouts/workouts-hub-data.test.ts`           | `f8f225a6e2ec48a6759a6c7707a1be62cc63b3beb0ee6fc9cfb8f660f8d7091b` |

## Remaining acceptance

No backend deployment, standalone installation, device interaction, real database/provider acceptance, Production promotion or Store action. #187 remains open for delivery/acceptance. Unsaved inline set fields retain the existing logger’s device-state behavior; only saved exercises/sets are claimed restart-safe.

On an exact verified standalone Dev candidate, test:

1. Start an empty workout; verify normal timer and appearance with no Coach draft exercises.
2. Add an exercise; minimize/reopen and terminate/relaunch before any set.
3. Save several sets; add another exercise; reorder; verify metric/imperial values, rest timer, background/resume and no false planned-completion notification.
4. Fail an exercise save; verify no false saved selection, reconnect and retry. Fail a start response; retry and verify one session.
5. Finish and reopen history; verify actual exercises/sets/duration, saved routine targets unchanged, and saving private until deliberate sharing.
6. Discard a separate disposable session; confirm only that session disappears.
7. Review light/dark, small screen, decimal keyboard, large text, VoiceOver/TalkBack and tap controls on each intended platform.
