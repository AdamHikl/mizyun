# Production feature release — 2026-10-21

Decision record: [ADR-0078](adr/0078-production-feature-release-2026-10-21.md). Adam asked to release Community, indoor bouldering, AI-tailored evening stretch, Health run imports, retained meal photos, recipes (ideas, ingredient photos, cooking assistant) and the ADR-0077 AI routing to Production, keep Store build 1.0.9 working, and skip device testing.

## Source and checks

- Commit `70adb7cccb564b7de3579cbc583580fdb193da97` on `main` (over `89336cf8`).
- Final `pnpm check` PASS on the settled tree (input SHA-256 `57d0928f…`): 3494 mobile, 1328 API (+15 skipped), 408 contracts, 826 core, 303 supabase-server, 125 config, 79 api-client tests. The Production driver reran `pnpm check` and `pnpm db:verify` on the candidate before promotion.
- `pnpm db:verify` PASS locally: 53 pgTAP files, 1694 tests, including new `0052_account_provider_revocation_skipped`.
- Reviews (independent Opus reviewers, not the authors): AI routing (no blockers); account deletion, migration and build-9 shims (one blocker: Production builds did not request imported runs — fixed in `run-list-query.ts`); bounded re-review of the fixes (no blockers; stale env wording and a photo-routing test added).
- Build-9 compatibility: frozen contract fixtures in `apps/api/src/test-fixtures/build9-contracts/` (from `dd5b4353`); `release-compatibility.test.ts` covers export, goals, AI consent and Community for requests without `x-mizyun-api-compat`.

## Dev

- `pnpm deploy:dev 70adb7cc…` succeeded; migration `20261021120000_account_provider_revocation_skipped` applied; public health 200 at 17:18:36Z.
- `dev.env` gained `APPLE_REVOCATION_ENCRYPTION_KEY` (backup `dev.env.bak-20261021T174040Z-revocation`); Dev API restarted healthy.

## Production

- First promotion attempt stopped before any change: the release journal `/var/lib/mizyun/repo/.git/mizyun-production-release-journal.jsonl` had mode 664, which the script rejects. With Adam's approval it was set to 600 (owner `mizyun`).
- `pnpm deploy:production 70adb7cc…` succeeded: deploy backup `mizyun-backup-for-deploy.service` finished 17:39:36Z, 24 migrations applied (`20261006120000` through `20261021120000`), API restarted, public health 200 at 17:39:48Z.
- Env switches (Adam-approved), backup `production.env.bak-20261021T174040Z-release`: Community flags on (delivery off), safety contact and Terms URL, `MIZYUN_BOULDERING_ENABLED`, `MIZYUN_STRETCH_AI_ENABLED`, `MIZYUN_RUN_IMPORTS_ENABLED`, `MIZYUN_MEAL_PHOTOS_ENABLED`, `MIZYUN_MEAL_RECIPES_ENABLED`, Anthropic key (copied from Dev, not printed), `ANTHROPIC_ENABLED`, eight provider keys, Apple key at `/etc/mizyun/certs-production/` with `APPLE_CLIENT_ID=com.mizyun.app` and a new revocation key. `AI_CONSENT_ACCEPTED_VERSIONS` left unset (accepts 2026-09-08, 2026-10-20, 2026-10-21).
- After restart: local and public health 200; logged routing `coach/mealText/activityDraft=anthropic`, all other features `gemini`; no error-level log lines since 17:40Z.
- Unauthenticated probes: `/v1/coach/status` 200 (Gemini for a caller without consent context); `/v1/stretch-plans/refine`, `/v1/runs/imports`, `/v1/bouldering/sessions`, `/v1/meal-recipes/capabilities` and the meal photo route return 401 (registered), not 404 or 503.

## iPhone

- `pnpm mobile:install:ios:production`: Release build 1.0.10 (10), `com.mizyun.app`, installed and launched on `00008140-001114501A86801C` at 17:31:27Z. Artifact `apps/mobile/ios/build/Build/Products/Release-iphoneos/Mizyun.app` (a device build, not a Store IPA).

## Not done or not verified

- Signed-in journeys for every released feature on the iPhone (device testing skipped by Adam). Nothing above proves a feature works for a signed-in user.
- Apple key `D8TB43DBS5` against `com.mizyun.app`: unproven until a real Apple-linked deletion with an authorization code.
- No Community moderator: `itinn@itinn.eu` has no Production account; set `COMMUNITY_MODERATOR_USER_IDS` after it signs up.
- `docs/TERMS_OF_SERVICE.md` lacks a Community clause; `docs/COMMUNITY_STANDARDS.md` is a draft; the website copy is not updated.
- App Store Connect privacy labels and Play Data safety (see `docs/STORE_LISTING_DISCLOSURES.md` §5), Store IPA/AAB, upload and review.
- Rollback note: an API rolled back to `9b0c41a` rejects `skipped_no_authorization_code` revocation rows; restore `production.env.bak-20261021T174040Z-release` with any code rollback, because older code refuses Anthropic routes without `ANTHROPIC_DEV_TESTING`.
