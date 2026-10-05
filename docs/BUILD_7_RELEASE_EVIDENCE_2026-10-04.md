# Build 7 release evidence — 2026-10-04

## Scope and source

Adam explicitly requested Production backend promotion and signed iOS/Android packages for1.0.7/build7. No Store upload was requested. Preparation branch:codex/production-build-7. First integrated release candidate: `d610382568ac39a0317b7edefbb272bf67fb4067`. Final frozen package/backend source: `9b0c41acbb7e4ee70592cab40b6148fc76a393ed`. Later documentation commits do not change the package source.

Live Production baseline:0aadf95b5ff85d9cfc8bf5485e68a72525080e84, pristine Hetzner/var/lib/mizyun/repo, activeAPI4000/PID3659946. Migration ledger contained28 versions through20260924140000; source has29 additional forward migrations. Dev source:a435a7660d85a4586224d5ac48827db651833826. On2026-10-04 Adam confirmed signed-in meal Save/reopen, workout Finish/history, Coach replies and background/reopen passed on that installed Dev app. This is user-observed Dev evidence, not exact build7 Production acceptance.

## Compatibility and safeguards

Original build6 Android source:3c20835953737604bdb03567e519b13c0823df5b; iOS:9d50538471447880b6088be03f64db90db7a07fb. Eight original contract modules matched across those sources. The new synthetic current-handler suite pins selected original schema closures/checksums, requires no historical Git objects, and covers meal CRUD/history/summary, mixed-client nutrient edits, omitted workout set type/finish/history, exercise catalog, legacy analytics/export projection and fake-provider Coach send/replay. Nine tests passed after first reproducing both old macro edits returning422. Core36 and catalog29 tests passed. This is wire/domain evidence using in-memory repositories, not live provider/device/RLS proof.

Fault harness first reproduced backup-after-checkout and incomplete migration journaling. Promotion now backs up previous code/schema, stops the API before in-place replacement and journals not_started/attempted/complete. Narrow sudoers gains only stop mizyun-api.service and start cloudflared.service; live tunnel Requires both APIs, so success/rollback explicitly restore it. Linux fixture origins advertise only known durable fixture URLs while actual local fetch remains real; invalid bundle/root and failed fetch tests remain. See ADR-0043. Independent non-author High review accepted the compatibility and promotion fixes. Fresh full gates passed on the prepared tree and exact d610382 candidate; deployment43/Hetzner operations passed. Canonical Production driver repeated the full check and disposable database verification before promotion.

## Deployment, artifacts and remaining gates

Initial Production/Dev promotion was d610382. Final canonical promotions and signed packages use9b0c41a, recorded below; package configuration, CI dependencies and the reproduced runner issue are resolved. Store uploads/approval, broader Android/native accessibility/provider/Community/lifecycle/restore exits retain their existing issue gates. Extreme legacy summary bounds are unchanged from build6 and do not establish unlimited aggregate compatibility.

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

## Release-runner correction — 2026-10-05

Corrected package-tool source `5ededf293da5a1a66dda6283edc333de9c3c61b4` passed fresh Mac full gate (input6310bdae5e2d1c69017fb79da59729631342300dc67015cf6178d8864015f9b2), [quality CI37231137566](https://github.com/AdamHikl/mizyun/actions/runs/37231137566) and [navigation CI37231137580](https://github.com/AdamHikl/mizyun/actions/runs/37231137580). Existing hosted db-push-dev workflow failure remains #23 and does not represent canonical Hetzner promotion.

Its isolated iOS attempt again failed the check-runner descendant fixture before signing (`/tmp/mizyun-build7-ios-package-corrected.log`). Added diagnostics reproduced `kill EPERM`, first exit143 retaining the lock, waiter exit1 stale-owner; immediate successful ps showed no members after descendant-end. Transcript `/tmp/mizyun-check-runner-group-probe.log`. Minimal correction requires successful existing member inspection on EPERM, accepts only no-live-member groups, and retains lock on live/unknown inspection. Four deterministic regressions and20consecutive real descendant fixtures passed; complete focused runner20/20. `/tmp/mizyun-check-runner-fixed-repeat.log`. Independent non-author High review approved; fresh full gate passed(input458053607a2e1fce1b8cd3a3edd3e8f693765faa44832c55f8b25ff084baf362). Commit9b0c41a froze the correction. Its subsequent canonical iOS full gate, archive and export succeeded with the refreshed account.

## Final release delivery — 2026-10-05

Frozen source: `9b0c41acbb7e4ee70592cab40b6148fc76a393ed`, clean accepted ancestor of origin/main. [Quality CI37268921317](https://github.com/AdamHikl/mizyun/actions/runs/37268921317) and [navigation CI37268921203](https://github.com/AdamHikl/mizyun/actions/runs/37268921203) passed. Fresh canonical Dev and Production full gates passed; Production inputc0dfefc9eb0a8a9f0271793e5a115b943767689e6e837fe3865190d2e7e28e38 and disposable database32files/861assertionsPASS. #199 is closed after exact Linux/Mac acceptance; #207 includes the independently reviewed runner correction. Existing hosted DB workflow #23 remains separate.

Dev journal05:58:03Z and Production journal06:03:18Z record success from previousd610382 to target9b0c41a; Production migrationState=complete. Both repositories are pristine. Dev API PID2372619/WorkingDirectory `/var/lib/mizyun/dev/repo`; Production PID2401543/WorkingDirectory `/var/lib/mizyun/repo`; cloudflaredPID2401546 active. Both actual DB ledgers remain57/max20261004110000; no additional migration was needed. Final public health200 for both hosts and protected Production Coach conversations401. Fresh encrypted backup `/srv/mizyun/backup-export/outgoing/20261005T060157Z/mizyun-production-20261005T060157Z.tar.gz.age`,5129987bytes, backup unit success/exit0, SHA256SUMS verified. No private data/archive were downloaded or decrypted.

`git diff d610382568ac39a0317b7edefbb272bf67fb4067 9b0c41acbb7e4ee70592cab40b6148fc76a393ed -- apps/api packages supabase/migrations` is empty. The final backend therefore preserves the exact API/packages/schema source accepted with the user-observed build6 core journeys. Those observations remain scoped to meal Save/reopen, workout Finish/history and a Coach reply; they are not new build7 physical-device or broader compatibility proof.

Fresh final logs: `/tmp/mizyun-build7-ios-package-final-candidate.log`, `/tmp/mizyun-build7-final-android-prebuild.log`, `/tmp/mizyun-build7-final-android-bundle.log`, `/tmp/mizyun-build7-final-android-sign.log`, `/tmp/mizyun-build7-final-dev-deploy.log`, `/tmp/mizyun-build7-final-production-deploy.log`.

### iOS Production IPA

- Version1.0.7/build7, com.mizyun.app, teamLQJNDVBL43; Xcode27.0/build27A266a. Canonical fresh isolated prebuild/full gate/archive/AppStoreConnect export and final verification passed.
- IPA `apps/mobile/dist/releases/ios/app-store/packages/1.0.7-7-9b0c41acbb7e4ee70592cab40b6148fc76a393ed-20261005T054945Z/Mizyun-1.0.7-7-9b0c41acbb7e4ee70592cab40b6148fc76a393ed-20261005T054945Z.ipa`: SHA256 `330eaf5037be96d8ba0476d5187719454d969431c177a385363769661f5fbf36`.
- Immutable manifest `apps/mobile/dist/releases/ios/app-store/packages/1.0.7-7-9b0c41acbb7e4ee70592cab40b6148fc76a393ed-20261005T054945Z/manifest.json`, supplementalverification.json and matching archive/dSYMs retained under `apps/mobile/dist/releases/ios/app-store/archives/Mizyun-1.0.7-7-9b0c41acbb7e4ee70592cab40b6148fc76a393ed-20261005T054945Z.xcarchive`.
- Cloud Managed Apple Distribution certificateSHA1E429BA7A349C5A8EDBD11536025213A196A4E1F9, expiry2027-09-14. Actual signed application identifierLQJNDVBL43.com.mizyun.app, HealthKit=true, APNsproduction, AppleSignInDefault, getTaskAllow=false. Actual exported Expo profile/variant/version/API/Supabase/callback validated. App and dSYM UUID83D4AB60-EEF1-3092-AFB5-9402B8AF8A9F match.
- Local signing/config checks passed at handoff, but Adam's subsequent manual Transporter upload was rejected90683 for missing NSHealthUpdateUsageDescription. This IPA is superseded; no Store acceptance is claimed. No upload by the agent occurred.

### Android Production AAB

- Version1.0.7/code7, com.mizyun.app, targetSDK36/debugfalse; canonical fresh Production prebuild and bundleRelease3m51s/681tasks succeeded, then signer/jarsigner/enrolled certificate validation passed.
- AAB `apps/mobile/dist/releases/android/google-play/Mizyun-1.0.7-code7-9b0c41acbb7e4ee70592cab40b6148fc76a393ed.aab`:79815393bytes, SHA256 `e2b3db2f443e8544a67205360377318ee9ff59bc387eced46015c11b52d1efa1`.
- Immutable artifact/provenance manifest `apps/mobile/dist/releases/android/google-play/Mizyun-1.0.7-code7-9b0c41acbb7e4ee70592cab40b6148fc76a393ed.manifest.json`. Upload aliasmizyun-upload, enrolledSHA1A3:37:60:CF:83:BB:54:87:FC:71:F0:38:D4:6B:97:21:CA:A0:70:4D.
- Independent Google bundletool1.18.3 validation passed; dumped manifest and actual `base/assets/app.config` verify Production identity/profile/tuple/API/Supabase/callback. All50arm64/x86_64shared libraries have PT_LOAD alignment>=16384 and bundle config is PAGE_ALIGNMENT_16K. Intermediate d610382 artifact is superseded; preserved final output was not overwritten.
- Ready for manual GooglePlayConsole upload. No Play upload or rollout occurred.

Store-delivered build7 device acceptance, accessibility/network/provider/Community/lifecycle and operational/restore exits retain #27/#32 and their owning issue gates. The package handoff does not close those broader exits or claim Store approval.

## Transporter90683 correction — 2026-10-05

Adam reported Transporter rejection IDROHBOA2Z2KXYEZ7UARKGQTMYCU for missing NSHealthUpdateUsageDescription. Fresh inspection of the preserved IPA above reproduces the missing key; the read description is present. Current native HealthKit module requests read-only stepCount with an empty share set. Fix the generated Info.plist source with truthful optional-step/no-write text and validate both descriptions in the exported IPA before publication. Preserve1.0.7/7/7. Replacement signing/export and manual Transporter retry are pending; original signing success did not prove Store privacy validation. Backend/API/schema and Android output require no change for this iOS metadata correction.
