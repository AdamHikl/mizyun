# Mutation Idempotency & Retry Audit (REL-AUD-007 / Q2)

Prepared: **2026-09-08** as part of Remediation Session D.
Baseline: Implementation Review Finding Q2 and Release Readiness Criterion R7.

Current reconciliation2026-10-08: [batch evidence](ISSUE_ACCEPTANCE_BATCH_2026-10-08.md). Historical counts below are not fresh acceptance. Weight now persists a fixed UUID/time/payload before dispatch and replays through an owner-scoped partial unique index; screen5/API27 and15 real transactional SQL checks pass. Delivery/native acceptance remains open. Workouts and sets still contain keyless calls/fresh timestamps in `log-workout-data.ts`; custom routine saves, in-memory Hub/Home start identities, Coach starts and partial multi-plan saves remain unresolved. The historical `cloneRoutineFromWorkout` symbol no longer exists; audit current routine/copy callers. Do not derive a permanent operation ID solely from a source workout: separate intentional copies need separate identities.

## 1. Overview & Purpose

Network unreliability on mobile devices causes dropped responses, timeouts, and user retries. Without end-to-end idempotency, retrying a state-changing mutation duplicates authoritative health records (meals, weight, workouts, sets).

This audit catalogs all write paths in Mizyun, records their current idempotency status, identifies failure modes, and outlines the required follow-ups.

---

## 2. Mutation Matrix

| Mutation Path                 | Method & Route                                      | Idempotency Key / Operation ID                        | Unique Database Index                                            | Conflict Detection                 | Draft Durability Before Submit               | Retry Status                           |
| :---------------------------- | :-------------------------------------------------- | :---------------------------------------------------- | :--------------------------------------------------------------- | :--------------------------------- | :------------------------------------------- | :------------------------------------- |
| **Meal Creation**             | `POST /v1/food-entries`                             | `clientOperationId` (UUID) + `Idempotency-Key` header | `idx_food_entries_user_client_op (user_id, client_operation_id)` | Yes (HTTP 409 on payload mismatch) | Yes (`expo-secure-store` awaited pre-submit) | **RESOLVED & VERIFIED (Q2)**           |
| **Meal Update**               | `PUT /v1/food-entries/:id`                          | Path parameter `:id` (Natural Idempotence)            | Primary key `id`                                                 | Handled by SQL UPDATE              | In-flight form state                         | **IDEMPOTENT** (HTTP PUT)              |
| **Body Measurement (Weight)** | `POST /v1/body-measurements`                        | UUID/header plus frozen measuredAt/payload            | Partial owner/operation unique index                             | Same replay; changed409            | Awaited encrypted draft before dispatch      | **SOURCE/SQL VERIFIED; DELIVERY OPEN** |
| **Workout Creation**          | `POST /v1/workouts`                                 | None                                                  | None                                                             | None                               | In-memory workspace                          | **PLANNED FOLLOW-UP**                  |
| **Workout Set Creation**      | `POST /v1/workouts/:id/sets`                        | None                                                  | None                                                             | None                               | In-memory workspace                          | **PLANNED FOLLOW-UP**                  |
| **Workout Routine Clone**     | `POST /v1/workouts` (via `cloneRoutineFromWorkout`) | None                                                  | None                                                             | None                               | Fire-and-forget                              | **PLANNED FOLLOW-UP**                  |
| **Coach Proposal Acceptance** | `POST /v1/coach/chat` (actions)                     | Proposal UUID                                         | Proposal state                                                   | Yes                                | Proposal cache                               | **PLANNED FOLLOW-UP**                  |

---

## 3. Deep Dive: Meal Creation (Resolved in Session D)

### 3.1 Failure Mode Addressed

Prior to Session D, `log-meal-screen.tsx` saved drafts without an operation ID. On submit, `log-meal-data.ts` generated a fresh `crypto.randomUUID()` on every attempt. If a network response was lost after server commit, tapping "Save" sent a new UUID, creating a duplicate meal.

### 3.2 Implemented Solution

1. **Durable Identity Generation**:
   - `clientOperationId` (UUID) and `consumedAt` (ISO timestamp) are initialized when the draft begins.
   - Older saved drafts lacking an ID are migrated exactly once via `upgradeLegacyMealDraft`.
2. **Pre-submit Durable Persistence**:
   - In `log-meal-screen.tsx`, `onSubmit` awaits `saveLoggingDraft(userId, "meal", ...)` before making the network call. If secure storage fails, submission halts with a recovery message.
3. **Synchronous Submission Lock**:
   - `isSubmittingRef` and `isCompletedRef` guard against double-taps and delayed autosaves resurrecting completed drafts.
4. **Server Deduplication & Conflict Guard**:
   - `POST /v1/food-entries` checks `options.foodEntryRepository.findByClientOperationId`.
   - If found, server verifies canonical payload (`name`, `caloriesKcal`, macros).
   - Matching payload returns the existing entry (HTTP 200).
   - Conflicting payload returns HTTP 409 `CONFLICT`.
   - Racing concurrent inserts hit the unique partial index `idx_food_entries_user_client_op` and retrieve the existing row.

---

## 4. Planned Follow-up Specifications

### 4.1 Weight / Body Measurements (`POST /v1/body-measurements`)

- **Implemented2026-10-08**: nullable operation UUID and partial owner uniqueness; replay/conflict handling. Migration delivery remains open.
- **Implemented2026-10-08**: stable operation ID/time/payload and awaited recoverable SecureStore draft; native restart/lost-response acceptance remains open.

### 4.2 Workouts & Sets (`POST /v1/workouts` and `POST /v1/workouts/:id/sets`)

- **Action**: Add `client_operation_id uuid null` to `workouts` and `workout_sets`.
- **Client**: Store active workout session in `expo-secure-store` with stable IDs.
- **Routine/copy callers**: create one fresh operation identity per intentional copy; persist it and frozen payload across ambiguous retries. Source identity alone must not collapse separate intentional copies.

---

## 5. Verification Evidence

- Automated test suite `apps/mobile/src/features/log-meal/meal-retry-durability.test.ts` (4 passed).
- Data layer unit tests `apps/mobile/src/features/log-meal/log-meal-data.test.ts` (20 passed).
- Form lifecycle tests `apps/mobile/src/features/log-meal/meal-form.test.ts` (12 passed).
- API routes tests `apps/api/src/modules/food-entries/routes.test.ts` (45 passed).
