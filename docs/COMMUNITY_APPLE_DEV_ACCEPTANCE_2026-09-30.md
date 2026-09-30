# Dev iPhone Apple sign-in blocker — 2026-09-30

Scope: Dev only, branch `codex/community-140-145`, baseline `c03d4f6c834e765d15d9eb93453c880c6e953489`. Initial tree clean. [#164](https://github.com/AdamHikl/mizyun/issues/164) tracks the defect; #7 retains broader Apple lifecycle acceptance and #137/#155 retain Community gates. All #140–155 bodies/latest comments were read; #141 remains closed and other exits remain blocked. No Production operation, account deletion, account recreation, partner admission or Community consent/publication was performed.

## Report and demonstrated failure boundary

Adam reported “We couldn't sign you in with Apple” before Apple's sheet. Initial signed standalone Dev1.0.6(6) artifact had no `com.apple.developer.applesignin`; generated `MizyunDev.entitlements` also lacked it. Dev installer reused matching `com.mizyun.development` native projects without capability validation. Its enabling environment flag did not regenerate that existing project. Both actual initial plist/signature fail the new guard. This establishes a build defect; successful physical login remains required to establish symptom resolution.

Read-only Dev Auth logs for the preceding hour showed refresh-token200 at19:00:46Z and a transient Auth→Dev database timeout at19:00:47Z, but no Apple ID-token exchange in that window. The timeout is a separate observation, not the demonstrated native defect's cause. No user IDs, IPs, keys or tokens are retained here. Current source uses SHA256 nonce to Apple and raw nonce to Supabase.

## Correction and automatic evidence

Dev-only capability check regenerates a same-bundle project missing Default Apple capability; signed-capability guard rejects deficient output before install. Production execution paths are unchanged. Typed abstract codesign output is checked because Xcode27's DER signature has no extractable XML representation. Unexpected format/type/value safely rejects installation.

- The same regression run in a temporary fixture against baseline `c03d4f6` installer fails on the first missing-capability assertion (exit1), demonstrating unsafe reuse; the corrected installer passes.
- `node scripts/test-dev-ios-apple-auth.mjs`: seven checks pass, covering real installer same-bundle missing/present/malformed capability and signed missing/present/wrong-type/wrong-value boundaries. Fixtures/mock commands prove installer decisions, not native/provider acceptance.
- `bash -n scripts/mobile-device-install.sh` and `git diff --check`: pass.
- Fresh `pnpm check`: exit0; mobile995/API730 pass, 15 existing gated API skips; all typechecks, dual Hermes exports, navigation/formatting, offline/build/deployment/operations safeguards and new seven-check regression pass. Log `/private/tmp/community-apple-pnpm-check.log` is local ephemeral evidence. No live provider suite or fresh SQL acceptance claimed.
- Independent non-author helper reviewed actual final guard/installer/tests, ran seven checks, rejected the old actual signature, and approved scope/failure handling with no blocking findings. Coordinator inspected the actual diff.

## Device monitoring and acceptance

Connected only to Adam's iPhone16Pro `00008140-001114501A86801C`. Initial Dev main process70312 launched with `devicectl --console`; monitor emitted startup messages but no Apple-specific error. Console output cannot prove screen state. `pnpm mobile:install:ios:dev --device 00008140-001114501A86801C --no-launch` rebuilt successfully and installed at19:15:36Z. Version1.0.6(6), teamLQJNDVBL43, exact Dev bundle. Actual regenerated native plist and signed capability guard pass; `codesign --verify --deep --strict` passes. Main bundle7090548bytes SHA256 `0d56edb625cf0a31cd41021f34c0eae58e87a5c32a27e62815b57cb3c19f9cc7` matches the previously verified Community runtime and contains exact Dev API/Auth/callback. Only native capability changed. Rebuilt from baseline plus reviewed installer changes; no JS runtime edits. No backend deployment required/performed; Dev stays282d740d93b338fb508cbad2a8fa27f5a605b9c8.

Corrected app launched with attached console at19:16:17Z, PID70346. Adam confirmed the Apple sheet appears and sign-in succeeds on this corrected installed build. Sanitized Dev Auth logs corroborate `POST /token`, `grant_type=id_token`, status200 at19:16:28Z (21:16:28 Europe/Bratislava). Returning-user sign-out/sign-in remains pending. Invitation/share/offline/accessibility/leave/rejoin, partner two-account, Android/operator/legal/restore/push/pilot gates remain unaccepted. Monitoring is console/process only; it does not provide live iPhone pixels.
