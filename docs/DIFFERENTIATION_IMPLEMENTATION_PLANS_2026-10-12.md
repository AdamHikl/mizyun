# Mizyun differentiation implementation plans

This proposed five-plan package would turn Mizyun's private tracking and Coach workflows into a connected review, action and follow-up experience for busy recreational lifters. Two detailed drafts exist. The remaining three await the user's intervening Everfit and project-priority reassessment. Trainer support is a separate product hypothesis evaluated below.

Planning date: 2026-10-12. Status: incomplete draft package, not a settled implementation recommendation; implementation has not started through these documents. This is the planning-session continuity artifact. No feature code, migrations, builds, provider calls, deployment, credentials or product-direction changes were performed. Existing work and release gates remain owned by their current sessions.

## Five plans and execution order

| Recommendation                          | Detailed plan                                                                                                 | Existing execution owner                                                         | Dependency                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------- |
| One connected weekly priority           | [01 Connected weekly review](plans/mizyun-differentiation-2026-10-12/01-connected-weekly-review.md)           | PC-04 / [#174](https://github.com/AdamHikl/mizyun/issues/174), with PC-02 / #172 | Plan 05 evidence foundation                     |
| Advice that opens a usable action       | [02 Actionable Coach suggestions](plans/mizyun-differentiation-2026-10-12/02-actionable-coach-suggestions.md) | PC-02 / #172 and PC-03 / #173; retry dependency #31                              | Plan 05; start with one meal action             |
| Follow up on an accepted change         | 03 Recommendation follow up — not yet authored                                                                | PC-04 / #174, evaluated through PC-06 / #176                                     | Plans 01 and 02                                 |
| Familiar meals and ingredient options   | 04 Practical meal suggestions — not yet authored                                                              | PC-04 / #174, with meal logging owners                                           | Plans 05 and 02                                 |
| Visible uncertainty and memory controls | 05 Evidence and memory transparency — not yet authored                                                        | PC-01 / #171; existing day-completion scope #119                                 | Foundation; advanced presentation can follow 01 |

Suggested sequence: 05 stages 1–3 → 01 descriptive review → 02 one meal action → 03 one follow-up → 04 familiar meal choices and then ingredient drafts. Extend workout edits and target-changing adaptation only after their versioning and retry gates pass. These are proposed slices within the existing [proactive Coach plan](PROACTIVE_COACH_PLAN_2026-10-02.md), not five independent replacements for it. The umbrella [#170](https://github.com/AdamHikl/mizyun/issues/170) remains research; #171 is ready, #172–175 blocked, and #176 research in the live backlog read on 2026-10-12. Recheck before beginning a slice; this document closes no issue.

Do not silently reorder the active work in [status](../status.md) or the accepted [roadmap](../plan.md). Select one bounded package in a future implementation session. New implementation issues should be children or explicit splits of the existing owners, with priority, status and area labels; avoid duplicate generic AI epics.

## Baseline and source correspondence

Observed HEAD: `0135228778059dc25c1a4925738f0b6934ed4f0c`. The shared tree contains concurrent Community meal sharing, tab caching, retained-photo and Coach-capability changes, including shared requirements/research/status files. Source observations include that mutable tree and are not an immutable release candidate. Future sessions must refresh their context and preserve all pre-existing work. No broad gate was run on the changing tree for this planning-only package.

Installed declarations: Expo `~57.0.23`, React Native `0.86.3`. Reverify exact resolved dependencies and current official guidance before native implementation.

Coordinator-inspected source fingerprints on 2026-10-12:

| Source                                                       | SHA256                                                             | Finding                                                                                                        |
| ------------------------------------------------------------ | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/weekly-adaptation.ts`                     | `2336a7630e6417b1f84fcfdf5466529b5cba68f59fcfce85a5de5f3114af21f0` | Non-null calorie days currently count toward adaptation readiness; they do not establish complete intake.      |
| `apps/api/src/modules/coach/tools.ts`                        | `fdf4e589f90b3bfaa4f65c56be8c64c3eadd053f0775dad97e59e7f7917ed9bf` | Weekly assembly uses capped meal/workout retrieval and local-day buckets without explicit completion evidence. |
| `packages/contracts/src/coach.ts`                            | `1a0367033d9d05826149a710da7eea4526a8d2f715ab13fc7b7aec287fb75997` | Six existing typed action kinds; workout-edit proposal lacks an expected source version.                       |
| `apps/api/src/modules/coach/memory-routes.ts`                | `d9a63ff09bb29345b7392b73a6ab6ef95ccc3b59820553905dc19e7e26d52cac` | Principal-scoped memory controls already exist.                                                                |
| `apps/mobile/src/features/settings/memory-controls-card.tsx` | `6dc0e66c0fe17ff730e45f9a90b2c3117f630d525d2ca1c515ed7307937687d5` | Existing create, edit, expiry and delete UI must be reused.                                                    |

The source-mapping helper independently inspected typed proposal rendering, meal-draft recovery, workout-plan saving, meal history and local day completion. This informed planning; it is not runtime acceptance. Market research was delegated separately. A third fresh helper could not be started because the runtime agent limit was reached; the coordinator inspected the foundation directly.

## Shared implementation constraints

- Pure evidence selection, calculations and ranking belong in `packages/core`; versioned schemas in `packages/contracts`; persistence ports and adapters remain separate; `apps/api` composes; mobile presents and integrates devices. Export through module public surfaces and update `docs/feature-map.json` when implementing.
- Preserve ADR-0024 adult/current-consent admission, server authentication, existing budgets and kill switches. No new provider, search grounding, embeddings or automatic memory inference. A personal explanation or draft uses the existing server-only Gemini adapter and accounting. Deterministic reviews work without a provider. New automatic explanation is off by default and distinct from current AI consent.
- Explicitly confirmed nutrition estimates are still estimates. Day coverage, nutrient completeness, record provenance and retrieval completeness are independent dimensions. Missing/unknown is never zero; truncated history never implies adherence or lack of progress.
- Use the user's IANA timezone and explicit local intervals, including DST, travel and backdating. Preserve canonical timestamps. No HealthKit/Health Connect/watch/imported data or private body-photo interpretation is added to Coach context by these plans.
- Every new durable artifact requires owner indexes, RLS and grants, cross-owner relation checks, bounded retention, complete export/deletion inventory, local cache cleanup and post-restore erasure treatment. The verified principal determines ownership. No direct model-authorized write.
- Atomic acceptance must check current source/goal/constraint revisions, deletion barriers and operation identity. Persist an account-owned immutable retry payload before sending. A lost response is an unknown outcome, not a reason to create a fresh operation.
- Shared continuity files and issue management belong to the coordinator. Freeze the reviewed source candidate after focused checks; require a non-author High review for authorization, migrations, lifecycle, AI admission/budgets or release safeguards. Select an isolated candidate before a broad gate when other sessions are writing.

## Shared verification and delivery gates

Each plan specifies focused regressions. Add meaningful tests for the real failure boundaries before broad verification. No counts here are fresh passes.

```sh
pnpm --filter @mizyun/contracts test
pnpm --filter @mizyun/core test
pnpm --filter @mizyun/api test src/modules/coach
pnpm --filter @mizyun/mobile test src/features/coach
pnpm --filter @mizyun/memory test
pnpm test:ai-eval
pnpm navigation:check
pnpm format:check
pnpm check
```

Select the affected focused suites rather than running every package repeatedly. Format owned files first. Run every new or modified test on the final source, settle independent review, then run one `pnpm check` on the stable candidate. Do not invoke `check:steps` directly. New persistence needs disposable-local SQL/RLS tests and real two-user authenticated HTTP/database tests; mocks alone do not establish isolation. Destructive database operations are coordinator-only and local-disposable only.

Native acceptance covers iOS and Android, account switch/logout, relaunch, offline/reconnect, late network responses, large text, VoiceOver/TalkBack, light/dark, small screens and metric/imperial units. Provider-neutral fixtures can start immediately; actual-provider tests remain gated by [BEFORE_TESTING](BEFORE_TESTING.md), #29 and expanded synthetic evaluations. Preserve #25/#26 export/deletion, #31 retries, #36 native Coach and [Q1–Q9 evidence](REMEDIATION_EVIDENCE_CHECKLIST.md). Follow [quality gates](QUALITY_GATES.md).

Deployment and Production promotion are separate authorized milestones. Record source/deployed SHA, migration versions, exact device/build IDs, commands/results/skips, provider identity and cost evidence; source, automated, Dev, device, pilot and Production acceptance stay distinct.

## Validation before expansion

Use an eligible 10–15-person design-partner cohort after access/release prerequisites, over four weeks. Establish a first-week baseline for tracking effort and current tools. Measure review return, voluntarily accepted actions, actual action completion, usefulness ratings with denominators, corrections/dismissals, time/taps, week-four retention, willingness to pay and AI cost. These sample sizes are experiment proposals, not statistical proof or industry benchmarks.

Set continuation thresholds before recruitment. Interview retained and departed users. Do not infer health improvement, causality, or willingness to switch from suggestion acceptance alone. Analytics remains optional and payload-free; food names, health values, ingredients, memory text, client relationships and messages never enter telemetry.

## Trainer product assessment

The proposed trainer product addresses an established category. Official pages checked 2026-10-12 show:

| Platform       | Relevant functionality                                                                                          | Primary source                                                                                                                                                                             |
| -------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ABC Trainerize | Client programs, workout/compliance tracking, meal and macro tools; AI workout drafting                         | [Features](https://www.trainerize.com/features/?tzTabId=1), [nutrition](https://www.trainerize.com/features/nutrition/), [AI builder](https://resources.trainerize.com/ai-workout-builder) |
| Everfit        | Trainer web/client apps, workout programming, AI meal-photo logs visible to coaches, AI program-note conversion | [MacroSnap](https://everfit.io/macrosnap-coaching/), [AI tools](https://everfit.io/ai/)                                                                                                    |
| TrueCoach      | Workout scheduling, client monitoring/messaging and nutrition metrics/MyFitnessPal integration                  | [Nutrition features](https://truecoach.co/nutrition-coaching-features-in-truecoach/), [workout builder](https://help.truecoach.co/en/articles/3047972-the-workout-builder-basics)          |
| Hevy Coach     | Trainer product alongside an existing consumer app; program assignment and workout/body tracking                | [Hevy Coach](https://hevycoach.com/)                                                                                                                                                       |

These are advertised capabilities, not hands-on quality/accuracy comparisons. Hevy meal logging and a TrueCoach integrated conversational AI coach were not verified. Trainerize's detailed AI FAQ describes draft generation with limits; do not turn its promotional wording into a promise of autonomous program assignment.

**Recommended hypothesis:** a trainer can review a client's week faster because the trainee already keeps food, actual sets and body trends in Mizyun. AI prepares an inspectable summary and draft; the trainer decides; the trainee's AI coach helps explain and carry out the agreed plan. This is an efficiency and workflow hypothesis, not unique technology.

Start with interviews and a responsive trainer web prototype, not a second native build pipeline. Target independent coaches who use spreadsheets/messages or whose clients already use Mizyun. Desktop program editing and multi-client review are likely useful; validate on-the-go requirements before selecting a native companion. Do not replace existing billing, business management, video libraries, payments, chat or white-label infrastructure in the first experiment.

Proposed initial portal scope: invite and trainee approval; a scoped client list; planned-versus-completed workouts and working-set progression; meal logging coverage and optionally allowed nutrition totals; an editable future program with an exact change preview; one weekly review and trainer approval. No silent edits to consumed-meal records or completed workout history. Historical logs remain owned by the trainee; the trainer authors program versions.

This introduces a second customer and delegated access outside the current private self-service launch scope in [goals](../goals.md). Before implementation, explicitly adopt the trainer work package and design a dedicated permission boundary. A Community follow, friendship, group or shared routine must never grant trainer access. Invitations require acceptance; separate permissions for workout reads, nutrition reads, body metrics and future-program editing. Photos, AI conversations and durable memories remain excluded unless separately designed and explicitly authorized. Apply revocation server-side to fresh requests, queued work and cached access; state that already viewed/copied information cannot be remotely recalled. Trainer and trainee account deletion/export and team membership need their own evidenced lifecycle rules.

Human and AI suggestions must display authorship and avoid conflicting authorities: AI may propose a change but cannot overwrite an agreed trainer program. Program versions, effective dates, trainee visibility, conflicts and rollback should be designed before granting edits. This needs a durable design ADR and independent High review when selected; these five personal-product plans do not implement access delegation.

Validate with 3–5 consenting coaches and a small eligible client group once access prerequisites pass. Compare minutes per weekly review and program update before/after, client logging persistence, coach corrections, approval rate, permission problems and actual willingness to move clients/pay. Agree numerical continuation criteria before starting. The likely acquisition benefit is that one trainer introduces several trainees; it is not guaranteed distribution or retention. Switching established coaches from incumbent suites is a separate migration problem.

## Primary sources and implementation consequences

Checked 2026-10-12; also recorded in the [research log](RESEARCH_LOG.md).

- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security): grants and row policies both matter; new owner-scoped records require operation-specific allow/deny proof.
- [Gemini structured outputs](https://ai.google.dev/gemini-api/docs/structured-output): schema-shaped output does not authorize actions or validate nutritional meaning; application rules remain authoritative.
- [Gemini terms](https://ai.google.dev/gemini-api/terms): billing/data-use/retention must be evidenced for the actual project; never claim zero retention or EU-only processing from backend location.
- [Expo Router SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/router/): use the installed router's supported navigation, passing opaque draft references rather than sensitive payloads in links.
- [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/): use existing account-owned persistence/error handling for bounded local state. The exact SDK 57 SecureStore URL failed in this research tool; latest guidance is contextual and must be checked against the installed SDK before implementation.
- [MyFitnessPal Coach](https://support.myfitnesspal.com/hc/en-us/articles/45212266254221-Introducing-Nutrition-Coach-Your-Nutrition-Assistant), [MacroFactor Workouts](https://macrofactor.com/workouts/), and [HealthifyMe](https://www.healthifyme.com/smart/features.html): grounded nutrition advice and combined product breadth are already competitive; test completed user workflows rather than claiming feature exclusivity.

## Next exact action

First resolve the user's Everfit comparison and project-priority question. These feature proposals do not establish differentiation or justify starting implementation. If the personal-product direction is retained, finish the three missing detailed plans, then select the PC-01/#171 coverage foundation: reproduce sparse meal days incorrectly qualifying weekly adaptation and settle the shared server coverage contract with existing day-completion UI. Keep trainer discovery separate until that product direction is selected. The two existing detailed drafts end with copyable implementation prompts.
