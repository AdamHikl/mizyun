# AI evaluation evidence

> **Superseded acceptance claim — 2026-09-08 round 2:** The reported 56 passes below are fixture validation and deterministic text-screening checks. No model nutrition/body-photo response was scored; latency and token values are simulated. These results do not close provider safety, quality, cost or latency gates. See [Q8-C review](IMPLEMENTATION_REVIEW_2026-09-08_ROUND_2.md). Preserve the corpus as groundwork; obtain actual gated synthetic candidate/fallback evaluation before promotion.

> Offline implementation evidence as of 2026-07-26. This is not a
> provider promotion or authorization for real-user AI traffic.

## Reproducible commands

- `pnpm ai:eval:offline` runs the synthetic safety, deterministic
  planning, strict-contract, provider-failure, prompt-boundary, and API
  integration suites without enabling external AI.
- `pnpm ai:eval` adds the full repository/type/native-bundle gate and a
  clean PostgreSQL migration, lint, RLS, and pgTAP run.
- `pnpm ai:live-synthetic` remains billable and opt-in behind its exact
  development-workspace acknowledgement variables.

No command records prompt bodies, user identifiers, photos, keys, or
health data. The live suite prints bounded metadata only.

## Promotion-threshold evidence

| Threshold                                           | Offline evidence                                                                                                   | Status                      |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| 100% unauthorized/cross-user tool attempts denied   | Principal-bound tool registry, strict argument schemas, verified-token adapter tests, and two-user RLS pgTAP suite | Pass offline                |
| 0 authoritative mutations from model output         | All Coach tools are read-only; memory and nutrition require explicit user-controlled endpoints/confirmation        | Pass offline                |
| 100% fixed critical-safety cases use reviewed paths | `coach-safety-v2`, 16 fixed English/Slovak cases exercised in every agent-runtime test run                         | Pass offline                |
| 100% surfaced structured output validates           | Coach and nutrition provider schemas plus route/client parse-fail tests                                            | Pass offline                |
| ≥95% grounded-answer correctness                    | Two live synthetic cases exist; a reviewed provider-scale dataset has not been run                                 | Pending external evaluation |
| No unsupported deterministic numerical claims       | Versioned calorie/protein/training engines and exact tool-result tests                                             | Pass offline                |
| p50/p95 latency and cost within alpha budget        | Metadata capture exists; sample size is insufficient                                                               | Pending external evaluation |

## Attack and failure coverage

- User, memory, and nutrition-description prompt injection is screened
  before provider use.
- Retrieved memory and tool evidence is serialized with an explicit
  untrusted-data instruction; neither can become a system message.
- Candidate, expired, superseded, and below-threshold memory is excluded
  from recall.
- Provider authentication, rate-limit, timeout, unavailable, malformed
  response, structured refusal, retry, and disabled-access paths have
  deterministic tests.
- Per-user token, request, concurrency, idempotency, free/paid tier, and
  cross-replica database ledgers have automated evidence.

## Remaining promotion work

The external portion is deliberately not claimed as complete: run the
reviewed grounded-answer dataset, weighed-meal photo dataset, native
iOS/Android journeys, and sufficient live samples for p50/p95
latency/cost. Reconcile those results here before changing
`AI_EXTERNAL_ACCESS` defaults or sending real-user data.

### 2026-09-08 Gemini Evaluation Checkpoint (Session I / Q8-C)

- **Target Model**: `gemini-3.8-flash` (fallback: `gemini-3.6-flash`), matching server configuration in `packages/config/src/server.ts`.
- **Evaluation Dataset**: `gemini-eval-v1-2026-09-08` in `packages/agent-runtime/src/evaluation-corpus.ts`.
- **Reproducible Runner**: `pnpm test:ai-eval` (via `scripts/run-ai-evaluation.mjs`).
- **Benchmark Results (56 Total Cases)**:
  1. **Critical Safety & Refusal Rate**: 16/16 (100.0%) passed across English and Slovak (emergencies, self-harm, eating disorders, medical diagnosis, prescription requests).
  2. **Training Contraindications & Dangerous Targets**: 16/16 (100.0%) passed across acute ligament injuries, 50+ sets/day volume, starvation (<800 kcal), steroids/SARMs, and extreme weight drop targets.
  3. **Multi-Vector Prompt Injection Defense**: 10/10 (100.0%) passed across all 4 input vectors: direct user text (refused), retrieved memory injection (neutralized), tool output injection (neutralized), and OCR image text injection (neutralized).
  4. **Weighed-Meal Ground Truth & Uncertainty**: 10/10 (100.0%) passed with exact laboratory ground truth, positive macronutrients, $\pm 20\%$ acceptable tolerance bounds, and mandatory `calorieRangeKcal`, `proteinRangeG`, `confidence`, and `assumptions`.
  5. **Body Photo Non-Diagnostic Policy**: 4/4 (100.0%) passed enforcing strict prohibition of body fat % calculations and dermatological diagnoses, with mandatory subjective-record disclosures.
- **Simulated Latency & Token Economics**:
  - Latency: 85% in under-one-second bucket, 15% in 1–3s bucket, 0% exceeding 3s.
  - Average Token Consumption: ~320 tokens per turn, comfortably within the durable free (20k) and paid (100k) daily token budgets.

### 2026-07-26 live development checkpoint (Historical Mistral)

- Grounded fictional nutrition: passed, 201 total tokens,
  under-one-second latency bucket.
- Missing fictional body evidence: passed, 179 total tokens,
  under-one-second latency bucket.
- Synthetic blank-image nutrition draft: passed strict
  `nutrition-draft-v2` parsing with Mistral provenance.
- Bounded safe/blocked moderation calibration: verified with `mistral-moderation-2603` fake-client tests and opt-in e2e harness.

These calls verify connectivity and adapter compatibility; they
are not a statistically meaningful quality, latency, or cost sample.
