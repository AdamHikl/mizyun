# Latest Dev delivery — 2026-10-09

Adam authorized latest iPhone Dev installation and any needed Dev backend deployment. Delivered snapshot`537f4ae0ac6e2e253715685574b34a3ac1dc8dd6` on`codex/automatic-meal-illustrations-dev`; includes automatic meal illustrations and the settled Coach selection fixes. Original checkout/main/index and all dirty working-copy changes were preserved. No merge/main push, Production promotion, Store upload, provider activation or credential change occurred.

## Exact source and deployment

Managed clean candidate:[worktree](/Users/adam/.codex/worktrees/meal-illustrations-dev/mizyun). Baseline`0d9da8a46197f20b12f00d643851a84866368998`;74modified/untracked paths copied and byte-checked against the original before committing. Candidate installed its own frozen offline dependencies; no dependency symlinks back to changing source. Only ignored Dev mobile environment was provisioned privately. Clean exact full-SHA preflight passed. Deployment driver ran fresh`pnpm check` on the committed candidate, then pushed only its feature branch and deployed via the canonical Dev protocol. Input SHA-256`8056687f1c91517baa29150f80df891e55b62b31db2c963732554c969765785d`;1957mobile/970API PASS,15opt-in Supabase E2E tests skipped as the dedicated environment was unconfigured; both exports and all safeguard suites passed. [Preflight](evidence/meal-illustrations-dev-2026-10-09/preflight.log), [deployment summary](evidence/meal-illustrations-dev-2026-10-09/deployment-summary.log).

Remote checkout`/var/lib/mizyun/dev/repo` pristine at exact SHA; API`mizyun-api-dev.service` PID2102880/start2026-10-09T07:10:58UTC/4100. Fresh local and public`/v1/readiness` ready=true, instance`80e8a5dd-8e93-41f5-82ec-1bbd77fe557d`, exact SHA and database/Auth/Storage all true. Public health200. New capability route rejects unauthenticated requests401.

Applied migration`20261009120000_meal_illustrations.sql`; independently confirmed ledger and all three new tables with RLS=true using only metadata queries in Dev container`mizyun-dev-db`, explicitly mapped`127.0.0.1:5433`. Effective connection has no query target overrides. New generation flag absent in both Dev configuration and running process, so defaults off. No model request was made. Prior tunnel/Production authority is preserved in[prior status](archive/status/STATUS_PRE_MEAL_ILLUSTRATIONS_DEV_DELIVERY_2026-10-09.md).

## iPhone installation

Physical iPhone16Pro`00008140-001114501A86801C`; standalone Release built with the current matching snapshot bytes using`xcodebuild`, Dev environment, schemeMizyunDev and teamLQJNDVBL43. `** BUILD SUCCEEDED **`; signed bundle/Apple sign-in verification and`codesign --verify --deep --strict` passed. Bundle`com.mizyun.development`, version1.0.9/build9; standalone JavaScript bundle8412576bytes. Hashes and exact operational facts in[receipt](evidence/meal-illustrations-dev-2026-10-09/receipt.json).

`xcrun devicectl device install app --device <UDID> <MizyunDev.app>` succeeded; independent installed-app query confirms identity/version. Manual command sequence avoided the existing installer's broad port8081process kill; no shared Metro service was interrupted. [Installed identity](evidence/meal-illustrations-dev-2026-10-09/installed-app.log).

Requested launch with`--terminate-existing` failed explicitly because the device was locked. Main app process not verified; the Dev widget extension alone appeared in process search. [Actual launch failure](evidence/meal-illustrations-dev-2026-10-09/ios-launch.log). User was asked to unlock during independent deployment work; no unlock reply/state was observed before handoff. This is installation evidence, not device feature acceptance.

## Next exact action and retained gates

Unlock the iPhone and open **Mizyun Dev**. Verify automatic illustrations in Meals and Edit, real photo priority/removal, offline/reconnect and large text/VoiceOver; verify Coach selection on this candidate. Native Android, signed-in two-account/PostgREST export/erasure, provider quality/cost/privacy and current[BEFORE_TESTING](BEFORE_TESTING.md) exits remain open. Private background generation remains disabled; bundled visuals work automatically. Issue[#230](https://github.com/AdamHikl/mizyun/issues/230) stays ready/open for acceptance. No Production release is implied.

Independent High delivery review found existing target-query/Metro/launch-reporting gaps; current effective target and manual flow contained them for this run. Tracked separately in[#231](https://github.com/AdamHikl/mizyun/issues/231); no shared-infrastructure fix was added to this delivery.

Primary sources checked2026-10-09: [Apple Xcode command-line tools](https://developer.apple.com/documentation/xcode/xcode-command-line-tool-reference), [Expo local builds](https://docs.expo.dev/guides/local-app-overview/), [PostgreSQL connection parameters](https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNSTRING). Implementation source/review and SQL evidence remain in[source verification](AUTOMATIC_MEAL_ILLUSTRATIONS_EVIDENCE_2026-10-09.md).
