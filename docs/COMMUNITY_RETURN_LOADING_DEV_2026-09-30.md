# Community return loading flash — Dev evidence, 2026-09-30

## Report and acceptance observed

Adam confirms deliberate joining succeeded on installed source `ed7a3624de7d40cb12f83a54868bcd27ecc41a6f`, then reports a half-second loading indicator on every return to Community. Earlier direct confirmation: Keep tracking privately opens Home and returning still shows joining form. These accept only the exercised private-exit and joining interactions; profile persistence/sharing/accessibility remain separate.

Sanitized Dev API logs corroborate enrollment POST201, requestIdreq-8x at2026-09-30T21:02:29.453Z (23:02:29 Europe/Bratislava),191.99ms, followed by successful Community GETs. No profile fields, tokens, request bodies or invitation secrets were captured. Device console mainPID70536 and Dev API metadata-only streams monitored; earlier console disconnect is connection invalidation, not crash proof. Process/HTTP results do not establish pixels or full journeys.

## Defect and correction (#165)

Clean baseline `e014f78f6ac499760984773862ac3c9b6d8cd9b5`, branch `codex/community-140-145`. Focus revalidation replaces whole hub with spinner, then automatic feed refresh also marks RefreshControl refreshing. Delayed refocus/foreground regressions fail on baseline before correction.

Keep a per-principal presentation-only marker after a verified enrolled hub. During refocus/foreground membership checks, retain generic navigation/sharing guidance without displaying protected cards, empty-feed claims or automatic spinners. Membership is still read every time; feed controller pause/clear, account remount and late-result checks are unchanged. Actual withdrawal/denial/error replaces shell with joining/status recovery. Explicit membershipVerified-and-enrolled data gate prevents stale mocked or real cards from appearing.

Manual pull-to-refresh alone drives the top refresh indicator; blur/background/revalidation and guarded finally reset it. Initial never-verified joining state can show loading; user-requested pagination remains distinct. No protected data or admission is cached by the marker.

Coordinator owns source/tests/docs/issues/native resources; read-only helper independently reviewed permission/visibility behavior and approved with no blockers. Focused `pnpm --filter @mizyun/mobile exec vitest run` feed screen/controller/profile:56tests/3files PASS, mobile typecheck PASS. Reviewer invocation ran all mobile:1022tests/92files PASS. Screen fixtures simulate hooks, not mounted/native layout; actual controller tests complement them. Fresh settled-source `pnpm check` PASS, exit0: mobile1022/API730 with15 existing policy/credential-gated API skips, dual Hermes/typechecks/navigation/formatting/safeguards/offline/Community operations and7 Dev Apple capability checks. Log `/private/tmp/community-return-loading-pnpm-check.log` is ephemeral; this is durable qualified evidence. No runtime changes after gate began; Source `40a7190c72b68a688295ee8327bb057aaac18755` committed/pushed; tree clean before build. Only evidence documentation changed afterward.

## Exact Dev iPhone installation

`pnpm mobile:install:ios:dev --device 00008140-001114501A86801C --no-launch` BUILD SUCCEEDED and installed at2026-09-30T21:11:54Z (23:11:54 Europe/Bratislava), source40a7190. Signed standalone Release `com.mizyun.development`1.0.6(6), teamLQJNDVBL43, Adam’s iPhone16Pro. Actual `codesign --verify --deep --strict` and signed Apple capability guard pass. Embedded main.jsbundle7102145bytes SHA256 `da276619b0beb41fcecc752c57f4f550d183a603d8b65168c5f5934955e2f77a`; exact Dev API/Auth/callback present. Artifact `apps/mobile/ios/build/Build/Products/Release-iphoneos/MizyunDev.app`; ephemeral install log `/private/tmp/community-return-loading-dev-install.log`.

Console launch succeeds at21:12:15Z, mainPID70771, monitoring attached; process/startup only. Adam explicitly confirms “No flash; pull-to-refresh works” on this candidate. This accepts the reported return indicator defect and deliberate refresh only; broader offline/background/accessibility/account-switch journeys remain under original Community acceptance. No backend deployment is needed.

## Scope and remaining work

DEV ONLY client change. Backend remains282d740, cohort unchanged, deliveryoff. No schema/config/backend deployment, Production operation, main merge or Store submission. #165’s reported flash and manual-refresh device acceptance are satisfied by Adam’s exact-candidate confirmation, with independent source/controller checks preserving fresh-read guards. Background/denied/offline/account-switch full-journey acceptance stays under the original Community packages. #142/#150/#155 original partner/platform/operator/legal/restore/push/pilot gates remain separate. Do not delete Adam’s main account or admit another principal without authorization.
