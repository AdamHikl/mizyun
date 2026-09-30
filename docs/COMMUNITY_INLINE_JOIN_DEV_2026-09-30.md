# Joining inside Community — Dev evidence, 2026-09-30

Adam requests joining directly inside the Community tab. Baseline `2b1e0ead461413c28d098b39ef8d441c5a289a52`, initial tree clean, branch `codex/community-140-145`, #142/#150. Prior navigation source `9112498d457218f9b96b64bf21d97a0052abab65` was installed and Adam confirmed Community tab and Account/Back. That confirmation does not accept this new joining candidate.

## Implemented

The tab hosts the existing enrollment/profile form, including separate social identity, deliberate adult declaration/current rules consent, validation, exact Dev/client admission and server authority. No automatic joining, private-profile copying, notification permission, follow or workout sharing. Private tracking remains reachable. The standalone `/community/settings` and Account privacy entry remain available for management.

The embedded form omits root Stack overrides and unrelated Account/member shortcuts, preserves keyboard avoidance, and adds tab bottom clearance. Current-principal remounts retain isolation. Successful enrollment or a status read recovering active membership after a lost response triggers fresh parent membership verification before showing the feed. Existing focus/foreground and late-result guards remain.

## Review and automatic verification

Helper owns only embedded form and four tests; coordinator owns feed integration and ten feed screen tests, documentation, commits and native resources. Independent non-author review found the lost-response recovery transition issue; corrected ready/active membership notification passed re-review with no source blockers. Coordinator inspected actual source. Reviewer focused checks: five files/61 tests PASS; coordinator focused four files/39 tests PASS. Controlled render tests mock React hooks/effects and do not prove mounted/native interaction. Actual profile/feed controller tests supplement them. Fresh settled-source `pnpm check` PASS, exit0: mobile1011/API730 with15 existing policy/credential-gated API skips; typechecks, dual Hermes exports, formatting/navigation, safeguards/offline/Community operations and7 Dev Apple capability checks pass. Log `/private/tmp/community-inline-join-pnpm-check.log` is ephemeral; this record is durable qualified evidence. No runtime writes after the gate began. Source `94ec5fcc237c3895b2efcfdec35955fadf45b28c` committed/pushed; tree clean before native build. Only documentation changed afterward.

## Exact Dev iPhone installation

`pnpm mobile:install:ios:dev --device 00008140-001114501A86801C --no-launch` succeeds: BUILD SUCCEEDED and installed at2026-09-30T20:05:36Z (22:05:36 Europe/Bratislava), source94ec5fc. Signed standalone Release `com.mizyun.development`1.0.6(6), teamLQJNDVBL43, Adam’s iPhone16Pro. Actual elevated `codesign --verify --deep --strict` and `node scripts/verify-ios-apple-auth.mjs --signed <app>` pass; initial sandbox verification could not access signing trust, and a wrong verifier mode was corrected. Embedded bundle7094841bytes SHA256 `d17398ea2be1e78de21d97f636910d100d9fb6530a843349f78626a3adf04490`; exact Dev API/Auth/callback strings present. Artifact `apps/mobile/ios/build/Build/Products/Release-iphoneos/MizyunDev.app`; install log `/private/tmp/community-inline-join-dev-install.log` is ephemeral.

Explicit console launch is blocked by locked iPhone (CoreDevice10002/FBS Locked). Installation/signature does not prove joining, visible layout, runtime monitoring or feature acceptance. Unlock and open Mizyun Dev to test.

## Targets and remaining acceptance

Client-only change; Dev backend remains `282d740d93b338fb508cbad2a8fa27f5a605b9c8`, delivery off, cohort unchanged. No backend deployment, database/schema mutation, Production operation, main merge or Store action. Exact authorized iPhone target is `00008140-001114501A86801C`, bundle `com.mizyun.development`, version1.0.6(6); elevated exact-device dry-run succeeds.

Pending physical acceptance: Community tab → fill social identity and unchecked declarations → deliberate Join → feed; restart/profile persistence, decline, error/retry, keyboard/large text/VoiceOver, rejoin and leave. Workout preview/publish/unpublish and partner/both-platform/operator/legal/restore/push/pilot gates remain separate. Do not delete Adam’s main account or admit another principal without separate authorization. Issues remain open until original exits are satisfied.
