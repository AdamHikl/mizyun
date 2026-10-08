# Workout UI restoration — 2026-10-08

Adam rejected the new workout layout and requested restoration of the previous UI. This decision supersedes the adaptive-table/header work for #228, including the latest-ten package's earlier header refinement claims.

## Source scope

Restored `log-workout-screen.tsx` exactly to the combined Dev baseline `67809bf3e9e125ca6f870b8f5c48cf25f0bcbfb9`, except saved load and repetition values now use `theme.text` instead of forced white. The original exercise header, History placement, set table, compact inputs, rest behavior, pending/logged distinction and #139 visible set-type selector are retained. Completed-workout read-only safeguards and the combined department changes are preserved.

Only two light/dark saved-value regression cases remain in `one-time-workout-screen.test.tsx`. Rejected reflow/header tests were removed with their layout. Root contains unrelated concurrent work; delivery and checks use the stable isolated checkout `/private/tmp/mizyun-combined-dev-20261008-vtmycf2g` on `codex/combined-dev-2026-10-08`.

## Verification

- Focused: `pnpm --filter @mizyun/mobile test src/features/workouts src/features/log-workout` — 18 files / 245 tests PASS.
- Independent read-only restoration review PASS: the screen differs from the baseline only in the two saved-value theme styles and removal of the forced white color; callbacks and guards remain unchanged.
- Actual-source React Native Web previews inspected at 430 px / 100% in light and dark themes: [light](evidence/workout-ui-restored-2026-10-08/source-light-430.png), [dark](evidence/workout-ui-restored-2026-10-08/source-dark-430.png). These are synthetic fixture previews, not native acceptance.
- Release build: `xcodebuild`, explicit physical iPhone destination, canonical Dev environment, version 1.0.9 (9) — BUILD SUCCEEDED. Strict signature verification PASS; bundle `com.mizyun.development`, team `LQJNDVBL43`, CDHash `ab7f447b3c78cc0326c56ae2b3e3fe9689d5d8be`.

- Final serialized `pnpm check` — PASS, stable input SHA-256 `19b953b612e3cf406ba469d998aa8466c0327e76ff2b39a3efff742a4db21b30`. Mobile 166 files / 1931 tests; core 420 tests; API 937 tests passed. Fifteen credential-gated API tests and three legacy configuration cases remain skipped; neither is acceptance. Both platform bundle exports, formatting, lint, type checks and tooling gates passed. Full log retained locally at `/private/tmp/mizyun-workout-restored-check.log`.
- Delivery source `584452e4ee45401c52744c7000dd08fd845f9008` committed and pushed on `codex/combined-dev-2026-10-08`; `git ls-remote` independently confirmed that exact remote SHA. Isolated checkout clean after delivery.
- Physical iPhone 16 Pro, explicit UDID `00008140-001114501A86801C`: installation and launch PASS. Independently observed app PID `17907` and widget PID `17909` under the new installed container `F6C9D500-6677-4A50-AC36-291BFC43CBDC`. This is standalone Release installation/process proof, not signed-in feature acceptance. Earlier rejected-layout install at `90dab563a406055bd306e46138b529069e5d953d` / PID17726 is superseded.
- [Redacted delivery receipt](evidence/workout-ui-restored-2026-10-08/delivery-summary.json).

## Remaining acceptance and historical evidence

#228 closed at Adam's explicit request after he confirmed the restored UI is done. The accepted scope is the original workout layout with readable saved-value colors. Narrow/max-font redesign was rejected; this closure does not claim that the original large-text acceptance matrix passed. Android acceptance remains explicitly pending per Adam; do not count the earlier Debug build as interaction acceptance. VoiceOver and the full native accessibility matrix remain unverified.

Earlier previews in `evidence/workout-readability-2026-10-08/` and the native simulator journeys of the rejected layout are historical only; they do not prove the final restored layout. The shared simulator is now being actively controlled for a separate UI batch test. Cleanup was interrupted by changed UI ownership; do not close that session, shut down the simulator, or overwrite its font settings. Last read-only observation found UIKit XXL. The task-created preview tab and preview server (8766) were closed. Task-owned Metro on 8087 is left available while the shared simulator has another active UI batch session; stop that exact server after its user releases the shared simulator. Do not stop unrelated Metro processes.

This restoration is client-only. Dev backend remains `5b0cff9afc7b88b18dbe6b29964f693b0899a895`; no backend or Production promotion is part of this change.
