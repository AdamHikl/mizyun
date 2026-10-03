# ADR-0038: Durable server-side recurring meal logging

- Status: Accepted
- Date: 2026-10-03
- Scope: NUTR-REC-001 / issue #183

## Decision

Store explicitly authorized recurring snapshots and an occurrence ledger in PostgreSQL. The API composition root starts a non-overlapping minute worker using its existing service-role client. Atomic SQL materialization serializes with user mutations and commits the ledger and food entry together. Use local calendar dates and named IANA timezone conversion, not fixed offsets or phone background execution.

One schedule generates at most one entry per local date. The ledger survives meal deletion. Stop tombstones the schedule; retries cannot recreate it. New/edited/resumed schedules apply prospectively. Recovery covers only the current local day. Database DST gap resolution shifts forward and a fold uses the later standard-time instant. The selected zone remains fixed until explicitly edited.

Copy an owned confirmed saved meal, with null nutrition unchanged. Preserve legacy food-source compatibility through an additive details marker. Strip automatic provenance from the template, then attach trusted occurrence provenance. Recheck advanced entitlement at generation, and stop generation after account deletion admission. Export schedules and occurrences; auth deletion cascades them.

## Consequences

Scheduling does not depend on a phone being awake or notification permissions. Availability depends on the backend/database; a minute tick is approximate, not a real-time guarantee. Entries are labelled automatically logged and remain editable/removable. Explicit schedule authorization does not establish observed consumption. Existing source enums and manual logging remain compatible. SQL concurrency/authorization and installed app-closed journeys require separate evidence.

## Sources

Reviewed 2026-10-03: [PostgreSQL datetime](https://www.postgresql.org/docs/17/functions-datetime.html), [DST resolution](https://www.postgresql.org/docs/17/datetime-invalid-input.html), [Supabase functions](https://supabase.com/docs/guides/database/functions), [Fastify lifecycle hooks](https://fastify.dev/docs/latest/Reference/Hooks/), [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/).
