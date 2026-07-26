# Mistral AI implementation plan

> Plan for building and privately evaluating Mizyun's first AI capabilities before founder/design-partner alpha. This document does not authorize external AI use by itself; `docs/BEFORE_TESTING.md` and the release gates below remain authoritative.

## Decision summary

- Preferred provider: Mistral AI's first-party API.
- Preferred text model configuration: `mistral-medium-latest`.
- Integration: the official TypeScript SDK inside `packages/providers/mistral`, called only by `apps/api`.
- API style: stateless Chat Completions plus Mizyun-owned conversation persistence. Do not use Mistral's hosted Agents/Conversations storage for v1.
- First capability: a read-only, text coach grounded in confirmed Mizyun records and deterministic calculations.
- Later capabilities: user-controlled durable memory, then editable text/photo nutrition drafts.
- Rollout: disabled by default and feature-flagged. Build and evaluate with synthetic data before founder alpha; enable for real testers only after privacy, usage-policy, safety, deletion, cost, and native acceptance gates pass.

`mistral-medium-latest` is a moving alias, not a durable evaluation identity. Every response must record the resolved model returned by Mistral, prompt version, tool-schema version, token usage, latency bucket, and finish reason. If a stable dated model ID is available, release candidates should pin it. If only the alias is used, a resolved-model change disables external rollout until the evaluation suite passes again.

## Implementation snapshot — 2026-07-26

The default-off first vertical slice is implemented:

- validated server-only Mistral configuration and an official-SDK adapter with structured output, normalized failures, timeout, one bounded transient retry, and response metadata;
- authenticated Mizyun-owned conversation CRUD/message routes, idempotent submission, RLS persistence, account export/deletion coverage, and a recoverable provider-failure path;
- bounded server-derived grounding from confirmed profile, goal, nutrition, training, and body records, with deterministic weight calculations and no media or client-supplied user scope;
- a fixed provider-neutral safety boundary plus a versioned 12-case synthetic English/Slovak critical-safety corpus;
- a native Coach conversation screen with disabled, loading, empty, pending, retry, provider-unavailable, evidence, archive/delete, and limitations states;
- full offline repository and database gates.

This is an implementation milestone, not permission for real-user traffic. Mistral external access still defaults to `false`. On 2026-07-23, after the developer confirmed a dedicated capped workspace and privacy/retention controls, one direct live call passed with a fictional nutrition fixture: structured output, `stop` finish reason, 342 total tokens, and a 1–3 second latency bucket. No real user data, account identifier, photo, or key entered the recorded request/output. Live moderation calibration, comprehensive grounded-answer evaluation, application/native integration, and the real-user policy decision remain open.

The first integrated planning level is also implemented: a pure,
versioned engine owns calorie, protein, and base training targets;
`compute_energy` now returns the real confirmed-input calculation;
and `get_coaching_plan` gives the model a strict, read-only plan with
typed missing inputs. Bulk goals are accepted across the energy wire
contract.

## Full AI capability execution levels

Each level is a reviewable commit with focused tests and the standard
repository gate. External provider access remains default-off while
offline implementation proceeds.

1. **Deterministic planning foundation — done.** Versioned calorie,
   protein, goal-specific training focus, exercise types, assumptions,
   and missing-input behavior; real Coach calculation tools.
2. **Personalization profile — done.** Persist experience, available
   equipment, dietary preferences, exercise limitations, schedule, and
   goal-specific preferences; expose them through account controls and
   principal-bound Coach grounding.
3. **Training prescription and progression — done.** Build deterministic,
   inspectable exercise-selection and progression rules over exercises,
   templates, recent volume, equipment, experience, and limitations;
   let AI explain and suggest an editable plan.
4. **User-controlled memory — done.** Correct the production adapter's
   principal/token boundary, recall only confirmed active memories, add
   candidate/confirm/correct/deactivate/expiry lifecycle, and ship
   mobile review controls plus export/deletion evidence.
5. **Nutrition drafting completion — done.** Add text-to-draft and make both
   text/photo drafts return ranges, assumptions, provenance, warnings,
   and confidence before explicit confirmation.
6. **Evaluation and operations — done offline.** Expand reproducible grounded-answer,
   safety, prompt-injection, isolation, failure, budget, and
   secret-bundle suites; record threshold results and reconcile every
   release checklist.
7. **Native and external enablement — build-ready.** iOS and Android
   production bundles are part of the standard gate. Next, run authenticated
   device journeys, hosted persistence/deletion checks, provider-model
   promotion, and the separately authorized policy/privacy go/no-go.
8. **Coach action layer — active.** Convert explicit conversational inputs
   into typed, persistent, editable proposals. Text meal logging and
   transient Coach photo attachments now route through the nutrition-draft
   provider and appear as the same persistent review card. Review transfers
   the proposal into encrypted recoverable meal-form state, and only the
   existing confirmed food endpoint can create the authoritative entry.
   Workout proposals, daily action plans, weekly adaptation proposals, and
   opt-in proactive prompts remain sequenced behind this completed meal slice.

## Why implementation can move before alpha

The confirmed manual nutrition, workout, body, dashboard, and private-media loops already exist and pass locally on standalone iOS and Android. That is enough to build a grounded AI layer without asking the model to own calculations or authoritative records.

What does **not** exist yet is evidence that cloud AI is legally, privately, safely, economically, and operationally suitable for real Mizyun users. Therefore:

1. adapter, contracts, persistence, UI, and synthetic evaluation may be built now;
2. the Mistral API key stays server-side and external AI remains disabled by default;
3. founder/design-partner access requires every release gate in this plan;
4. ALPHA-001 elapsed days and participant counts remain zero until humans actually use the accepted build.

## Important provider constraint

Mistral's current cloud Usage Policy prohibits providing professional advice without proper qualification and explicitly includes health-related guidance. Mizyun must not assume that a “fitness coach” label is automatically outside that restriction.

Before any real user receives Mistral-generated coaching:

- obtain written clarification from Mistral for the intended fitness/wellness use case or review it with qualified legal counsel;
- define the boundary between general fitness education and prohibited medical/health advice;
- encode and test the resulting refusal/escalation behavior;
- keep AI disabled externally if the intended use is not permitted.

Offline implementation and fake-adapter evaluation may continue while this question is resolved. Live Mistral calls with synthetic fixtures may begin only after the synthetic-provider gate in `docs/BEFORE_TESTING.md`; no real health data may be sent.

## Capability order

### Capability 1 — Grounded text coach

The coach may:

- answer questions using the user's confirmed profile, active goal, food summaries, workout summaries, body trend, and deterministic energy result;
- explain which confirmed facts and calculations shaped the answer;
- suggest one conservative, reversible next action;
- state missing information and uncertainty.

The coach may not:

- diagnose, treat, prescribe, or handle emergencies;
- recommend extreme calorie deficits/surpluses, dangerous training volume, or contraindicated behavior;
- mutate a meal, workout, goal, measurement, or memory;
- receive unrestricted database access;
- treat model output as a deterministic calculation.

### Capability 2 — Conversations

- Create, continue, list, rename/archive, export, and delete Mizyun-owned conversations.
- Persist user and assistant messages under the verified user ID with RLS.
- Preserve a user message when provider generation fails so retry is recoverable.
- Never put message bodies in routine logs or product analytics.

### Capability 3 — Read-only tools

Initial normalized tools:

- `get_profile_and_goal`
- `get_nutrition_summary`
- `get_training_summary`
- `get_body_trend`
- `get_energy_explanation`

Tools accept no client-supplied `userId`. The API injects the verified principal and access token. Tool arguments and results use strict shared schemas, bounded date ranges, bounded row counts, and no media bytes or signed URLs.

### Capability 4 — User-controlled memory

- Store only explicit user statements or confirmed-record summaries as candidates.
- Require confirmation before a candidate becomes active when it is sensitive, inferred, or behavior-changing.
- Support list, provenance, correction, deactivate, expiry, export, and delete.
- Start with PostgreSQL full-text/trigram search behind `MemoryStore`; defer embeddings until measured retrieval quality requires them.

### Capability 5 — Editable nutrition drafts

Only after the text coach and memory gates pass:

- parse user text into an editable nutrition estimate;
- add food-photo input only after a consent-based synthetic/weighed-meal evaluation exists;
- return ranges, assumptions, provenance, and confidence;
- require explicit confirmation/edit before creating a food entry.

Body-photo diagnosis or precise body-fat estimation remains out of scope.

## Work packages

### AI-GOV-001 — Provider, privacy, and commercial gate

Deliverables:

- confirm which Mistral commercial terms apply to the company account;
- execute/review the DPA and current subprocessor list;
- determine whether Zero Data Retention is available and activate it before real-user traffic;
- disable provider feedback mechanisms that can attach input/output;
- obtain clarification for the fitness/wellness use case under the Usage Policy;
- document input/output retention, deletion, incident contact, region, subprocessors, and training opt-out;
- create separate development and production workspaces/keys where the account supports them;
- set the smallest practical organization/workspace spend limit.

Exit:

- a dated provider review records an explicit go/no-go for synthetic testing and a separate go/no-go for real users.

### AI-CONFIG-001 — Server-only configuration

Add validated server configuration:

```text
AGENT_PROVIDER=disabled|mistral
MISTRAL_API_KEY=<server secret>
MISTRAL_MODEL=mistral-medium-latest
MISTRAL_TIMEOUT_MS=<bounded integer>
MISTRAL_MAX_OUTPUT_TOKENS=<bounded integer>
AI_DAILY_USER_TOKEN_BUDGET=<bounded integer>
AI_EXTERNAL_ACCESS=false|true
```

Rules:

- `AGENT_PROVIDER=mistral` requires every Mistral field;
- `AI_EXTERNAL_ACCESS` defaults to `false`;
- no `MISTRAL_*` or AI secret is accepted by the mobile public-config loader;
- config errors name the missing server variable without printing its value;
- the API health/status surface reports readiness and resolved configuration metadata without exposing secrets.

### AI-PROVIDER-001 — Mistral adapter

Create `packages/providers/mistral`:

- implement `AgentProvider` using `@mistralai/mistralai`;
- keep SDK types and errors inside the provider package;
- use Chat Completions, structured outputs, and declared function tools;
- normalize authentication, timeout, 400, 401, 402, 429, 5xx, malformed output, content refusal, and abort errors;
- implement one bounded retry for transient/idempotent failures with jitter and `Retry-After` support;
- capture token usage, resolved model, finish reason, request correlation, and coarse latency/cost metadata;
- never log prompts, tool payloads, responses, API keys, or raw provider errors that may echo content.

The provider adapter must not import feature repositories. Tool execution remains in the agent runtime/API application layer.

### AI-RUNTIME-001 — Tool loop and safety envelope

Extend the provider-neutral runtime:

- normalized tool declaration, tool call, and tool result types;
- maximum tool-call rounds and total request deadline;
- strict schema validation before tool execution;
- an allowlist of read-only tools;
- independent authorization using the verified principal;
- prompt versioning and a fixed system safety policy;
- clear separation of confirmed facts, deterministic results, interpretation, and suggestion in the response contract;
- safe fallback when moderation, provider, tool, or output validation fails.

The model never chooses authorization scope and never receives database credentials.

### AI-CONV-001 — Conversation persistence and API

Add repository ports/adapters and routes for COACH-01 through COACH-06:

- `POST /v1/coach/conversations`
- `GET /v1/coach/conversations`
- `GET /v1/coach/conversations/:id`
- `POST /v1/coach/conversations/:id/messages`
- `PATCH /v1/coach/conversations/:id`
- `DELETE /v1/coach/conversations/:id`

Behavior:

- derive ownership from the bearer token;
- use an idempotency key for message submission;
- persist the user message before generation;
- store a recoverable failed state without fabricating an assistant response;
- validate/limit message count and text length;
- include conversations/messages in account export and deletion;
- add two-user RLS and route tests.

### AI-TOOLS-001 — Confirmed-data read tools

Implement each tool as an application service over existing ports:

- return only data required for the question;
- prefer daily/weekly aggregates over raw rows;
- label units, local-day boundaries, source, freshness, and missing inputs;
- call deterministic energy functions rather than asking the model to calculate them;
- exclude notes/free text unless the user explicitly includes them in the conversation;
- exclude progress-photo bytes and URLs from the text-coach phase.

Add tests proving a model-generated tool argument cannot expand the date range, switch user, request arbitrary SQL, or mutate data.

### AI-SAFETY-001 — Moderation and policy behavior

Create a provider-neutral safety decision boundary:

- pre-screen user input for self-harm/eating-disorder risk, medical requests, prompt injection, abuse, and PII leakage;
- post-screen generated output;
- evaluate Mistral's moderation endpoint for self-harm, health, PII, and jailbreaking, but do not rely on it as the only policy layer;
- fail closed for safety-screen errors when a response could be harmful;
- provide fixed, reviewed responses for emergencies, eating-disorder/self-harm signals, diagnosis/treatment requests, and requests outside Mizyun's scope;
- never claim professional qualification.

Emergency copy and escalation links require locale-aware product/legal review before external release.

### AI-EVAL-001 — Reproducible evaluation harness

Build a versioned, synthetic dataset with no real user health data:

- grounded nutrition explanation;
- grounded training/progression explanation;
- missing-data and contradictory-data handling;
- aggressive deficit/surplus requests;
- dangerous volume/intensity requests;
- injury, diagnosis, medication, eating-disorder, and self-harm prompts;
- prompt injection in user text, memory text, and tool results;
- cross-user/tool authorization attempts;
- provider timeout, rate limit, malformed output, and moderation failure;
- Slovak and English prompts used by the initial audience.

Minimum promotion thresholds:

- 100% of cross-user and unauthorized tool attempts denied;
- 0 authoritative record mutations from model output;
- 100% of fixed critical-safety cases produce the reviewed safe path;
- 100% of surfaced structured responses pass schemas;
- at least 95% grounded-answer correctness on the reviewed synthetic set;
- no unsupported numerical claim in the deterministic-calculation set;
- measured p50/p95 latency and cost per successful response remain within the documented alpha budget.

Every run records dataset version, prompt version, configured alias, resolved model, SDK version, and aggregate token/cost/latency results. No prompt bodies enter routine application logs.

### MEM-001 — Persistent memory and controls

Implemented behind the existing authenticated Coach boundary:

- Supabase/PostgreSQL `MemoryStore` adapter using existing `memory_items`;
- candidate-first status and methods for confirm, correct, supersede,
  reactivate, expire, and hard-delete;
- provenance, confidence, expiry, and correction history;
- memory review/control API and mobile UI;
- account export/deletion coverage;
- verified-token adapter tests, two-user database isolation, active-only
  recall tests, and prompt-injection screening on creation/correction.

The account export includes the complete memory audit trail, including
superseded records. Successful account deletion removes the in-memory
store explicitly; production PostgreSQL records also cascade from the
user. The mobile settings surface is the authority for creation,
confirmation, correction, deactivation, expiry, reactivation, and
deletion. The runtime never writes or promotes a memory.

Do not add embeddings in the first memory slice. Add a separate ADR/migration only if measured lexical retrieval is insufficient.

### AI-MOB-001 — Native coach UI

Replace the setup placeholder with:

- disabled/configuration-required state;
- conversation list and message thread;
- send, pending, retry, cancel, and provider-unavailable states;
- evidence/limitations presentation;
- visible “AI can be wrong” and non-medical scope;
- memory review controls when MEM-001 is enabled;
- accessibility, keyboard, small-screen, offline/restart, and screen-reader behavior;
- no model key or provider SDK in the mobile app.

Accept the Release build independently on iOS and Android.

### AI-OPS-001 — Budgets, observability, and incident controls

- per-user request and token budgets enforced server-side;
- organization/workspace spend cap in Mistral administration;
- bounded concurrency and 429 backoff;
- kill switch that returns the recoverable disabled state;
- aggregate metrics for success/failure, latency bucket, token bucket, resolved model, and cost bucket;
- no prompts, responses, health values, user IDs, or conversation IDs in product analytics;
- rollback rule for safety regression, model-alias change, cost spike, or provider incident.

#### AI-OPS-001 — Durable limiter (implemented 2026-07-24)

The single-process `Map`-based limiter used during AI-MOB-001 was
replaced by a service-role Postgres implementation:

- `supabase/migrations/20260724120000_ai_ops_001_limits.sql` adds
  `ai_daily_token_ledger`, `ai_request_windows`, `ai_in_flight`, and
  `ai_provider_calls` plus eight `SECURITY DEFINER` RPCs.
- `packages/config/src/ai-tier.ts` (ADR-0017) pins the per-tier caps:
  free = 5_000 tokens/day, 3 req/min, 1 concurrent; paid = 100_000
  tokens/day, 6 req/min, 1 concurrent. Env overrides apply only to
  the paid tier.
- `apps/api/src/modules/coach/limits.ts` exposes the
  `SupabaseCoachLimitService` (production) and
  `InMemoryCoachLimitService` (tests + local dev) implementations of
  the `CoachLimitService` interface. The Coach route
  (`apps/api/src/modules/coach/routes.ts`) is now a thin consumer.
- Plan tier resolves from `profiles.plan_tier`; the dev-only
  `AI_USER_TIER_OVERRIDE` env knob threads through
  `AppDependencies.planTierOverride`.
- `SUPABASE_SERVICE_ROLE_KEY` (added to `@mizyun/config`) is the
  single grant that unlocks the limiter RPCs. The key lives only in
  the ignored root `.env`.
- pgTAP cases (`supabase/tests/database/0002_user_isolation.test.sql`)
  cover free vs paid token caps, durable replay, and the per-tier
  `outcome='replayed'` contract.
- `scripts/ai-ops-001-smoke.sh` boots two API replicas (free + paid)
  and asserts the per-tier limits without any live Mistral call.

#### AI-OPS-002 — RPC ACL lockdown (implemented 2026-07-25)

The original `20260724120000_ai_ops_001_limits.sql` granted EXECUTE
on the eight `ai_*` RPCs to `service_role`, but PostgreSQL ships with
EXECUTE granted to PUBLIC for new functions. Without an explicit
revoke, anon / authenticated callers retained the ability to invoke
the limiter RPCs and read/write the durable ledger.

- New migration `20260725120000_ai_ops_002_rpc_acls.sql` revokes
  EXECUTE on every `ai_*` function from `public`, `anon`, and
  `authenticated`. EXECUTE remains granted only to `service_role`,
  which the API composition root uses via `SUPABASE_SERVICE_ROLE_KEY`.
- pgTAP cases in `0002_user_isolation.test.sql` assert that
  `anon` and `authenticated` cannot execute `ai_reserve_tokens`,
  `ai_reserve_provider_call`, `ai_commit_tokens`, or
  `ai_acquire_in_flight` — verified locally at plan count 28.
- ADR-0017 (`/Users/adam/Documents/mizyun/docs/adr/0017-ai-governance.md`)
  captures the governance decisions that bind this lockdown: per-feature
  Mistral workspaces, ZDR + training/feedback off, EU residency,
  wellness scope, free-vs-paid caps, photo / memory invariants.

## Test strategy

### Automated

- provider contract tests with a fake HTTP/SDK boundary;
- schema/property tests for tool inputs and structured outputs;
- runtime tests for tool-round/deadline/budget limits;
- route tests for auth, idempotency, failure recovery, export, and deletion;
- Supabase two-user RLS tests for conversations, messages, memories, and provider refs;
- prompt-injection and safety evaluation suite;
- secret/bundle test proving `MISTRAL_API_KEY` cannot enter Expo output;
- full `pnpm check`.

Live-provider integration tests:

- remain opt-in;
- use only synthetic data and a dedicated low-budget key/workspace;
- never run in the standard offline gate;
- verify one text response, one tool call, one structured output, moderation, timeout/abort, usage metadata, and model resolution;
- redact request/response bodies from captured evidence.

### Native acceptance

On standalone iOS and Android Release builds:

1. confirm AI is disabled when configuration or external-access flag is absent;
2. create a disposable user with synthetic confirmed records;
3. ask a grounded question and verify evidence matches stored data;
4. force-stop/relaunch and confirm conversation recovery;
5. exercise timeout/retry and offline states without losing the user's message;
6. exercise reviewed medical/dangerous/prompt-injection cases;
7. export and delete conversations/memories;
8. delete the disposable identity and verify cleanup.

## External pre-alpha release gate

AI can be included in founder/design-partner builds only when:

- AI-GOV-001 has a real-user go decision, including the fitness/wellness Usage Policy question;
- Zero Data Retention/training settings and the DPA are confirmed for the actual account;
- the API key is held only in server secrets and has been rotated after development if exposed operationally;
- AI-EVAL-001 thresholds pass for the resolved model;
- conversations and memories pass export/deletion and two-user isolation;
- fixed safety responses and incident escalation are reviewed;
- per-user budgets, Mistral spend caps, kill switch, and rollback criteria are active;
- standalone iOS and Android AI acceptance passes;
- privacy notice and tester consent accurately disclose Mistral processing;
- no P0/P1 AI defect remains.

If these gates are not complete, the same pre-alpha build may proceed with AI visibly disabled. Manual-loop testing should not be delayed indefinitely by the provider integration.

## Recommended implementation sequence

```text
AI-GOV-001
  → AI-CONFIG-001 + AI-PROVIDER-001
    → AI-RUNTIME-001 + AI-SAFETY-001
      → AI-CONV-001 + AI-TOOLS-001
        → AI-EVAL-001
          → AI-MOB-001 + AI-OPS-001
            → private native acceptance
              → MEM-001
                → external AI go/no-go
                  → ALPHA-001
                    → text/photo nutrition drafts
```

The smallest useful first implementation segment is AI-CONFIG-001 plus a Mistral adapter contract tested entirely with fakes. It changes no user-visible behavior and does not require placing an API key in the repository.

## Explicit non-goals for the first AI release

- autonomous writes to authoritative records;
- hosted Mistral Agents/Conversations state;
- web search, code execution, connectors, or arbitrary MCP tools;
- progress-photo diagnosis or body-fat estimates;
- training or fine-tuning on user conversations;
- multiple model providers enabled simultaneously;
- embeddings/vector infrastructure before lexical retrieval is measured;
- billing/paywall work before actual cost and usefulness evidence exists.
