# AI architecture consistency audit

> Final implementation audit, 2026-07-26. External provider access
> remains default-off; this document describes code readiness, not a
> real-user release decision.

## End-to-end authority flow

```text
verified bearer token
  → principal-scoped repository ports / PostgreSQL RLS
  → confirmed profile, goal, nutrition, workout, body, and active-memory data
  → versioned deterministic calorie, protein, and training engines
  → bounded read-only Coach tools
  → provider-neutral orchestrator
  → structured AI explanation with evidence
  → user review
  → ordinary authoritative write endpoint (only when explicitly confirmed)
```

The model cannot supply a user ID, execute arbitrary SQL, widen bounded
tool windows beyond their caps, or call a mutation tool. The API injects
the verified user ID and access token into tools, grounding, and memory.

## Consistency findings

| Concern                        | Canonical owner                       | Consumers                                              | Audit result                          |
| ------------------------------ | ------------------------------------- | ------------------------------------------------------ | ------------------------------------- |
| Calories/energy                | `@mizyun/core` versioned engine       | API route, Coach plan/tool, dashboard                  | One calculation path                  |
| Protein goals                  | `@mizyun/core` coaching plan          | Coach plan/tool and mobile Coach plan                  | One versioned rule set                |
| Exercise selection/progression | `@mizyun/core` training prescription  | authenticated API, tool, mobile Coach                  | One inspectable prescription          |
| Personalization                | closed profile preference object      | database, contracts, settings, grounding, prescription | Same vocabulary and validation        |
| Memory authority               | `MemoryStore` port plus lifecycle API | grounding, orchestrator, settings, export/delete       | Candidate-first; active-only recall   |
| Nutrition AI                   | strict shared draft contract          | text/photo provider, API, client, editable form        | Same uncertainty/provenance shape     |
| Provider selection             | API composition root                  | Mistral adapters behind ports                          | Server-only, replaceable, default-off |
| Authoritative writes           | feature routes/repositories           | manual UI and confirmed AI-prefilled forms             | No model mutation path                |

Confirmed AI nutrition drafts retain their original range, assumptions,
warnings, confidence, and provider/model/prompt provenance under the
food entry's `details.aiDraft`; the final top-level nutrition values are
the user's editable confirmed values.

## Layer-direction audit

- `@mizyun/core` imports no provider, database, Expo, or transport SDK.
- Shared contracts contain validation and wire types, not provider
  clients or repository implementations.
- `@mizyun/agent-runtime` depends on provider and memory ports, never on
  Mistral or Supabase implementations.
- Mistral code is isolated in `packages/providers/mistral`.
- Supabase code is isolated in adapter packages and the API composition
  root.
- Mobile imports shared contracts/ports and API clients; it contains no
  Mistral key or provider SDK.

No dependency inversion violation was found in the implemented AI path.

## Permanent verification

- `pnpm check` now creates both iOS and Android production bundles.
- `pnpm ai:eval:offline` runs the synthetic AI-focused suite.
- `pnpm ai:eval` runs the full repository gate plus clean database
  migration/lint/RLS verification.
- External live calls remain separately opt-in through the exact
  synthetic acknowledgement gate.

## Honest remaining boundary

The software path is integrated, but provider promotion and real-user
enablement are not complete. Authenticated physical-device journeys,
hosted persistence/deletion, a reviewed grounded-answer dataset,
weighed-meal photo evaluation, and sufficient live samples for
latency/cost thresholds remain external acceptance work. None requires
changing the domain or port architecture described above.
