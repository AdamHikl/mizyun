# Build 7 release evidence — 2026-10-04

## Scope and source

Adam explicitly requested Production backend promotion and signed iOS/Android packages for1.0.7/build7. No Store upload was requested. Preparation branch:codex/production-build-7. Candidate SHA is recorded after integration.

Live Production baseline:0aadf95b5ff85d9cfc8bf5485e68a72525080e84, pristine Hetzner/var/lib/mizyun/repo, activeAPI4000/PID3659946. Migration ledger contained28 versions through20260924140000; source has29 additional forward migrations. Dev source:a435a7660d85a4586224d5ac48827db651833826. On2026-10-04 Adam confirmed signed-in meal Save/reopen, workout Finish/history, Coach replies and background/reopen passed on that installed Dev app. This is user-observed Dev evidence, not exact build7 Production acceptance.

## Compatibility and safeguards

Original build6 Android source:3c20835953737604bdb03567e519b13c0823df5b; iOS:9d50538471447880b6088be03f64db90db7a07fb. Eight original contract modules matched across those sources. The new synthetic current-handler suite pins selected original schema closures/checksums, requires no historical Git objects, and covers meal CRUD/history/summary, mixed-client nutrient edits, omitted workout set type/finish/history, exercise catalog, legacy analytics/export projection and fake-provider Coach send/replay. Nine tests passed after first reproducing both old macro edits returning422. Core36 and catalog29 tests passed. This is wire/domain evidence using in-memory repositories, not live provider/device/RLS proof.

Fault harness first reproduced backup-after-checkout and incomplete migration journaling. Promotion now backs up previous code/schema, stops the API before in-place replacement and journals not_started/attempted/complete. Narrow sudoers gains only stop mizyun-api.service and start cloudflared.service; live tunnel Requires both APIs, so success/rollback explicitly restore it. Linux fixture origins advertise only known durable fixture URLs while actual local fetch remains real; invalid bundle/root and failed fetch tests remain. See ADR-0043. Independent review and final full gate are pending. Focused deployment43/Hetzner operations passed.

## Deployment, artifacts and remaining gates

Record exact candidate, local database upgrade/full suite, Dev promotion, Production backup/journal/migration/runtime state, artifact signing/embedded tuple/endpoints/hash and package paths here. Store uploads/approval, broader Android/native accessibility/provider/Community/lifecycle/restore exits retain their existing issue gates. Extreme legacy summary bounds are unchanged from build6 and do not establish unlimited aggregate compatibility.

## Disposable forward-upgrade rehearsal

Reset only the local Mac Supabase projectmizyun to baseline0aadf95b using its archived config/migrations (`pnpm exec supabase db reset --local --workdir /private/tmp/mizyun-build7-baseline --no-seed`). Inserted two synthetic auth users, one meal/exercise/completed workout/set in `supabase_db_mizyun` through the explicit local Docker socket. Confirmed28-version baseline ledger. `pnpm exec supabase migration up --local` applied all29 pending versions and completed at57. SQL assertions passed for unchanged meal date/name/macros/details with nullable new nutrients, unchanged completed workout/details, existing set normal default, authenticated legacy meal update, omitted-set-type insert and foreign-user RLS hiding all three personal tables. No Production/Dev data was read or copied; no remote destructive command ran. This rehearsal does not accept real Auth/Storage or physical old-app interaction.

Fresh logs: `/tmp/mizyun-build7-baseline-reset.log`, `/tmp/mizyun-build7-forward-upgrade.log`; synthetic SQL `/private/tmp/mizyun-build7-baseline-records.sql` and `/private/tmp/mizyun-build7-upgrade-assertions.sql`. Canonical `pnpm db:verify` reset/lint/32files861pgTAP assertions passed on the prepared tree; the driver reruns on the committed exact candidate before promotion.

The optional recurrence scratch runner initially failed because it cloned an already-migrated schema then reapplied non-idempotent table definitions. It now strips recurrence only in its newly created schema-only scratch before replaying the migration under permissive defaults; source/local shared/remote records are untouched. Exact rerun results are recorded separately.
