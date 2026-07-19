# ADR 0009: Active workout authority and recovery

- Status: accepted
- Date: 2026-07-19

## Context

A workout can span app backgrounding, process termination, and temporary network loss. Saved sets must not depend on device-only state, but unsaved text should survive a routine interruption. Previous-performance context must describe prior sessions, not sets added moments ago to the active session.

## Decision

- Starting a workout creates an API workout with `completedAt: null`.
- On entry, mobile lists workouts and recovers the newest incomplete workout plus its persisted sets.
- Every saved set is immediately authoritative through the set API.
- Expo SecureStore holds only small user-scoped unsaved field strings and the selected exercise.
- Completion updates `completedAt`; abandonment deletes the workout after confirmation.
- Recent-performance requests pass the active workout ID as `excludeWorkoutId`; the API excludes those sets before aggregation.

## Consequences

- App restart does not lose the active workout or any saved set.
- Network failure can preserve unsaved text without presenting it as confirmed data.
- Previous best load and prior-session volume remain stable while the current workout is logged.
- The current schema can technically contain more than one incomplete workout. Mobile recovers the newest; a future server invariant may enforce at most one active workout per user if multi-device evidence warrants it.
