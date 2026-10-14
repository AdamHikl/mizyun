# Community meal sharing — #238

Date: 2026-10-12. Baseline `0135228778059dc25c1a4925738f0b6934ed4f0c`.

Adam requested meals alongside workouts throughout Community and explicitly deferred iOS simulator testing. Two bounded High helpers implemented backend/SQL and mobile publication safeguards; the coordinator integrated feed/profile/detail/privacy copy and tests. No commit, push, deployment or native test is part of this session.

## Behavior and boundary

- Community Feed and Me offer Share meal. The selector lists the latest 200 confirmed owned entries; saving a meal stays private.
- Exact preview shares name/day with optional calories/protein/carbs/fat starting off. Existing active posts retain their previously chosen nutrition setting for editing; revoked/new posts start off. Private notes, photos, provider/Coach metadata and recipient-visible source meal IDs are excluded.
- Mixed feed/profile/detail reuse current audience, reactions, comments, reporting, mute/block, owner management, expiry, withdrawal, export and account deletion. Changes to shared source fields/unconfirmation/delete revoke meal posts; private snapshots never update silently.
- Immutable operation/version/generation checks and short foreground authority fence retries, account/token changes and late responses. SQL remains the authority for owned source projection and audience.
- [ADR-0056](adr/0056-explicit-community-meal-publication.md), [requirements](PRODUCT_REQUIREMENTS.md), and [research](RESEARCH_LOG.md) record the bounded extension. Existing admission, safety/operator, disclosure and release gates remain.

## Automated evidence

**Final isolated `pnpm check`: PASS**, input SHA256 `9fbb73393cb7d19f1e6ec824b7cb5ffefaba0a044069aa4c46f171fcff63bbda`; mobile 2,194 / API 986 passed, 15 credential-gated API tests skipped. iOS/Android bundle checks passed. [Post-check receipt](evidence/community-meals-2026-10-12/verification-summary.json), [full log](evidence/community-meals-2026-10-12/full-check.log), [overlay scope](evidence/community-meals-2026-10-12/candidate-overlay.json), [independent review](evidence/community-meals-2026-10-12/review-summary.md). These receipt/document updates were added after the passing candidate gate; document/format checks apply separately.

- Shared-tree final focused Community run: 51 suites / 608 tests passed; mobile typecheck passed. Isolated baseline/owned overlays: 51 Community suites / 589 tests passed, API Community 192 plus final UUID regression 5, contracts 52, core 37 and adapter 54 passed. Final full gate remains separate. The first full attempt stopped on missing Coach capability ownership for the new route; the catalog now maps Share meal and explains its explicit preview/optional nutrition. Focused capability validation passes.
- Empty schema-only Mac scratch database: 6 suites / 148 SQL assertions passed, including 40 new meal assertions and 108 existing publication/lifecycle/privacy assertions. Applied forward migration `20261012120000_community_meal_sharing.sql` SHA256 `70cb0a3749e8e90b1cd90c2de45dd9ae6e279015f205fb062b5b51358ed6394b`; SQL test SHA256 `7a5ae95b75987b4d5335e520189ec90b843c8545f4c21b796921bc0862cebdd9`. Scratch removed; shared database untouched; no user records copied. Existing concurrency/real PostgREST transport suites were not run.
- Independent High review of the first immutable candidate found two bounded P2 blockers: missing central meal-field redaction and workout-only generic approval/comment copy. Both repaired. Captured Pino regression demonstrated the redaction failure first, then 12 logging / 7 reaction tests and all 608 Community tests passed. Final repair review and full gate are recorded in the post-check receipt.
- Exact candidate overlay/source correspondence, checks, skips, review and final result are saved as a post-check record under `docs/evidence/community-meals-2026-10-12/`. The source input document is prepared before the full gate; the post-check receipt is checked separately. Pre-existing personal startup cache/photo work is excluded from candidate source and preserved in the shared workspace.

## Remaining acceptance

iOS simulator explicitly deferred by Adam. Next: paired synthetic Dev accounts share a meal without/with nutrition, inspect feed/profile/detail, react/comment/report, edit/unshare/source-delete, then exercise block/removal/withdrawal and original foreground expiry/account switch. Check small-screen wrapping, large text, light/dark and VoiceOver. Dev migration/backend/mobile delivery and Production release are unrun and separate.

## Preserved prior running/usability handoff

## Running — #216 / RUN-01–05

**#210/#211/#213:** usability fixes/reviews/full gatePASS (mobile1476); fresh Dev simulator sign-in/meal/batch/resume/AX and live fonts verified. Physical/max-font/VoiceOver exits open. [Evidence](USABILITY_FOLLOWUP_EVIDENCE_2026-10-06.md).

**#214 simulator workflow:** skill/helper13PASS, High review clear; live signed Dev sign-in/read and warm reuse/full gatePASS. [Evidence](SIMULATOR_WORKFLOW_EVIDENCE_2026-10-06.md).

**Retained gates:** #210/#211/#213 usability/#207 navigation source and physical/max-font/VoiceOver/provider exits: [prior status](archive/status/STATUS_PRE_RUNNING_2026-10-06.md).

**Next:** accept #210/#213 physical/accessibility/max-font journeys on this candidate. Release: accept version9 native journeys, then manual IPA/AAB upload; test native workout status. #27/#32 native/Store exits open. Community closed; photos/App Preview Dev-only; no agent upload; broader gates remain.
