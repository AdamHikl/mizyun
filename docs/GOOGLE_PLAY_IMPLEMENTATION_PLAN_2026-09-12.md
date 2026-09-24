# Google Play publishing implementation plan

Date: 2026-09-12. Status: planned; this session prepares documentation only.

## Objective and scope

Publish Mizyun on Google Play using a locally built, signed Android App Bundle (AAB), following internal testing, any required closed testing, and explicit release acceptance. This is Phase 9 distribution work under ADR-0023; EAS is not required.

The user reports the Apple side should already be completed. Apple implementation is outside this plan. Reuse accepted shared backend work, while verifying Android behavior and the actual backend candidate. This document does not certify Apple deployment or reopen its implementation.

Do not purchase accounts, change signing keys, invite testers, upload builds, deploy or publish during this planning session. Existing uncommitted Apple/authentication/icon work must be preserved. The planning snapshot is based on checkout `6304400` plus that working tree; it is not a clean release candidate.

## Current repository baseline

| Area              | Observed                                                                                                                             | Required next proof                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Native identities | Android Production `com.mizyun.app`; Android Dev `com.mizyun.dev`. iOS Dev now differs.                                              | Preserve Android identities; do not copy the newer iOS Dev identifier into Android accidentally.     |
| Build command     | `scripts/mobile-founder-production-android.sh` supports `prebuild`, `assembleRelease`, `bundleRelease`, with production host checks. | Inspect generated environment, AAB and signer; script existence is not store acceptance.             |
| Signing           | `with-android-release-signing.js` supports a release keystore, but allows an explicit debug-keystore fallback.                       | Store builds must reject that fallback, including Gradle-property and argument overrides.            |
| Version           | `app.json` has version 1.0.0; generated Android project has versionCode 1; no explicit Android version-code source configured.       | Repeatable positive increasing versionCode and accepted release identity.                            |
| Artwork           | Approved ribbon-M PNG is configured for Android.                                                                                     | Verify launcher appearance and produce Play listing assets.                                          |
| Privacy/account   | In-app deletion/export and `/legal/privacy`, `/legal/support`, `/legal/delete-account` routes exist.                                 | Device/website acceptance; correct unsupported instant-deletion claims and validate support process. |
| AI reporting      | Coach contains an in-app feedback entry point.                                                                                       | Confirm it can report offensive AI content effectively and that reports reach a review process.      |
| Console           | Account type, verification, app record, keys and testing eligibility were not inspected.                                             | Complete PLAY-001 before estimating a release date.                                                  |

## Sequence and ownership

1. **PLAY-001:** developer account, ownership and testing eligibility.
2. **PLAY-002:** reproducible store bundle and signing safeguards.
3. **PLAY-003:** Android compatibility, authentication and device acceptance.
4. **PLAY-004:** disclosures, policy behavior and listing assets (can run alongside PLAY-002/003).
5. **PLAY-005:** internal Play test, then required closed test and production-access application.
6. **PLAY-006:** final review, intentional public release and monitoring.

Existing data isolation, recovery, AI and deployment gates remain dependencies. No feature expansion or monetization implementation is implied. Delegate a bounded independent test/audit task for substantive packages. The coordinator owns continuity, signing/portal changes, deployments and final checks. Authentication, privacy and release-tooling changes require an independent reviewer who did not author them.

## PLAY-001 — Establish the correct Play Console account

- Inspect existing Google Play Console access, developer identity, app records, account verification and policy notices before creating duplicates. Google Play registration is separate from the Apple license; founder handles any required payment, legal agreement, identity verification and public contact declarations.
- Resolve account type first. Google's current account policy requires organization registration for health apps, with examples including medical and research apps. Mizyun has health/fitness and nutrition functionality: plan for the company/organization route, verify the applicable classification and account eligibility, and obtain Google clarification if needed. Do not select personal status to bypass organization requirements.
- For an organization, verify the legal entity, D-U-N-S information, website/contact verification and linked payments-profile consistency. Keep identity documents and private contact details out of repository evidence.
- If an eligible existing personal account is used, check creation date and Console requirements. Accounts created after November 13, 2023 require at least **12 continuously opted-in closed testers for 14 consecutive days**, then an application for production access. Internal testing does not count; passing the time threshold does not guarantee approval. Plan authentic testing and feedback, not only enrollment.
- Inspect current Android developer verification/package registration notices, including announced September 30, 2026 changes; complete whichever steps the actual account requires before distribution.
- Confirm `com.mizyun.app` belongs to the intended publisher; package identity is durable. Create/reuse the Mizyun app record with correct language, app category and distribution choices only after ownership is settled.
- Founder decides countries, audience and pricing. Default planning scope is the existing product, without adding subscriptions. If digital purchases are introduced, add a separate current Google Play Billing/entitlement/purchase/restore package before release.

**Exit:** verified publisher/account, owned app record, known testing eligibility, and named remaining founder actions. Do not promise a launch date before this gate.

## PLAY-002 — Produce a verifiable store AAB

Expected files: Android release scripts and signing plugin, mobile app config, build-matrix checks and a focused release runbook.

- Retain local prebuild/Gradle under ADR-0023. Use the existing Production environment validation and ensure the same public values reach prebuild and embedded JavaScript. Fail on wrong hosts, redirect, package, stale Dev native output, conflicting profiles or missing configuration.
- Add explicit validated `android.versionCode` input and document how to select an unused increasing value. Keep user-visible version separate. Inspect the final AAB manifest; do not rely on source defaults.
- Inspect any existing keystore and Play signing enrollment before generating keys. Use a dedicated upload key and Play App Signing for delivered APKs. Preserve existing signing continuity; back up upload credentials securely and record public certificate fingerprints and recovery ownership.
- Harden the **store** path to reject `MIZYUN_ALLOW_DEBUG_KEYSTORE_IN_RELEASE`, including inherited environment, Gradle properties and command-line options. Verify actual AAB signing identity rather than trusting configuration text. Remove obsolete comments claiming release is signed with the debug key.
- Validate signing-plugin postconditions after native generation; regex replacement must not silently leave a debug-signed release. Check missing keystore/password/alias and mismatched native project cases with meaningful failure tests.
- Treat clean prebuild as regeneration of native output: inspect/preserve intentional native edits first. Store candidate artifacts outside source paths, with unique versionCode/SHA names and SHA-256 checksums. Never overwrite accepted artifacts or log passwords.
- Build with `pnpm mobile:founder-production:android:bundleRelease` after safeguards and `pnpm check` pass, then run `pnpm mobile:founder-production:android:signBundle`. Treat `apps/mobile/android/app/build/outputs/bundle/release/app-release.aab` as generated input only; upload the verified copy preserved under `apps/mobile/dist/releases/android/google-play/`.
- Validate with bundletool and JAR-signature inspection. Inspect generated APKs with Android signing tools where appropriate. Confirm non-debuggable release, package/version, supported ABIs, embedded production endpoints and absence of server/private keys. Archive mapping/native-symbol files when generated.
- Register signing fingerprints with services that actually depend on them. Google-native authentication/Firebase integrations must use the **Play app-signing certificate**, not just the upload certificate; the existing browser OAuth flow should be assessed on its own requirements.

**Exit:** independently reviewed release safeguards and an identified, validated AAB with a reproducible build record. No upload or device acceptance implied.

## PLAY-003 — Android compatibility and functional acceptance

Current Google policy requires new phone apps/updates to target **Android 16 / API 36 or higher** from August 31, 2026. Refresh this requirement before building. [Target API policy](https://support.google.com/googleplay/android-developer/answer/11926878?hl=en).

- Inspect effective target/min/compile SDK, AGP, Gradle, Java, NDK and all packaged native libraries; Expo/React Native version alone is not proof. Change versions only where needed and record compatibility evidence.
- Verify **16 KB page-size compatibility** of native libraries and packaged APK alignment using current Android tooling. Exercise the app on a 16 KB device/emulator, including Hermes and native modules; do not count only a successful JavaScript bundle. [Android page-size guidance](https://developer.android.com/guide/practices/page-sizes).
- Inspect the **merged release manifest** and SDK-contributed permissions. Existing generated output includes overlay and legacy storage permissions; justify/remove unnecessary access. Check photo picker, camera, notification permission, alarms and any foreground service actually used. Do not add Health Connect, broad media access or exact-alarm privileges solely for publishing.
- Run standalone Android Dev acceptance against Dev first, preserving environment isolation. Later validate the exact Play-delivered Production candidate against a compatible accepted backend. Shared Production promotion remains a separate approved milestone.
- Cover minimum supported Android, a current API 36 device, a representative physical handset and 16 KB runtime. Test cold launch/Mac-off operation, update persistence, back gestures, edge-to-edge/keyboard layout, accessibility text scaling and icon masking.
- Exercise email signup/verification/recovery, Google browser OAuth return, cancellation, restart/session refresh, sign-out and expired/revoked sessions. Test actual Play-installed authentication because store signing and redirects can differ from local installs.
- Confirm users with linked identities can access/delete their accounts on Android without being forced into an unavailable iOS-only native Apple API. Preserve the shared identity policy; do not silently create duplicate accounts or infer ownership from email.
- Test meal/photo logging, denied/limited media access, workouts/rest notifications during background/lock screen, weight, export links, deletion and post-deletion local cleanup. Include denied notifications, network loss/retry and process restart.
- Test consent, AI limits, unavailable-provider behavior and reporting using the currently approved provider-testing scope. Never enable gated live suites just to complete store paperwork.

**Exit:** real Android journey evidence tied to source/build/device/backend, no unresolved release-blocking defect, and independent review for any auth/privacy fixes.

## PLAY-004 — Policy behavior and store listing

### Data and user controls

- Complete Data Safety from an inventory of actual app/backend/SDK flows: account identifiers, health/fitness, photos, coach content, feedback attachments, diagnostics and any analytics/push identifiers. Determine collection, sharing, purposes, linkage, optionality and retention accurately. No advertising sharing does not mean no third-party processing; evaluate Google's definitions and exceptions.
- Verify the public privacy and deletion URLs without app installation. Existing `/legal/delete-account` offers an email pathway: confirm it permits real requests, verifies ownership safely and has an operated mailbox. A static page or `mailto` alone is not proof that requests are handled.
- Correct instant/immediate deletion claims and unverified 48-hour promises in legal pages/listing. Explain actual completion timing, retained data and retention reasons. Test in-app and outside-app requests through completion, including sensitive media and local-session cleanup.
- Declare actual health features, expected to include **Activity and Fitness** and **Nutrition and Weight Management**. State that Mizyun is not a medical device and does not diagnose, treat, cure or prevent medical conditions, and remind users to consult a healthcare professional for medical advice, diagnosis or treatment. Keep this consistent in the app and listing; do not claim device approval or diagnostic accuracy.
- Verify the existing in-app feedback flow can report offensive AI output without leaving the app, is discoverable from relevant AI surfaces, carries adequate context with consent/minimization, and reaches an accountable review process. Improve it only where evidence shows gaps. Run prohibited-content and unsafe-advice evaluations under existing AI gates.
- Complete ads, target audience/content, IARC rating, app access and any actual sensitive-permission declarations. Do not copy the old “Everyone” rating or assume Apple's answers transfer. Do not declare Health Connect access unless the build really uses it.

### Assets and reviewer access

- App name: Mizyun; choose Health & Fitness category/tags from the actual Console options. Prepare a truthful short/full description with current character limits.
- Export a **512×512 Play listing icon** from the approved M artwork; create a **1024×500 feature graphic** and real Android screenshots meeting current Console requirements. Launcher assets and store listing assets are separate. Use synthetic data and show shipped functionality.
- Verify privacy/support pages and mailbox. Remove unsupported encryption/model-training/full-export claims until evidenced; align legal copy and in-app wording.
- Provide Google review with a working synthetic-data account and precise navigation instructions through login, consent, AI, export and deletion. Avoid dependence on founder-only OTP/manual approval. Put review credentials in Console/secure storage, never Git.
- If reviewers need paid features, provide supported review entitlement access without disabling production authorization or budget safeguards globally.

**Exit:** reviewed disclosures and assets, tested privacy/reporting/support operations, and reviewer access; Google declarations are ready to enter, not presumed approved.

## PLAY-005 — Internal and closed testing

Dependencies: verified account/signing and a safe compatible backend. Store-track names do not define backend isolation: `com.mizyun.app` targets Production even on an internal/closed track.

1. Upload the validated AAB to **internal testing** under Play App Signing. Inspect processing results, supported devices, native compatibility and policy warnings. Record uploaded versionCode and checksum.
2. Install through Google Play with authorized testers and repeat critical PLAY-003 journeys. The store-signed app may not update an existing locally signed `com.mizyun.app`; resolve this with a non-destructive data/session plan before changing installations. Internal App Sharing uses different signing behavior and is not a substitute for final track acceptance.
3. Complete app setup and required declarations before moving to **closed testing**. Review available pre-launch reports, crashes, ANRs, accessibility and native failures; fix and increase versionCode as needed.
4. Explicitly authorize the supported tester cohort, countries, backend capacity and AI budget before broadening access. The founder/partner Dev exception does not cover a larger Play test population. Prefer a supported Production test cohort; do not send 12 external testers into restricted Dev merely to satisfy a count.
5. If the account requires the personal-account test, maintain 12 continuously opted-in testers for at least 14 days, collect authentic journey/feedback evidence, resolve issues, and apply for production access. Otherwise document the actual Console eligibility and run a representative closed beta without inventing a mandatory duration.
6. Record tester/device coverage and remaining failures using redacted evidence. Open testing is optional; it is not required for this plan.

**Exit:** Play-delivered acceptance, completed applicable closed testing, production-access approval where needed, and an accepted candidate. Testing access is not app-review approval or public release.

## PLAY-006 — Review, publish and operate

- Reconcile `docs/QUALITY_GATES.md`, current remediation evidence and this plan against the candidate. Keep backup/restore, two-way environment isolation, privacy lifecycle, provider readiness and Pi capacity/monitoring gates. Apple's acceptance is not Android evidence.
- Submit the accepted version and accurate declarations for review. Allow for review questions and additional testing; do not promise a fixed approval time.
- Check actual Console first-release controls. Staged rollouts apply to updates, not the first publication. For launch timing, Google recommends publishing to a closed track first if using managed publishing; verify that control is actually available and enabled before relying on it. Prepare timing/countries accordingly and use an explicit founder release decision before the action that makes the app public. For later updates, use managed publishing/staged rollout where supported.
- After publication, verify the live listing, fresh Play install, sign-in and critical workflows. Monitor Android vitals, API failures, deletion jobs, support and AI spend. Define incident owner and response thresholds before launch.
- Retain accepted AAB, hashes, versionCode, public signing fingerprints and mapping/symbol artifacts. Android updates require a higher versionCode; stopping distribution does not remove installed copies. Keep backend compatibility and a forward-fix path rather than assuming every device can instantly roll back.

**Exit:** intentionally published and verified Google Play version with operational evidence. Track implemented, automatically verified, Dev/device accepted, Play testing distributed, Google approved and Production released separately.

## Evidence and next-session handoff

For each package record: source SHA/working-tree state, build tools, native versions, AAB checksum/versionCode, public certificate fingerprints, backend SHA/migrations, commands/results, device/OS/page size, Console track/status, failed/skipped checks and exact next action. Never record keystore passwords, private keys, tokens or reviewer passwords.

At implementation startup refresh AGENTS/status and `pnpm context environment-build-deployment`; delegate a bounded read-only/test task. Format changed files and run relevant focused checks plus `pnpm check` before committing or deployment. Review the actual diff after helper writes settle.

**Starting prompt:**

> Execute PLAY-001 and begin PLAY-002 in `docs/GOOGLE_PLAY_IMPLEMENTATION_PLAN_2026-09-12.md`. Inspect the latest working tree and preserve existing Apple work. Verify the correct Play Console publisher/account type and organization eligibility, app identity, signing state and testing requirements. Refresh official requirements, then harden the local Android AAB path against debug signing and stale configuration, with explicit versionCode and artifact verification. Delegate a bounded audit/test task. Do not deploy Production, invite external testers, upload or publish before the relevant package gates and concrete release decision.

## Dated primary sources

Consulted 2026-09-12. Recheck policies and Console notices at implementation.

- [Play Console account requirements](https://support.google.com/googleplay/android-developer/answer/10788890?hl=en) — account type, identity and upcoming verification notice.
- [Personal-account testing](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en-GB) — conditional 12-tester/14-day gate and production-access application.
- [Play App Signing](https://support.google.com/googleplay/android-developer/answer/9842756?hl=en) and [uploading bundles](https://developer.android.com/studio/publish/upload-bundle) — upload versus distribution signing.
- [Expo SDK 57 app config](https://docs.expo.dev/versions/v57.0.0/config/app/) — Android identity/icon/version configuration.
- [Data Safety](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en) and [account deletion](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en) — disclosures and outside-app deletion pathway.
- [Health declaration](https://support.google.com/googleplay/android-developer/answer/14738291?hl=en) and [health policy](https://support.google.com/googleplay/android-developer/answer/16679511?hl=en-GB) — fitness/nutrition scope and health disclosures.
- [AI-generated content](https://support.google.com/googleplay/android-developer/answer/13985936?hl=en) — in-app reporting and restricted-content prevention.
- [Publishing controls](https://support.google.com/googleplay/android-developer/answer/9859654?hl=en-GB) and [staged rollouts](https://support.google.com/googleplay/android-developer/answer/6346149?hl=en) — launch timing and update-only percentage rollout.
- [Listing assets](https://support.google.com/googleplay/android-developer/answer/9866151?hl=en-GB) — store graphic requirements.

Planning evidence: coordinator source inspection and official-source research, plus independent read-only helper audit of signing, declarations, deletion and AI reporting. No application edits, fresh build/test/device acceptance, Console mutation, deployment or upload were performed for this plan.

Independent plan review: no blocking findings; explicit health disclaimer wording incorporated. Documentation checks are recorded in the latest status handoff.
