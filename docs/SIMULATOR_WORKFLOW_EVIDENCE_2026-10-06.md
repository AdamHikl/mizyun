# Repeatable Dev simulator workflow — 2026-10-06

Tracking [#214](https://github.com/AdamHikl/mizyun/issues/214). User requested learning from simulator failures and a reusable script/skill. Base `f40e8941afc5307efce6d5c5909c0146ed1f3dda`; app implementation unchanged. Pre-existing Build9 evidence/status and physical-install evidence preserved.

## Delivered

- [Project skill](../.agents/skills/test-ios-simulator/SKILL.md), native-control/scenario reference and UI metadata. Discoverable as `$test-ios-simulator`.
- `pnpm mobile:simulator:ios doctor|serve|launch`: Dev-only configuration, pinned iOS UUID, explicit task port, native identity/platform/manifest/signature checks, foreground owned Metro, checked install/relaunch and digest-based warm reuse. No provisioning/credential typing, erase, persistent defaults writes or unidentified process killing. Cached identity/routing checks are not all-native compatibility proof: skill requires recorded native path/input hashes and flags before reuse.
- Generic simulator tutorial now routes Hetzner Dev testing to this workflow. Feature ownership and13-regression command are part of navigation/full checks.

## Failures converted into guidance

Prior UI review: Debug virtual-env Production routing despite Dev shell/manifest; ineffective development-client deep link for bare Debug binary; stale/compact DeviceHub window control; offscreen AX taps landing on workout overlay; clipboard insertion mismatch; unsafe restart with open draft; live-versus-cold font attribution. The skill supplies exact setup, visible-target/current-AX controls, setValue/verification, bounded window recovery, saved/closed lifecycle rules and qualified feature scenarios. It does not recreate the historical dotenv override.

Independent High forward-review resolved missing Metro attachment proof, overclaimed native compatibility, shared build paths, newly added native-file inventory and fail-fast inner shell. Final source review clear; independent13/13 tests passed.

Real validation found two additional defects in the initial recipe: CI1 disabled Metro watch; unsigned CODE_SIGNING_ALLOWED=NO rendered but SecureStore raised KeyChain missing-entitlement errors. Final helper forces CI0 and rejects invalid/unsigned artifacts; recipe uses ad-hoc CODE_SIGNING_ALLOWED=YES/CODE_SIGN_IDENTITY=-. No secure-storage bypass or app/Auth change.

## Current evidence

- Helper13/13 tests passed in normal host context: actual occupied IPv4 port refusal, invalid targets/ports/options, inherited/local Production dotenv exclusion, private dotenv exclusion, mismatched Dev routes before native work, read-only doctor, unavailable/non-iOS target, wrong native platform/identity, stale routing, missing Metro, stale installed binary, explicit install/relaunch, unsigned artifact refusal and watch-mode setting. Fixtures prove these boundaries, not Auth or UI behavior. Initial sandbox bind/CoreSimulator denial was retried in normal host context.
- Skill validator passed. Shell recipes parsed with bash-n. Fresh serialized `pnpm check` passed: input SHA256 `8b4d2039b40a218279b74eb321075bd02266c134527b6a4b8c5f7efa4303ffad`; helper13/13, mobile1476, API852 passed/15 existing credential-gated E2E skips; navigation0 errors/19 advisory warnings. Log `/private/tmp/mizyun-simulator-workflow-check.log`. Live-provider integration remains gated/unrun. Post-gate changes only record evidence/status.
- Real doctor completed successfully in approximately0.33s on this host; this is one invocation, not an end-to-end speed claim. Cold Debug build succeeded, then incremental ad-hoc-signing rebuild succeeded. Logs `/private/tmp/mizyun-simulator-skill-build.log` and `...-build-signed.log`; current validation artifact `/private/tmp/mizyun-ios-simulator/Build/Products/Debug-iphonesimulator/MizyunDev.app`. Future recipe uses a unique task directory instead.
- Exact iPhone17Pro simulator `F4939E5D-BA85-4479-AA1E-92B21441FB8C`, iOS26.5, `com.mizyun.development`1.0.9(9), PID15560. Helper verified Dev embedded public config and signature, booted/installed/launched with process-scoped `-RCT_jsLocation localhost:8085`. Actual native app rendered; retained final task Metro log contains fresh iOS bundle requests and no CI-mode warning.
- Ad-hoc signed app restored the existing synthetic Dev account. Normal Settings Sign out and fresh email/password Sign in succeeded; native Home showed UI Test, today's400kcal, weekly1600kcal and existing Test active workout. Native password-storage prompt declined; no credentials/keys/tokens in evidence. [Native result](evidence/simulator-workflow-2026-10-06/fresh-dev-sign-in-home.png).
- Actual `noWindowsAvailable` recovered by reselecting observed DeviceHub window, invoking its exposed Raise action, then current screenshot coordinates; prompt dismissal and fresh AX result verified. No blind repeated click.
- Warm launch without install/relaunch succeeded in approximately0.99s and returned the same PID15560 after installed/native digests matched. It did not reinstall/terminate the app. PID alone is insufficient; current task bundle traffic and native fresh sign-in supply attachment/result evidence.
- No meal/workout record mutation, new consent/provider access, simulator settings change, physical reinstall or backend/Production release. Existing require-cycle warnings remain unrelated. Return to Home with no open draft; stop only retained task Metro and restore initially Shutdown simulator without erase.

## Acceptance limits

This validates the reusable setup, normal synthetic Dev login/read and bounded window recovery. The scenarios outline future meal/workout/draft/font/keyboard/accessibility testing; it does not newly accept every listed feature. Maximum font, VoiceOver, Release/Android and physical signed-in exits remain in #210/#213. No measured user task-time improvement is claimed. Next use the skill against a concrete changed feature and preserve exact input/action/result evidence.
