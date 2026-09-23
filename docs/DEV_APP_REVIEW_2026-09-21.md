# Dev app and workflow review — 2026-09-21

## Scope and evidence

This is a product, UI, information-architecture and coding-workflow audit, with GitHub follow-up work. It does not implement the proposed fixes or approve a release.

- Source: `5c79721090a971f9e92e8ab68304bb8d9b9aa3b2` plus existing uncommitted work, preserved throughout the audit.
- Reviewed the current feature code, goals, business alignment, roadmap, open/recently closed issues, and September 20 Android source captures. Older captures are visual evidence, not proof of the currently installed artifact.
- Opened the iPhone 17 / iOS 26.5 simulator through Xcode 27 Device Hub. Its initially installed `com.mizyun.development` bundle was dated September 14. Created a synthetic Dev test account and successfully signed in. No real user fitness data was used for the simulator account.
- Rebuilt and installed the current dirty-working-tree Dev source over the stale simulator app. The embedded bundle SHA-256 is `c719f7f37558bccbb2a96e7085ec656077bed89d80062fdc31335face0c7efd4`; the recorded source fingerprint is `50859e478c7d35cb6cefe48db30351ca4704d5c239d749879c2362a462ab37c2`. The app launched and retained the synthetic account. The user then stopped further simulator inspection in favor of backlog cleanup.
- Independent helpers reviewed the coding workflow and dashboard data/lifecycle boundaries. The coordinator inspected the referenced code and reproduced the clean-checkout failure.
- No Production changes, backend deployment, external AI calls, account-deletion exercise or physical-device acceptance occurred.

## What is good

- The product already connects meals, training, body measurements and coaching around a private record. Manual logging remains useful independently of AI.
- Meals support history search, grouping, portion resizing, editing and copying. These are valuable repeat-use features; do not replace them with another broad meal-logging rewrite.
- Reusable workout routines and active sessions have distinct behavior in current source. Preserve the existing lifecycle/idempotency work and finish its acceptance under the existing issues.
- The nutrition contracts deliberately preserve unknown values; body history distinguishes raw readings from smoothed estimates. This is a strong foundation for honest progress reporting, although the daily dashboard breaks that nutrition rule in presentation.
- Account already groups settings and exposes privacy/memory/data controls. Progress and privacy are implemented surfaces, not proposals to build everything from scratch.
- The repository has clear domain/adapter boundaries, focused feature navigation, substantial tests and native bundle gates, Dev/Production identities, and guarded deployment tooling.
- Current Android layout repairs (#107/#108) are already complete issues. This review does not reopen the old broken-word or Coach-gap defects from earlier screenshots.

## What needs attention first

| Order | Work                                                                                                                                                      | Reason                                                                                                                                   |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | [Unknown nutrition (#112)](https://github.com/AdamHikl/mizyun/issues/112) and [dashboard context (#113)](https://github.com/AdamHikl/mizyun/issues/113)   | Wrong certainty or wrong-day/period values undermine trust in the daily picture.                                                         |
| 2     | [Clean-checkout gate (#109)](https://github.com/AdamHikl/mizyun/issues/109), then [PR verification (#110)](https://github.com/AdamHikl/mizyun/issues/110) | The local check depends on an ignored native file; checked-in PR workflows do not run the application quality gate.                      |
| 3     | [Independent dashboard refresh (#114)](https://github.com/AdamHikl/mizyun/issues/114)                                                                     | One historical failure can replace fresh daily values with an older whole-dashboard snapshot; month-end refresh fans out to 35 requests. |
| 4     | Daily action hierarchy and progress discovery                                                                                                             | Prioritize logging/resuming and understanding progress over large introductory/setup cards.                                              |
| 5     | [Build identity (#111)](https://github.com/AdamHikl/mizyun/issues/111), complete history search, current backlog                                          | Make reports reproducible and prevent users or agents from working from incomplete or obsolete context.                                  |

The dashboard issues are source-confirmed; their existing reducer/cache tests pass but do not exercise screen rendering and asynchronous lifecycle. Their issue bodies specify the missing regression boundaries instead of claiming device reproduction.

## UI and information architecture

The reviewed Android Home capture places Quick Log below the greeting, nutrition card and weight/training cards. The Workouts capture prioritizes Create Routine and the exercise library above the saved routine's Start action. Current source retains that order. For a returning gym-goer, logging and resuming should be easier to reach than setup and explanation.

Use smaller recurring headers, a visible primary logging action, and a prominent active-workout resume state. Keep formula assumptions available through disclosure rather than filling the main daily surface. Do not solve density by disabling text scaling or shrinking touch targets.

Progress currently lives across Home's period totals, Body history, exercise progression, Account shortcuts and Coach's weekly adaptation. A clear Progress entry and coherent weekly review would make the existing data more useful. First test a small navigation/content prototype; this does not require a sixth tab, a new analytics platform, or replacement calculations.

Meal history has a separate completeness defect: it fetches only the newest 200 entries and searches locally without explaining that limit. Older meals and a cutoff day's totals need a bounded, honest retrieval path.

## Backlog outcome

The GitHub backlog was reconciled against current code, infrastructure and product direction before any issue was closed. Acceptance criteria were first transferred into the surviving issues.

- Rewrote 36 surviving issues around the current Hetzner, Gemini, local Xcode/Gradle and store-delivery path.
- Closed 18 obsolete or duplicate issues as superseded: #10, #12, #16, #19, #20, #22, #24, #28, #34, #35, #42, #43, #46, #47, #48, #50, #51 and #53.
- Closed #17 and #18 as completed after fresh navigation checks passed.
- Created audit findings #109–#114 and [meal-history completeness #117](https://github.com/AdamHikl/mizyun/issues/117).
- The final open backlog contains 44 issues. Every open issue has one priority, status and area label. Unresolved release gates remain open and are distinguished from implementation, deployment and device acceptance.

## Future goals and work sequencing

Keep the launch wedge: faster capture, one private record, useful progress, then grounded coaching. The next product milestone should produce evidence that target users repeatedly complete this loop, not merely add screens.

- Use [the existing founder/design-partner issue #37](https://github.com/AdamHikl/mizyun/issues/37) for the seven-day founder loop and subsequent 10–30-person validation after its release dependencies are met. Record activation, time/taps to log, repeated friction, return use and qualitative reasons to return. Use consent-respecting analytics or a manual study; do not collect sensitive payloads in GitHub.
- Test whether the weekly review answers a concrete question about the user's goal and leads to an understandable next action. Keep insufficient-data states honest and all proposed goal changes confirmable.
- Keep [billing #38](https://github.com/AdamHikl/mizyun/issues/38) dependent on demonstrated premium value, cost and willingness to pay. Do not add a paywall merely because AI exists.
- Defer community, multiple active model providers and broad new integrations until repeat use supports them. Existing HealthKit/Health Connect research issues remain the home for those later options.
- Reconcile [documentation/backlog #33](https://github.com/AdamHikl/mizyun/issues/33) and [safe promotion #23](https://github.com/AdamHikl/mizyun/issues/23). Old Windows/Pi/Mistral wording and the hosted-Supabase migration writer are active sources of confusion. Do not bulk-close unresolved release gates.

## Verification and limits

- Fresh focused dashboard/cache tests: 2 files, 20 tests passed. These are primitive/reducer evidence, not proof that the reported screen defects are absent.
- Build-matrix check passes in the ambient checkout. In a tracked-files-only snapshot of the same HEAD it fails at `scripts/test-build-matrix.mjs:449` with `ENOENT` for ignored `apps/mobile/android/app/build.gradle`. A complete fresh dependency installation was not run for this reproduction.
- The current Dev simulator build installed and launched successfully. The Expo wrapper's final macOS window-opening step exited after installation because System Events automation was unavailable; this did not invalidate the installed artifact.
- Fresh `pnpm check` passed through formatting, all workspace typechecks, iOS/Android bundle exports, repository test suites, safeguards and all 56 offline AI invariants. Final navigation and diff checks are recorded in the session handoff.
- Remote workflow permissions, branch protection, current deployed backend SHA, live AI quality, physical-device accessibility and store distribution were not accepted by this audit.

## Dated primary sources

Accessed 2026-09-21:

- [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/) and [Expo CLI](https://docs.expo.dev/more/expo-cli/): current native build/run reference for the simulator update.
- [Expo Continuous Native Generation](https://docs.expo.dev/workflow/continuous-native-generation/): native directories are generated from maintained configuration/plugins; portable checks must not silently rely on another checkout's generated output.
- [React Native accessibility](https://reactnative.dev/docs/accessibility): labels, roles and state semantics inform concrete VoiceOver/TalkBack acceptance consolidated under #32. Source inspection does not certify accessibility.
- [GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches): creating a CI workflow and configuring its required status are separate steps.
