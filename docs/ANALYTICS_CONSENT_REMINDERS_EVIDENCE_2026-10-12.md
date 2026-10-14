# Analytics consent discovery and reminders — #239

## Scope and behavior

Exact baseline `0135228778059dc25c1a4925738f0b6934ed4f0c`, plus this session's analytics reminder, composition bridge, settings discovery and account-cleanup overlays. Preserve unrelated Community, retained-photo, startup-cache, instructions and continuity edits. No commit, Dev install/backend deployment or Production release is established by this document.

Account now has a direct Help improve Mizyun shortcut. Privacy & data retains the same analytics route with a clearer label; searches for data collection, usage data, help improve Mizyun and analytics consent find it. Existing consent disclosure remains and the action says Allow usage analytics.

Undecided accounts can see a dismissible Home dialog after eight seconds. Review analytics opens the existing consent page; Later/Back reserve14 days and Don't ask again persists suppression. No prompt during onboarding, background or an active workout; explicit refusal/revocation and existing grant suppress it. Failed consent/storage reads suppress prompts, failed suppression is retryable, and account changes discard late responses. Reminder preferences are separate per account/device and explicitly erased with account-local data. The popup itself never grants or records telemetry. [Decision](adr/0057-discoverable-analytics-consent-reminders.md).

## Reproduced failure and focused evidence

Before the change, the new discovery regression failed3 of4 cases: data collection/usage data returned nothing, and help improve Mizyun selected feedback. After the fix, the focused command passed286 tests across23 files on the shared source:

```sh
pnpm --filter @mizyun/mobile test src/features/analytics src/features/settings src/composition/analytics-consent-reminder-bridge.test.tsx src/composition/analytics-client.test.ts src/features/auth/auth-analytics-lifecycle.test.tsx
```

Coverage includes14-day boundary/restart, persistent suppression/account isolation, malformed and failed preference storage, failed suppression, network failure, foreground/lifecycle transitions, late owner reads, navigation, and local-erasure failure. Existing network-consent and auth lifecycle suites passed. Mocks establish isolated behavior; they do not establish installed/native usability or live consent delivery.

## Candidate and remaining gates

The final full gate is planned for an isolated candidate at `/private/tmp/mizyun-analytics-consent-candidate`, using the exact baseline plus16 owned mobile source/test files and this session's documentation patches only. Third-party dependencies are reused with workspace imports redirected inside the candidate; ignored iOS source/project scaffolding is copied without Pods/build/local environment. Validate source hashes, Git baseline, links and required scaffolding before the gate. Final review and all source repairs/focused checks must settle first.

Independent High review found a cold-reopen workout hydration gap. Repaired it by requiring a successful schema-validated workout read before consent eligibility; delayed, failed and active-workout regressions pass. Repair review approved with no remaining blockers. Final isolated focused run passed289 tests across23 files and mobile typecheck passed. The full-gate outcome will be added as a clearly identified post-check receipt and checked for document/format correctness. Current source is not an installed build. Next: standalone Dev install and verify Account navigation, all dialog choices, restart/foreground, two accounts, offline failure, small screen/large text and VoiceOver/TalkBack. Production/Store delivery remains a separate release action.

## Preserved prior analytics acceptance

- **#186 analytics/#192 guards:** real Mac3034 initialized; synthetic3033 isolated. `pnpm analytics:dashboard` + private login. Exact delivery, consent/deny/revoke, automatic/Community capture and Store imports open; zero Prod opt-ins. Pi hosting superseded;8GB deferred until revenue. [Evidence](docs/DEVELOPER_ANALYTICS_DASHBOARD_2026-10-03.md).

The zero Production opt-in figure above is historical October3 coverage, not a fresh count. The running dashboard snapshots were refreshed2026-10-12 at15:59UTC; both readerVisible true. No automatic collector was installed.

## Post-check result receipt

Isolated `pnpm check`: PASS, input SHA256 `018f223d5b8baa31be8dcc6e93ec06d889e14582a5d8c517aad28ebed985efc6`;2,202 mobile/980 API tests passed,15 credential-gated API tests across3 files skipped. iOS/Android Metro bundles, format, typechecks, navigation and required tooling suites passed. Independent High review approved after the workout hydration repair. All16 reviewed source hashes matched the shared source after completion. No native run/install, live consent capture, backend deployment, commit/push or Production release occurred.

[Result](evidence/analytics-consent-reminders-2026-10-12/verification-summary.json), [source scope](evidence/analytics-consent-reminders-2026-10-12/candidate-overlay.json), [source correspondence](evidence/analytics-consent-reminders-2026-10-12/source-hashes.json), [review](evidence/analytics-consent-reminders-2026-10-12/review-summary.md), [full log](evidence/analytics-consent-reminders-2026-10-12/full-check.log). These are post-check records, checked separately for formatting/navigation; they were not inputs to the passing candidate.
