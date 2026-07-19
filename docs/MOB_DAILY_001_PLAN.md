# MOB-DAILY-001 plan

> Working plan for the persistent mobile daily loop. Phases 2-5 cover the API/data layer; this work package brings the mobile UI onto it incrementally.

## Why

The 2026-07-18 sweep named MOB-DAILY-001 as the next exact work package. Status says "All training data is currently stored locally on the device." The dashboard is a static placeholder with hardcoded "—" metrics and `Pressable` buttons that don't navigate. After PERSIST-002 every Phase 2 feature has a durable Supabase-backed implementation, so the mobile surfaces can read real records.

## Scope

### In scope

1. **Wire the dashboard to real persisted records.** Three small data hooks (`useDailySummary`, `useLatestWeight`, `useWorkoutCount`) that call the existing PERSIST-002 endpoints and replace the static "—" metrics with real numbers. Loading and error states fall back to "—" so the placeholder UX is the floor.
2. **Three entry forms** reachable from the existing dashboard action buttons:
   - `app/(home)/log-meal.tsx` — minimal name + calories + carbs/protein/fat fields → `POST /v1/food-entries`.
   - `app/(home)/log-workout.tsx` — name + (optional) notes → `POST /v1/workouts` with `completedAt: now`.
   - `app/(home)/log-weight.tsx` — single weight field → `POST /v1/body-measurements`.
3. **Navigation wiring** — `Pressable` onPress on the dashboard calls `router.push` to the matching entry form.
4. **Vitest tests** — typed reducers for each fetch hook, plus a smoke "fetch + happy path" test using the existing mocked `apiClient` shape.

### Deferred from the first capture slice

- Multi-day aggregation on mobile (that's a follow-up once we have user behavior data).
- Photo capture (MEDIA-MOB-001).
- HealthKit / Health Connect (separate segments).
- Coach wiring (the placeholder screen stays).
- Auth / onboarding refactors (those already work and aren't on the critical path).

## Files

### New

- `apps/mobile/src/features/dashboard/dashboard-screen.tsx` — wire to real data (replace the hardcoded `metrics` array).
- `apps/mobile/src/features/dashboard/dashboard-data.ts` — pure fetch reducers (testable without RN).
- `apps/mobile/src/features/dashboard/dashboard-data.test.ts` — reducer tests.
- `apps/mobile/src/app/log-meal.tsx` — entry form route file (one-liner re-export).
- `apps/mobile/src/features/log-meal/log-meal-screen.tsx` — the form.
- `apps/mobile/src/features/log-meal/log-meal-data.ts` — pure submit reducer.
- `apps/mobile/src/features/log-meal/log-meal-data.test.ts` — submit reducer tests.
- `apps/mobile/src/app/log-workout.tsx` and supporting files (same shape).
- `apps/mobile/src/app/log-weight.tsx` and supporting files (same shape).

### Modified

- `apps/mobile/src/features/dashboard/dashboard-screen.tsx` — replace the static `metrics` array + `Pressable` action buttons with data + `router.push`.

## First capture-slice evidence

- Dashboard data reducers and create-submit reducers have focused unit coverage for success, validation, and important failure paths.
- Meal, completed-workout, and weight forms are reachable from the dashboard and preserve small user-scoped drafts in encrypted device storage until the API confirms success.
- Dashboard calories, latest weight, and current-week workout count come from API responses; loading and partial-refresh failures are visible and retryable.
- Metric and imperial weight entry produce the same canonical kilogram meaning.
- `pnpm check` must pass before the slice is handed off.

MOB-NUT-001 is complete: the Home stack now includes an authoritative daily meal list and totals, create/edit/copy/delete behavior, explicit delete confirmation, focus-driven refresh, recoverable user-scoped edit drafts, and local-day API boundaries. MOB-DAILY-001 remains active after this slice. Its parent definition of done still requires baseline weight in activation, exercise/set logging with previous performance, labeled weight history/trend, energy state, and simulator/device acceptance against persistent storage.

## Open follow-ups (per the matrix)

- MOB-ONB-001 — complete activation with baseline weight.
- MOB-DASH-001 — the trend views (week/month) and the energy-summary card from ENG-002.
- MEDIA-MOB-001 — the photo capture + upload flow against PERSIST-003.
- AND-001 — verify the same loop on Android (deferred).
- OBS-001 — consent-respecting analytics once the loop is durable end-to-end.
