# Production release 2026-10-23

Requested by Adam: promote the current `main` to Production, keep existing builds working, install the new Anthropic API key, install Production on the iPhone, then build the Store packages.

## Backend

- Candidate: `b2b1591cb23fa203643f86d61e9003e250d81c23`. The previous Production release was `70adb7cc` (Oct 21), so this candidate adds 48 commits. Those include #327/#329 offline cache with ETag/304 and no-store, #331, #321, #265, #298, the overnight fixes and the Community join fix. No new migrations.
- Anthropic key: Dev's `ANTHROPIC_API_KEY` was rotated on 2026-10-22 at 21:48Z, but Production still had the old key. The Dev value was copied into `/etc/mizyun/production.env` at 19:00Z without being printed. Backup: `production.env.bak-20261023T190033Z-anthropic-key` (60 lines before and after; owner `root:mizyun`, mode 640).
- `pnpm deploy:production b2b1591c…` passed. That covers `pnpm check` and `pnpm db:verify` on the candidate, and `mizyun-backup-for-deploy.service` completed before the promotion. The ledger reported "Remote database is up to date". Public health returned 200 at 19:09:04Z.
- After the restart:
  - The API was active, with 0 error-level log lines since 19:05Z.
  - Routing was `coach/mealText/activityDraft=anthropic`; every other feature routes to `gemini`.
  - An Anthropic `GET /v1/models` request made with the Production key returned HTTP 200.
- Old-client compatibility (independent Opus review of `70adb7cc..b2b1591c` for 1.0.9 and 1.0.10) found no blocker:
  - No routes or fields were removed, and `client-compat.ts` is unchanged.
  - 304 is sent only when the request includes `If-None-Match`, which old clients never send.
  - Low risks: a workout set with every field null now returns 400, and drafts are rate-limited per minute (existing `RATE_LIMITED` shape).
  - API tests passed: 1377, with 15 skipped. Real-client smoke testing of 1.0.9 against Production was not run.

## iPhone

- Production 1.0.10 (10) Release build from `b2b1591c`: installed and launched on `00008140-001114501A86801C` at 19:28:10Z (team `LQJNDVBL43`). 1.0.10 is kept because Adam confirmed it was never uploaded to either store.
- Adam's device check failed: Community Join showed "User or request not found". At 19:38:34Z and 19:39:14Z the Kong log shows `POST /rest/v1/rpc/community_save_profile` returning 400 (P0001 `community_unavailable`), which the API mapped to 404.
- Cause: Production `public.community_operations` had stayed fully closed (`enabled/enrollment/discovery/publish/engagement/delivery=false`, `cohort_required=true`, empty pilot cohort) since migration `20260930210000`. The Oct 21 release turned on only the API env flags. Dev had the switch open, so this only failed on Production. To reproduce, replay as the account in a transaction that is rolled back: `community_operation_guard` raises on the insert.
- Fix (Adam-approved 2026-10-23, all users): set `enabled/enrollment/discovery/publish/engagement=true`, `delivery=false`, `cohort_required=false`. The rolled-back replay then returns `active`. A temporary copy of the switch values was briefly created in `public` and dropped immediately; the previous values are recorded above.
- Copy fix: when the 18+ box was not ticked, the join hint showed zod's raw "Invalid literal value, expected true". `createCommunityProfileSchema.adultDeclaration` now has a friendly message. The regression test in `profile-form.test.ts` fails before the fix and passes after. Effect: mobile hint and API 422 text only.
- Waiting on Adam's device check of the rebuilt app. After that come the Store IPA and AAB, which Adam uploads himself.

## Rollback

To roll back the code to `70adb7cc`, restore `production.env.bak-20261023T190033Z-anthropic-key` only if the old key is still valid. Otherwise keep the new key, which works with both versions.

## Store packages (2026-10-24, source `bdbd15d7d7910d2b93616d3ce5286feb9c8a104b`, 1.0.10 (10))

- Adam confirmed that Community works on the Production iPhone build (`bdbd15d7`, installed 19:52Z).
- **iOS.** `pnpm mobile:founder-production:ios:ipa --sha bdbd15d7… --build-number 10`. The first run failed because the non-UTF-8 shell broke `pod install`; it was rerun with `LANG/LC_ALL=en_US.UTF-8`.
  - The isolated full gate passed (input SHA-256 `75e1581a…`) and the archive was created.
  - CLI export failed with "No Accounts" / no "iOS Distribution" certificate, the same as on Oct 22. Adam exports through Xcode Organizer.
  - The archive was verified: `com.mizyun.app` 1.0.10 (10), team `LQJNDVBL43`. The bundle contains the Production API and the join fix.
  - The archive was copied to `apps/mobile/dist/releases/ios/app-store/archives/` and `~/Library/Developer/Xcode/Archives/2026-10-24/`, as `Mizyun-1.0.10-10-bdbd15d7…-20261024T061458Z.xcarchive`.
- **Android.**
  - The build ran `pnpm mobile:founder-production:android:prebuild`, then `bundleRelease` with process-scoped `MIZYUN_ALLOW_DEBUG_KEYSTORE_IN_RELEASE=true` (the Gradle keystore guard has no password env).
  - `signBundle` then stripped that signature and re-signed with the upload key from Keychain.
  - The certificate SHA1 `A3:37:60:CF:…:70:4D` matches Play.
  - Artifact: `apps/mobile/dist/releases/android/google-play/Mizyun-1.0.10-code10-bdbd15d7….aab`, 79,201,823 bytes, SHA-256 `9b060af6cdffc526c5674540ad39ec6bee3f5ef3bd1eb525dbe9bbe7a617ace2`. The AAB contains the Production API, the join fix and `com.mizyun.app`.
- Still open:
  - Adam's Organizer export and App Store Connect / Play Console uploads.
  - Store review.
  - Android physical-device check of this exact AAB, which has not been run.
