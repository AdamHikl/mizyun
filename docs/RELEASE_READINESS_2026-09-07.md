# Mizyun friends-beta readiness audit — 2026-09-07

> Follow-up 2026-09-08: [implementation review](IMPLEMENTATION_REVIEW_2026-09-08.md) found partial remediation with remaining defects. R3 remains P1/open; its checked-in EAS production profile still resolves the Dev identity without an external override. Read the follow-up for current evidence; original findings below remain the closure baseline.

## Decision

**Do not distribute the current build for unsupervised testing with friends' personal data yet.** The product has enough functionality to make a small private beta worthwhile. The blockers are account privacy controls, release configuration, AI eligibility/consent/evaluation, retry integrity, and operational acceptance. An architecture rewrite or completion of every future feature is unnecessary before a narrowly scoped manual-tracking pilot.

Guided demonstrations using synthetic data can provide usability feedback now. After the gates below pass, begin with 3–5 adult friends, then expand toward the documented 10–30 design partners. This proposed smaller pilot does not mark the full MVP or beta quality gate complete. Keep AI unavailable to external testers until its separate gate passes; the founder exception does not extend to friends.

## Audit scope and evidence

- Read the product goals, business alignment, roadmap, status, backlog, requirements, release/AI gates, architecture/ADRs, alpha records, legal/store documents, relevant mobile screens/data layers, API composition and routes, provider/runtime code, migrations/security tests, and deployment/backup/CI scripts.
- Audited local `main` at `108234c`, including pre-existing uncommitted Coach, feedback-header, workout-routine, and other mobile edits. Those edits were preserved. This is not a claim that the tested tree equals the installed app or deployed server.
- Fresh `pnpm check` **passed**: formatting, all workspace TypeScript checks, iOS and Android Expo/Hermes exports, **1,269 tests**. **13 Auth/persistence integration tests were skipped.** This command does not run database/RLS verification or physical-device journeys.
- Network-free Fastify probes reproduced account export **500**, deletion challenge **200**, and account deletion **500** using the production repository composition and actual empty-token guard. No real account was deleted or exported. Two identical meal POSTs both returned **200** with different record IDs.
- Public production API health and Supabase Auth health returned **200**. Coach status reported `gemini`, `gemini-3.8-flash`, `ready: true`, `externalAccess: true`. This is configuration readiness, not a successful live model evaluation.
- Public Auth settings: signup enabled, email autoconfirm **false**, email and Google login enabled, Apple login disabled. These settings do not prove mailbox delivery, recovery links, or OAuth completion.
- Public privacy/terms/support returned **200**. Unauthenticated `/v1/me` and `/v1/account/export` returned **401**. No cross-user claim follows from these anonymous checks.
- Pi SSH failed with `Permission denied (publickey)` using the configured alias/key. Current server SHA, backup freshness, restore capability, timers, and service health could not be independently inspected.
- Native UI interaction could not proceed because Simulator control repeatedly rejected actions. An isolated web preview with dummy endpoints rendered an Expo server error, `this.validatePath is not a function`. UI findings below are **source-based**, not fresh visual/native acceptance. The web error is not evidence that the native app crashes.
- No production mutation, migration/reset, live AI request, store submission, invitation, or release occurred.

## Release findings

### R1 — P1: Account export/deletion is broken in the production composition

`apps/api/src/app.ts:494` always constructs `InMemoryAccountRepository`, including when all feature repositories are Supabase-backed. `apps/api/src/account-repository.ts:86` exports using `accessToken: ""`; deletion does the same starting with conversations. `packages/adapters/supabase-server/src/index.ts:185` rejects an empty token before making a request. The focused probe reproduced both 500 responses.

There are further gaps beyond passing a token: the orchestrator does not remove Auth identities or Storage objects, exports an empty `privateMedia` array, and has test-only profile/goal deletion hooks. The memory cleanup in `apps/api/src/modules/account/routes.ts` discards individual deletion failures via `Promise.allSettled`. Merely substituting a service-role token would not complete the lifecycle.

**Close when:** an appropriate account adapter/use case exports every durable category, handles pagination, performs retryable complete deletion of database rows/Auth/media/memory/provider references, reports failures honestly, and passes two-user integration and restart/retry tests on disposable accounts. Backups and processor retention must have an accurate documented lifecycle.

### R2 — P1: Mobile account privacy controls are missing

The Privacy group in `apps/mobile/src/features/settings/settings-screen.tsx:570` has memory controls and product-analytics export. It has no full account-data export or delete-account control. No `/v1/account` call exists anywhere in mobile source. Exporting local analytics is not exporting food, photos, workouts, or conversations.

The live legal page, repository privacy policy, terms, store description, and reviewer notes nevertheless promise complete in-app export and instant account deletion. This is a concrete mismatch, not merely missing acceptance evidence.

**Close when:** discoverable export/deletion controls call the completed R1 lifecycle; a disposable user completes both on iOS/Android; live and repository disclosures match. Provide a prominent external deletion-request route for Google Play. A support email can be part of that pathway; it need not be a new automated web application. Apple requires in-app deletion for apps offering account creation, and Google specifies the external pathway. [Apple guidelines](https://developer.apple.com/app-store/review/guidelines/), [Google deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111).

### R3 — P1: Explicit Dev/Production build isolation and signed release acceptance

**Updated 2026-09-08: still open.** Reinspection confirms the configuration below is unchanged. Implement the configuration portion once through INFRA-DUAL-003 in the [separation guide](tutorials/DEV_PRODUCTION_PI_GUIDE.md); do not create a competing release-profile fix. R3 remains the release gate, while INFRA-DUAL-003 owns the shared implementation.

`apps/mobile/app.config.js:20` defaults `MIZYUN_APP_VARIANT` to `dev`. `apps/mobile/eas.json` sets production API/Auth URLs but omits that variable. Evaluating the config with only the checked-in production profile produced:

```text
name: Mizyun Dev
bundle/package: com.mizyun.dev
scheme: mizyun-dev
auth callback: mizyun://auth/callback
EAS project ID: absent from checked-in config
```

Remote EAS variables may exist; they were not inspected. The repository's documented build command is not independently reproducible as the intended production app. Publishable-key provisioning and EAS project/signing setup also need acceptance. The older founder Android APK is documented as debug-key-signed and explicitly unsuitable for sharing with others.

**Part A — implement during separation:** `development` and standalone `preview` explicitly select `dev`, `com.mizyun.dev`, Dev API/Auth/public key and `mizyun-dev://auth/callback`. `production` explicitly selects `production`, `com.mizyun.app`, production API/Auth/public key and `mizyun://auth/callback`. Verify EAS project/environment/signing, reject mixed configurations, and prove both app identities coexist with isolated sessions. The Dev client and standalone preview may replace each other; neither may replace Production. [EAS environments](https://docs.expo.dev/eas/environment-variables/), [internal distribution](https://docs.expo.dev/build/internal-distribution/).

**Part B — close after release fixes:** build the final accepted SHA into versioned TestFlight/Play artifacts, verify the actual production configuration and cold/warm email/OAuth callbacks, and record native acceptance. Passing Part A or installing Mizyun Dev does not close R3 or approve external distribution. EAS server-side settings were not inspected in this update.

### R4 — P1: Google login needs an equivalent privacy-preserving iOS option

`apps/mobile/src/features/auth/auth-screen.tsx` prominently offers Google login. Production Auth confirms Google enabled and Apple disabled. No Sign in with Apple implementation was found. Apple's guideline 4.8 requires an equivalent login option with specified privacy features unless an exception applies; no applicable exception is evidenced here.

**Close when:** add and test a qualifying option such as Sign in with Apple, or remove third-party login from the iOS candidate and use the app's own account system. Verify linked-account behavior and deletion as applicable. [Apple login requirements](https://developer.apple.com/app-store/review/guidelines/#login-services).

### R5 — External AI gate blocked: global access, disclosure, age, and provider evidence

Production has global AI access and open signup. The inspected API uses authentication plus provider status/limits, with no tester/founder allowlist or recorded AI-sharing-consent gate. Coach/meal screens do not provide a provider-specific consent step before forwarding confirmed context or photos. Analytics consent and confirming the resulting food draft address different decisions.

`docs/BEFORE_TESTING.md` still approves an obsolete Mistral candidate and leaves provider promotion, safety, privacy, weighed-meal, injection, and native gates open. The current provider is Gemini. `docs/PRIVACY_POLICY.md` describes enterprise zero retention, while the public privacy page does not identify Google at all. Neither description establishes the actual project's terms, billing status, processing region, retention, or controls.

Google's current API terms require adult eligibility, restrict API clients likely to be accessed by under-18s, require Paid Services for EEA/UK/Swiss users, and describe limited abuse-monitoring retention and possible international processing. The EEA data-use exception should not be confused with authorization to distribute an unpaid API client. Current store copy says 12+/Everyone and the privacy document permits older minors. Do not recruit minors to this Gemini-powered pilot. [Gemini terms](https://ai.google.dev/gemini-api/terms).

**Close when:** define/enforce tester and AI eligibility, verify the actual Google project terms/settings, accurately disclose recipients/data/retention, obtain explicit AI-sharing permission, and complete the current-model evaluation gate. If running an earlier manual-only pilot, enforce disabled external AI server-side, including direct API calls. Apple explicitly requires disclosure and permission for third-party AI sharing. [Apple data-use requirements](https://developer.apple.com/app-store/review/guidelines/#data-use-and-sharing).

### R6 — P1: Quota authority and AI safety evidence need strengthening

The foundation grants authenticated users table-wide profile UPDATE with an own-row policy. A later migration adds `profiles.plan_tier`, and no column privilege restriction or immutability trigger was found. An authenticated user can therefore attempt a direct PostgREST update of their own tier to `paid`, which Coach reads for a larger token allowance. API request-schema filtering does not protect the direct database endpoint. This is a migration/code finding; it was not exploited against production.

Standalone meal text/photo/refine endpoints have a per-minute in-memory limiter but no daily token/cost reservation matching the Coach ledger. Rate limiting is not a total spend cap. `GeminiContentModerator` is a three-English-phrase local screen, not a Gemini moderation API call. Other runtime input/output guards and model safety checks exist, so this does not mean all moderation is absent; the old evaluation claims still do not establish current-model safety.

**Close when:** protect server-owned tier fields through database privileges/policies/triggers and test direct authenticated updates; budget all billable AI paths; evaluate actual Gemini outputs, tool proposals, multilingual critical cases, injection, failure, latency, and cost. Rename/document the local moderation layer accurately. This matters for external AI, while subscription billing itself can wait.

### R7 — P1: Lost-response retries can duplicate authoritative meal records

`apps/mobile/src/features/log-meal/log-meal-data.ts` POSTs without a stable operation ID. `apps/api/src/modules/food-entries/routes.ts:255` generates a fresh UUID each time. If a save commits but its response is lost, the preserved draft/retry creates another meal and inflates totals. The network-free repeated-request probe confirmed different IDs for identical submissions. This is not a claim that intentionally logging the same meal twice should be deduplicated by content.

**Close when:** persist a client operation ID with each draft and deduplicate transactionally per user/operation. Verify a committed write followed by a lost response and retry. Audit weight, workout/set creation, and multi-session saves for the same failure. Preserve intentionally separate identical entries.

### R8 — Release evidence blocked: backup, recovery, monitoring, and native matrix

Backup/promotion scripts exist; it would be incorrect to say there is no production backend or no backup code. However, `backup-production.sh` creates ordinary dump/tar archives without its own encryption step, and off-device sync is tied to the Mac being awake. Host/disk encryption, fresh remote archives, successful restores, and alert delivery were not verified. A green `/v1/health` is just a static liveness response; it does not test database, storage, email, or models.

The alpha results file records 0/7 founder days and zero participant exports. This means the repository lacks that evidence, not that the founder has never used the app. July simulator journeys and August founder builds cannot establish acceptance of September's candidate. Camera denial/recovery, low-connectivity, background/restart, small screens, dark mode, large text, screen readers, email/OAuth, deletion, and new-version upgrades require the actual iOS/Android distribution builds.

**Close when:** record the exact candidate SHA/build numbers, complete a disposable-account device matrix, restore database plus Storage into an isolated destination, verify off-device backup freshness/access protections, and test actionable outage/error reporting and rollback. Follow the existing infrastructure gate for outside reliance; do not impose the later paying-user 90-day staging requirement on a small pilot by accident.

### R9 — P1 conditional operational hazard: remote CI still runs a reset workflow

`.github/workflows/db-verify-selfhosted.yml` pulls code on a configured PC host and executes `pnpm db:verify`, whose first step is `supabase db reset --local`. The workflow describes targeting the long-lived alpha stack, contrary to current environment rules. It may fail or reach a separate CLI development stack rather than the official production Compose stack; actual secrets/enablement were not inspected. There is no explicit disposable-host guard.

**Close when:** remove this path to a persistent host or retarget it to a clearly isolated throwaway database, enforce that boundary, and verify CI required checks. Do not execute it to investigate.

## Architecture and information architecture assessment

The modular-monolith choice remains appropriate for a founder and 10–30 testers. Core and memory/runtime imports preserve the important vendor/framework boundaries. Contracts, user-token-bound repositories/RLS, signed private media, secure session storage, deterministic energy/training rules, active-only memory recall, and explicit proposal acceptance fit the long-term goals. There is no evidence here that microservices, a vector database, more model providers, or a backend rewrite would solve the release blockers.

Integration ownership is the main weakness: the account port lacks authenticated operation context, the composition root mixes persistent features with an in-memory lifecycle, and mock-heavy tests miss that combination. Provider selection still carries abstractions from removed Mistral support. Coach API orchestration is about 1,400 lines; Coach and workout screens are about 2,600 and 1,800 lines. Split policy/action execution, data lifecycle, and rendering at useful boundaries as those areas change. A wholesale refactor should not delay the critical fixes.

Source-based UI/IA assessment:

- Home / Workouts / Meals / Coach / Account is a sensible top-level structure. Dashboard quick actions, meal copy/edit/delete/history, previous workout performance, recoverable input, photo comparison, and visible feedback are useful beta surfaces.
- Settings is overloaded with developer vocabulary: “Authentication & Principal State,” raw user IDs, “Durable AI Memories,” and “client-side RLS isolation.” RLS is enforced in PostgreSQL. Prefer simple user-facing account/privacy language and keep diagnostics behind a support disclosure.
- “Product Analytics & Export” can be mistaken for full personal-data export. Give personal data its own prominent controls and name analytics separately.
- Demo preview uses a fixed synthetic profile and is reachable from sign-in/deep links. Keep a persistent demo indicator and clear exit; it must not look like an authenticated, saved personal workspace. No API authentication bypass was demonstrated.
- Do not redesign the navigation before measuring logging friction. Acceptance should check one-handed logging, keyboard visibility, large fonts, small screens, contrast, and whether users understand estimates/confirmation. These remain unverified visually in this audit.

## Comparison with the goals

| Goal                                   | What exists now                                                                                                                | Gap and implication                                                                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O1: trustworthy daily energy           | Manual meals, history/copy/edit/delete, confirmed AI drafts, deterministic targets and week/month reviews                      | Retry duplicates threaten trust; reusable meal library and full activity integration are incomplete. Manual-only pilot remains useful after integrity fixes.           |
| O2: training progression               | Exercise catalog/custom exercises, planned workouts, set logging, previous performance, current clone-on-complete routine work | Distinguish latest uncommitted routine behavior from deployed acceptance; prove repeat sessions and edits/recovery on real devices.                                    |
| O3: longitudinal progress              | Weight/waist/chest history, smoothed trend, private photo upload/compare/delete                                                | HealthKit/Health Connect steps absent; physical camera/recovery and complete account-media deletion unaccepted. Steps can be explicitly excluded from the first pilot. |
| O4: controllable memory-aware guidance | Gemini adapter, grounded tools, proposals, durable memory controls and conversations                                           | External provider/consent/evaluation gate incomplete; current moderation and cost coverage need proof. Hold external AI until accepted.                                |
| O5: replaceable infrastructure         | Ports/adapters, one API composition root, portable SQL/Storage, exact-commit promotion and backup scripts                      | Complete account lifecycle and restore evidence; Pi is current primary, Windows is backup. No rewrite needed.                                                          |
| Validation/business                    | Consent-first local analytics, aggregate analysis script, in-app feedback; free/paid model hypothesis                          | No recorded founder week/cohort retention or validated premium value/cost. Billing, social/community, and paid acquisition should wait.                                |

The current code is ahead of the older documents on meal history, workout routines, Gemini, public hosting, and confirmed email settings. It is behind some newer claims about complete privacy controls and release preparation. `ALPHA-001 ready` must not be interpreted as permission to invite users while these findings remain open.

## Smallest sensible path to friends testing

1. Establish the minimum safe Dev/Production separation first: recover Pi access, verify capacity/backups, eliminate R9's unsafe remote-reset path, create isolated Dev persistence and deploy targets, and complete R3 Part A. Adopt explicit production releases instead of automatically promoting feature commits. Prove Dev actions leave production intact before using it for release-fix acceptance.
2. Implement R1/R2 account privacy and R7 retry integrity in that environment, then R4 login and accurate policies/access controls. Complete R5/R6 before external AI or enforce a manual-only pilot. Local unit/domain fixes can proceed if Pi setup is blocked, but they must not trigger unverified production promotions.
3. Close R3 Part B and R8 on the final release candidate. Record exact tested artifact/server versions and a founder week, recovering existing private evidence if available. Avoid adding a third staging stack, OTA updates or broad infrastructure refactors before these fixes.
4. Invite 3–5 adults with a concrete one-week task: onboard, log meals, complete at least two workouts, record weight, restart/retry, and use feedback. Measure first-record activation, time/taps, repeat days, failures, and whether the weekly view helps. Collect only voluntary privacy-safe exports.
5. Expand toward 10–30 target design partners after the complete loop is stable. Full MVP acceptance still includes the remaining requirement IDs; paid validation still needs entitlements, purchase/restore, retention, and unit economics.

## Distribution options

- **iOS:** use TestFlight external testing for friends. Apple reviews the first external build; internal testers are App Store Connect team users, so do not grant friends team access merely to avoid external review. [TestFlight external testing](https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers/).
- **Android:** use Google Play internal testing initially (up to 100 testers) with a properly signed App Bundle. Closed testing fits the later cohort. For personal accounts created after November 13, 2023, production-access eligibility requires at least 12 continuously opted-in closed testers for 14 days and a subsequent application; internal testing does not satisfy that requirement. This condition should not be assumed for organization accounts. [Play testing tracks](https://support.google.com/googleplay/android-developer/answer/9845334?hl=en), [personal-account requirements](https://support.google.com/googleplay/android-developer/answer/14151465).

Owning the Apple Developer membership removes a distribution prerequisite. It does not close the app's privacy, reliability, AI, or device acceptance gates.
