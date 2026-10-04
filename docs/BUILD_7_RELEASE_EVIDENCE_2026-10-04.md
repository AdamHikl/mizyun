# Build 7 release evidence — 2026-10-04

## Scope and source

Adam explicitly requested Production backend promotion and signed iOS/Android packages for1.0.7/build7. No Store upload was requested. Preparation branch:codex/production-build-7. First integrated release candidate: `d610382568ac39a0317b7edefbb272bf67fb4067`. Package-verification follow-up changes require a fresh candidate before final artifacts.

Live Production baseline:0aadf95b5ff85d9cfc8bf5485e68a72525080e84, pristine Hetzner/var/lib/mizyun/repo, activeAPI4000/PID3659946. Migration ledger contained28 versions through20260924140000; source has29 additional forward migrations. Dev source:a435a7660d85a4586224d5ac48827db651833826. On2026-10-04 Adam confirmed signed-in meal Save/reopen, workout Finish/history, Coach replies and background/reopen passed on that installed Dev app. This is user-observed Dev evidence, not exact build7 Production acceptance.

## Compatibility and safeguards

Original build6 Android source:3c20835953737604bdb03567e519b13c0823df5b; iOS:9d50538471447880b6088be03f64db90db7a07fb. Eight original contract modules matched across those sources. The new synthetic current-handler suite pins selected original schema closures/checksums, requires no historical Git objects, and covers meal CRUD/history/summary, mixed-client nutrient edits, omitted workout set type/finish/history, exercise catalog, legacy analytics/export projection and fake-provider Coach send/replay. Nine tests passed after first reproducing both old macro edits returning422. Core36 and catalog29 tests passed. This is wire/domain evidence using in-memory repositories, not live provider/device/RLS proof.

Fault harness first reproduced backup-after-checkout and incomplete migration journaling. Promotion now backs up previous code/schema, stops the API before in-place replacement and journals not_started/attempted/complete. Narrow sudoers gains only stop mizyun-api.service and start cloudflared.service; live tunnel Requires both APIs, so success/rollback explicitly restore it. Linux fixture origins advertise only known durable fixture URLs while actual local fetch remains real; invalid bundle/root and failed fetch tests remain. See ADR-0043. Independent non-author High review accepted the compatibility and promotion fixes. Fresh full gates passed on the prepared tree and exact d610382 candidate; deployment43/Hetzner operations passed. Canonical Production driver repeated the full check and disposable database verification before promotion.

## Deployment, artifacts and remaining gates

Production and Dev now run d610382, described below. Final packages are being rebuilt after correcting exported configuration verification and CI dependencies; package paths/hashes will be recorded after completion. Store uploads/approval, broader Android/native accessibility/provider/Community/lifecycle/restore exits retain their existing issue gates. Extreme legacy summary bounds are unchanged from build6 and do not establish unlimited aggregate compatibility.

## Disposable forward-upgrade rehearsal

Reset only the local Mac Supabase projectmizyun to baseline0aadf95b using its archived config/migrations (`pnpm exec supabase db reset --local --workdir /private/tmp/mizyun-build7-baseline --no-seed`). Inserted two synthetic auth users, one meal/exercise/completed workout/set in `supabase_db_mizyun` through the explicit local Docker socket. Confirmed28-version baseline ledger. `pnpm exec supabase migration up --local` applied all29 pending versions and completed at57. SQL assertions passed for unchanged meal date/name/macros/details with nullable new nutrients, unchanged completed workout/details, existing set normal default, authenticated legacy meal update, omitted-set-type insert and foreign-user RLS hiding all three personal tables. No Production/Dev data was read or copied; no remote destructive command ran. This rehearsal does not accept real Auth/Storage or physical old-app interaction.

Fresh logs: `/tmp/mizyun-build7-baseline-reset.log`, `/tmp/mizyun-build7-forward-upgrade.log`; synthetic SQL `/private/tmp/mizyun-build7-baseline-records.sql` and `/private/tmp/mizyun-build7-upgrade-assertions.sql`. Canonical `pnpm db:verify` reset/lint/32files861pgTAP assertions passed on the prepared tree; the driver reruns on the committed exact candidate before promotion.

The optional recurrence scratch runner initially failed because it cloned an already-migrated schema then reapplied non-idempotent table definitions. It now strips recurrence only in its newly created schema-only scratch before replaying the migration under permissive defaults; source/local shared/remote records are untouched. Exact rerun results are recorded separately.

## Production promotion and previous-app acceptance

Canonical Dev promotion completed on `d610382568ac39a0317b7edefbb272bf67fb4067`; pristine `/var/lib/mizyun/dev/repo`, API PID3908725, port4100/DB5433. Canonical Production promotion completed on the same exact SHA; pristine `/var/lib/mizyun/repo`, API PID3943654, tunnel PID3943657, Dev API also active. Journal2026-10-04T19:43:51Z records success, previous0aadf95b, migrationsApplied=true/migrationState=complete. Ledger has57 versions through20261004110000. Public Production/Dev health200 and Production protected Coach conversations401 observed19:45:37Z. Community rollout flags were not enabled.

Pre-promotion encrypted backup: `/srv/mizyun/backup-export/outgoing/20261004T194230Z/mizyun-production-20261004T194230Z.tar.gz.age`,4.8MB, backup unit success/exit0 and SHA256SUMS verification passed. No private records/archive were downloaded or decrypted. Adam explicitly approved only adding exact `systemctl stop mizyun-api.service` and `systemctl start cloudflared.service` permissions; original sudoers saved at `/etc/mizyun/mizyun-deployers.sudoers.pre-build7`, replacement passed visudo.

Adam subsequently confirmed the existing build6 Production app still performs meal Save/reopen, workout Finish/history and a Coach reply against the upgraded backend. This is real user-observed previous-app compatibility for those three journeys. It does not accept every build7/native/provider/Community journey or Store submission.

Fresh logs: `/tmp/mizyun-build7-dev-deploy.log`, `/tmp/mizyun-build7-production-deploy.log`. Canonical database gate passed32files/861pgTAP assertions. Recurrence scratch runner passed52SQL assertions and removed its scratch; `/tmp/mizyun-build7-recurring-db3.log`.

## Artifact attempts and release-tool follow-up

The first exact d610382 iOS attempt passed its full gate, then failed archive signing with Xcode “No Accounts” and a cached profile missing HealthKit. Adam signed in and requested retry. Second attempt failed a serialized check-runner fixture wait (15/16); independent inspection found no proven lock-safety defect, but diagnostics remain a #207 follow-up. Third attempt passed that fixture, then failed a single50ms search wall-clock benchmark (57.1ms;1408other mobile tests passed). These attempts are failures, not artifact acceptance. Logs: `/tmp/mizyun-build7-ios-package.log`, `/tmp/mizyun-build7-ios-package-retry.log`, `/tmp/mizyun-build7-ios-package-final.log`.

An intermediate d610382 AAB was successfully signed using the enrolled upload key (alias mizyun-upload, SHA1 A3:37:60:CF:83:BB:54:87:FC:71:F0:38:D4:6B:97:21:CA:A0:70:4D). Google bundletool1.18.3 validation passed; manifest com.mizyun.app1.0.7/code7, targetSDK36, debugfalse; all50arm64/x86_64 shared libraries have PT_LOAD alignment>=16KB. Intermediate artifact SHA256d33d2f572bf96bf56662d1358b043064fbe00222a7ef4b0d42facd26123d781b. It predates the new exported endpoint metadata and is superseded by the final candidate package; do not treat it as the final shipping handoff.

Production JS contains legitimate dormant Dev endpoint literals in Community admission guards. The former iOS rejection of any Dev URL would falsely reject this app. Follow-up validates exported EXConstants.bundle/app.config identity, Production profile/variant,1.0.7/7/7 tuple and exact public API/Supabase/callback settings; retains runtime Production URL presence and Apple signing/entitlement safeguards. Synthetic positive and18 exported-config failure cases pass. CI also needs explicit ripgrep installation after run37228715070 passed43Linux deployment tests but failed missing rg in the iOS tooling fixture. Search benchmark measurements focused median8.865ms support repeated warmed batches retaining the50ms budget.
