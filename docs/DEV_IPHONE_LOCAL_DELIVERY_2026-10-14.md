# Latest local iPhone Dev delivery — 2026-10-14

Adam requested installation of the latest Dev app on his iPhone. Mizyun Dev **1.0.9 (9)**, bundle `com.mizyun.development`, was built, signed, installed and positively launched on the paired iPhone 16 Pro (`00008140-001114501A86801C`). The main process was independently observed with PID **39993**. Signed-in feature acceptance remains separate.

## Source and verification

- Frozen candidate: `/private/tmp/mizyun-iphone-dev-20261014`, exact baseline `0135228778059dc25c1a4925738f0b6934ed4f0c`, plus all current tracked and nonignored local source. All 2,335 files matched the shared source at capture. This includes uncommitted Community meal sharing, first-render cache, meal photo recovery, analytics reminders, REC-01–06 recipes and meal routine suggestions. [Source manifest](evidence/dev-iphone-local-2026-10-14/candidate-manifest.json).
- Dependencies were cloned into the candidate; workspace links were checked to avoid the shared tree. Generated iOS/Android scaffolding was copied without build caches, and CocoaPods was regenerated in the candidate. Git baseline, source correspondence, navigation and `git diff --check` passed before the canonical gate.
- Fresh `pnpm check` passed for input SHA-256 `0a301101d36d1e2fd3cc76e771eb20ffd7c07ff3f014d0eaf476b249764d7fe8`: **2,572 mobile / 1,109 API tests passed**, with 15 existing credential-gated API skips. Typechecks, formatting, both fresh Hermes exports/privacy scans and tooling checks passed. [Gate summary](evidence/dev-iphone-local-2026-10-14/quality-gate-summary.txt). Full local log: `/private/tmp/mizyun-iphone-dev-evidence-20261014/full-check.log`.
- A fresh no-history Sol Medium helper performed a read-only installer/environment review. The coordinator verified its findings and independently established device availability and absence of competing native builds. Direct guarded `xcodebuild`/`devicectl` steps preserved the shared native project and avoided the installer's port-wide Metro termination and swallowed launch errors.
- Standalone **Release** compiled successfully with team `LQJNDVBL43`. Signed Apple sign-in, deep strict signatures, app/Watch/widget Dev identities and embedded public Dev API/Supabase/callback values passed. No Production version bump.
- Retained artifact: `apps/mobile/dist/releases/ios/device/2026-10-14-local-0135228-dev-1.0.9-9/MizyunDev.app`. The retained signature was verified with system keychain access before installation. One CoreDevice install connection reset and one launch remote-service failure resolved on retry; final install and launch JSON outcomes were successful, followed by independent process evidence. [Delivery receipt](evidence/dev-iphone-local-2026-10-14/native-delivery.json).
- Candidate source hashes remained unchanged. Concurrent shared edits after capture affected only a logging-draft test and continuity/research documents; runtime source stayed identical. These delivery records and the status update are post-check documents, outside the tested snapshot.

## Backend and remaining acceptance

Public Dev `/v1/health` returned HTTP 200 with `status:ok`. No backend deployment, commit, push, Production operation or Store upload was performed. The recorded Dev authority remains the October 11 baseline; new Community meal routes/migration, recipe services and meal suggestion services remain undeployed. Installation does not establish those features' end-to-end behavior.

Next: test signed-in native journeys on this installed app and separately authorize deployment of the accepted backend candidate when ready. Offline/restart/account changes, accessibility, live-provider quality/privacy/cost, paired Watch and Production/Store acceptance remain open. Prior October 12 delivery was pending; this receipt establishes the completed October 14 installation.

## Later source qualification — 2026-10-14

The separate-commit integration review subsequently repaired runtime meal-completion receipt and analytics-reminder erasure races. Their current source hashes differ from this installation manifest. The installed app corresponds to the frozen snapshot above and does not contain those later repairs; the new combined source requires its own rebuild and device acceptance. This does not invalidate the recorded build/install/launch evidence for its captured candidate.
