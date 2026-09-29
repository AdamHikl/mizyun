# Active Workout Set Addition Clarification and Set Types Implementation Plan

> **Work Package**: `WORKOUT-SET-001`  
> **GitHub Issue**: [#139](https://github.com/AdamHikl/mizyun/issues/139)  
> **Status**: Planning Mode Only (Zero runtime mutations, zero schema changes, zero deployments)  
> **Date**: 2026-09-29  
> **Authoring Session Commit**: `abac66032cc3acd666fcbb4605ee54b85e05846a`

---

## A. Context & Scope

### 1. Problem Statement

In Mizyun's active workout logger ([`apps/mobile/src/features/log-workout/log-workout-screen.tsx`](../apps/mobile/src/features/log-workout/log-workout-screen.tsx)), two user-experience friction points were identified via direct user feedback:

1. **Confusing 'Add set' button behavior and wording**:
   - The exercise card renders all completed sets (e.g. sets 1, 2, 3), followed immediately by an inline "Active / Pending Set Row" (set 4) with load/reps inputs and a green checkmark button (`✓`).
   - Immediately below this row, a full-width footer button is rendered saying `+ Add Set 4` (`+ Add Set {nextSetSequence}`), calling the identical `onLogSet` handler as the row's `✓` button.
   - Users reported confusion: _"It says 'Add set 4' even when set 4 is already right there in the table? Even though I probably understand it is not marked as finished yet..."_. The user naturally interpreted "Add Set 4" as creating row 4 rather than logging it.
2. **Missing set type classification (Warmup, Normal, Failure, Drop set)**:
   - Modern workout tracking apps (e.g., Hevy, Strong) allow categorizing sets into **Normal** (working), **Warmup (`W`)**, **Failure (`F`)**, and **Drop set (`D`)**.
   - Currently, Mizyun treats all sets identically. Warmup sets are erroneously counted towards total working volume (`load × reps`) and progressive overload evaluations, distorting strength progression metrics.
   - Users have explicitly requested the ability to tag sets as Warmup, Normal, or Failure during live workouts.

### 2. In Scope

- **Contracts (`@mizyun/contracts`)**:
  - Introduce `workoutSetTypeSchema = z.enum(["normal", "warmup", "drop", "failure"])`.
  - Extend `workoutSetSchema` and `workoutSetCreateSchema` with optional/defaulted `setType`.
- **Core Domain (`@mizyun/core`)**:
  - Add `setType: WorkoutSetType` to `WorkoutSetCore` and `StoredWorkoutSet`.
  - Update `summariseExerciseSets` in [`packages/core/src/workout-set.ts`](../packages/core/src/workout-set.ts) to exclude `warmup` sets from working session volume (`lastSessionVolumeKg`) and PR calculations.
  - Update progressive overload calculations in [`packages/core/src/progressive-overload.ts`](../packages/core/src/progressive-overload.ts) so `warmup` sets do not trigger target load advancements.
- **Database & Adapters (`public.workout_sets` & Supabase Server)**:
  - Add additive migration `supabase/migrations/20260929180000_workout_set_types.sql` adding `set_type text not null default 'normal' check (set_type in ('normal', 'warmup', 'drop', 'failure'))`.
  - Update `SupabaseWorkoutSetRepository` in [`packages/adapters/supabase-server/src/workout-set-repository.ts`](../packages/adapters/supabase-server/src/workout-set-repository.ts) to map `set_type` ↔ `setType`.
- **API (`apps/api`)**:
  - Accept and validate `setType` in `POST /v1/workouts/:workoutId/sets`.
- **Mobile App (`apps/mobile`)**:
  - Update `addWorkoutSetWith` in [`apps/mobile/src/features/log-workout/log-workout-data.ts`](../apps/mobile/src/features/log-workout/log-workout-data.ts) to accept `setType`.
  - Resolve the button ambiguity in [`apps/mobile/src/features/log-workout/log-workout-screen.tsx`](../apps/mobile/src/features/log-workout/log-workout-screen.tsx):
    - When an active pending row is displayed, the row's checkmark button (`✓`) is the primary completion action (accessible, >=44pt hit target).
    - If a card footer button is rendered while a pending row is open, it must say **`✓ Log Set {N}`** (or `Save Set {N}`), never `+ Add Set {N}`.
    - When all planned sets are completed (`completedSets.length >= entry.targetSets`), render a distinct **`+ Add Extra Set`** button that appends an additional set row to the exercise.
  - Add Set Type Selector:
    - Display distinct visual badges in the set column: sequence number for `normal`, amber `W` for `warmup`, red `F` for `failure`, purple `D` for `drop`.
    - Provide a modal / bottom sheet to toggle or select set type for the active set (and completed sets).
    - Intelligent pre-fill: warmup sets default to `warmup` until a normal set is logged, subsequent sets default to `normal`.
  - Synchronize live notification/Live Activity summaries with set type context where relevant.

### 3. Non-Goals

- Changing routine template schemas (`RoutineExercise`) in this work package (routines will continue specifying planned set counts; set types during live execution default to normal unless changed by the user).
- Modifying legacy workout tables or historical records (existing rows seamlessly default to `'normal'`).
- Modifying RLS policies or user isolation rules (existing `user_id = auth.uid()` RLS policies on `workout_sets` remain unchanged).
- Deploying to Hetzner Dev or Production during this planning session.

---

## B. Baseline & Constraints

1. **Baseline SHA**: `abac66032cc3acd666fcbb4605ee54b85e05846a` (all 15 packages passing `pnpm check`).
2. **Architectural Boundaries**:
   - `packages/core`: Pure TypeScript, zero external framework or database dependencies. Bounded numeric logic and validation.
   - `packages/contracts`: Zod schemas and wire types shared across API and mobile.
   - `packages/adapters/supabase-server`: Maps SQL snake_case columns (`set_type`) to domain camelCase properties (`setType`).
   - `apps/mobile`: Presentation and user input only; calculation rules delegated to `@mizyun/core`.
3. **Accessibility**: Touch targets for set type chips, check buttons, and footer actions must be at least 44×44 pt on iOS and 48×48 dp on Android.
4. **Backward Compatibility**: Any client (e.g. older installed mobile builds) sending sets without `setType` must succeed with the default `'normal'` set type without validation errors.

---

## C. Staged Implementation Steps

### Stage 1: Contracts and Core Domain

**Objective**: Introduce `WorkoutSetType` in `@mizyun/contracts` and `@mizyun/core`, and adjust volume/progression calculation rules.

#### Files Affected:

- `[MODIFY] packages/contracts/src/workout-set.ts`
- `[MODIFY] packages/contracts/src/index.ts`
- `[MODIFY] packages/core/src/workout-set.ts`
- `[MODIFY] packages/core/src/workout-set.test.ts`
- `[MODIFY] packages/core/src/progressive-overload.ts`
- `[MODIFY] packages/core/src/progressive-overload.test.ts`
- `[MODIFY] packages/core/src/index.ts`

#### Implementation Details:

1. **`packages/contracts/src/workout-set.ts`**:
   ```typescript
   export const workoutSetTypeSchema = z.enum([
     "normal",
     "warmup",
     "drop",
     "failure",
   ]);
   export type WorkoutSetType = z.infer<typeof workoutSetTypeSchema>;

   // In workoutSetSchema:
   setType: workoutSetTypeSchema.default("normal"),

   // In workoutSetCreateSchema:
   setType: workoutSetTypeSchema.optional(),
   ```
2. **`packages/core/src/workout-set.ts`**:
   - Add `setType: WorkoutSetType` to `WorkoutSetCore` and `StoredWorkoutSet`.
   - Update `summariseExerciseSets`:
     ```typescript
     // Exclude warmup sets from working session volume
     for (const s of sets) {
       if (s.workoutId !== sessionId) continue;
       if (s.setType === "warmup") continue; // Warmup sets do not count towards working volume
       if (s.loadKg === null || s.repetitions === null) {
         tainted = true;
         continue;
       }
       volume += s.loadKg * s.repetitions;
     }
     ```
     - For `bestLoadKg`: warmup sets are also excluded to represent true working 1RM / PR loads.
3. **`packages/core/src/progressive-overload.ts`**:
   - In `CompletedSetProgressionInput`, add optional `setType?: WorkoutSetType`.
   - In `evaluateExerciseProgression`, ignore sets where `setType === "warmup"`.
4. **Stage Acceptance Criteria**:
   - `pnpm --filter @mizyun/contracts test` passes.
   - `pnpm --filter @mizyun/core test` passes with new assertions verifying volume exclusion for warmup sets and normal inclusion for drop/failure sets.

---

### Stage 2: Database Migration & Backend Adapters / Routes

**Objective**: Add the `set_type` column to `public.workout_sets` and wire it through repository and Fastify routes.

#### Files Affected:

- `[NEW] supabase/migrations/20260929180000_workout_set_types.sql`
- `[MODIFY] packages/adapters/supabase-server/src/workout-set-repository.ts`
- `[MODIFY] packages/adapters/supabase-server/src/workout-set-repository.test.ts`
- `[MODIFY] apps/api/src/modules/workout-sets/routes.ts`
- `[MODIFY] apps/api/src/modules/workout-sets/routes.test.ts`

#### Implementation Details:

1. **`supabase/migrations/20260929180000_workout_set_types.sql`**:
   ```sql
   -- WORKOUT-SET-001: Support set types (normal, warmup, drop, failure)
   alter table public.workout_sets
     add column if not exists set_type text not null default 'normal'
       check (set_type in ('normal', 'warmup', 'drop', 'failure'));
   ```
2. **`packages/adapters/supabase-server/src/workout-set-repository.ts`**:
   - Extend `WorkoutSetRow`:
     ```typescript
     readonly set_type?: string | null;
     ```
   - In `workoutSetFromRow`:
     ```typescript
     setType: (row.set_type as WorkoutSetType) ?? "normal",
     ```
   - In `toInsertRow`:
     ```typescript
     set_type: set.setType ?? "normal",
     ```
3. **`apps/api/src/modules/workout-sets/routes.ts`**:
   - Extract `create.setType ?? "normal"` when creating `StoredWorkoutSet`.
4. **Stage Acceptance Criteria**:
   - `pnpm --filter @mizyun/supabase-server-adapter test` passes.
   - `pnpm --filter @mizyun/api test` passes with existing tests and new suite tests verifying set type persistence and round-trips.

---

### Stage 3: Mobile Data Layer

**Objective**: Expose `setType` in `addWorkoutSet` and mobile workout data helpers.

#### Files Affected:

- `[MODIFY] apps/mobile/src/features/log-workout/log-workout-data.ts`
- `[MODIFY] apps/mobile/src/features/log-workout/log-workout-data.test.ts`

#### Implementation Details:

1. In `WorkoutSetForm`:
   ```typescript
   export interface WorkoutSetForm {
     readonly exerciseId: string;
     readonly repetitions: string;
     readonly load: string;
     readonly durationSeconds: string;
     readonly distanceMeters: string;
     readonly perceivedExertion: string;
     readonly setType?: WorkoutSetType;
     readonly unitSystem: "metric" | "imperial";
   }
   ```
2. In `addWorkoutSetWith`:
   Pass `setType: form.setType ?? "normal"` to `workoutSetCreateSchema.safeParse`.
3. **Stage Acceptance Criteria**:
   - `pnpm --filter @mizyun/mobile test src/features/log-workout/log-workout-data.test.ts` passes.

---

### Stage 4: Active Workout UI & Set Addition Clarification

**Objective**: Fix the confusing "+ Add Set 4" footer button and implement the interactive set type selector.

#### Files Affected:

- `[NEW] apps/mobile/src/features/workouts/set-type-modal.tsx`
- `[MODIFY] apps/mobile/src/features/log-workout/log-workout-screen.tsx`
- `[MODIFY] apps/mobile/src/features/workouts/workout-notification.ts`
- `[MODIFY] apps/mobile/src/features/workouts/workout-notification.test.ts`

#### Implementation Details:

1. **Clarify Button Behavior & Wording in `LiveExerciseCard`**:
   - The table renders:
     1. Completed set rows (`props.completedSets.map(...)`).
     2. The active pending row (for `nextSetSequence`).
   - Fix the footer button duplication:
     - **Remove** `<ThemedText>+ Add Set {nextSetSequence}</ThemedText>` when an active pending row is already shown.
     - Instead, the footer button should be:
       - **Option A (Cleaner UX)**: While a pending set row is present, the row's `✓` button (now sized >=44pt with clear green accent) is the primary completion action. Below the table, if a button is displayed, label it **`✓ Log Set {nextSetSequence}`** (so users know it completes the active set row, rather than "adding" an uncompleted set).
       - **Option B (Planned Set Boundaries)**: If all planned sets are finished (`completedSets.length >= entry.targetSets`), do not auto-render a blank set 4. Instead, render a clean **`+ Add Set`** button. Tapping `+ Add Set` opens/activates the extra set row, making the action of _adding_ a set completely distinct from _logging_ a set!
2. **Interactive Set Type Selector (`SetTypeModal`)**:
   - In `PendingSetInput`, add `setType: WorkoutSetType` (defaults to `"normal"`).
   - In the active row, replace static text `{nextSetSequence}` with an interactive chip:
     - Normal: displays `{nextSetSequence}`
     - Warmup: displays `W` with amber badge (`backgroundColor: "rgba(245, 158, 11, 0.15)"`, `color: "#F59E0B"`)
     - Failure: displays `F` with red badge (`backgroundColor: "rgba(239, 68, 68, 0.15)"`, `color: "#EF4444"`)
     - Drop: displays `D` with purple badge (`backgroundColor: "rgba(139, 92, 246, 0.15)"`, `color: "#8B5CF6"`)
   - Tapping the chip opens `SetTypeModal`:
     - Lists all 4 types with descriptions:
       - **Normal Set** (Default working set)
       - **Warmup (`W`)** (Excluded from working volume & PRs)
       - **Failure (`F`)** (Set taken to muscular failure / RPE 10)
       - **Drop Set (`D`)** (Reduced weight set immediately following)
     - Minimum 48pt tap targets for each option.
   - When a set is logged:
     - Warmup sets: if set 1 was warmup, set 2 defaults to warmup until a normal set is logged.
     - Once a normal set is logged, subsequent pending sets default to `"normal"`.
3. **Stage Acceptance Criteria**:
   - Tapping `✓` or "Log Set" logs the active set with the chosen set type.
   - Completed sets reflect their set type badges in the set column (`W`, `F`, `D`, or sequence number).
   - `workout-notification.ts` correctly summarizes the next set type if not normal.

---

### Stage 5: Verification & Quality Gates

**Objective**: Validate across all workspaces and verify quality gates.

#### Verification Commands:

1. `pnpm check`:
   - Validates navigation structure (`pnpm navigation:check`).
   - Validates formatting (`pnpm format:check`).
   - Validates TypeScript across all 15 workspaces (`tsc --noEmit`).
   - Validates Metro bundle exports for iOS and Android.
   - Runs all unit, contract, mobile, API, and offline AI test suites.
2. Manual / Device acceptance checks (for when code is implemented):
   - Start active workout on device.
   - Log Set 1 as Warmup (`W`) → verify badge shows `W` and session volume does NOT increase by warmup weight × reps.
   - Log Set 2 as Normal (`2`) → verify badge shows `2` and session volume increases.
   - Log Set 3 as Failure (`F`) → verify badge shows `F`.
   - Verify footer button semantics: no "+ Add Set 4" confusion while set 4 is pending.

---

## D. Next-Session Prompt

When ready to implement this work package, copy and paste this exact prompt:

```markdown
Implement WORKOUT-SET-001 according to docs/ACTIVE_WORKOUT_SET_CLARIFICATION_AND_TYPES_PLAN_2026-09-29.md.
Follow all Mizyun rules in AGENTS.md:

1. Start with Stage 1 (contracts & core domain types, volume/progression calculations).
2. Proceed to Stage 2 (database migration & supabase-server adapter / API routes).
3. Proceed to Stage 3 (mobile data layer) and Stage 4 (SetTypeModal and LiveExerciseCard button clarification).
4. Run full `pnpm check` before reporting completion.
   Delegate research/subagent reviews where appropriate.
```
