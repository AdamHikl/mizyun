# Meal-photo local copy fix — 2026-10-07

Issue: [#225](https://github.com/AdamHikl/mizyun/issues/225). Requirements: NUTR-01, NUTR-02 and MEAL-PHOTO-001. Source baseline: `7d5c9d0ecfd52629995af25d896dd6cdfef1abaf` plus the local changes listed below. Subsequently built/installed the standalone iPhone Dev app at the user's request; no commit, push or backend deployment.

The reported iPhone error occurs before AI upload: the native image decoder cannot find an owner-scoped durable draft image. Current Expo57 File.copy returns a promise. Source and thumbnail copying immediately deleted their temporary source without awaiting the copy; retries also published copied paths before completion. The prior synchronous filesystem test mock hid this race.

All three copies now await native completion, verify nonempty destinations, and recheck account cleanup before publishing a durable path. Partial or late copies are removed; rendered cache inputs are deleted after settlement; failed retry copies preserve the chosen draft original. Independent review also reproduced an iOS directory URI ending with a slash: the previous owner-prefix comparison added another slash and rejected valid files. The prefix now has exactly one trailing slash, and tests model native directory/file URI joining.

The UI gives a short Remove/reselect/manual-entry recovery message without displaying native exceptions, paths or identifiers. Previously broken draft attachments require explicit removal and reselection; existing meal fields and explicit Save behavior are preserved. Dev-only photo retention and AI consent/provider controls retain their existing behavior.

## Verification

- Failure demonstrated before implementation: six deferred-copy/failure/purge regressions failed; one unreadable-photo recovery test failed; the native-directory cleanup regression failed before the prefix correction.
- Final focused command: `pnpm --filter @mizyun/mobile test src/features/log-meal` — PASS, 17 files / 244 tests (retention21 and screen47). Includes source/thumbnail/retry ordering, partial-copy failures, account purge during each copy type, empty destinations, native directory ownership, lost-response retries and Remove/reselect with fields preserved.
- Independent non-author GPT-6.1 Sol / High review: confirmed the native async API and trailing-slash defect; final four-file diff and additional tests clear. Reviewer separately ran the changed-file suites before the last three test additions: PASS, 65 tests. Coordinator's final 244-test pass covers those additions.
- Full repository `pnpm check`: PASS, exit0; input SHA256 `c321e91ee4a11eeeb5ed3f54ce309f3ad5e25e3e960d123b18dea0261db34373`. Formatting/navigation/workspace typechecks, both real Metro exports, 1765 mobile tests, 892 API tests and all tooling gates passed. Fifteen API integration tests remain credential-gated/skipped. The initial sandbox attempt stopped before checks on process-lock inspection (`ps EPERM`); the authorized full run completed. No live-provider or native acceptance is claimed.
- `git diff --check`: PASS before the full gate.
- [Durable verification summary and source hashes](evidence/meal-photo-copy-fix-2026-10-07/verification-summary.json). All four reviewed source/test hashes still match after the gate; only documentary result recording followed it. Issue #225 stays active pending exact-candidate device acceptance.

## Scope and custody

Owned source/tests: `apps/mobile/src/features/log-meal/meal-photo-retention.ts`, `meal-photo-retention.test.ts`, `log-meal-screen.tsx` and `log-meal-screen.test.tsx`. Coordinator also updates this evidence document, the research log and the existing #218 entry in `status.md`.

Preserved pre-existing Community edits: `docs/COMMUNITY_UI_REDESIGN_EVIDENCE_2026-10-07.md`, `docs/adr/0048-community-connected-ui-reads.md`, `docs/evidence/community-ui-2026-10-07/refinement-check-summary.json`, both untracked refinement delivery/install summaries and the other `status.md` content. The [prior photo integration](MEAL_PHOTO_MAIN_INTEGRATION_2026-10-07.md) and [Dev delivery evidence](MEAL_PHOTOS_DEV_DELIVERY_2026-10-06.md) remain historical authority for their candidates; their test/deployment results do not accept this local fix.

## Next exact action

Accept the installed iPhone Dev candidate: verify library/camera selection → Process → explicit Save → reopen thumbnail, then retry/restart and removal. Existing #217/#218 physical iPhone/Android, offline/account/multi-photo/accessibility and live-provider gates stay open. Existing broken files cannot be recovered from a path alone; remove/reselect the attachment. Production photo retention remains disabled.

## Requested iPhone Dev installation

At `2026-10-07T17:12:35Z`, `pnpm mobile:install:ios:dev --device 00008140-001114501A86801C` exited0 with Release build and install success. Live process inventory independently confirmed MizyunDev PID13101 on iPhone16Pro. Bundle `com.mizyun.development`, display name Mizyun Dev, version1.0.9(9), signature team LQJNDVBL43; deep/strict signature and signed Apple capability checks passed. Embedded Dev API/Supabase/auth endpoints and enabled meal-photo flag match the expected configuration; main Hermes bundle SHA256 `b6fc40921223ce5de40b68cfb650d30024e055daa81ae4918398e91d26529faf`. All845 tracked source/configuration hashes, including the private Dev configuration digest, remained stable through the build. No Metro process occupied8081 before installation. The installer reported a positive launch but omitted its PID; the independent inventory provides that evidence. Installation/launch does not accept the photo journey.

[Redacted installation summary](evidence/meal-photo-copy-fix-2026-10-07/iphone-install-summary.json). The install-ios-dev skill was used; a separate High helper reviewed installer safeguards, provenance limitations and the resulting verification checks.
