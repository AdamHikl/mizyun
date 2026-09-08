# ADR-0021: Durable account deletion lifecycle and tombstones

- Status: accepted
- Date: 2026-09-08
- Related: ADR-0001, ADR-0012, Finding Q4, REL-AUD-001, REL-AUD-002, AUTH-04, SEC-06

## Context

Implementation Review finding Q4 exposed vulnerabilities in the account deletion implementation:

1. Deletion challenges were held in an in-memory process Map; an API restart or load-balancer distribution invalidated pending challenges and aborted in-flight deletions.
2. If network failures occurred after server processing, token consumption caused client retries to fail with `confirmation_token_missing`.
3. Storage object removal and memory deletion errors were caught and silently swallowed, allowing Auth deletion to proceed while orphaned private data remained.
4. If service-role administrative credentials were not provided, the adapter fell back to partial deletions while reporting success (`{ deleted: true }`).
5. Dual orchestration existed across both `account-repository.ts` and `apps/api/src/modules/account/routes.ts`.

## Decision

1. **Persistent Deletion State Machine (`public.account_deletion_jobs`)**:
   - Persist deletion operations in a dedicated database table `account_deletion_jobs`.
   - Stages: `challenge_issued` -> `in_progress` (sub-stages: `storage`, `memory`, `auth`) -> `completed` (or `failed`).
   - Challenge tokens are stored as secure SHA-256 hashes (`challenge_hash`).
   - Once confirmation is accepted (`in_progress`), challenge expiry no longer aborts the job; cleanup proceeds to completion across API restarts.

2. **Durable Tombstone Architecture**:
   - `account_deletion_jobs.user_id` does NOT declare an `ON DELETE CASCADE` foreign key to `auth.users(id)`.
   - When the Auth identity and cascaded relational tables are deleted, the deletion job record remains intact as a durable tombstone and audit proof.
   - Row Level Security permits only `service_role` management; authenticated callers have read-only access to their own job status.

3. **Honest, Resumable Multi-Stage Cleanup**:
   - **Storage Stage**: Enumerate all private objects under the user prefix in storage buckets. Missing objects (`404`) are treated as idempotent success. Storage outages, network errors, or authorization failures halt execution, record the stage, and mark the job `failed` (retryable).
   - **Memory Stage**: Delete vector/learned memories from `MemoryStore`. Outages are captured honestly and retryable.
   - **Auth Admin Cascade Stage**: Delete `auth.users` via Supabase Auth Admin. PostgreSQL cascades foreign keys across all user-owned domain tables (`profiles`, `food_entries`, `workouts`, etc.) in a single transaction.
   - **Tombstone Stage**: Mark job `completed` with timestamp.

4. **Single Orchestration Owner**:
   - `AccountRepository.deleteUser` acts as the single orchestration owner. The API route simply invokes `deleteUser` and returns the honest result; no duplicated memory deletion or error-swallowing occurs in transport routes.

5. **Idempotency & Lost Final Response Recovery**:
   - Repeated confirmation requests with the same valid challenge token return the current state of the job (`in_progress` or `completed`).
   - If the client drops connection after Auth deletion, retrying with the confirmation token verifies against the persisted tombstone and returns `{ deleted: true }`.

## Consequences

- Deletions are reliable, crash-resilient, and auditable.
- Missing dependencies or storage/memory outages never produce false-positive success.
- Clean database migrations and pgTAP tests verify the tombstone schema and RLS policies.
- Complies with GDPR/CCPA erasure mandates and Apple/Google Play account deletion standards.
