# ADR-0052 — Community revocation capture and quarantined replay

Date: 2026-10-08. Status: accepted for local implementation; independent storage,
deployment, completeness certification and recovery acceptance remain pending.
Issues: COMM-12/#151, COMM-14/#153; related ADR-0030 and ADR-0032.

## Decision

Capture content-free privacy reductions in the same database transaction as the
mutation, including withdrawal generations, accepted account erasure, blocks,
sanctions, relationship removal and selected social/source revocations. The
service-only outbox has no cascade FK and never prunes unacknowledged events.
This records committed intent; it is not an independently durable ledger.

A dedicated exporter scans unacknowledged rows rather than advancing a timestamp
or sequence cursor. It encrypts each immutable event using an operator-provided
age public recipient, writes to an explicitly provisioned private destination,
fsyncs ciphertext, journal and directory, then acknowledges the full journal
checkpoint. Lost acknowledgements safely retry the identical immutable event.
Environment, content hashes, ciphertext hashes and journal chaining are checked.
No private age key enters the VM exporter or mobile bundle.

Recovery reads a checkpoint supplied separately by the independent ledger
operator. It validates/decrypts bounded files and applies owner/generation-scoped
reductions only after closing the disposable Dev restore's social controls,
cohort, outbox, device registry and approved media. Replayed events are immutable
and idempotent. Sanctions create a conservative restore hold rather than inventing
expiry, reversal or a permanent-ban decision. Account erasure removes restored
Auth ownership; physical Storage erasure and retained evidence remain separate
acceptance checks. No replay function or runner grants permission to reopen.

## Consequences and limits

An asynchronous outbox can lose unexported events with primary storage loss.
Fsync proves the destination accepted bytes, not replication or independent
failure survival. Therefore the exporter and restore runner explicitly report
completeness uncertified and reopening forbidden. Establish an independently
retained source covering archive creation through cutover, reconcile pending or
lost acknowledgements and all privacy-reduction categories, verify physical
Storage erasure and ACL/Auth equivalence, and complete operator recovery drills
before any separate reopening decision. Backups retain the existing daily RPO;
this change does not promise zero-loss recovery.

Writer locks and partial journals fail closed. A crashed lock/orphan requires an
operator inspection and deliberate repair; it is not automatic failover. No
retention/rotation procedure or key custody policy is silently invented. Existing
essential local privacy reductions remain available when the exporter is down.

## Primary sources checked 2026-10-08

- [PostgreSQL 17 CREATE TRIGGER](https://www.postgresql.org/docs/17/sql-createtrigger.html): capture executes within the original transaction, including cascades.
- [PostgreSQL 17 LISTEN](https://www.postgresql.org/docs/17/sql-listen.html): notification delivery is not a durable replay source; use persisted pending rows.
- [Node filesystem API](https://nodejs.org/api/fs.html): explicit fsync, exclusive creation and descriptor-based checks support the local sink protocol.
- [age design](https://age-encryption.org/): separate public-recipient encryption from recovery identity custody; encryption is not proof of storage durability.
- [Docker none driver](https://docs.docker.com/engine/network/drivers/none/): the existing disposable restore uses no external network and exposes no ports.

## 2026-10-11 local implementation extension

The forward `20261011120000` migration additionally captures mutes, mention opt-out,
per-card comment disabling, delivery preference narrowing, edited-away comment/message
text and reduced workout projections. Export declares participant memberships and
per-card comment settings at subtree version `2026-10-11`, with earlier versions
remaining readable. Missing/malformed successful pages fail complete export.

Content-free events cannot reconstruct the revised text or exact quiet interval.
Replay therefore revokes the old artifact for edited disclosure, and conservatively
mutes all notification delivery for a captured narrowing. Later opt-ins within the
same enrollment may be discarded; a later enrollment/artifact generation is fenced.
This favors preventing older disclosure from returning over reconstructing preferences.
No current live edit/share/notification behavior is changed by replay capture.

Mute replay scopes the choice to the owner's enrollment and checks the peer still
exists; it does not encode the peer's enrollment generation. The restore remains
closed until independent reconciliation accepts account-bound choices and any
required deliberate re-consent. Messaging `muted` metadata was not given new
visibility/delivery semantics. No expiry/pruning, archive horizon, hold custody or
coverage certificate is invented here. Existing original recovery exits remain.

Primary sources rechecked: [PostgreSQL17 triggers](https://www.postgresql.org/docs/17/sql-createtrigger.html),
[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security),
[PostgREST12 RPC](https://docs.postgrest.org/en/v12/references/api/functions.html).
