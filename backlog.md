# Mizyun backlog

> Executable work inventory (to-do, active, ready, research, and blocked). The roadmap and dependency order live in `plan.md`. Keep each item small enough to finish and verify in one focused segment where practical.
>
> For completed work items and historical implementation evidence, see [completed-backlog.md](completed-backlog.md).

## Google Play publishing — planned 2026-09-12

Follow [the phased plan](docs/GOOGLE_PLAY_IMPLEMENTATION_PLAN_2026-09-12.md). Apple completion is user-reported and outside this work package; shared release gates remain in force.

| ID       | Priority | Status | Work item                                   | Exit / dependency                                                                    |
| -------- | -------- | ------ | ------------------------------------------- | ------------------------------------------------------------------------------------ |
| PLAY-001 | P1       | ready  | Publisher/account and testing eligibility   | Verified entity, organization eligibility, app record and Console requirements       |
| PLAY-002 | P1       | ready  | Safe signed Production AAB                  | No debug fallback, explicit versionCode, verified signer and bundle                  |
| PLAY-003 | P1       | ready  | Android compatibility and device acceptance | API36/current policy, 16KB native support, Play-delivered core/auth/privacy journeys |
| PLAY-004 | P1       | ready  | Policy behavior and listing                 | Health/AI/Data Safety, outside-app deletion, assets and reviewer access              |
| PLAY-005 | P1       | ready  | Internal/closed testing                     | Accepted safe backend/cohort; applicable closed-test and production-access gates     |
| PLAY-006 | P1       | ready  | Review and intentional publication          | Accepted candidate, current release gates and operated public service                |

## Apple sign-in and App Store candidate acceptance — planned 2026-09-11

User deferred implementation to a later session. Follow [the implementation plan](docs/APPLE_SIGN_IN_APP_STORE_IMPLEMENTATION_PLAN_2026-09-11.md); these items do not close or reorder existing remediation release gates.

| ID        | Priority | Status | Work item                              | Exit / dependency                                                                            |
| --------- | -------- | ------ | -------------------------------------- | -------------------------------------------------------------------------------------------- |
| APPLE-004 | P1       | ready  | Accept Apple login on Dev iPhone       | APPLE-002/003; deploy to Dev Pi and accept native sign-in & deletion on physical iPhone      |
| STORE-002 | P1       | ready  | Upload and accept TestFlight candidate | APPLE-004, STORE-001, applicable release gates and compatible accepted backend               |
| STORE-003 | P1       | ready  | App Review and explicit public release | Accepted TestFlight build, all release gates, founder declarations and operational readiness |

## Icon implementation

| ID               | Priority | Status | Work item                                                             | Evidence / remaining acceptance                                                                                                                                                                                                    |
| ---------------- | -------- | ------ | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BRAND-ICON-001   | P3       | active | Apply approved ribbon-M icon across launcher and startup              | Shared launcher and native/animated splash configuration implemented; Dev/Production paths and native generation verified; native rebuild/install plus launcher/cold-start acceptance pending                                      |
| BRAND-SPLASH-001 | P2       | ready  | Calibrate splash & animated launch screen background to brand palette | Update `apps/mobile/app.json` expo-splash-screen config and `apps/mobile/src/components/animated-icon.tsx` from legacy `#208AEF` bright blue to theme dark `#0B0F12` / adaptive palette, eliminating blue box artifact around icon |

## Session engineering

| ID                   | Priority | Status | Work item                                                   | Evidence / remaining acceptance                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------- | -------- | ------ | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI-BUDGET-001        | P1       | active | Decoupled AI token & photo draft budgets                    | Separate count-based photo draft budget (5 free/100 paid) and chat token budget (10k/100k); ledger RPCs, differentiated 429 bodies, UI quota cards; verified via pnpm check; Pi deploy pending                                                                                                                                                                                                                          |
| BETA-PRO-001         | P1       | active | Beta Pro Pass request flow & approval CLI                   | Request route, Supabase table with RLS, admin trigger to paid plan_tier, Expo push notification dispatch; Settings and Onboarding UI with shared `beta-pro-client`; cross-environment triage CLI in `scripts/check-beta-pro-requests.mjs` and `pnpm beta-pro`; verified via pnpm check; Pi deploy pending                                                                                                               |
| OFFLINE-CACHE-001    | P1       | ready  | Offline profile & dashboard cache for instant startup       | Cache user profile and daily dashboard metrics locally using SecureStore/Async pattern; enable instant offline boot without blocking on network; background revalidate on connectivity; unit tests passing                                                                                                                                                                                                              |
| FIX-COACH-INTENT-001 | P1       | ready  | Disambiguate Coach workout logging intents from meal drafts | Natural language workout logging ("Add two hour walk to my completed workouts today") misclassified as meal drafts by `isExplicitMealLoggingIntent` in `nutrition-action.ts` because exclusion regex missed plurals (`workouts`) and activity nouns (`walk`, `run`, `ride`, `swim`); update regex to require food context for additions, exclude workouts/cardio, and preserve Coach workout intent; unit tests passing |

Agent navigation follow-up: [stages 1–2 implementation plan](docs/AGENT_NAVIGATION_IMPLEMENTATION_PLAN.md). Independent review found stages 1 and 2 partial; see [N1–N8](docs/AGENT_NAVIGATION_REVIEW_2026-09-09.md). Prior evidence below is scoped and does not close the items; developer tooling only. These tasks do not close or reprioritize release acceptance gates.

| ID           | Priority | Status | Work item                                                                  | Evidence                                                                                                                                                                                                                                                                             |
| ------------ | -------- | ------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DOCS-NAV-001 | P1       | ready  | Reconcile current guidance, archive history, and introduce focused startup | 900 lines of history archived to `docs/archive/status/`; `status.md` condensed to 51 lines; `docs/START_HERE.md`, `docs/adr/README.md`, `docs/patterns/README.md` seeded; normal startup reduced to 233 lines (-86.4%); read-only helper inventory passed.                           |
| DOCS-NAV-002 | P1       | ready  | Add feature manifest and bounded context command                           | `docs/feature-map.json` maps 15 features covering 100% of API modules (15/15) and mobile features (14/14); `pnpm context` CLI with `--list`, `--json`, `--all` and Levenshtein suggestions passing automated tests.                                                                  |
| DOCS-NAV-003 | P1       | ready  | Add advisory impact analysis and navigation/boundary checks                | `pnpm impact` with NUL-delimited diffs, direct ownership, reverse deps, and semantic affects propagation; `pnpm navigation:check` and `test:navigation` (15 tests passing) integrated into root `pnpm check`.                                                                        |
| DOCS-NAV-004 | P1       | ready  | Independently accept new-session navigation                                | Independent helper subagent (`1831e777`) executed 5 cold-start exercises (meal retry, deletion, AI consent, food contract change, Pi units) using exclusively `docs/START_HERE.md` and navigation tooling without hints. Evidence recorded in `docs/AGENT_NAVIGATION_ACCEPTANCE.md`. |

## Status and priority

- Status: `ready`, `research`, `active`, `blocked`, `done`
- Priority: P0 blocks safe progress/release; P1 is MVP-critical; P2 is valuable; P3 is optional/later.

## Q1–Q9 remediation execution

**2026-09-09 round-3 review and coordinator pass:** [latest findings](docs/IMPLEMENTATION_REVIEW_2026-09-09_ROUND_3.md) retain open implementation work. REL-AUD-007's edited ambiguous-retry path now stops safely, while durable unknown-outcome persistence remains open; INFRA-DUAL-004 now rejects omitted-port targets and tracks rollback failures, while readiness identity and remote proof remain open; REL-AUD-001/002 retain incomplete deletion recovery and memory/media export; REL-AUD-005/006 retain consent UI/context gaps, direct-helper admission semantics, reservation leases/aggregate caps and live evaluation gaps. Q1 unit/permission improvements are not installed. Existing `ready` rows remain open; passing mocks do not close them.

**Round-2 review:** [current findings](docs/IMPLEMENTATION_REVIEW_2026-09-08_ROUND_2.md) reopen unsupported closure claims. Q6 source fix is retained pending deployed/upgrade evidence; Q5 is regressed. Q1/Q8-A/Q9 containment and safe promotion precede final native/release acceptance.

Follow [the detailed implementation plan](docs/REMEDIATION_IMPLEMENTATION_PLAN_2026-09-08.md) and maintain [the evidence checklist](docs/REMEDIATION_EVIDENCE_CHECKLIST.md). Q identifiers map to the existing INFRA-DUAL/REL-AUD rows below; they do not replace or renumber them. Start with Q8-A containment and Q1 runtime isolation, then Q9 locally tested deployment safeguards before later remote patch acceptance. Implementation, independent verification and release are separate states. This plan does not close or start any implementation item.

## Requested dual-environment setup — partially implemented, review reopened

See [the guide](docs/tutorials/DEV_PRODUCTION_PI_GUIDE.md), ADR-0020 and [the 2026-09-08 implementation review](docs/IMPLEMENTATION_REVIEW_2026-09-08.md). Separate Pi stacks exist, but the review found incomplete runtime isolation, build profiles, deployment safeguards and acceptance. Reopened rows retain their implemented portions; `ready` means follow-up is required, not that implementation was discarded.

| ID             | Priority | Status | Work item                                                         | Done when                                                                                                                             |
| -------------- | -------- | ------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| INFRA-DUAL-001 | P1       | ready  | Restore access, inventory Pi and adopt environment/release design | Capacity, production baseline, recovery and exact target manifest recorded; requested workflow reconciled with canonical instructions |
| INFRA-DUAL-002 | P1       | ready  | Separate Pi Dev API/Supabase/Auth/Storage and HTTPS               | 001 passes; distinct keys/mounts/ports/services/users and synthetic cross-environment rejection verified                              |
| INFRA-DUAL-003 | P1       | ready  | Both iPhone variants with guarded local/EAS profiles              | 002 passes; Dev Metro/standalone and Production identities, callbacks, signing and endpoint configuration verified                    |
| INFRA-DUAL-004 | P1       | ready  | Exact-SHA Dev and Production promotion with safe CI               | 002 passes; unsafe reset workflow removed; supplied SHA honored, explicit targets/locks/migrations/rollback proven                    |
| INFRA-DUAL-005 | P1       | ready  | Dual-environment acceptance and operational handoff               | 003/004 pass; device, Mac-off, resource, backup/isolation checks and canonical docs complete                                          |

Review follow-up: INFRA-DUAL-002 maps to Q1/Q8; 003 to Q3; 004 to Q9; 001/005 require recovery/resource/device evidence and adopted documentation. REL-AUD-001/002 map to Q4/Q5; 005 to Q7/Q8 and uncompleted model acceptance; 006 to Q6/Q8; 007 to Q2. REL-AUD-004 has the intended source change but still needs signed-device acceptance. REL-AUD-009 retains the verified removal of the old reset workflow.

## External-testing audit findings — 2026-09-07

The [release audit](docs/RELEASE_READINESS_2026-09-07.md) records evidence and closure criteria. Existing `done` labels describe scoped implementation, not external release approval. No new implementation item was started during the audit.

Sequencing update 2026-09-08: start with INFRA-DUAL-001 and the minimum isolated Dev/build/deploy acceptance. R3 configuration (Part A) is implemented through INFRA-DUAL-003; REL-AUD-003 retains final signed-release acceptance (Part B), so it cannot be completed merely by installing Dev. Then prioritize REL-AUD-001/002/007 before final release acceptance. Pure local patch work need not wait if Pi access is blocked. No item is newly marked active or done by this planning update.

| ID          | Priority | Status | Work item                                                        | Done when                                                                                                                                                                                                                                                                       |
| ----------- | -------- | ------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REL-AUD-001 | P1       | ready  | Persistent complete account export/deletion (R1; REL-001)        | Authenticated lifecycle covers every durable category/Auth/Storage, deterministic batch pagination, retries safely, and passes two-user database tests                                                                                                                          |
| REL-AUD-002 | P1       | ready  | Mobile account data controls and accurate disclosures (R2)       | REL-AUD-001 passes; native file export via FileSystem/Share, staged deletion with local cache purge, and external deletion pathway complete                                                                                                                                     |
| REL-AUD-003 | P1       | ready  | Reproducible signed tester build profiles (R3; REL-002)          | Explicit production variant, matching callbacks, public-key/EAS/signing setup, and exact TestFlight/Play artifacts accepted                                                                                                                                                     |
| REL-AUD-004 | P1       | active | Resolve iOS Google-login parity (R4)                             | Native Sign in with Apple implemented with SHA-256 nonce replay protection; Google Sign-In re-enabled on iOS alongside Apple under Guideline 4.8; gated via MIZYUN_ENABLE_APPLE_AUTH; independent security review approved; device verification pending Apple Developer license |
| REL-AUD-005 | P0       | ready  | Current Gemini external eligibility/consent/evaluation gate (R5) | Actual project terms/retention/billing, adult eligibility, server-enforced access, sharing consent and model evaluation accepted; otherwise external AI disabled                                                                                                                |
| REL-AUD-006 | P1       | ready  | Protect AI tier authority and budget every provider path (R6)    | Direct own-profile tier escalation denied; photo/text/refine budgets enforced; moderation accurately represented and evaluated                                                                                                                                                  |
| REL-AUD-007 | P1       | ready  | Idempotent authoritative logging retries (R7)                    | Lost-response meal retry returns original record; draft persisted pre-submit; write paths audited in docs/MUTATION_IDEMPOTENCY_AUDIT.md                                                                                                                                         |
| REL-AUD-008 | P1       | ready  | Current candidate device/operations acceptance (R8; REL-002/003) | Candidate fixes pass; Pi access restored; off-device backup/restore, alerts, auth/recovery, accessibility/network, and both native artifacts evidenced                                                                                                                          |
| REL-AUD-010 | P2       | ready  | Reconcile stale operational/AI/product documents                 | Pi/Gemini/confirmed-email/current-feature evidence replaces obsolete Windows/Mistral/unhosted claims without marking open gates complete                                                                                                                                        |

## Now — Persistent manual alpha

These items convert the tested domain/API foundation into the low-friction product required for customer validation.

| ID          | Priority | Status  | Work item                                              | Done when                                                                                                                                                          |
| ----------- | -------- | ------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MOB-AND-001 | P2       | ready   | Split the founder Android APK per ABI                  | `:app:assembleRelease` produces separate `arm64-v8a` (and other ABI) APKs; per-device download drops from ~103 MB to ~35–45 MB; messenger transfer becomes trivial |
| AI-GOV-001  | P0       | active  | Mistral privacy, policy, DPA, ZDR, and commercial gate | Capped/private dev setup attested; written real-user health-policy decision remains; founder-only testing mode is documented                                       |
| AI-MOB-001  | P1       | active  | Native Coach conversation experience                   | iPhone trusted-LAN preflight active; native synthetic acceptance remains                                                                                           |
| ALPHA-001   | P0       | ready   | Founder week plus 10–30 design-partner alpha           | No open P0/P1 issue blocks repeated use; evidence and feedback are recorded                                                                                        |
| BILL-001    | P1       | blocked | Premium packaging and mobile subscription billing      | Paid value/cost is validated and entitlements restore safely                                                                                                       |

## Later — Phases 6–9

| ID             | Priority | Status   | Work item                                                | Entry gate                                                                                       |
| -------------- | -------- | -------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| IOS-HEALTH-001 | P2       | research | HealthKit permissions and steps adapter                  | Phase 5                                                                                          |
| AND-HEALTH-001 | P2       | research | Health Connect permissions and steps adapter             | Android verified                                                                                 |
| MEM-001        | P0       | active   | Persistent memory adapter and controls                   | Active-only authorized recall plus candidate lifecycle and mobile controls                       |
| AI-001         | P0       | active   | Evaluate/select initial Mistral model                    | First live synthetic structured response passes; full evaluation remains                         |
| AI-002         | P1       | active   | Text coaching adapter and read-only tools                | Production synthetic tool flow passes; native iPhone re-acceptance remains                       |
| VISION-001     | P1       | active   | Editable text/photo food drafts                          | Local mobile/API/provider gate passes; authenticated native/provider acceptance remains          |
| VISION-002     | P2       | blocked  | Conservative body-progress observations                  | Media + safety evaluation                                                                        |
| REL-001        | P0       | blocked  | Privacy/export/deletion release gate                     | MVP repositories complete                                                                        |
| REL-002        | P0       | blocked  | iOS/Android beta build matrix                            | MVP feature complete                                                                             |
| REL-003        | P1       | blocked  | Accessibility and poor-network pass                      | MVP feature complete                                                                             |
| AUTH-SMTP-001  | P1       | active   | Domain-authenticated Auth & transactional email delivery | `no-reply@mizyun.phiskel.com` SES adapter & GoTrue SMTP configured via `docs/SES_EMAIL_SETUP.md` |

## Infrastructure evolution

| ID                 | Priority | Status  | Work item                                                          | Entry gate                                                                                                         |
| ------------------ | -------- | ------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| INFRA-WIN-001      | P0       | active  | Provision Windows/WSL2 founder-production backend                  | Official self-hosted Supabase + API survive reboot; backup/restore and authenticated synthetic device journey pass |
| INFRA-SELFHOST-001 | P0       | active  | Self-hosted Mizyun-operated Supabase on Adam's Slovakia PC (alpha) | Implemented by INFRA-ENV-001 and completed by live INFRA-WIN-001 acceptance                                        |
| INFRA-PORT-001     | P1       | blocked | Managed-to-self-hosted portability and restore lab                 | The alpha track on the Slovakia PC has shipped; off-site backups + second operator exist                           |
| INFRA-CUTOVER-001  | P2       | blocked | Rehearse and execute production data-plane migration               | 90-day staging gate and two rehearsals pass                                                                        |

The authoritative stages, operational gates, topology, rollback, and provisional service objectives live in `docs/INFRASTRUCTURE_EVOLUTION_PLAN.md`. The single-Linux-host restriction is relaxed for the alpha track per ADR-0016 amendment 2026-07-25; it is restored before any paying-user cutover.

## Parking lot

These ideas are not commitments and should not displace MVP work without updating `goals.md` and `plan.md`:

- barcode scanning and external nutrition databases;
- Apple Watch/Wear OS companion experiences;
- coach/client team accounts;
- social sharing, challenges, or leaderboards;
- meal planning and grocery lists;
- advanced periodization and readiness models;
- localization beyond architecture readiness.

## Maintenance rules

- Assign a new stable ID; do not renumber existing items.
- Mark an item `active` only when it is the current work package in `status.md`.
- Record blockers as dependencies, not vague notes.
- Move completed implementation detail to Git history; retain the row as `done` until the containing phase completes.
- New durable scope must map to a goal and product requirement before implementation.

## Shared agent skills — planned 2026-09-13

- **AGENT-SKILLS-001 — ready for future implementation.** Follow [the evidence-based Codex/Antigravity guide](docs/AGENT_SKILLS_IMPLEMENTATION_GUIDE_2026-09-13.md). Start with context hygiene and three shared P0 skills; improve existing triage skills before adding deployment/mobile/analytics skills. Product roadmap sequencing is unchanged.
- **Exit:** one canonical repository skill library, preserved rules/evidence and dirty work, measured context-cost baseline/comparison, required checks, and fresh discovery/behavior acceptance in both clients. Current completion is the guide only; no token savings or installed compatibility claimed.
