# Oldest issues batch3 — 2026-10-07

Continues [batch1](OLDEST_ISSUES_BATCH_2026-10-07.md) and [batch2](OLDEST_ISSUES_BATCH_2_2026-10-07.md). Their Apple/provider, grouped-meal/#139 device, deployment and release gates remain open. This package does not change remote services, credentials, database schemas or installed builds.

## Founder acceptance

Adam confirmed: “#13 — Beta Pro and #11 — Branding are all checked and approved, you can work on the next set of issues.” Both issues are closed with `status:done`; the confirmation is their acceptance evidence. No device/build identifier or redundant fresh test is invented. #138 remains closed from its earlier explicit exercise-order acceptance.

- [#11 acceptance](https://github.com/AdamHikl/mizyun/issues/11#issuecomment-6045377816)
- [#13 acceptance](https://github.com/AdamHikl/mizyun/issues/13#issuecomment-6045379995)

## #25 export paging and truthful completeness

The API previously counted paginated memory rows but delivered at most10,000 via the normal memory list. Its paging helper stopped after a short page even when a server cap was smaller than500; the1000-page guard returned a truncated prefix. Failed consent reads could silently omit categories. Expiring signed media links were labelled complete despite missing offline bytes.

The memory port now has an export operation implemented by both concrete stores. Supabase uses the verified-token client and owner filter, `created_at,id` ordering and every retained state. API counts match delivered records. The shared export reader advances by actual returned count and requires an empty page; page failures, missing results and guard exhaustion abort the success envelope. Legacy capped repositories and exports with listed private media are partial; the mobile saved-partial warning covers omissions and expiring links.

Added regressions cover10,003 retained memories under a137-row server cap,10,001 delivered memories with owner isolation/all retained states, later-page/missing-result/guard failures, consent failures and capped fallback completeness. Source failure was established by inspecting the actual capped API read and short-page/guard branches; no red test run was requested. Independent non-author High source review found no scoped blocker.

Remaining #25/Q5 exits: complete durable-category inventory, snapshot or documented verified concurrency behavior, portable offline photo bytes/checksums, bounded streaming/resources/concurrency/artifact cleanup, real two-user Auth/DB/Storage interruption/isolation evidence and device Files/sharing journeys. Deletion/restore/provider obligations remain separate. #25 stays active.

## #23 release journal boundary

Required journal receipts now precede promotion mutations and successful release markers. Append/write/sync failures fail closed; the nonrecursive abort path keeps the deployment lock through recovery. Receipts distinguish requested/previous/checked-out SHAs, conservative migration/backup attempt states, local health and rollback outcomes. Unknown running SHA, backup reference and migration IDs/checksums remain explicit `null` fields rather than invented proof. The writer validates its owned regular file and repairs a short append where possible. Independent non-author High source review found no scoped blocker. `bash -n` passed for both scripts, and the local disposable deployment harness passed49/49 including six new journal failure/recovery-lock cases. No real service/database failure was injected. Running-release identity, authenticated/dependency readiness, real migration drift/schema-compatible rollback, live faults and exact authorized Dev delivery remain Q9 exits. #23 stays active.

## #139 batch-gate repairs

The first full gate stopped on formatting in an added export test; a formatting-only repair settled it. The next gate exposed previously untested #139 type errors: duplicate default fields before a spread, and two tests referencing a fixture from the excluded concurrent #226 package. Coalesce the complete blank input only when no saved input exists, and give the two planned-type tests their own typed fixture. Actual entered fields, manual overrides and ordinal behavior remain intact. The concurrent completed-workout code/tests stay excluded and preserved.

Fresh mobile typecheck and76 focused routine/logger tests passed. Independent review of the two repair diffs found no blocker. Whole-feature phone acceptance remains open; earlier “automated checks deferred” records are historical, not a fresh verification claim.

## Verification and delivery

Combined focused export checks passed in the isolated `export-journal-batch` checkout: memory3, export/account adapters35 and API account28 (66 total). Commands: `pnpm --filter @mizyun/memory test`, `pnpm --filter @mizyun/adapter-supabase-server test src/export-pagination.test.ts src/memory-store.test.ts src/account-repository.test.ts`, `pnpm --filter @mizyun/api test src/modules/account/routes.test.ts`. The final gate is batched once after owned source/helper edits settle. Concurrent mobile, Community/photo evidence and their status/research edits are preserved and excluded from the isolated candidate. No native/device/provider acceptance or deployment is claimed. Final isolated `pnpm check` PASS: input SHA-256 `c22dc3cdc9b72d4bda67113f5c85edcdfe43d744282e662ad9d5bad50e32f541`, mobile1759/API921/export adapters185/deployment49. Types, iOS/Android bundle checks and remaining tooling gates passed. API15 credential-gated E2E and config3 legacy bundle-path cases skipped; live-provider integration remains disabled. This source gate does not accept devices, providers or deployments.

Source commits: export`9858f2a4caf1994e2379988254e9f4600dcab47a`, journal`4cc97f8a3c614aaf4a8fe7dc8532e7443fbae9a7`, routine repair`63da6069e08e159daf33bd40be0efdca842bb2e7`. The committed source matches the stable isolated candidate; detailed redacted evidence is in [check summary](evidence/oldest-issues-batch3-2026-10-07/check-summary.json). Metadata-only evidence was appended after the passing gate and receives formatting/whitespace checks. Concurrent work was excluded, including #226 and photo/Community packages.

Next exact action: portable private-media archive/verified resource and concurrency behavior for #25/#26, running-release/dependency/authenticated readiness plus migration/recovery evidence for #23, and combined phone acceptance for #102/#139. Main push is source integration; exact Dev delivery, installed builds and Production release remain distinct.
