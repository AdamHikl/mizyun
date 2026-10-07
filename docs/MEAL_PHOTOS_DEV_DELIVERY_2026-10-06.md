# Private meal photos — Dev delivery, 2026-10-06

Issue [#218](https://github.com/AdamHikl/mizyun/issues/218). Implementation is isolated in managed branch `codex/meal-photo-thumbnails`, `/Users/adam/.codex/worktrees/meal-photo-thumbnails/mizyun`. It preserves Pro multi-photo3984c35 and the accepted running938efc5 deployment. Concurrent shared-checkout Health preview/export/simulator/settings changes are preserved and excluded from this candidate. Production is unchanged.

## Behavior and data handling

Photo-based meal logging offers Keep photo with meal. One compressed JPEG appears as a compact saved-card thumbnail; tapping opens a preview with removal. Multiple source photos require an explicit matching choice. A photo failure preserves the confirmed meal and a user-scoped Retry/Discard operation.

Retained photos have a640px longest edge and256KiB limit. The server decodes/reencodes pixels and strips metadata. Private Storage, typed ownership, owner-only reads, short-lived signed links, durable cleanup for photo/meal/account deletion and abandoned uploads, export linkage and account-scoped local cleanup are implemented. Production UI/backend guards remain disabled. Mobile remote caching is disabled initially.

## Verification

- Independent High nonauthor review approved after resolving upload/deletion/account-cascade and native retry/account-identity findings. Final integration review confirmed running API/export/purge and production guards. No agent author report substitutes for coordinator checks.
- Coordinator focused mobile272/API140 passed. Dedicated disposable local Supabase `mizyun-meal-photo-218`, API54721/DB54722: combined34SQLfiles924assertions passed, including23 new photo assertions. No shared Mac, Hetzner or Pi database reset occurred.
- Real local Auth/API/Storage probe passed32 checks with synthetic accounts and zero provider calls: invalid bytes/dimensions, trusted metadata stripping, lost-response retry, cross-user denial, direct mutation/overwrite denial, export association and erasure. Finally cleanup was checked.
- Initial combined source303e2e5bd567cec0023467a0bc6c41be72cf4399 full gate passed input41706751990295762f982f500a7f071a0f130427f073a90d64810954d040fc66. Canonical deployment reran the full gate, input33a9dd50b0386b0e8ef95fee3f3db7c3cccc1bc77db2d1f48e222f6ff9a0f59a.
- Live Dev acceptance exposed an internal8100 port retained in a public signedURL. The adapter now explicitly assigns protocol, hostname and port while preserving signed path/query. The actual SDK transport regression failed before the repair and passed after it;14 focused adapter tests and typecheck passed. Independent review also covered public443/custom8443 URL preservation. [Node URL semantics](https://nodejs.org/api/url.html#urlport), checked2026-10-06, support the explicit port assignment.
- Repair source a64a15898c43ece0c2e551086f040c645e2b5baa passed the full gate inpute06d47bb859155685ac52fc78f8f1dc62fc8cb218bdd5a2b83c778a6b51b649e: mobile1563/API880/adapter169 passed, both platform exports, formatting/types, navigation and operational/build safeguards passed.15 existing API integration skips and3 config bundle-path skips remain unrun; no live AI-provider acceptance is claimed.

## iPhone delivery

Standalone Release built, installed and launched2026-10-06T18:32:40Z. iPhone16Pro00008140-001114501A86801C, bundlecom.mizyun.development, version1.0.9(9), teamLQJNDVBL43. Independent process inventory confirmed PID9670. Embedded Dev API/Supabase/callback endpoints and enableMealPhotos=true were verified.

Artifact: `/Users/adam/.codex/worktrees/meal-photo-thumbnails/mizyun/apps/mobile/ios/build/Build/Products/Release-iphoneos/MizyunDev.app`. Source303e2e5 mobile tree; repaira64a158 changes only server/tests/docs. CDHash5db7241fc8253c455a1ef10546d8e4f26391902e; executableSHA256740bd89b84a113232be104198308024783e5f231d9ac624c344b8134867b2894; bundledHermesSHA256e94e8f593b82e88fbd0c129185fc5b43381e9b4e08ba06c2e3c408c73e62eca8. Installation/running process do not prove signed-in photo interaction.

## Open acceptance

Native photo Save/reopen/preview/remove, offline/restart Retry/Discard, account switching, multi-photo matching, max-font/VoiceOver and Android checks remain open. Simultaneous generic-media/meal deletion may cause a safe atomic rollback requiring retry; an expired thumbnail tap may require another tap after refresh. No Production release or Store upload occurred.

## Final exact Dev acceptance

Canonical promotion ofa64a15898c43ece0c2e551086f040c645e2b5baa succeeded2026-10-06T18:49:09Z. Deployment reran the full gate:PASS input72c299d30b65ea696a90d623efbda820336cdb1906e6f43948561050fa50ca73. Operator verification confirmed a pristine exact checkout `/var/lib/mizyun/dev/repo`, active/running `mizyun-api-dev.service` PID3424542, API4100/DB5433 and migrations20261006120000/20261006183000/20261006200000. Public health returned200. Remote branch `codex/meal-photo-thumbnails` equalsa64a158; no merge into shared main was performed.

Real public Dev probePASS32checks, synthetic-only and zero provider calls. It verified successful retained JPEG upload/download through the public Dev origin, invalid-input checks, metadata removal, duplicate-safe lost-response retry, cross-user read/removal denial, direct RPC/Storage mutation denial, export association, photo deletion preserving the meal, meal deletion erasing bytes and Auth-account-cascade erasure. All synthetic account cleanup was checked; no synthetic account is intentionally retained. The live probe uses real Auth/Storage and the public API, rather than a mocked signing response. [Redacted result](evidence/meal-photos-2026-10-06/public-probe.json).

The dedicated disposable Mac stack was stopped with data preserved; the existing shared stack was untouched. Final native interaction remains the exact next action: take a photo in installed Mizyun Dev, save with Keep photo with meal enabled, reopen the meal card, tap the thumbnail, then remove it and verify the meal remains. Broader offline/account-switch/multi-photo/accessibility/Android exits above remain open. Issue218 remains active awaiting native acceptance.
