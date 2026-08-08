# Mizyun backlog

> Executable work inventory. The roadmap and dependency order live in `plan.md`. Keep each item small enough to finish and verify in one focused segment where practical.

## Status and priority

- Status: `ready`, `research`, `active`, `blocked`, `done`
- Priority: P0 blocks safe progress/release; P1 is MVP-critical; P2 is valuable; P3 is optional/later.

## Now — Phase 1

| ID                | Priority | Status | Work item                                               | Done when                                                                   |
| ----------------- | -------- | ------ | ------------------------------------------------------- | --------------------------------------------------------------------------- |
| BE-001            | P0       | done   | Choose local/hosted Supabase development workflow       | ADR-0003: local-first with separate hosted integration                      |
| TOOL-001          | P0       | done   | Start the installed Docker Desktop runtime              | Docker engine verified and local stack starts                               |
| BE-002            | P0       | done   | Configure local development Supabase project            | Local stack starts from committed configuration                             |
| BE-003            | P0       | done   | Apply and validate all migrations                       | Clean reset and database lint pass                                          |
| SEC-001           | P0       | done   | Add automated RLS isolation tests                       | All current pgTAP schema/RLS assertions pass                                |
| SEC-002           | P0       | done   | Complete private-media isolation tests                  | Path and signed-URL owner-isolation tests pass                              |
| CFG-001           | P1       | done   | Add validated API and mobile configuration modules      | Missing/invalid config produces typed, actionable states                    |
| API-001           | P1       | done   | Create provider-neutral authenticated mobile API client | Tokens attach/refresh; 401 and network errors normalize                     |
| AUTH-001          | P1       | done   | Test real sign-up/sign-in/session restore               | Verified against local Supabase on iOS and Android                          |
| AUTH-002          | P1       | done   | Add account/settings screen with sign-out               | Signed-in user can explicitly end the session                               |
| AUTH-003          | P1       | done   | Implement password recovery and confirmation flows      | Deep-link and error states verified                                         |
| AUTH-PROD-001     | P0       | done   | Restore founder-production account creation             | Founder-alpha autoconfirm issues a session; raw provider errors are hidden  |
| MOB-ENV-001       | P0       | done   | Isolate founder Production iOS build environment        | Guarded build rejects non-production API/Auth hosts before Expo bundles     |
| AUTH-UX-001       | P1       | done   | Keep Auth actions reachable above the software keyboard | Auth and recovery forms scroll, dismiss, and submit through keyboard safely |
| OPS-001           | P1       | done   | Establish safe structured API logging/error baseline    | Request IDs present; sensitive bodies/tokens excluded                       |
| AND-001           | P1       | done   | Configure and verify Android emulator                   | Standalone Release journey and native media pass                            |
| DOCS-WIKI-001     | P2       | done   | Capture reusable local development runbooks             | Setup/build/test/platform failures are reproducible                         |
| INFRA-MIGRATE-001 | P0       | done   | Apply forward migrations to founder production          | Backup made; all 13 migrations applied and onboarding tables verified       |

## Now — Persistent manual alpha

These items convert the tested domain/API foundation into the low-friction product required for customer validation.

| ID              | Priority | Status  | Work item                                                           | Done when                                                                                                                                                       |
| --------------- | -------- | ------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PERSIST-001     | P0       | done    | Supabase repositories for profile, goals, and food                  | Production composition persists records across API restarts with RLS                                                                                            |
| PERSIST-002     | P0       | done    | Supabase repositories for training, body, and account               | Same persistence/isolation/export/deletion proof as PERSIST-001                                                                                                 |
| PERSIST-003     | P0       | done    | Real Supabase private-media storage adapter                         | Mobile-compatible signed upload/download/delete works against real storage                                                                                      |
| MOB-DAILY-001   | P1       | done    | Persistent mobile daily-loop integration                            | All MOB-ONB/NUT/WO/BODY/DASH child journeys pass together on stored data                                                                                        |
| MOB-ONB-001     | P1       | done    | Complete activation and baseline weight                             | New user reaches a useful dashboard with the minimum energy inputs                                                                                              |
| MOB-NUT-001     | P1       | done    | Manual food logging and daily totals UI                             | User can create/edit/delete food and see stored calorie/macro totals                                                                                            |
| MOB-WO-001      | P1       | done    | Exercise, workout, and set logging UI                               | User completes a workout and sees previous performance                                                                                                          |
| MOB-BODY-001    | P1       | done    | Weight/measurement entry and trend UI                               | User records weight and sees raw history plus a labeled trend                                                                                                   |
| MOB-DASH-001    | P1       | done    | Replace dashboard placeholders with real summaries                  | Calories, weight, training, and energy state come from persisted records                                                                                        |
| MEDIA-MOB-001   | P1       | done    | Progress-photo capture/upload/timeline/compare UI                   | Private photo lifecycle is usable and deletable from mobile                                                                                                     |
| OBS-001         | P1       | done    | Privacy-safe product validation analytics                           | Activation, logging efficiency, failures, and retention are measurable                                                                                          |
| AI-PLAN-001     | P0       | done    | Plan Mistral AI before controlled pre-alpha                         | Sequenced provider, safety, evaluation, UI, and release gates are documented                                                                                    |
| AI-GOV-001      | P0       | active  | Mistral privacy, policy, DPA, ZDR, and commercial gate              | Capped/private dev setup attested; written real-user health-policy decision remains; founder-only testing mode is documented                                    |
| AI-CONFIG-001   | P0       | done    | Validated server-only Mistral configuration                         | Missing keys fail closed; external access defaults off                                                                                                          |
| AI-PROVIDER-001 | P0       | done    | Official-SDK Mistral provider adapter                               | Structured output, metadata, retry, timeout, and failures normalize                                                                                             |
| AI-CONV-001     | P0       | done    | Private coach conversation persistence and API                      | Auth, RLS adapter, idempotency, export, delete, and route tests pass                                                                                            |
| AI-SAFETY-001   | P0       | done    | Provider-neutral coach safety envelope                              | Versioned 12-case EN/SK critical corpus passes; Mistral moderation port implemented with tests                                                                  |
| AI-SAFETY-002   | P1       | done    | Align output moderation with wellness scope                         | Health remains input-blocking; wellness output passes unless another unsafe category or deterministic pattern matches                                           |
| AI-MOB-001      | P1       | active  | Native Coach conversation experience                                | iPhone trusted-LAN preflight active; native synthetic acceptance remains                                                                                        |
| AI-MOB-003      | P1       | done    | Clear Coach composer and expose failed-message retry                | Sent text stays out of the composer; failed bubbles and restored drafts provide an explicit retry action                                                        |
| AI-OPS-001      | P0       | done    | Durable AI budgets and replica-safe idempotency                     | Shared Postgres limits, tier caps, RPC ACL lockdown, and replica-safe idempotency verified                                                                      |
| COACH-PLAN-001  | P0       | done    | Deterministic calorie/protein/training plan foundation              | Versioned engine and real read-only Coach tools return auditable targets or missing inputs                                                                      |
| COACH-PERS-001  | P0       | done    | Goal-specific Coach personalization profile                         | Experience, equipment, preferences, limitations, and schedule persist and ground suggestions                                                                    |
| COACH-TRAIN-001 | P0       | done    | Exercise selection and progression plan                             | Deterministic editable suggestions reflect goal, profile, equipment, limitations, and recent volume                                                             |
| AI-ACT-001      | P0       | done    | Conversational meal action proposals                                | Text/photo Coach inputs persist an editable proposal; only explicit review/save creates a food entry                                                            |
| AI-ACT-002      | P0       | done    | Conversational workout action proposals                             | Coach produces an editable deterministic workout proposal that requires explicit start/confirmation                                                             |
| AI-ACT-003      | P0       | done    | Daily Coach action plan                                             | Coach unifies remaining calories/protein, training state, missing inputs, and one practical next action                                                         |
| AI-ACT-004      | P0       | done    | Weekly Coach adaptation proposal                                    | Coach reviews confirmed adherence/trends and proposes an inspectable target or training adjustment                                                              |
| AI-ACT-005      | P1       | done    | Opt-in proactive Coach prompts                                      | User-controlled reminders surface useful daily/weekly Coach check-ins without autonomous writes                                                                 |
| AI-ACT-006      | P1       | done    | Multi-session workout plan proposals (Coach → interactive workouts) | Pattern + LLM intent extraction, deterministic engine builds N ordered sessions, mobile Save-all creates N scheduled workouts; native iPhone acceptance remains |
| AI-ACT-007      | P1       | done    | Refine AI meal drafts with follow-up instructions                   | `/v1/food-entries/draft/refine` accepts current draft + 2–1000 char instruction; LLM adjusts existing values (prompt version `nutrition-draft-refine-v1`); mobile Log a meal exposes a "Refine with AI" block after the macros; prompt version, deterministic safety replacement, shared rate limit, injection screen, recoverable instruction, and refine-specific humanizer all covered |
| ALPHA-001       | P0       | ready   | Founder week plus 10–30 design-partner alpha                        | No open P0/P1 issue blocks repeated use; evidence and feedback are recorded                                                                                     |
| BILL-001        | P1       | blocked | Premium packaging and mobile subscription billing                   | Paid value/cost is validated and entitlements restore safely                                                                                                    |

Native acceptance evidence: standalone iOS and Android Release apps pass real sign-in, exact meal totals, weight plus waist/chest history, workout/set completion, previous performance, dashboard summaries, app-restart session/data restoration, and the two-photo private upload/compare/delete lifecycle against local Supabase. iOS additionally proves new-user onboarding with an 80 kg baseline. Android runs on an API 36 Pixel 9 AVD and uses only local reverse tunnels to make Supabase's localhost signed Storage URLs reachable from the emulator.

## Implemented domain/API slices — not yet customer-complete

`done` in this section means the scoped domain and Fastify route behavior is implemented and tested. It does not mean persistent production storage or a usable mobile workflow exists.

| ID        | Priority | Status | Work item                                     | Dependency                 |
| --------- | -------- | ------ | --------------------------------------------- | -------------------------- |
| PROF-001  | P1       | done   | Profile domain/repository/API slice           | Phase 1 isolation baseline |
| GOAL-001  | P1       | done   | Goal model, validation, and history           | PROF-001                   |
| UX-001    | P1       | done   | New-user onboarding flow                      | PROF-001, GOAL-001         |
| NUT-001   | P1       | done   | Manual food CRUD vertical slice               | Phase 1 repositories       |
| NUT-002   | P1       | done   | Daily macro/calorie summary                   | NUT-001                    |
| ENG-001   | P1       | done   | Select/version deterministic energy formulas  | Profile/goal requirements  |
| ENG-002   | P1       | done   | Energy target and balance engine              | ENG-001, NUT-002           |
| EX-001    | P1       | done   | Custom exercise CRUD                          | Phase 1 repositories       |
| WO-001    | P1       | done   | Workout templates and sessions                | EX-001                     |
| WO-002    | P1       | done   | Set logging and previous-performance view     | WO-001                     |
| BODY-001  | P1       | done   | Weight/measurement tracking and trends        | Profile vertical slice     |
| MEDIA-001 | P0       | done   | Private upload/sign/delete adapter            | SEC-002                    |
| MEDIA-002 | P1       | done   | Progress photo timeline/comparison            | MEDIA-001                  |
| DATA-001  | P0       | done   | Define export/account deletion lifecycle      | Stable repositories/media  |
| PROF-001+ | P1       | done   | Profile follow-up: activityLevel + sexAtBirth | PROF-001                   |

## Later — Phases 6–9

| ID             | Priority | Status   | Work item                                    | Entry gate                                                                              |
| -------------- | -------- | -------- | -------------------------------------------- | --------------------------------------------------------------------------------------- |
| IOS-HEALTH-001 | P2       | research | HealthKit permissions and steps adapter      | Phase 5                                                                                 |
| AND-HEALTH-001 | P2       | research | Health Connect permissions and steps adapter | Android verified                                                                        |
| MEM-001        | P0       | active   | Persistent memory adapter and controls       | Active-only authorized recall plus candidate lifecycle and mobile controls              |
| AI-001         | P0       | active   | Evaluate/select initial Mistral model        | First live synthetic structured response passes; full evaluation remains                |
| AI-002         | P1       | active   | Text coaching adapter and read-only tools    | Production synthetic tool flow passes; native iPhone re-acceptance remains              |
| VISION-001     | P1       | active   | Editable text/photo food drafts              | Local mobile/API/provider gate passes; authenticated native/provider acceptance remains |
| VISION-002     | P2       | blocked  | Conservative body-progress observations      | Media + safety evaluation                                                               |
| REL-001        | P0       | blocked  | Privacy/export/deletion release gate         | MVP repositories complete                                                               |
| REL-002        | P0       | blocked  | iOS/Android beta build matrix                | MVP feature complete                                                                    |
| REL-003        | P1       | blocked  | Accessibility and poor-network pass          | MVP feature complete                                                                    |
| AUTH-SMTP-001  | P1       | blocked  | Domain-authenticated Auth email delivery     | `no-reply@phiskel.com` sends confirmation/recovery mail before external beta            |

## Infrastructure evolution

| ID                 | Priority | Status     | Work item                                                          | Entry gate                                                                                                             |
| ------------------ | -------- | ---------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| INFRA-ENV-001      | P0       | done       | Isolate Mac development from Windows founder production            | Production config fails closed; exact-commit promotion never resets PC data; runbook and service templates pass checks |
| INFRA-WIN-001      | P0       | active     | Provision Windows/WSL2 founder-production backend                  | Official self-hosted Supabase + API survive reboot; backup/restore and authenticated synthetic device journey pass     |
| INFRA-SELFHOST-001 | P0       | active     | Self-hosted Mizyun-operated Supabase on Adam's Slovakia PC (alpha) | Implemented by INFRA-ENV-001 and completed by live INFRA-WIN-001 acceptance                                            |
| INFRA-MANAGED-001  | P0       | superseded | Hosted managed Supabase EU development/staging                     | Superseded by INFRA-SELFHOST-001 for the alpha track; returns as the production-track shape via INFRA-PORT-001         |
| INFRA-PORT-001     | P1       | blocked    | Managed-to-self-hosted portability and restore lab                 | The alpha track on the Slovakia PC has shipped; off-site backups + second operator exist                               |
| INFRA-CUTOVER-001  | P2       | blocked    | Rehearse and execute production data-plane migration               | 90-day staging gate and two rehearsals pass                                                                            |

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
