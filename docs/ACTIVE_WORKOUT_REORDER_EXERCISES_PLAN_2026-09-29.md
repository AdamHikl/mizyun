# Active Workout Exercise Reordering Implementation Plan (Issue #138)

> **Document version**: 1.0.0  
> **Date**: 2026-09-29  
> **Target Release**: Mizyun Dev & Mobile 1.0.0  
> **Status**: In Progress

---

## 1. Executive Summary & User Need

In real-world gym environments, equipment contention is frequent: a barbell bench press or squat rack is often occupied when a user arrives at that step in their routine.

**User Feedback (Issue #138)**:

> _"Možno by bolo fajn ak by šlo meniť poradie exercises počas workoutu. Akože neviem či to je až tak significant ale napríklad ak máš routine a je obsadené niečo a cvičíš v inom poradí tak nech si to vieš len presunúť"_  
> (_"Maybe it would be fine if it was possible to change the order of exercises during a workout. Like I don't know if it's that significant, but for example if you have a routine and something is occupied and you work out in a different order, you can just move it"_)

This implementation plan delivers full support for reordering exercises during an active workout session with zero data loss, instant client-side responsiveness, backend session persistence, and full accessibility.

---

## 2. Architectural Boundaries & Requirements

1. **ADR-0009 Routine vs Session Separation**:
   - Reordering exercises during an active session MUST update only the active session (`details.lifecycle = { kind: "session", routineId }`).
   - The original routine template MUST NOT be mutated when reordering an active session.
2. **Offline-Resilient Persistence**:
   - Reordering immediately updates component state and local session state.
   - Reordered exercise list is persisted to backend via `PUT /v1/workouts/:id` with updated `details.sessionExercises`.
   - `extractPlannedExercises` respects `details.sessionExercises` with highest precedence so reload/refresh retains the custom order.
3. **Next-Action Synchronization**:
   - Rest timer next exercise calculations (`selectNextExerciseIndexForNotification`, `activeSessionSummary`) automatically reflect the new order.
   - The user is seamlessly guided to the next incomplete exercise according to their customized order.
4. **Touch Targets & Accessibility**:
   - All interactive reorder controls (`↑`, `↓`, Reorder modal buttons) have touch targets $\ge 44 \times 44$ pt with explicit `accessibilityRole="button"` and descriptive `accessibilityLabel` attributes.

---

## 3. Implementation Plan

### Phase 1: Data Layer & Contracts

- **`apps/mobile/src/features/log-workout/log-workout-data.ts`**:
  - Update `extractPlannedExercises` to check `details.sessionExercises` first.
  - Implement `reorderWorkoutExercisesWith(client, workout, reorderedExercises)` to persist changes to `details.sessionExercises` via `PUT /v1/workouts/:id` using `workoutPatchSchema`.
- **`apps/mobile/src/features/workouts/workouts-hub-data.ts`**:
  - Update `extractPlannedExercisesFromWorkout` to support `details.sessionExercises`.
- **`apps/api/src/modules/coach/routines.ts`**:
  - Update `extractRawExercises` to support `details.sessionExercises`.
- **Unit Tests**:
  - Add tests in `log-workout-data.test.ts` for `sessionExercises` precedence and `reorderWorkoutExercisesWith`.

### Phase 2: UI Components

- **`apps/mobile/src/features/workouts/reorder-exercises-modal.tsx`**:
  - Bottom-sheet modal listing exercises with index numbering, exercise name, target summary, and `↑` / `↓` buttons with accessible touch targets.
  - "Done" button to confirm and dismiss.
- **`apps/mobile/src/features/log-workout/log-workout-screen.tsx`**:
  - Add `onMoveExercise(fromIndex: number, toIndex: number)` handler.
  - Add inline `↑` and `↓` buttons in `LiveExerciseCard` header for rapid 1-tap reordering.
  - Add `⇅ Reorder` button in `ActiveWorkoutFeed` live header bar that opens `ReorderExercisesModal`.
  - Wire state and persist reordered exercises to both local state and backend.

### Phase 3: Verification & Independent Review

- Run Vitest suites for mobile and API.
- Execute full repository check (`pnpm check`).
- Delegate independent subagent review for safety and UX verification.
- Update `status.md` with qualified evidence and advance GitHub issue #138.
