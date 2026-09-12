# Sign in with Apple and App Store implementation plan

Date: 2026-09-11. Status: planned; implementation deferred at the user's request.

## Objective and boundaries

Enable reliable native Sign in with Apple, validate it on Mizyun Dev, and distribute an accepted Production build through TestFlight and the App Store using local Xcode tooling (ADR-0023). This plan supports AUTH-01–03 and Phase 9 of the roadmap. It does not mark existing release gates complete or authorize a Production promotion during this planning session.

The founder reports having an Apple Developer license. Active paid membership, team ownership, signing permissions, and App Store Connect access still require verification. No application code, signing configuration, remote service, or Apple account was changed in this session; no archive was built or uploaded.

## Inspected baseline

Source checkout: `6304400` (short SHA), clean at inspection on 2026-09-11. Recheck the current checkout and deployed SHAs before implementation; historical status entries are not fresh release evidence.

| Area               | Existing implementation                                                                                                                                                                                             | Remaining gap                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native Apple login | `apps/mobile/src/features/auth/auth-screen.tsx` generates a random nonce, sends its SHA-256 digest to Apple, and exchanges the identity token plus raw nonce through the identity adapter. Cancellation is handled. | Physical-device proof, lifecycle coverage, and effective provider configuration.                                                                  |
| iOS capability     | `apps/mobile/app.config.js` enables `expo-apple-authentication` and `usesAppleSignIn` only with `MIZYUN_ENABLE_APPLE_AUTH=1`.                                                                                       | Paid-team provisioning and intentional configuration for each variant. OS availability alone does not establish entitlement or backend readiness. |
| Supabase           | ID-token exchange is implemented in `packages/adapters/supabase-mobile`. Local Apple provider configuration exists. Dev Compose pins GoTrue v2.189.0 and exposes an enable flag.                                    | Dev template lacks Apple client-ID configuration. Actual Dev/Production runtime configuration has not been inspected.                             |
| Account deletion   | Durable Supabase account-deletion workflow exists.                                                                                                                                                                  | No Apple token revocation was found. Verify GoTrue behavior; do not assume deleting Supabase Auth revokes Apple's grant.                          |
| Native identity    | Dev: `com.mizyun.dev`; Production: `com.mizyun.app`.                                                                                                                                                                | Register/verify both under the correct paid team and preserve environment isolation.                                                              |
| Distribution       | Local iOS scripts support prebuild and device Release builds; Xcode 26.6 (17F113) was observed by the audit helper.                                                                                                 | Explicit archive/export workflow, configurable team and build number, signing validation, App Store Connect record and upload.                    |
| Store disclosures  | `docs/STORE_LISTING_DISCLOSURES.md` and legal routes exist.                                                                                                                                                         | Stale age rating, unsupported claims, unverified reviewer account, and privacy answers need correction.                                           |
| Release acceptance | Existing quality and remediation gates are documented.                                                                                                                                                              | Standalone device journeys, recovery rehearsal and all other applicable unresolved gates remain requirements.                                     |

## Execution order

`APPLE-001 account setup → APPLE-002 native/provider configuration → APPLE-003 Apple lifecycle → APPLE-004 Dev acceptance → STORE-002 TestFlight → STORE-003 App Review/release`

`STORE-001 archive tooling and listing preparation` can run alongside APPLE-002/003. It must not upload or release an unaccepted candidate. Retain the existing remediation sequencing before remote deployment; this plan adds distribution work without superseding Q1–Q9 closure requirements.

Use the fewest helpful agents. Delegate a bounded module, test investigation, or read-only review with disjoint file ownership. The coordinator owns continuity documents, integration, final checks, commits, deployments and Apple account mutations. Require a reviewer who did not author authentication, deletion or release-tooling changes.

## APPLE-001 — Verify Apple account and app identities

1. Read the newest `status.md`, inspect the working tree, and run `pnpm context auth` and `pnpm context environment-build-deployment`.
2. Verify paid membership is active and identify the actual Team ID and membership type (individual or organization). The scripts' historical `PP89XZBW4U` is not verification. Confirm the intended seller identity before creating a store record.
3. Verify Xcode Settings → Accounts and App Store Connect access. The founder completes login/2FA and any required legal agreement or identity/contact declaration.
4. Inspect existing App IDs and app records before creating anything. Preserve `com.mizyun.app` for Production and `com.mizyun.dev` for Dev; resolve any ownership conflict explicitly.
5. Enable Sign in with Apple for both App IDs and regenerate the required provisioning profiles. Decide grouping deliberately; backend token audiences must remain environment-specific regardless of Apple grouping.
6. Register/verify actual outbound email domains or addresses with Apple’s private email relay. Check SMTP SPF/DKIM and actual transactional/recovery delivery to Hide My Email recipients; native login success alone does not prove delivery.
7. Record non-secret team/app identifiers, capability status and signing prerequisites. Never store private keys, session tokens, passwords or review credentials in Git or chat.

**Exit:** Verified paid team, correct owned App IDs, enabled capability and usable signing access. App Store Connect legal/contact questions have named founder actions where unresolved.

## APPLE-002 — Configure native login and backend audiences

Expected files: mobile app config, auth UI/composition, identity/mobile adapter tests, iOS build scripts, Dev Compose and the verified authoritative Production configuration.

1. Refresh official Expo SDK 57, Apple and Supabase/installed GoTrue documentation. Inspect both Pi environments read-only over Tailscale, including effective GoTrue image/configuration and the source of Production Compose. Report only redacted configuration facts.
2. Wire the paid-team capability into the intended builds. Retain an explicit way to make capability-disabled local builds. Ensure UI visibility respects build configuration as well as OS support; `isAvailableAsync()` is not a provider-readiness check.
3. Preserve the nonce contract: cryptographic fresh nonce per attempt, SHA-256 to Apple, raw nonce to GoTrue, server verification enabled. Never add a skip-nonce workaround.
4. Configure the native audience as `com.mizyun.dev` on Dev and `com.mizyun.app` on Production. Avoid accepting both audiences on both servers. Confirm exact settings supported by the pinned GoTrue version before changing templates or runtime configuration.
5. Native ID-token login should not acquire a web Services ID/client secret solely to mimic browser OAuth. Assess Apple lifecycle credentials separately in APPLE-003; web/Android Apple OAuth is outside this initial native iOS scope.
6. Handle cancellation, absent token, duplicate taps, provider disabled, network failure, first and repeat login, Hide My Email, and missing name/email fields. Either persist first-login name safely or intentionally collect a display name in onboarding; never erase existing profile data with null repeat-login fields.
7. Check existing Google/email behavior and account-linking semantics. Do not merge accounts based on client-supplied email or infer identity from relay addresses.

**Checks:** Regression at actual boundaries for token/nonce forwarding and failed exchanges; config evaluation for enabled/disabled capability and each variant; independent security review. Live invalid-signature, nonce mismatch/replay behavior and wrong-audience denial require real backend evidence, not mocked adapter results.

**Exit:** Local implementation and configuration reviewed and automatically verified. Mark Dev deployment and physical-device acceptance separately.

## APPLE-003 — Complete Apple authorization lifecycle

Expected areas: identity ports/contracts, API composition/routes, server adapter, deletion worker, mobile reauthentication, and any necessary forward migration. Read `pnpm context account-lifecycle` and applicable Q4 plan/evidence sections before edits.

1. Verify whether the exact GoTrue native-ID-token flow retains an Apple refresh/access token and whether account deletion revokes it. Existing Supabase deletion alone is not evidence.
2. Design the missing revocation path using Apple's token endpoint and revocation API. Document the selected credential lifecycle in an ADR before implementation. A native Apple authorization code is short-lived and single-use; it must be exchanged server-side with ownership/identity checks. The current mobile flow discards this code.
3. Choose a reviewed strategy: securely retain revocable Apple credentials server-side, or obtain fresh authorization when deletion is requested with a durable recovery path. Address existing Apple users without a retained token. Do not rely solely on users manually revoking access in Apple settings.
4. Verify/create the Sign in with Apple server key and Key ID with the correct primary App ID association for the selected exchange/revocation design. Confirm grouping and key association support separate Dev/Production audiences. Keep signing keys/client secrets server-only, with restricted access, rotation and redacted logging. Any stored provider token requires encryption, key ownership, minimal retention, RLS/ownership boundaries and exclusion from account exports. Do not add raw provider secrets to mobile storage or general metadata.
5. Integrate revocation into the durable deletion workflow so restarts, retries and partial failure cannot silently mark it complete or lose the only revocation credential. Preserve deletion initiation and recovery when Apple is unavailable; record outstanding work truthfully.
6. Handle revoked authorization and session restoration explicitly. Verify foreground/startup behavior on real devices and define server notification handling if needed; client event listeners alone are not server-side revocation proof.

**Checks:** Expired/reused authorization code, wrong user/audience, replay, Apple timeout/5xx, lost response, duplicate deletion and worker restart; account without Apple identity; Apple identity without stored token; no secret leakage. Real synthetic-account deletion must confirm Apple grant revocation and Supabase/data cleanup. Independent lifecycle/security review is mandatory.

**Exit:** Apple sign-in users can delete their accounts through a reliable, reviewed flow that revokes Apple authorization; recovery behavior is evidenced. This is a public-release blocker, not optional polish.

## APPLE-004 — Dev deployment and device acceptance

1. After writes settle, format changed files, run focused tests and `pnpm check`, inspect the diff, and record the exact source SHA. Keep provider integration tests disabled until their existing checklist permits them.
2. Reverify deployment safeguards, Tailscale, destination and environment isolation. Deploy the verified candidate only to Dev, with required configuration/migrations; keep the Pi checkout pristine.
3. Build a newly provisioned standalone `com.mizyun.dev` Release app. Inspect the signed entitlement and provisioning team; a JavaScript update cannot add native entitlements.
4. On physical iPhone test first login with shared email and Hide My Email, transactional/recovery email delivery, cancellation, repeat login, sign-out, restart, expired session, network loss, revocation and deletion. Use synthetic test data/accounts.
5. Verify onboarding, email-login compatibility, account linking behavior, meal/photo logging and export after Apple login. Confirm Dev/Production tokens are rejected in both opposite environments and the native Apple audience configuration is isolated.
6. Complete the existing standalone/Mac-off journey and recovery gates applicable to this candidate; do not reuse an old install as proof of the new build.

**Exit:** Record source/deployed SHAs, migrations, build/version, team and device identifiers, exact journey results, redacted evidence and unresolved failures. APPLE-002/003 cannot close solely on unit tests.

## STORE-001 — Prepare local archive tooling and truthful listing

### Build and signing

- Extend the local Production iOS workflow with repeatable archive and export steps, preserving ADR-0023. No EAS dependency.
- Accept a verified Team ID and explicit monotonically increasing build number; validate inputs and record version/SHA. Reject mismatched variant, hosts, redirect, native identity, missing signing inputs and conflicting ambient configuration.
- Ensure prebuild and archive bundling inherit the same reviewed Production public environment with Expo dotenv overrides disabled. Do not depend on a separately opened Xcode inheriting a shell's variables.
- Guard against stale Dev native output and preserve any intentional native changes before regeneration. Use unique archive paths and do not overwrite accepted artifacts.
- Separate archive/export from upload. Validate bundle ID, embedded production configuration, entitlements, provisioning, signing, SDK privacy manifests and absence of server secrets in the actual archive.
- Remove the historical Tailscale HTTP exception from Production config if no longer required. Correct camera permission copy to include meal and progress photos. Decide required notification capabilities from actual features rather than enabling unrelated services with the new license.
- Add meaningful negative tests for wrong environment/stale native output/missing signing configuration, then independent tooling review. Actual archive/export/signature validation remains a distinct gate.

### Metadata and privacy

- Correct `docs/STORE_LISTING_DISCLOSURES.md`: use the current age questionnaire; do not reuse the hardcoded 12+ rating. Distinguish product age eligibility from Apple's assigned rating.
- Replace instant-deletion and complete-export promises with actual behavior (asynchronous deletion; JSON plus temporary photo links with stated limits). Remove unsupported at-rest encryption/provider-training claims until verified against effective infrastructure and provider terms.
- Reconcile App Privacy responses against the actual app, backend, AI provider, analytics, diagnostics and notification SDK data flows. Do not copy the draft's diagnostics/linkage answers without evidence.
- Verify that the published support mailbox receives mail, and verify public privacy/support URLs, terms, retention and AI-sharing consent match the release. Update in-app text and legal documents together where required.
- Capture screenshots from the accepted build with synthetic data and current Apple specifications. Supply description, subtitle, keywords, category, copyright, review contact and accurate navigation notes.
- Create a functional review account through the normal secure process, seed synthetic examples, and enter credentials only into App Store Connect. Remove example passwords and claims of a prepared account from the draft until verified.
- Founder decides initial storefronts, EU trader status/contact details, seller identity, availability and free versus paid launch. Do not infer a monetization launch from the license purchase. If digital subscriptions are included, add StoreKit purchase/restore and entitlement acceptance before submission.

**Exit:** Reviewed archive tooling and listing draft; all outstanding founder declarations and release blockers listed. No unsupported compliance claims or plaintext review credentials in repository artifacts.

## STORE-002 — TestFlight acceptance

Dependencies: APPLE-004, STORE-001 and all applicable existing release gates. Production backend promotion remains a separate explicitly approved milestone; confirm compatible accepted backend/configuration before a Production TestFlight build is used.

1. Create or reuse the App Store Connect record for `com.mizyun.app` under the verified team.
2. Archive the exact candidate locally and validate/export for App Store Connect. Record archive identity and validation output.
3. Upload, wait for Apple processing, resolve warnings/errors, and complete export-compliance and beta-review information accurately. External testing may require Apple's beta review; respect the approved tester scope and backend AI policy.
4. Install through TestFlight and repeat standalone login, Apple revocation/deletion, core logging, photo access, export, consent/AI limits and update-from-existing-build checks. TestFlight Production uses the same app identity as the eventual App Store app, while Dev remains separate.

**Exit:** Processed TestFlight build, accepted journeys and compatible backend evidence tied to exact build/SHA. Upload success does not mean release acceptance.

## STORE-003 — App Review and release

1. Reconcile every open gate in `docs/QUALITY_GATES.md`, `docs/REMEDIATION_EVIDENCE_CHECKLIST.md` and this plan against current evidence. Resolve public rollout capacity, monitoring, backup/restore and support readiness; do not assume founder Pi operation is public or paying-user readiness.
2. Complete final metadata/privacy/age/accessibility/export-compliance answers and reviewer access. Founder resolves legal/contact/storefront declarations.
3. Select the accepted build and submit for App Review after the concrete release package is ready. Prefer manual release so approval does not unexpectedly publish the app.
4. Handle review findings with focused fixes and repeat affected acceptance. Any new binary gets a new build number and evidence.
5. At the explicit release milestone, release the accepted version, verify live listing/install/sign-in, and monitor errors, deletion queue, API capacity and AI spend. Document incident response and recovery: backend rollback must remain compatible; a shipped iOS binary cannot be instantly replaced on every device.

**Exit:** Apple-approved and intentionally released version, verified live install and operational evidence. Keep implemented, automatically verified, Dev deployed, device accepted, TestFlight distributed and App Store released statuses distinct.

## Next-session starting prompt

> Implement APPLE-001 and begin APPLE-002 from `docs/APPLE_SIGN_IN_APP_STORE_IMPLEMENTATION_PLAN_2026-09-11.md`. Inspect the latest working tree/status first and refresh official documentation. Verify the paid Apple team, identifiers and capabilities; inspect effective Dev/Production Apple provider configuration read-only. Delegate a bounded independent audit/test task. Preserve separate native audiences and existing release gates. Continue local work while any founder account steps are pending; do not promote Production or submit an unaccepted build. Track Apple revocation/deletion under APPLE-003 before public release.

## Primary sources and handoff

Consulted 2026-09-11; refresh time-sensitive requirements at implementation:

- [Expo SDK 57 AppleAuthentication](https://docs.expo.dev/versions/v57.0.0/sdk/apple-authentication/) — native capability, button, credential and device behavior.
- [Expo SDK 57 app configuration](https://docs.expo.dev/versions/v57.0.0/config/app/) — build number, bundle identity, entitlements and public extra configuration.
- [Supabase Apple authentication](https://supabase.com/docs/guides/auth/social-login/auth-apple) — native identity-token flow, audience configuration, one-time name fields and native/web distinctions.
- [Apple private email relay](https://developer.apple.com/help/account/capabilities/configure-private-email-relay-service) and [Apple server key setup](https://developer.apple.com/help/account/capabilities/create-a-sign-in-with-apple-private-key/) — relay delivery and token-lifecycle signing prerequisites.
- [Apple account deletion](https://developer.apple.com/support/offering-account-deletion-in-your-app/) — Apple token revocation requirement.
- [Apple distribution](https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases) and [upcoming requirements](https://developer.apple.com/news/upcoming-requirements/) — archive/distribution and current SDK requirements.
- [App Store Connect app creation](https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app/), [age rating](https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating), [App Privacy](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/) and [EU trader requirements](https://developer.apple.com/help/app-store-connect/manage-compliance-information/manage-european-union-digital-services-act-trader-requirements).
- [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) — login, account/privacy, AI-sharing and review access requirements.

Planning evidence: coordinator repository inspection and official-source research, plus a read-only helper audit of release tooling, disclosures and Apple requirements. No runtime tests, signing, backend changes, device acceptance or App Store submission were performed for this plan.

Independent plan review found no blocking sequencing or safety issues; relay delivery, server-key association and mailbox verification suggestions were incorporated. Documentation formatting, navigation checks (0 errors; 12 existing stale-review warnings), and diff whitespace validation passed. Full application tests were not run for this documentation-only planning change.
