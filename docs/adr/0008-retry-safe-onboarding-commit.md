# ADR 0008: Retry-safe onboarding commit protocol

- Status: accepted
- Date: 2026-07-19

## Context

Activation writes an active goal, a baseline body measurement, and profile display settings through separate authenticated endpoints. There is no cross-endpoint database transaction. Writing the profile first can make SessionGate treat a partially completed user as activated after an app restart, while blindly replaying creates can duplicate measurements or conflict with the one-active-goal invariant.

## Decision

The mobile onboarding submitter performs an ordered, retry-safe protocol:

1. read the active goal and create one only when the API returns not found;
2. read existing body measurements and create the baseline only when no confirmed weight exists;
3. write display name and unit system to the profile last.

SessionGate continues to use non-null `profile.displayName` as the completion marker. Therefore the marker cannot be committed until both prerequisite authorities exist, and retries discover prior successful work before issuing another create.

## Consequences

- A network failure at any intermediate step leaves onboarding visible after restart.
- Retrying does not create another active goal or baseline weight.
- An existing confirmed weight satisfies the baseline requirement; onboarding does not overwrite it.
- This is application-level orchestration, not an atomic transaction. Any future server-side onboarding endpoint must preserve the same ordering/idempotency guarantees before superseding this ADR.
