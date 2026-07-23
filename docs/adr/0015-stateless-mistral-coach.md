# ADR-0015: Stateless Mistral coach with Mizyun-owned grounding and conversations

- Status: accepted
- Date: 2026-07-23

## Context

Mizyun needs a first text-coaching capability without placing a model vendor in
the domain, mobile bundle, authorization boundary, deterministic calculations,
or long-lived conversation authority. User records and message bodies are
sensitive. Mistral's hosted Agents/Conversations features would introduce a
second durable store and different deletion/retention semantics.

## Decision

- Use Mistral's first-party stateless Chat Completions API through the official
  `@mistralai/mistralai` SDK isolated in `packages/providers/mistral`.
- Configure `mistral-medium-latest` as the initial hypothesis and record the
  resolved model returned by every successful call. A resolved-model change
  requires the evaluation gate again before external use.
- Keep conversation and message authority in Mizyun's existing RLS-protected
  PostgreSQL tables. Store user messages before generation and use a
  user/conversation-scoped idempotency key.
- Build a bounded, read-only grounding snapshot in the authenticated API from
  confirmed profile, goal, nutrition, training, and body records. Do not send a
  user ID, bearer token, database credential, media URL, or photo to Mistral.
- Keep deterministic critical-safety decisions before the provider. Require a
  strict structured response and reject malformed or independently unsafe
  output.
- Default `AI_EXTERNAL_ACCESS=false`. The provider can be configured and
  fake-tested without becoming available to mobile users.
- Keep durable memory out of this slice until grounded-coach evaluation passes.

## Consequences

- The model provider remains replaceable and no vendor SDK enters mobile or
  domain packages.
- RLS, account export, cascade deletion, and retry recovery apply to
  conversations without synchronizing a hosted vendor thread.
- The initial snapshot performs every allowed read on the server instead of
  letting the model choose arbitrary tools. A later measured tool loop may
  refine retrieval, but it must preserve the same principal injection, schemas,
  bounds, and read-only behavior.
- Standard offline tests require no Mistral key. Live tests remain opt-in and
  synthetic until provider privacy/policy gates are complete.
- External use remains blocked by the Usage Policy clarification, actual-account
  DPA/ZDR configuration, live evaluation, budgets, and native acceptance.
