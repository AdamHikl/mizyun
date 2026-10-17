# Timed workouts evidence (#278, 2026-10-17)

Package: [#278](https://github.com/AdamHikl/mizyun/issues/278), "time-based workouts like swimming". Decision: [ADR-0068](adr/0068-timed-exercise-tracking-and-log-activity.md). Adam chose "Timed exercises + quick log" on 2026-10-17. Baseline `d175da95cd6505c707324d156bc6d94235bdaf5a`.

## Scope delivered (source)

- `packages/core/src/exercise-tracking.ts`: tracking modes (`load_reps`, `duration`, `duration_distance`), exact-name/catalogId resolution (memoised index), duration parsing (bare number = seconds for holds, minutes for activities), shared distance units (m/yd for swimming, rowing, SkiErg; km/mi otherwise).
- `packages/core/src/exercise-catalog-supplement.ts`: Mizyun-authored Swimming, Outdoor Cycling, Hiking (no RepDB `source`, `pending_professional`); catalog 609 → 612, inserted alphabetically. `findCatalogExercise("bike")` still returns Air Bike.
- Live workout card (`apps/mobile/src/features/log-workout/`): Time and optional distance inputs for timed exercises, inline accessible validation, legacy reps-only sets still visible, timed rest summaries, catalog picks save `metadata.catalogId`/`trackingMode`. Load/reps exercises unchanged.
- Log activity (`apps/mobile/src/features/log-activity/`, `app/log-activity.tsx`, Workouts hub row): one completed workout + one duration set; stable operation ID; set-existence check before the set add; account-bound pending plan; unlock when nothing was sent; Close on non-retryable errors; no Health export marker; end time never in the future.
- No migration, RLS, API route or contract change.

## Delegation and review

- Exploration (read-only) mapped sets, catalog, running/bouldering precedents.
- Two Sonnet helpers implemented the live card and Log activity with disjoint file ownership; the coordinator integrated shared units, metadata and docs.
- Independent Opus review (non-author) found 3 blockers (bare numbers read as minutes on planks; per-render uncached catalog search; Log activity exported to Health as strength training with estimated times), 1 high (pending plan retried under another account) and mediums (permanent lock, empty-workout messaging, future end time, legacy reps hidden, watch behaviour). All but M5 were fixed; M5 is a documented behaviour change (see below). Bounded fix review: see Results.

## Results

- Core: `npx vitest run` in `packages/core` → 48 files / 692 tests passed (includes a first-use timing guard for the name index: about 0.8 ms measured); `tsc --noEmit` clean.
- API: `npx vitest run src/modules/exercises` → 28 tests passed. Agent runtime: `npx vitest run` → 95 passed; Coach feature-knowledge script covers 22 features / 55 routes.
- Mobile: `npx vitest run src/features/log-activity src/features/log-workout src/features/workouts` → 24 files / 327 tests passed; `tsc --noEmit` clean.
- `pnpm navigation:check` → PASS (0 errors, 25 pre-existing warnings).
- First full `pnpm check` failed in `test:coach-feature-knowledge`: "Mobile route has no Coach capability owner: log-activity.tsx". Fixed by adding the route and guidance to `packages/agent-runtime/src/app-capabilities.ts`.
- The second bounded review confirmed the index rebuild and the sticky `workoutSent` fix; its last nit (record a sent workout before the stale-response return) is applied.
- Final full `pnpm check` on the settled working tree (baseline `d175da95` plus this uncommitted package): **PASS**, input SHA-256 `f9be683419d66e5a8c6ed6687ecd3a0969d56f4128b8b34641203666b82f1a9b`; mobile 3075 tests, API 1183 passed / 15 skipped (provider/credential-gated suites, unchanged), safeguards 74/74. Only this evidence file and `status.md` were edited afterwards (gate result recording).

## Open exits

- Simulator and installed Dev device acceptance: add Swimming to a workout and log `10:00`/`400`; log a plank with `45`; Log activity for today and an earlier day; retry after airplane mode; large text and VoiceOver on the new inputs.
- Watch companions cannot log timed exercises; previously rep-logged Plank/Jump Rope/Walking/Rowing Machine are now phone-only for logging.
- Not covered by automated tests: watch `canLogSet`/command rejection for timed entries.
- Follow-up issues: #280 (custom tracking type, routine time targets), #281 (watch timed sets), #282 (Health export and energy), #283 (timed history and progress), #284 (pre-existing all-null set create bug).
- Not committed, deployed or released in this session.
