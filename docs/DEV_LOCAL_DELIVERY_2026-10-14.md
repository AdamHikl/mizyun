# Matching Dev backend and iPhone delivery — 2026-10-14

## Current outcome

Hetzner Dev now runs accepted commit **`d7e2055b260552c785325414756c6beeea1b7d8c`**. Its matching standalone Mizyun Dev **1.0.9 (9)** is signed and installed on Adam's iPhone 16 Pro (`00008140-001114501A86801C`). Launch is currently blocked because iOS reports the phone is locked; unlock was requested. No signed-in native journey is accepted.

This supersedes the installed source in the [initial October 14 receipt](DEV_IPHONE_LOCAL_DELIVERY_2026-10-14.md), which predates the two local-erasure repairs. The original signed artifact remains retained separately.

## Accepted source and gates

The concurrent source-delivery chat completed five commits and a normal push to main. The coordinator inspected the actual two mobile repair diffs and the [independent integration/repair review](evidence/all-local-separate-commits-2026-10-14/integration-review.txt). Backend runtime, deployment safeguards and the three migrations stayed byte-identical to the initial verified snapshot. Source-only integration acceptance is recorded in [the Git delivery](ALL_LOCAL_SEPARATE_COMMITS_2026-10-14.md).

The owned isolated copy `/private/tmp/mizyun-iphone-dev-20261014` was advanced to the accepted commit after archiving its original 2,335-file source at `/private/tmp/mizyun-iphone-dev-source-original-20261014.tar.gz`. The clean candidate's **2,345 tracked files** matched the pushed primary source. Dependencies and previously verified Dev native scaffolding were retained; source hashes stayed unchanged after the final native build. [Accepted source manifest](evidence/dev-local-delivery-2026-10-14/candidate-manifest.json).

Fresh fetched `origin/main` and deployment protocol correspondence passed. `pnpm deploy:dev:preflight d7e2055b260552c785325414756c6beeea1b7d8c` passed clean candidate, pushed commit, canonical Hetzner host marker and public health. The canonical deployment driver reran `pnpm check` on that exact commit: **PASS**, input SHA-256 `241ce85e487d2b3cf3ba0231f4a056ea94a4b5695b99742f0cc3a02161c15e6a`, **2,584 mobile / 1,109 API tests passed**, 15 existing credential-gated API skips. Type/bundle/privacy/format/navigation and required tooling checks passed. [Deployment summary](evidence/dev-local-delivery-2026-10-14/deployment-summary.txt). Full local log: `/private/tmp/mizyun-dev-deployment-20261014.log`.

A fresh independent Sol High reviewer found no deployment-safeguard blocker. Coordinator operations evidence confirmed the root-owned unique host marker, pristine Dev checkout, matching service template, service user/path, effective API4100/Supabase8100/DB5433, no libpq target overrides and default-off recipe switch. The driver used the restricted Dev deployment account and canonical promotion protocol; only coordinator operations performed deployment and remote reads.

## Backend proof

- Canonical target: `/var/lib/mizyun/dev/repo`, `mizyun-api-dev.service`, API4100, database `127.0.0.1:5433/postgres`. Public Dev API/Supabase hostnames and founder/partner shared-Gemini exception were preserved.
- All three pending forward migrations applied: `20261012120000_community_meal_sharing.sql`, `20261013090000_recipe_request_reservations.sql`, `20261013120000_recurring_meal_suggestions.sql`. The actual ledger now has **72 versions** through `20261013120000`; exact remote source hashes match the accepted files. Ledger versions are not claimed as checksum evidence.
- Public `/v1/health` returned HTTP200. Public `/v1/readiness` reports `ready:true`, exact SHA above, new instance `18957f89-8be1-48be-8c11-43989331fd31`, and Database/Auth/Storage all true. Service PID **3388709**; remote checkout remains clean. SHA marker and successful release journal agree.
- Metadata checks confirm RLS and a user-ID index on all four new recipe/suggestion tables. Recipe capabilities and routine suggestions reject unauthenticated requests with HTTP401. These checks do not establish real two-account RLS/Storage isolation or feature journeys.
- Effective `MIZYUN_MEAL_RECIPES_ENABLED` remains unset, so live recipes stay disabled. Existing `AI_EXTERNAL_ACCESS=true` was preserved. No provider request, new credential, infrastructure configuration change, Production operation or Store upload was performed.

[Preflight](evidence/dev-local-delivery-2026-10-14/backend-preflight.json), [postflight/journal/migration hashes](evidence/dev-local-delivery-2026-10-14/backend-postflight.json), [before](evidence/dev-local-delivery-2026-10-14/readiness-before.json) and [after readiness](evidence/dev-local-delivery-2026-10-14/readiness-after.json) contain redacted operational proof.

## iPhone proof and remaining action

The accepted commit compiled in Release with team `LQJNDVBL43`. Main app, Watch and widget all use the Dev identities and 1.0.9(9). Signed Apple sign-in, deep strict signatures and embedded public Dev endpoints/callback passed. The new Hermes bundle differs from the initial installation and includes the reviewed erasure repair. No Metro process was terminated.

Retained artifact: `apps/mobile/dist/releases/ios/device/2026-10-14-main-d7e2055b-dev-1.0.9-9/MizyunDev.app`. A transient CoreDevice developer-disk metadata failure resolved on install retry. Installation succeeded. Launch first timed out; the reconnect attempt returned explicit `Locked`. [Native receipt](evidence/dev-local-delivery-2026-10-14/native-delivery.json).

Next: unlock the iPhone for positive launch/process verification, then accept signed-in feature, offline/restart/account, accessibility and paired Watch journeys separately. Qualified nutrition/food-safety and provider/privacy/cost gates remain open; live recipes remain disabled. Forward migrations persist if code rolls back, and previous-code compatibility after new meal/suggestion writes is unproven: use containment/forward repair if needed. Production/Store acceptance remains separate.

These delivery receipts and continuity updates are post-check documentation outside the immutable tested candidate; applicable formatting/navigation checks are performed separately. No new source commit is implied by these operational records.
