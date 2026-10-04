# Combined Dev delivery — 2026-10-04

Adam authorized checking all pending work, committing/pushing, merging into main, deploying the Dev backend and installing the standalone Dev app on his iPhone. Baseline: `codex/recurring-meals`, HEAD `f08aff45e7a481a785e8e930752ad08595cdd3fd`; pending mobile/Coach/tooling changes were preserved and reviewed. Production and Store delivery remain separate.

## Review and candidate

A Medium helper reviewed mobile presentation (8 files/118 tests passed; no blocking findings). A High non-author helper reviewed identity/consent/AI/device/check safeguards. Its personal-source-badge finding was reproduced and corrected with the real API send/replay regression; independent final review has no remaining blockers and targeted API90 passed. Coordinator inspected actual diffs and keeps native acceptance distinct from source verification.

Remote main has one documentation-only commit `a1c9530` recording earlier `e63519e` integration and qualified disposable database CI evidence. Preserve that ancestry during integration; its historical acceptance does not accept today's combined candidate.

## Verification

Focused mobile: 10 files/143 tests passed. API Coach intent/routes: 90 tests passed after evidence-badge correction. Runtime90/Gemini55/navigation117/capability9 passed; Apple capability7, concurrent unique discovery paths and signal cleanup passed. Fresh precommit full gate PASS(exit0), `/private/tmp/mizyun-delivery-precommit-check-final.log`, input SHA256 `505c4589e61f2828f00760b16ac9d6acf837ebfed89827bf70c91a1988fd8d04`: mobile1409/API843 with15existing gated skips, contracts203/core373/server-adapter154; formatting/types/dualHermes and all configured safeguards. Initial attempt stopped at the26-byte status-size overflow; summary shortened without removing gates. Check-runner16 passed with process inspection enabled; the sandboxed attempt could not inspect processes and is not counted as a passing gate. Current test logs use `/private/tmp/mizyun-delivery-*.log`. No live-provider call or destructive database check is part of this package.

## Delivery

All63files committed/pushed as `3a04548`. Resolved only the compact-status conflict while preserving remote historical evidence in the linked archive. Fresh merged `pnpm check`PASS(exit0), `/private/tmp/mizyun-delivery-merge-check.log`, input SHA256 `ac398eb0c33e0bbab1ea4154b6ff701cd4313ec0327f53b2bdf38a5bf3e6db2f`. Main merge `a435a7660d85a4586224d5ac48827db651833826` pushed without force; remote main SHA matches.

Canonical `pnpm deploy:dev:preflight a435a7660d85a4586224d5ac48827db651833826`PASS. Canonical `pnpm deploy:dev`PASS(exit0), `/private/tmp/mizyun-delivery-deploy-dev.log`; its exact-commit full gate passed (input SHA256 `87fdb22983ca857ab483599fbc45a05a92d9b41a859298b3acc5605b95715bd2`), migration ledger already up to date. Unique Hetzner host marker, Dev path/service and loopback DB5433 guard checked by protocol. Public health200 at `2026-10-04T18:05:00.264Z`. Bounded ops reads confirmed pristine checkout at exactSHA, active API PID3516861/cwd `/var/lib/mizyun/dev/repo`, `coach-system-v2-app-v1` and capability catalog present. Public unauthenticated Coach read401 with standard error envelope. No credentials or user data inspected; no live model query.

`pnpm mobile:install:ios:dev --device 00008140-001114501A86801C` built and installed successfully at `2026-10-04T18:05:59Z`, `/private/tmp/mizyun-delivery-ios-install.log`. Clean source `a435a766...`; bundle `com.mizyun.development`1.0.6(6), team `LQJNDVBL43`, Release artifact `/Users/adam/Documents/mizyun/apps/mobile/ios/build/Build/Products/Release-iphoneos/MizyunDev.app`. JS SHA256 `90c30e464aece34078c6c77584cbbf319cba1f0af9474ce99f46ed22d69b70f7`. Strict/deep signature and signed Apple capability verificationPASS with macOS trust access; sandbox trust verification was unavailable. Automatic launch denied solely by device lock; launch retry pending unlock. Installation is verified; signed-in feature acceptance remains open.

GitHub navigation CI passed for exactSHA. Quality CI still running at evidence capture. Legacy `.github/workflows/db-push-dev.yml` [run](https://github.com/AdamHikl/mizyun/actions/runs/37222767364) failed before any jobs; no supplied annotations explain it. This is separate from the completed guarded Hetzner deployment. No hosted target, credentials or workflow configuration changed. Paired target preflight passed: Adam's iPhone16Pro, hardware UDID `00008140-001114501A86801C`, bundle `com.mizyun.development`, team `LQJNDVBL43`, Release build without Metro.

## Remaining acceptance

Signed-in recurring guidance in new/old threads; cold/background/offline/account/token recovery; Coach keyboard/copy; header scroll/taps; Meals day workflows; workout Finish/Discard and Set Target accessibility remain exact-device gates. Installation/launch does not close the linked feature issues.
