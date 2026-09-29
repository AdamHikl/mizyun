# Account navigation and settings search

Work package: **ACCOUNT-NAV-001 / [#133](https://github.com/AdamHikl/mizyun/issues/133)**. Date: **2026-09-29**. Status: planned; implementation not started.

## A. Context & scope

Make Account easy to browse and let people find a setting by its name or by describing what they want to change. Deliver a compact Account home, clearly named destinations, and private on-device search across existing settings and useful Account destinations.

The current `apps/mobile/src/features/settings/settings-screen.tsx` combines a large profile header, shortcuts, six category filters and many accordions. Several forms start expanded. Reminders are under AI Coach, appearance is under Session, and health steps are under Privacy. Technical labels such as “Authentication & Principal State” make discovery harder. This is a source-based assessment, not an observed usability study.

In scope: mobile information architecture, labels, destination routing, search metadata/ranking, accessibility, form navigation and regression checks on iOS and Android. Preserve current feature availability and behavior.

Non-goals: backend/schema changes, new settings, changes to AI admission or account lifecycle, cloud search, subscriptions, release/deployment, global app navigation redesign. No roadmap reprioritization. Existing export/deletion and release acceptance gates remain open under their own issues.

## B. Baseline & constraints

- Source: `0b2540ca66e6e5c3846ae3b54df24c79276ca839`; working tree clean at planning startup.
- Installed declarations: Expo `~57.0.23`, Expo Router `~57.0.21`, React Native `0.86.3`.
- Account tab route: `apps/mobile/src/app/(tabs)/settings.tsx`; root stack: `apps/mobile/src/app/_layout.tsx`.
- Reuse existing settings cards and their save, permission, failure and confirmation behavior. UI search belongs in `apps/mobile`, with no vendor or database dependencies.
- Current category changes and collapsed accordions unmount children. Local drafts can be lost; new navigation must preserve drafts while mounted and guard leaving unsaved forms.
- Search must inspect metadata only. Do not render hidden result cards: mounting an account-data card can resume deletion-status recovery.
- Search never grants permissions, changes consent, requests Beta Pro, signs out, exports or deletes. It opens the existing control; subsequent explicit action retains its existing safeguards.
- Search remains available offline. Destination screens retain truthful loading/error/offline states and existing authorization. A local result is not proof that a remote setting loaded successfully.

## Proposed experience

Keep the bottom tab named **Account**. Show a compact name/email/plan summary, then **Search settings** with helper text “Search by name or describe what you want to change.” Remove the large shortcut grid and filter-chip/accordion combination from the home screen.

Show seven clear category rows with short examples. Opening a category lists its settings; opening a row shows the relevant editor. Search skips the category step. A few rows may scroll below the fold; do not shrink typography to force everything onto one screen.

| Category             | Existing destinations and proposed wording                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Profile & goals      | Personal details; Units; Goal & target pace; Energy targets; Regional food standards; Body progress; Progress photos when enabled                       |
| Workouts & reminders | Rest timer & workout alerts; Auto-advance target weights; Daily and weekly coach reminders; First-meal reminder; Evening catch-up reminder              |
| Appearance           | Theme: System, Light, Dark; home row may open this single editor directly                                                                               |
| Health connections   | Steps from Apple Health / Health Connect, with supported/permission/unavailable states                                                                  |
| AI coach             | Coaching preferences; AI usage & Beta Pro Pass; Coach memory and AI data consent (canonical destinations shared with Privacy)                           |
| Privacy & data       | Coach memory; AI data consent; Product analytics (consent, local-event export/clear); Export account data; Delete account; Privacy policy               |
| Account & help       | Sign-in & security; Account information; Complete setup when needed; Feedback & support; Terms & health advisory; external deletion-request information |

Keep **Sign out** as a clearly labelled footer action with its current confirmation. Include a search result that opens Account & help and reveals this action, never signs out directly. Rename technical principal-state language; retain session/error/retry details and place user ID in secondary account details. Preserve existing legal documents and links. Keep provider/model details on the AI detail screen, not as a prominent navigation badge.

Multiple entry points may point to one destination (for example Coach memory); deduplicate search results by stable destination/anchor ID. Do not duplicate forms or copies of saved state. AI consent, export and deletion can share the existing AccountDataCard editor with distinct anchored entry points.

### Search behavior

1. Search all available Account settings regardless of the category previously browsed. Empty input shows ordinary categories and a few fixed examples, not search history.
2. Match labels, alternate names, common intent phrases and field-level terms. Normalize casing, spacing, punctuation and diacritics; support conservative typo tolerance for longer words. Preserve meaningful negation such as “don't”.
3. Rank exact labels and specific curated intents first, then label prefixes, aliases and meaningful token overlap; fuzzy matches last. Require enough distinctive evidence to avoid matching every query containing “my” or “change”. Use stable ordering for ties.
4. Result rows contain a label, short explanation and path, e.g. **Theme** / “System, Light or Dark” / “Account → Appearance”. Never show invented settings or generated instructions.
5. A tap opens the exact editor and scrolls/focuses its labelled field where appropriate. Reveal rather than toggle. Back returns to the query, results and scroll position; clear query on account switch/sign-out. Cold links fall back to Account on Back when there is no search session.
6. Broad requests show multiple relevant choices. “Stop notifications” lists workout alerts and each reminder type; explain that system notification permission is managed by the OS where applicable. Do not invent a global disable switch.
7. No credible match: “No matching setting found”, examples, category browsing and Feedback. Never force the nearest unrelated result. Unknown/disabled route IDs get a safe unavailable screen.
8. Keep query text only in memory for this navigation session. Do not put it in URLs, persisted history, analytics, crash breadcrumbs or server/model requests. Catalog entries contain static setting descriptions, never personal profile values, memory contents or health records.

Examples to cover in fixtures:

| Search                                                       | Expected destination                                               |
| ------------------------------------------------------------ | ------------------------------------------------------------------ |
| dark mode / make the app darker / too bright / drak mode     | Theme                                                              |
| pounds instead of kilos / change kg to lb                    | Units, within personal details                                     |
| lose weight more slowly / change my target weight            | Goal & target pace                                                 |
| timer takes too long / stop rest timer sound                 | Rest timer & workout alerts, relevant field                        |
| remind me to eat breakfast                                   | First-meal reminder                                                |
| stop evening reminders                                       | Evening catch-up reminder                                          |
| connect Apple Health / show my steps                         | Health connections, platform appropriate                           |
| what does the coach remember / forget what AI knows about me | Coach memory; no destructive action executed                       |
| stop sharing with AI / revoke AI consent                     | AI data consent; existing confirmation, separate from Coach memory |
| stop usage tracking / don't collect analytics                | Product analytics                                                  |
| download my data                                             | Export account data, not analytics-only export                     |
| delete my account / erase my profile                         | Delete account; existing confirmation flow                         |
| change my password                                           | Sign-in & security, preserving Apple/Google guidance               |
| more AI messages / beta pro                                  | AI usage & Beta Pro Pass                                           |
| stop notifications                                           | Relevant reminder and workout settings, no single assumed answer   |
| change bank account / unrelated prose                        | No matching setting                                                |

**Recommendation:** ship local matching with curated descriptions first. It can handle common descriptions without latency, provider costs or sending potentially sensitive queries away. It does not understand arbitrary language; do not market it as an AI assistant. Test previously unseen paraphrases. If it falls short, expand metadata and evaluate an on-device semantic approach separately. A cloud/model fallback would require a new privacy, consent, cost and architecture decision; it is not part of this package.

## C. Staged implementation steps

### 1. Define destinations and acceptance fixtures

- [NEW] `apps/mobile/src/features/settings/settings-catalog.ts`: static entries with `id`, `label`, `description`, `categoryId`, `aliases`, `intentPhrases`, typed `targetId`, optional `anchorId`, and an availability rule key.
- [NEW] `apps/mobile/src/features/settings/settings-destinations.ts`: allowlisted mapping from IDs to routes/editors and supported anchors; no arbitrary href execution from query text.
- [NEW] catalog tests and a checked-in synthetic search fixture set, including held-out paraphrases, ambiguity, misspellings and no-match cases.
- Availability distinguishes hidden features from visible but unavailable controls. Hide disabled Progress Photos consistently; health permission denial must keep recovery discoverable. Provider-managed password controls remain discoverable with explanatory copy. Recheck gates at destination render, not only during search.
- Produce a before/after checklist of every card, action, disclosure, conditional state and link before extraction. AI consent currently lives in `account-data-card.tsx` under Third-Party AI & Consent; give it a separate search anchor and entry point while reusing the existing consent controller and confirmation. Never equate memory deletion with withdrawing AI consent.

Acceptance: every existing Account action has a canonical destination; every anchor resolves; no catalog entry invokes a mutation or loads sensitive data.

### 2. Build the browsing structure

- [MODIFY] `apps/mobile/src/features/settings/settings-screen.tsx`: compact home, categories, search entry and footer.
- [NEW] `apps/mobile/src/app/account-settings/[settingId].tsx` and `apps/mobile/src/features/settings/settings-detail-screen.tsx`: thin route + allowlisted editor rendering. Preserve `(tabs)/settings.tsx` and existing external destinations `/energy-setup`, `/body`, `/progress-photos`, `/feedback`.
- [NEW] `apps/mobile/src/features/settings/settings-category-screen.tsx` and `apps/mobile/src/app/account-settings/category/[categoryId].tsx` for category browsing.
- [MODIFY] `apps/mobile/src/app/_layout.tsx`: register appropriate stack titles and Back behavior without weakening existing authentication guards.
- [NEW] extracted `analytics-settings-card.tsx`, `account-information-card.tsx`, `legal-settings-card.tsx` as needed from existing inline components; preserve their actual behavior.
- [MODIFY] existing form cards only where necessary to expose stable anchors and dirty-state callbacks. Guard Back, swipe-back, Android Back and other navigation exits with “Keep editing” / “Discard changes” for explicit-save forms. Immediate-save toggles retain current persistence semantics; do not autosave explicit-save forms.
- Use public feature exports for cross-feature integrations. [MODIFY]/[NEW] feature public entry points as needed, instead of adding imports into another feature's internals.

Acceptance: all old actions reachable; no unsaved edits lost silently; no permissions requested merely by visiting the home/search; session refresh, sign-out cleanup, deletion recovery and legal content preserved. Do not suppress legitimate recovery behavior when opening Account data directly.

### 3. Add local search and direct reveal

- [NEW] `apps/mobile/src/features/settings/settings-search.ts`, `settings-search.test.ts`, `settings-search-results.tsx`.
- [MODIFY] home and detail screens to preserve ephemeral search state and reveal stable anchors after layout. Query does not become a route parameter.
- Use a standard labelled React Native input with clear/cancel behavior and keyboard-safe results. Debounce accessibility announcements, not necessarily the tiny local matcher. Avoid per-keystroke network access.
- Do not mount editor components for previews. Retrieve dynamic subtitle values only from already-loaded appropriate state; unknown values display as unknown.

Acceptance: curated exact-name fixtures all rank correctly; at least 90% of a separate set of 40+ held-out, unambiguous English paraphrases put the intended destination in the top three. Ambiguous fixtures retain appropriate alternatives; unrelated fixtures show no false confident result. These are proposed acceptance thresholds, not measured results. Target local matching p95 under 100 ms on the oldest test device and record actual measurement.

### 4. Review, verify and accept on devices

- [MODIFY] `docs/feature-map.json` if public entry points/test ownership change; coordinator updates research/status/issue only. No new ADR needed for this local presentation refactor unless the implementation changes architecture or introduces a semantic provider.
- Independent review of the completed diff is required for touched account/security/privacy lifecycle surfaces; reviewer must not author those changes. Keep pre-existing Q4/Q5/Q7 gaps separate from this package.
- Begin with coordinator owning navigation/integration and one helper owning matcher/catalog tests, with disjoint files; perform final checks after writes settle.

Acceptance: verification below passes and the measured usability/device evidence is recorded. Implemented, automated checks, device acceptance and releases remain distinct.

## D. Verification plan

Automated checks during implementation:

```sh
pnpm --filter @mizyun/mobile test src/features/settings
pnpm navigation:check
pnpm format:check
pnpm check
```

Add behavioral coverage for metadata-to-route resolution, gated entries, deduplication, exact/intent/fuzzy ranking, empty/no-match/ambiguous queries, invalid anchors, Back restoration and identity changes. Exercise actual editor/navigation integration for dirty forms, search-to-control reveal, no mutation on search/select, and account-data recovery. Current Vitest uses native stubs: helper tests and source-string assertions do not establish rendered interaction; add an appropriate component harness or record native interaction checks for those boundaries. Preserve existing settings lifecycle tests; provider integration remains gated by `docs/BEFORE_TESTING.md`.

Physical iOS and Android acceptance: VoiceOver/TalkBack focus and result announcements; large text; small screen; light/dark/system theme; keyboard clearance; touch targets (at least 44 pt iOS / 48 dp Android); Back/swipe/tab exits with dirty forms; online/offline errors; Apple/Google/password accounts; disabled photos; health unavailable/denied/granted; sign-out/account switch. Test search itself offline and verify it causes no query-bearing network or telemetry activity. Do not use real deletion as an incidental navigation test; account-lifecycle acceptance uses dedicated synthetic accounts and its own gates.

Small usability check: at least three people unfamiliar with the new layout attempt five tasks each (theme, units, reminders, export, health steps). Target at least 80% unassisted completion within 20 seconds per task, recording both browsing and descriptive search. Adjust labels/matching from consented notes, with no automatic raw-query collection. This is a proposed formative test, not population-level proof.

Planning-session validation: documentation formatting, navigation links and diff whitespace only; no builds, runtime tests, device tests, deploys or releases are claimed by this document.

## E. Next-session prompt

> Implement ACCOUNT-NAV-001 from `docs/ACCOUNT_NAVIGATION_PLAN_2026-09-29.md`. First run `git -c core.fsmonitor=false status --short`, read AGENTS.md, the newest status entry and START_HERE, then refresh focused settings/account-lifecycle context and official Expo 57/React Native guidance. Preserve concurrent work. Begin with the complete control-to-destination inventory and search fixtures. Keep existing settings, auth, consent, export/deletion, permission and sign-out semantics. Implement local metadata search only; no cloud/model requests or stored queries. Delegate a bounded matcher/test task with disjoint ownership, keep continuity and GitHub changes with the coordinator, and require independent review of account/privacy surfaces. Run the planned checks, record actual device gaps, and do not deploy or release as part of this UI package without separate authorization.
