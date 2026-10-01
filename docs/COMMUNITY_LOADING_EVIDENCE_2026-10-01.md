# Community repeated loading evidence — 2026-10-01 (#168)

## Scope and baseline

- User supplied a 2.68-second recording of Community → Coach → Community. Temporary empty encouragement is followed by a shared workout card. No user identity or workout contents are copied into evidence.
- Source baseline: `677861a` on `codex/community-140-145`; mobile React19.2.3, Expo57.0.23, React Native0.86.3. Existing `status.md` and detailed-sharing evidence edits were preserved.
- Coordinator authored runtime/tests/docs. Read-only helper audited all Community screens and independently reviewed the final change.

## Changes

- Previously enrolled returning feed overlaps membership and feed reads, rather than adding two sequential network round trips. Both endpoints retain their own current server checks; screen reveals no cards until verification settles. A different enrollment generation discards the speculative feed and triggers a fresh read.
- Previously populated feed uses a neutral generic card placeholder during revalidation. It retains no names, cards, counts or workout details; genuine empty feeds retain encouragement. Fresh empty/error/denial results remain distinguishable.
- Inbox no longer shows its empty encouragement panel while updates are being checked. A strengthened render regression reproduced that flash before the guard was added.
- Detail reactions use a memoized principal/lifetime/visibility-bound client. Late safety receipts no longer restart the reactions modal request. Old clients are rejected after background/account change.
- Feed, detail, sharing, Find friends, Friends, Inbox, notification preferences and Profile ignore unchanged foreground events. Real transitions still clear/revalidate. Profile stops loading for foreground events when its screen is unfocused.
- Signed-out sharing shows a sign-in message with the existing Close action instead of indefinite loading.
- Sharing preview still rereads current private source, published version and audience on every deliberate opening. Detail, relationships, discovery, inbox, preferences and safety keep their protected revalidation boundaries. Rules are static. No backend/schema/native dependency change.

## Reproduction and verification

- Before implementation, feed/share actual-render regressions:4fail/22pass. Failures cover serialization, redundant foreground reads, discarded selection and signed-out loading.
- Before implementation, detail actual-render regressions reproduce unstable reactions client and duplicate foreground fetch. The initial third assertion had a finder null/undefined harness mismatch, corrected before using it as evidence.
- Focused Community suite before final fast-refocus correction: `pnpm --filter @mizyun/mobile test src/features/community` passes283tests/29files; fresh mobile typecheck passes.
- Independent review found and coordinator fixed enrollment-generation prefetch mixing and captured-revision memo reuse across a fast batched refocus. Regressions include both, plus old-intent rejection, withdrawal, background, denied membership, manual refresh and late results after blur.
- Final focused `pnpm --filter @mizyun/mobile test src/features/community`:284tests/29files pass. Fresh serialized settled-source `pnpm check`:exit0; mobile1061/API736 pass,15 existing gated API E2E skips; repository typechecks, iOS/Android Hermes exports, navigation, formatting, deployment/operations/signing/build/AI/privacy/Apple-auth tooling pass. Initial full run failed the strengthened Inbox regression before correction and is not counted as passing evidence.
- Independent non-author final review approved after generation, batched-refocus scope and Inbox corrections. `git diff --check` passes. No provider/live database suites were enabled; no database changes require them.

## Remaining acceptance

Install the exact committed client candidate on Dev iPhone, then repeat populated Community ↔ Coach returns, shared detail/reactions, Find friends/Friends/Inbox/Profile/preferences and explicit sharing. Check slow/offline/error retry, foreground/background, account switch, leave/rejoin, large text and VoiceOver. Record actual outcomes separately from mocked/component/source checks. No Dev backend deployment or new native install/device acceptance/Production release is claimed. Original Community pilot/operator/legal/restore gates stay separate.
