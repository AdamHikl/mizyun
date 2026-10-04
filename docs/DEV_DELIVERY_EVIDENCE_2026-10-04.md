# Combined Dev delivery — 2026-10-04

Adam authorized checking all pending work, committing/pushing, merging into main, deploying the Dev backend and installing the standalone Dev app on his iPhone. Baseline: `codex/recurring-meals`, HEAD `f08aff45e7a481a785e8e930752ad08595cdd3fd`; pending mobile/Coach/tooling changes were preserved and reviewed. Production and Store delivery remain separate.

## Review and candidate

A Medium helper reviewed mobile presentation (8 files/118 tests passed; no blocking findings). A High non-author helper reviewed identity/consent/AI/device/check safeguards. Its personal-source-badge finding was reproduced and corrected with the real API send/replay regression; independent final review has no remaining blockers and targeted API90 passed. Coordinator inspected actual diffs and keeps native acceptance distinct from source verification.

Remote main has one documentation-only commit `a1c9530` recording earlier `e63519e` integration and qualified disposable database CI evidence. Preserve that ancestry during integration; its historical acceptance does not accept today's combined candidate.

## Verification

Focused mobile: 10 files/143 tests passed. API Coach intent/routes: 90 tests passed after evidence-badge correction. Runtime90/Gemini55/navigation117/capability9 passed; Apple capability7, concurrent unique discovery paths and signal cleanup passed. Full gate pending. Check-runner16 passed with process inspection enabled; the sandboxed attempt could not inspect processes and is not counted as a passing gate. Current test logs use `/private/tmp/mizyun-delivery-*.log`. No live-provider call or destructive database check is part of this package.

## Delivery

Commit/main merge, Dev exact-source deployment and iPhone install results pending. Paired target preflight passed: Adam's iPhone16Pro, hardware UDID `00008140-001114501A86801C`, bundle `com.mizyun.development`, team `LQJNDVBL43`, Release build without Metro.

## Remaining acceptance

Signed-in recurring guidance in new/old threads; cold/background/offline/account/token recovery; Coach keyboard/copy; header scroll/taps; Meals day workflows; workout Finish/Discard and Set Target accessibility remain exact-device gates. Installation/launch does not close the linked feature issues.
