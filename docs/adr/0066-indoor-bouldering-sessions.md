# ADR-0066: Indoor bouldering sessions

Date: 2026-10-16. Status: proposed; implemented on Dev only, pending Adam's review of the layout sketches below. Package [BOULDER-001/#276](https://github.com/AdamHikl/mizyun/issues/276).

## Context

Adam wants climbers to log indoor boulders inside Workouts, see their Font grades improve and share sessions with followers. Strength sets and the running summary do not represent a session made of many graded attempts. The [implementation plan](../BOULDERING_IMPLEMENTATION_PLAN_2026-10-16.md) lists the reuse points and stages BLD-01 to BLD-06.

## Decision

1. **Storage.** A bouldering session is one `workouts` row with `details = { activityType: "bouldering", workoutLifecycle: { kind: "session" }, boulderSession: { version: 1, gradeScale: "font", recordingTimezone, activityDate, gymName } }`. `started_at` and `completed_at` are observed instants; `completed_at` is null while the session is active. Each boulder is a row in `public.boulder_ascents` with a composite owner FK to the session. The server derives `grade_rank` from `grade_code`; the client value is never trusted.
2. **Grade scale.** Font `3` to `8C+` (23 values, ranks 0–22), stored with `grade_scale = 'font'`. Comparisons use the rank only. No conversion to other scales.
3. **One active session across kinds.** The database allows at most one active bouldering session per user (start RPC under the per-user advisory lock plus a partial unique index; a second start returns `BOULDER_SESSION_ACTIVE`). Cross-kind blocking is a client rule: legacy strength sessions have no reliable server-side "active" marker (ADR-0009 recovery is heuristic), so the mobile app blocks starting one kind while the other is active and offers **Resume** instead.
4. **Idempotency.** Session starts and finishes, and ascent creates and edits, write owner-scoped `boulder_operation_receipts` (operation id, kind, ascent id, payload digest, accepted revision, deleted flag; no grades or notes). A lost-response retry returns the same row, a changed payload conflicts, and deleting a boulder or session tombstones its receipts, so a delayed create cannot resurrect it and new writes to a deleted session answer `BOULDER_REMOVED`. Session start uses the `workouts.client_operation_id` unique key. Edits compare-and-swap on `revision`.
5. **Photos.** Reuse private media purpose `workout`, the existing upload ticket and the client-side 2048 px JPEG re-encode (the metadata-removal step). The RPC links only an asset owned by the caller with purpose `workout` that is not deleted. Account erasure sweeps the bytes through `media_assets`.
6. **Projects (BLD-04).** A **Not yet** boulder creates a new open project unless the user explicitly chose **Try again** on an existing open or archived project, which links the new boulder to it (an archived project stays archived until it is sent). There is no automatic matching by grade and colour: setters reuse colours, so a guess would merge different problems. A flash cannot continue a project. Links are set only when a boulder is created; edits never open, move or remove a link. The database derives project state from its linked boulders: any linked send makes it **sent** (removing or editing that send away reopens it as open), and a project is removed only when its last linked boulder is removed. Projects are never deleted by age; older ones are grouped in the app and can be archived. A Try again whose project was sent or removed elsewhere answers `BOULDER_PROJECT_UNAVAILABLE` so the app can save the boulder unlinked. The planned short project label is deferred.
7. **Boundaries.** Writes go only through authenticated security-definer RPCs with an empty `search_path`, a per-user advisory lock and the account-deletion admission check used by running. Guard triggers block direct table writes, sets attached to a bouldering session, routine conversion, generic workout-route changes and the strength workout-card publication path. Legacy workout lists, Coach strength context, energy and progression exclude bouldering before pagination. Bouldering never supplies calorie credit.
8. **Availability.** Server flag `MIZYUN_BOULDERING_ENABLED` (enabled on Dev) and mobile `isBoulderingEnabled()` (Dev on, Production off unless an explicit flag). With the flag off, every `/v1/bouldering` route returns `FEATURE_DISABLED`; export and deletion still include bouldering data.
9. **Sharing (BLD-05).** A separate `bouldering` activity kind with an allowlisted snapshot (local day, top grade, sends, flashes, optional per-grade sends). Gym name, notes, photos, colours, attempts and times are never shared.

## Layout sketches (for Adam's review)

Log-a-boulder sheet:

```text
┌──────────────────────────────────────┐
│ Log a boulder                    ✕   │
│ Grade                                │
│ ‹ 5+  6A  [6A+]  6B  6B+  6C  … ›    │
│ Result                               │
│ [ Flash ] [ Sent ] [ Not yet ]       │
│ Attempts   –  2  +      (Sent only)  │
│ ▸ More: colour · note · photo        │
│ [ Same again ]          [   Save   ] │
└──────────────────────────────────────┘
```

Session summary:

```text
┌──────────────────────────────────────┐
│ Session complete · Boulder Gym       │
│ ┌──────────────────────────────────┐ │
│ │ ★ New personal best: 6C          │ │
│ └──────────────────────────────────┘ │
│ Sends 9   Flashes 4   Attempts 23    │
│ Top grade 6C                         │
│ 6C   ■                               │
│ 6B+  ■■                              │
│ 6B   ■■■■                            │
│ 6A+  ■■                              │
│ [ Share session ]          [ Done ]  │
└──────────────────────────────────────┘
```

## Consequences

Bouldering reuses the workout envelope, recovery and media pipeline without a new tab. Two new tables (three with projects) join the export, erasure and pgTAP lifecycle registries. Strength code paths must name every non-strength activity type they exclude. Gym grades are setter opinions, so the UI never claims cross-gym comparability. Database/RLS changes need independent review; native, device and Production acceptance remain separate gates.

## Sources

[Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) and [Expo SDK 57 ImagePicker](https://docs.expo.dev/versions/v57.0.0/sdk/imagepicker/), checked 2026-10-16; see the plan section F and the [research log](../RESEARCH_LOG.md). No authority publishes the Font scale; the ordered list is a product choice.
