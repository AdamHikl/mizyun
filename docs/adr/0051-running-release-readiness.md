# ADR-0051: Running release readiness

Date:2026-10-08. Status: accepted for source implementation; deployment acceptance open.

## Decision

Capture the clean actual API checkout SHA, random process instance and start time at startup. `/v1/readiness` provides bounded DB/Auth/Storage readiness without user data, secret values or filesystem paths. Promotions require requested, checked-out and running identities to agree and a fresh healthy instance. Stop the service before changing its source, including rollback. Unknown evidence fails closed. Legacy rollback health is explicitly qualified and never accepted as modern running-release evidence.

## Consequences

An environment variable/requested SHA cannot attest the running source. Source writable by the Dev service remains an operational trust limitation: startup identity is not cryptographic protection against a compromised source writer. Authenticated smoke, migration drift, backup provenance, schema compatibility and live failure rehearsal remain independent requirements. No new anonymous data access or provider inference is introduced.

Primary documentation and actual checks: [dated acceptance batch](../ISSUE_ACCEPTANCE_BATCH_2026-10-08.md).
