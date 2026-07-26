# AI evaluation evidence

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
