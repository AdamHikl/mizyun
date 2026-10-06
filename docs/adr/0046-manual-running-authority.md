# ADR-0046: Manual running authority and retry-safe mutations

Date: 2026-10-06. Status: accepted for Dev implementation.

## Context

Users request useful running tracking. Existing workout sets support duration and distance, but the strength interface and progression calculations do not represent a completed run well. GPS recording and device imports add separate permission, provenance and lifecycle requirements.

## Decision

Add a direct Log run action inside Workouts and dedicated run history/detail/edit flows. The first client records a completed calendar day, required elapsed duration (including pauses), optional distance, environment, effort and notes. Pace is derived from canonical metres and elapsed seconds; absent distance remains unknown.

Store one running session in the existing workouts table with a strict versioned runSummary. The entered activityDate and recordingTimezone are authoritative. Day precision uses identical local-noon transport anchors solely to satisfy the existing timestamp envelope. No start time or duration is inferred from these anchors. The typed API can preserve an observed instant, but the initial create form does not invent one.

Use authenticated atomic RPCs with owner-scoped operation receipts, immutable replay payloads, edit revision checks and delete/cancel tombstones. Direct generic workout writes and attached sets cannot bypass this boundary. Receipts contain identity, digest, revision and deletion status, and cascade with account erasure; export includes run details and owner receipts. Local drafts use the existing encrypted per-account slot and account cleanup.

Legacy workout lists exclude running before pagination. Coach receives bounded running context separately from resistance counts and progression. Running does not supply calorie credit or medical/race readiness claims. Community publication and challenge/routine attachment remain blocked until their semantics are designed.

## Consequences

No new navigation tab, location permissions or provider dependency is needed. Users can log outdoor, treadmill and duration-only sessions immediately. Imports and GPS remain separate stages in the implementation plan. Database/RLS, native usability and Dev delivery retain independent acceptance evidence.

## Sources

See [dated research and implementation plan](../RUNNING_IMPLEMENTATION_PLAN_2026-10-06.md), especially sections D–G and the primary-source appendix, and [research log](../RESEARCH_LOG.md). Sources reviewed 2026-10-06 include Apple location authorization guidance, Expo Location/SecureStore documentation, Android foreground location service guidance, and Supabase RLS/transaction boundaries.
