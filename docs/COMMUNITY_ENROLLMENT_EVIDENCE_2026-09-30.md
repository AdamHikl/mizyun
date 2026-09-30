# COMM-03 / #142 enrollment evidence — 2026-09-30

Source: HEAD `877d1898e9205c4be19c6344e1cf1d533f4ff312` plus preserved uncommitted community implementation, #142 changes and concurrent #143 work. No commit/push, shared-database migration, Hetzner deployment, native install/device acceptance, Production or Store action in this package. Earlier evidence is historical. No shared local reset was run.

## Implemented scope

- Conservative eligibility uses integer private birth year `1900..current UTC year - 19` in core/API and database; missing/invalid/ambiguous year denies participation. Corrections withdraw authority atomically. This does not verify identity or birthday.
- Enrollment and re-enrollment require current rules `2026-09-30` plus explicit separate adult declaration. Direct RPC cannot silently accept. Active profile updates require an existing current receipt and preserve it; repeated successful enrollment preserves generation/receipt.
- Owner GET returns withdrawn identity for reserved-handle recovery. Social DTOs remain allowlisted; foreign RPC identity projections remove declaration/terms metadata. Stable blocks and suspensions remain through withdrawal.
- Pilot handles remain immutable/reserved through withdrawal. Normalized uniqueness and direct reserved-name checks remain atomic. Auth-row cascade creates a minimal handle-only 90-day quarantine; deadline checks prevent premature reuse. Server/API deny contact details/URLs in bio and control text; full abusive-content filtering remains #148.
- Reachable Account → Privacy & data → Community settings and rules route. Separate blank social identity, unchecked declaration/rules/search, explicit saves, refusal/private path, confirmed withdrawal, neutral restrictions, UTC revalidation, principal-bound memory drafts and lost-response reconciliation. Visible enrollment is closed until actual contact/legal/moderation/retention/pilot gates are accepted.

## Fresh verification

Regression first: core community birth-year boundary failed 1 of 26 tests because 2008 was admitted during 2026; corrected year-minus-19 policy passes, with UTC rollover coverage.

- `pnpm --filter @mizyun/core test src/community.test.ts`: 28 pass.
- `pnpm --filter @mizyun/contracts test src/community.test.ts`: 43 pass at focused run (includes concurrent #143 tests).
- `pnpm --filter @mizyun/api test src/modules/community/profile-routes.test.ts`: 18 pass.
- `pnpm --filter @mizyun/adapter-supabase-server test src/community-repository.test.ts`: 36 pass at focused run (includes concurrent #143 tests).
- Helper mobile suite: 831 tests / 72 files pass; coordinator repository gate results recorded below when finished. Helper mobile typecheck passed. Native layout/VoiceOver/TalkBack/hardware evidence is unrun.

Local database proof uses only isolated `mizyun_issue142_scratch` inside Mac `supabase_db_mizyun`. Schema and app ACL copied from local baseline, omitting unrelated extension ACLs after `pg_stat_statements_reset` grant failed. No real data copied; synthetic principals only. Migration `20260930130000_community_enrollment_controls.sql` applies forward. Current shared tests include concurrent #143 signature/guard amendments, so compatibility run also applies `20260930120000_community_relationship_controls.sql` inside scratch; initial old-signature/guard failures are not #142 acceptance and were rerun against matching combined schema.

- Existing SQL `0008`, `0009`, `0010`: 16 + 30 + 24 assertions pass under matching combined migrations.
- New SQL `0012`: **38 assertions pass**. Covers explicit/null/false/old consent, active updates, retries, generations, normalized duplicate/reserved handles, visible receipt minimization, actual Auth FK cascade/quarantine deadline, age correction and restoration, suspension preservation.
- `python3 scripts/test-community-enrollment-concurrency.py`: PASS, two simultaneous claims yield exactly one winner and one `community_handle_taken`; synthetic scratch Auth rows removed in `finally`.

All SQL invocations use `psql -v ON_ERROR_STOP=1`; coordinator additionally checks `not ok` output because psql exit status alone does not prove pgTAP success. Dedicated scratch database was removed after verification. Shared Supabase Auth/PostgREST harness updated for explicit consent but not run here, since another active task owns shared DB verification. Storage is unaffected. Provider integration suites remain credential-gated.

## Independent review and remaining gates

Non-author helper reviewed contracts/core/API/adapter/RPC and mobile. Resolved suspension being represented as withdrawal in mobile, and disabled Not now during a pending save. Strengthened visible identity receipt minimization assertion after reviewer identified an empty-result false positive. Final non-author review approved with no remaining findings. A further Unicode initials defect was fixed using whole code points, with core/enrollment-form regressions passing; optional generated initials now match preview and submitted content.

#142 remains open for physical Dev withdrawal/re-enrollment/stable-block/suspension/account-switch journeys and admission dependencies. No independent age assurance, actual tested safety contact/staffed reporting, moderation filtering completeness, target-user comprehension, 30-day receipt/text purge, monitored deadline-plus-24h quarantine purge, social export or restore acceptance is claimed. Quarantine physical removal currently occurs on subsequent profile writes; #151/#153 must supply monitored purge. Enrollment remains closed in UI. Pilot rename requires a later explicit extension; no rename promise.

Next exact action: finish contact/legal/moderation/retention/admission acceptance, then verify the accepted exact candidate on physical Dev builds; keep the issue open until its exits pass. Concurrent uncommitted work is preserved; no selective commit of untracked shared foundation is attempted.

## Coordinator final verification

First `pnpm check` stopped at formatting in six concurrent #143 files. After that separate task was confirmed interrupted/inactive, formatted those files while preserving their implementation; next full `pnpm check` passed. Final Unicode correction prompted one more complete gate: **`pnpm check` PASS (exit 0)**, including repository-wide formatting/typechecks, iOS/Android Metro bundle exports, mobile **838 pass**, API **644 pass / 15 credential-gated E2E skips**, core **316 pass**, contracts **122 pass**, Supabase-server adapter **117 pass**, deployment/build/signing safeguards and **56/56 offline AI invariants**. Skipped live-provider/E2E suites are not acceptance evidence. The package totals include preserved foundation and concurrent #143 source; they do not close #143. `pnpm navigation:check` passed with zero errors / 24 advisory warnings, and `git diff --check` passed.

No selected commit was possible without capturing the pre-existing untracked community foundation and unfinished shared #143 work. Source provenance is HEAD plus the exact local source hashes in the enrollment source manifest. No #143 completion, migration or verification is attributed to this issue.
