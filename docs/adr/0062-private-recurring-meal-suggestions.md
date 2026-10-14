# ADR-0062 — Private recurring meal suggestions

Date: 2026-10-13. Status: accepted for source implementation; Dev/native/pilot acceptance open. Requirement: NUTR-REC-002; issue #242.

## Decision

Offer one contextual card on Home/Meals after three consecutive local days of exact confirmed meal identity and consumption times within90 minutes. Explicit copies count, including copies of automatic entries; server occurrence-ledger entries and surviving automatic markers do not. Detection is pure domain code and invokes no model/provider. Normalize NFC and explicit whitespace, fold ASCII case only, preserve missing nutrition versus zero, and use exact basic macros/grams. Compact same-minute duplicates and fail closed on incomplete or excessive search history.

User authorization creates a schedule, rather than merely opening an editor. Daily begins tomorrow; Change previews custom time/weekdays and uses the same acceptance boundary. Profile/device timezone disagreement requires a choice and fresh detection. Accepted schedule timezone remains fixed across travel. Existing management handles pause, skip, stop and edits. Durable30-day/permanent family dismissal and global controls never disable existing schedules.

Acceptance is an authenticated database transaction under the existing owner lock. Revalidate complete source/evidence independently of client hashes, reuse an equivalent current schedule, or create and skip today atomically. An immutable operation receipt is checked before live-evidence logic; replay never skips tomorrow. The reciprocal manual-create guard prevents suggestion-first duplicates. Accepted/stopped suggestions do not resurrect. Preserve ordinary schedule worker, entitlement and occurrence behavior.

Owner-only RLS tables store family decisions, preferences and receipts. Account export paginates each by its actual primary key; deletion blocks new admission and clears all state. Mobile persists the operation before transport in encrypted, bounded SecureStore chunks with repairable journals. Lifetime fences retire reads/actions on logout/account changes; unknown outcomes resolve the same operation. Cached success rereads schedule status before presenting it. Backgrounding hides actions/impressions; foreground refresh redetects current timezone before enabling the card. Cleanup tombstones make interrupted expected-operation deletion recoverable. Request bodies and candidate path segments are redacted, including default Fastify log messages.

## Alternatives and consequences

A card avoids new notification permissions and sensitive lock-screen content. Fuzzy meal matching, photo reuse, grouped meals, generalized automation and proactive advice remain outside v1. Exact matching may miss separately estimated servings. Three days and90 minutes are product hypotheses; changing policy requires coordinated truthful copy/contracts. Pilot analytics is deferred and must not count generated food records as deliberate engagement or confirmed intake.

## Sources and evidence

Checked2026-10-13: [Supabase functions](https://supabase.com/docs/guides/database/functions), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [PostgreSQL17 locking](https://www.postgresql.org/docs/17/explicit-locking.html), [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/), [React Native accessibility](https://reactnative.dev/docs/0.86/accessibility), [Fastify routes](https://fastify.dev/docs/latest/Reference/Routes/), [Pino serializers](https://github.com/pinojs/pino/blob/main/docs/api.md).

See [implementation specification](../MEAL_ROUTINE_SUGGESTIONS_PLAN_2026-10-13.md) and [qualified evidence/open gates](../MEAL_ROUTINE_SUGGESTIONS_EVIDENCE_2026-10-13.md).
