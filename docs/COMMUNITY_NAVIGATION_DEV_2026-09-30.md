# Community primary navigation — Dev evidence, 2026-09-30

## Scope and source

Adam explicitly approved the proposed navigation: Home / Workouts / Meals / Coach / Community, with Account in the main screen headers. Source candidate `9112498d457218f9b96b64bf21d97a0052abab65` is pushed on `codex/community-140-145`; remote head matched local, tree clean before build. Baseline `0ac0371eb4900a19e77afb7e531d83e5f3b1e3fe`; initial tree clean. [ADR-0031](adr/0031-community-tab-account-header.md) records the decision. This segment is Dev only. No main merge, Production operation, backend deploy/config/restart, schema/data mutation, new account admission or Store action.

## Implemented behavior

- Existing `/community` feed is now the fifth tab; private Home remains the default. Account moves from the tab group to root Stack at unchanged `/settings`, preserving existing settings/deep links and root Back to the presenting tab.
- Each main screen has a local readonly initials/avatar Account button with a 48-point target and accessible label. Feedback remains reachable. Account spacing follows its new root Stack header.
- Community home groups Find friends, Requests, Inbox and My profile/settings. Nonparticipants get an explanation, deliberate Join route and Keep tracking privately. Opening the tab does not enroll, request push permission, follow, publish or copy private profile fields into a social profile. Profile loading/errors never imply participation.
- Retained tab focus/foreground refreshes membership before feed data; feed clears/hides while checking. Join/leave in settings is reflected on return. Revision/focus/foreground guards prevent late results restoring hidden content. Web layout clears its existing top tab bar. Sharing stays explicit at the saved workout.

## Verification and review

Coordinator owns routes, shared header, primary-screen integration, documentation/GitHub/build/install. Helper owns only feed screen/tests. Independent non-author reviewer found the retained-tab stale membership issue, reviewed the corrected diff and approved it with no remaining source blockers. Coordinator inspected actual settled source.

Initial rendered navigation checks failed for missing private exit/Inbox before the screen changes. Final tests include controlled join/leave elsewhere→refocus, background return and late read after leaving. Hook/render fixtures prove isolated behavior; actual feed/profile controller tests supplement permission-loss behavior and are not physical integration acceptance.

Fresh settled-source `pnpm check` **PASS, exit0**: mobile1006/API730 tests pass, API15 existing policy/credential-gated skips; typechecks, both Hermes exports, navigation, formatting, safeguards, offline invariants, Community operations and Dev Apple capability regressions pass. Independent focused `pnpm --filter @mizyun/mobile exec vitest run src/features/community/feed/feed-screen.test.tsx src/features/community/feed/controller.test.ts src/features/community/use-community-profile.test.ts` passes50tests/3files. Coordinator focused Account/feed/settings check passed202tests before the final four focus/foreground regressions; final full gate includes them. Header test2 and final mobile typecheck pass. Final documentation-only formatting/navigation and `git diff --check` pass. No fresh SQL/provider acceptance claimed. Local full log `/private/tmp/community-navigation-pnpm-check.log` is ephemeral; this record is durable qualified evidence.

## Dev iPhone installation

`pnpm mobile:install:ios:dev --device 00008140-001114501A86801C --no-launch` **BUILD SUCCEEDED**, install succeeded at2026-09-30T19:46:37Z (21:46:37 Europe/Bratislava). Exact clean source9112498; no runtime source changed afterward. Signed standalone Release `com.mizyun.development`, version1.0.6/build6, teamLQJNDVBL43, Adam's iPhone16Pro, Xcode27.0. Artifact `/Users/adam/Documents/mizyun/apps/mobile/ios/build/Build/Products/Release-iphoneos/MizyunDev.app`.

Actual `codesign --verify --deep --strict` and signed Apple Default-capability guard pass. Embedded main.jsbundle7094714bytes, SHA256 `be68134747490eb809379a0a86a2f36e0f388ee2f0ae5709af8e938924b3580d`; exact Dev API/Auth/callback are present. Explicit launch with console succeeds at19:47:17Z, mainPID70440. Console monitoring proves process/startup only, not visible navigation or VoiceOver. No Production app installed or touched. Dev backend remains282d740d93b338fb508cbad2a8fa27f5a605b9c8; prior activation/cohort/delivery evidence stays qualified in its original record.

## Remaining device and pilot acceptance

Adam explicitly confirmed “Community tab and Account/Back work” on the installed candidate. This accepts the visible Community entry and exercised Account/Back path only; no result was supplied for every originating tab, voluntary Join/private exit, membership after join/leave, narrow-screen/large-text/VoiceOver, offline/background or cold/warm deep links. These remain to test. Android and broader Community/pilot/provider/operator/contact/legal/restore/push gates remain unaccepted; #150/#137/#155 are not closed by source tests or installation. Partner identity still requires separate authorization. Adam's prior Apple sheet/login success belongs to #164; returning-user login remains separate. Do not delete Adam's main account.
