# ADR 0009: Active workout authority and recovery

- Status: accepted
- Date: 2026-07-19
- Amended: 2026-10-04

## Context

A workout can span app backgrounding, process termination, and temporary network loss. Saved sets must not depend on device-only state, but unsaved text should survive a routine interruption. Previous-performance context must describe prior sessions, not sets added moments ago to the active session.

## Decision

- Starting a workout creates an API workout with `completedAt: null`.
- Reusable routines and performed sessions remain in the same storage table for backward compatibility, but `details.workoutLifecycle.kind` explicitly distinguishes `routine` from `session`. A session copied from a routine records the source routine ID.
- Saving a routine never starts or completes that row. Starting from it creates a fresh session snapshot with `startedAt` set at the start action; the routine remains unchanged.
- On entry, mobile lists workouts and recovers the newest incomplete session plus its persisted sets. Routine rows are excluded from recovery and from live timers.
- One-time workouts use `details.sessionMode = "one_time"` on ordinary session rows, with no source routine. Exercise selections are saved immediately in `details.sessionExercises`, even before their first set. They use the same logger and history with no prescribed targets or automatic routine progression.
- Every saved set is immediately authoritative through the set API.
- Expo SecureStore holds only small user-scoped unsaved field strings and the selected exercise.
- Completion updates only the session's `completedAt`; abandonment deletes only the session after confirmation. Neither action clones, completes, or deletes its source routine.
- Recent-performance requests pass the active workout ID as `excludeWorkoutId`; the API excludes those sets before aggregation.

## Consequences

- App restart does not lose the active workout or any saved set.
- Network failure can preserve unsaved text without presenting it as confirmed data.
- Previous best load and prior-session volume remain stable while the current workout is logged.
- A routine can be reused repeatedly without moving through completed history. Each execution has its own duration, sets, and disposable active-session state.
- Legacy unclassified incomplete records with planned exercises remain visible as routines in the hub; interacting with them upgrades the lifecycle by creating a marked session copy.
- The current schema can technically contain more than one incomplete workout. Mobile recovers the newest; a future server invariant may enforce at most one active workout per user if multi-device evidence warrants it.
