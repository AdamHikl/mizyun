# Private meal photos — Dev evidence, 2026-10-06

Issue: [#218](https://github.com/AdamHikl/mizyun/issues/218). Baseline3984c35fe922f3ebd16abff850dc1302550da9e8 in managed codex/meal-photo-thumbnails checkout. Excludes concurrent Health preview/export/simulator/settings changes in the shared checkout. No Production deployment or Store upload authorized.

## Implemented scope

Optional single compressed private meal photo, compact thumbnail and larger preview/removal, owner-scoped durable retries separate from confirmed meal save, explicit selection across multi-photo drafts. Backend trusted JPEG processing, typed ownership, deletion/recovery lifecycle, Dev activation guard. Exact paths and final verification will be recorded after writes/review settle.

## Verification and review

Final coordinator focused suites: mobile21files272testsPASS; API6files140testsPASS; account-purge16tests included. Author focused contract/core/adapter/config/typechecksPASS, verified separately by final full gate pending. Independent High non-author review inspected authority boundaries, trusted JPEG processing, retry/account cleanup and Production disable; findings fixed.

Disposable local Supabase project `mizyun-meal-photo-218`, API54721/DB54722, leaves existing `mizyun`543xx untouched. Candidate resetPASS and fullpgTAP33files884assertionsPASS (newmealphoto23), migration `20261006200000`. SQL verification exposed and then verified fixes for variable/column ambiguity, outer mealDELETE self-update and Authcascade FK ordering. RealAuth/API/Storage probePASS32checks with synthetic accounts and no AI calls. Reconciled live Dev running938efc5 into the candidate; combined migration chainPASS34files924assertions, photo migration20261006200000. Serialized full gate pending; no pending check counts as passed.

Known nonblocking limitation: simultaneous generic-media/meal deletion can cause a safe atomic rollback requiring retry. Expiredthumbnail taprefresh may require a secondtap; native privacy/UX exits remain open.

## Delivery and open acceptance

Dev deployment and physical iPhone installation pending. Exact source/service/migration/route evidence will be recorded here. Native Save/reopen/photo choice/preview/remove, offline recovery, account switch, max-font/accessibility and Android acceptance remain required.

## Initial delivery and live repair

Combined source303e2e5bd567cec0023467a0bc6c41be72cf4399 preserves running938efc5 and Pro multi-photo3984c35. Final source full gatePASS input41706751990295762f982f500a7f071a0f130427f073a90d64810954d040fc66; canonical deployment gatePASS input33a9dd50b0386b0e8ef95fee3f3db7c3cccc1bc77db2d1f48e222f6ff9a0f59a. Mobile1563/API880PASS;15 existing API integration and3 config bundle-path skips remain unrun. Both platform exports and operational/build gates passed.

Canonical initial Dev promotion succeeded2026-10-06T18:38:10Z, pristine source303e2e5, PID3376308; API4100/DB5433; ledger running12:00+18:30/photo20:00 verified. Real public upload succeeded but the signedURL kept internal8100; the probe rejected this before counting live acceptance. Synthetic accounts were removed in checked finally cleanup. Adapter repair explicitly assigns hostname and port; final repair gate/deployment/live journey remains pending here and is tracked in issue218.

Standalone Dev Release built/installed/launched2026-10-06T18:32:40Z, source303e2e5 mobile tree, iPhone16Pro00008140-001114501A86801C, com.mizyun.development1.0.9(9), teamLQJNDVBL43, PID9670 independently verified. Embedded Dev endpoints and enableMealPhotos=true verified. CDHash5db7241fc8253c455a1ef10546d8e4f26391902e; executableSHA256740bd89b84a113232be104198308024783e5f231d9ac624c344b8134867b2894; HermesbundleSHA256e94e8f593b82e88fbd0c129185fc5b43381e9b4e08ba06c2e3c408c73e62eca8. URL repair changes only server code/tests/docs, so no replacement mobile build is required. Native interaction/accessibility/account-switch/offline exits remain open. Production unchanged.
