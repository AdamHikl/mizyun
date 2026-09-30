# Community Dev deployment and iPhone installation — 2026-09-30

Adam confirmed the exact candidate in response to the explicit Dev backend + standalone iPhone deployment question. Candidate/deployed/built source: `49d3e19f5cc0e7d0c4bc4c1fd5ff68adad651300` on `codex/community-140-145`. No application source or runtime configuration was changed during deployment. Community admission/cohort/delivery remain closed. Production remains at `0aadf95b5ff85d9cfc8bf5485e68a72525080e84`.

## Preflight and recovery point

- Clean local candidate and existing pushed ref; `pnpm deploy:dev:preflight 49d3e19f5cc0e7d0c4bc4c1fd5ff68adad651300` passes. Restricted deploy account accepts only the promotion protocol; read-only effective-target checks used `mizyun-hetzner-ops` without changing the Dev checkout.
- Hetzner marker verified; `/var/lib/mizyun/dev/repo`, `mizyun-api-dev.service`, service user `mizyun-dev-api`, API `127.0.0.1:4100`, Supabase `127.0.0.1:8100`, database container `mizyun-dev-db` exposed only at localhost5433. Installed unit hash matches candidate: `229e7ebe95e1f2072ef3cf0e3a9dd62e066f7892f388bd3747f15e14a2d9a232`.
- Independent non-author deployment review checked canonical `origin/main:scripts/promote-dev.sh` and native installer. Dev protocol has no snapshot step and rolls back code only after forward migrations; coordinator created a transaction-consistent, database-only Dev recovery snapshot under the deployment lock before promotion. No Production backup/freeze service was invoked.
- Snapshot `20260930T174102Z`: `/var/lib/mizyun/dev/predeploy-backups/dev-before-community-20260930T174102Z.dump.age`, 450095 bytes, root-owned0600 in private0700 directory. Direct `pg_dump --format=custom` stream encrypted with existing age public recipient; no plaintext dump or private recovery key on VM. SHA-256 `619c5d4ecb5ec5f9ee188566f47b3ea6bc6fd4ba2d37999db85c20fed90f57a8`. Previous Dev SHA `17766196b6e769d99913e83bdde7cbf04096db8c` and ledger recorded. This is a VM database snapshot, not off-host disaster recovery/Storage backup/restore acceptance.

## Backend evidence

`pnpm deploy:dev 49d3e19f5cc0e7d0c4bc4c1fd5ff68adad651300` **PASS, exit0**, including a fresh complete `pnpm check` on this exact candidate (mobile977/API730,15 existing gated skips; dual Hermes/typechecks/format/navigation/safeguards,56 offline invariants and26 CLI/worker tests). Canonical protocol fetched from `origin/main` at `877d1898e9205c4be19c6344e1cf1d533f4ff312`.

All14 Community migrations `20260930100000` through `20260930230000` applied and verified individually in the actual Dev ledger. Journal success `2026-09-30T17:43:28Z`; remote HEAD and `.git/mizyun-dev-sha` equal candidate; remote checkout pristine. Active Dev service restarted17:43:23 UTC, MainPID4052111. Runtime process environment binds Dev API/Supabase endpoints and all Community flags are unset/defaultfalse. Database singleton enabled/enrollment/discovery/publish/engagement/delivery allfalse, cohort_requiredtrue, cohort count0.

Public probes at17:47:18 UTC: `/v1/health`200, unauthenticated `/v1/community/profile`401 `AUTHENTICATION_REQUIRED`, `/v1/community/feed`503 `SERVICE_UNAVAILABLE` under the closed browsing gate. Matching localhost checks pass. These are health/access-negative checks, not authenticated user acceptance. The probe initially expected401 for all protected routes; it was corrected to the actual documented global-gate precedence (feed503). Remote public Python probe encountered proxy HTML; final public evidence uses Mac curl, and remote endpoint evidence uses localhost.

Read-only live REST-root service-JWT matrix at17:51:25 UTC: Dev bearer→Dev200, Production bearer→Production200, both cross-environment directions401. Existing service credentials were read only in process memory and never printed. No accounts/private data mutated or returned. Current Dev service-only `community_operations_metrics` RPC200, all five aggregate counters0; verifies new PostgREST schema availability. This proves the tested service-JWT transport boundary; actual user Auth/session/device isolation remains an original acceptance gate.

Concrete follow-up [#163](https://github.com/AdamHikl/mizyun/issues/163): the closed-operation503 body omits `error.requestId`, violating logging policy. Recorded without altering the explicitly confirmed candidate. The gate still denies browsing and has no data exposure.

## iPhone artifact and installation

`pnpm mobile:install:ios:dev --device 00008140-001114501A86801C` built a signed standalone **Release** app and installed it successfully on Adam's iPhone16Pro (iOS27.0/24A437), at `2026-09-30T17:48:46Z`. Xcode27.0/27A266a; team `LQJNDVBL43` (`itinn s.r.o.`). Bundle `com.mizyun.development`, display name Mizyun Dev, version1.0.6/build6. Artifact: `/Users/adam/Documents/mizyun/apps/mobile/ios/build/Build/Products/Release-iphoneos/MizyunDev.app`.

`codesign --verify --deep --strict` passes. Signed entitlements include Dev application identifier/team, `aps-environment=development`, HealthKit and `group.com.mizyun.development`. Embedded main bundle7089461 bytes, SHA-256 `145be91c970c0c91d77b14b734b3282990f0952482566fd4dffb0f1759dfbaec`, contains exact Dev API/Supabase/callback endpoints. No listener on8081; standalone embedded-bundle evidence is separate from verified Mac-off interaction.

**Initial automatic launch failed; subsequently opened by Adam:** installer masks launch failure while exiting0. Actual `devicectl` result is Locked, CoreDevice10002 / FBSOpenApplicationError7; main app process absent (extension presence is not main launch proof). Adam subsequently reported the app open, and a fresh `devicectl` read confirms main PID69763 from the installed artifact. This confirms process launch for this original closed candidate; signed-in Community interaction was unavailable under its gates. Do not describe the wrapper's misleading “Mobile Device Acceptance” heading as feature/device acceptance.

## Next exact action and evidence scope

Adam then explicitly requested working Dev testing and identified his Dev account. A subsequent Dev-only client/backend activation candidate is being prepared; this original candidate remains the historical deployment baseline. Perform original signed-in/privacy/two-account/device/provider/operator/legal/restore/pilot worksheets on that newer candidate. No Community worker installation, wider cohort activation, Production/Store release or human acceptance ran. #141 remains closed for local foundation; other child issues retain original gates.

Raw logs for this run: `/private/tmp/community-deploy-49d3e19/` (`deploy.log`, `dev-snapshot.log`, `postcheck.log`, `public-check.log`, `runtime-transport-check.log`, `ios-install.log`). This file preserves redacted durable results; temporary logs are supporting local artifacts.
