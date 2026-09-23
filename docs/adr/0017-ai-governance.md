# ADR-0017: AI governance — per-feature workspaces, ZDR, EU residency, free-vs-paid caps

- Status: superseded as an active provider/workspace/tier specification; retained as historical rationale for safety, data minimization, and budget controls
- Date: 2026-07-25

> Current authority: server configuration and composition are Gemini-or-disabled; ADR-0024 defines consent-based admission; current durable limit code/tests define effective budgets. The Mistral workspace, moderation, provider-path, model, and original free-vs-paid values below are historical and must not be used as operating instructions.

## Context

AI-MOB-001 shipped the first text-coach with a single Mistral workspace and
the `AI_EXTERNAL_ACCESS=false` default from ADR-0015. Three follow-on
segments — AI-OPS-001 (durable limiter), AI-002 (read-only tool loop),
and the planned MEM-001 + VISION-001 — share the same provider and
introduce new call shapes, higher token volumes, and (for vision)
photo bytes. Each capability carries its own privacy, cost, and
operational surface; collapsing them into one workspace violates the
separation of concerns ADR-0015 established for the model itself.

The user has explicitly committed to a strict tier split: AI features
are mainly for paying users; free-plan users will have very strict
limits. That policy decision needs to outlive the AI-OPS-001
implementation and bind MEM-001 and VISION-001 to the same shape.

## Decision

### Per-feature Mistral workspaces

One Mistral workspace per AI capability. Each workspace has its own
API key, its own ZDR / training / feedback settings, and its own
product tagging. The mapping is fixed at the adapter level:

| Capability     | Workspace              | Provider adapter              |
| -------------- | ---------------------- | ----------------------------- |
| Text coach     | `mizyun-text-coach`    | `MistralAgentProvider`        |
| Vision drafts  | `mizyun-vision-draft`  | `MistralVisionProvider` (new) |
| Durable memory | none — memory is in PG | n/a (MEM-001 stays offline)   |

Workspace names live in `@mizyun/config/src/server.ts`. The adapter
constructs receive the API key per workspace. No code path may
construct a provider with a workspace it does not own.

### Zero Data Retention (ZDR) + training/feedback off

Every workspace enables ZDR (`safe_prompt_mode: true`,
`retention_mode: "none"`) and disables training and feedback
(`training_opt_out: true`, `feedback_opt_out: true`). The SDK flag is
verified at adapter construction; an attempt to construct without
the flags is rejected at boot, not at runtime.

### EU residency

Workspaces and the data plane live in the EU. For the alpha track
the data plane is the Slovakia PC per the 0016 amendment, an EU
member state. The Mistral Cloud account is restricted to EU-only
API routes; cross-region API calls are blocked by an upstream
allow-list managed outside this repo.

### Wellness scope

The model is scoped to general fitness, nutrition, body, and
energy education. Critical-safety responses are owned by the
runtime, not the model:

- Emergency, self-harm, eating-disorder, medical, dangerous-target,
  prompt-injection: fixed `screenCoachInput` patterns + fixed
  response copy. Provider is bypassed entirely.
- Provider output is post-screened for unsafe-content patterns
  (medical claims, unsafe daily targets, train-through-pain advice).
  Matched output is replaced with a generic safety fallback.

`docs/AI_IMPLEMENTATION_PLAN.md` §AI-SAFETY-001 enumerates the
canonical categories. Any expansion requires a new ADR amendment.

#### Amendment 2026-08-06 — direction-aware health moderation

Mistral Moderation 2 defines `health` as detailed or tailored medical advice.
Mizyun therefore keeps `health` blocking on user input, after the deterministic
critical-safety screen, but does not treat `health` alone as a reason to discard
generated output. Personalized fitness and nutrition wellness answers can be
classified as `health` because they use confirmed user context. Generated output
still passes the provider adapter's deterministic medical-claim, extreme-intake,
and train-through-pain screen; every other positive Mistral moderation category
remains blocking. This policy prevents broad category overlap from disabling the
product's accepted wellness scope without removing the medical-input boundary.

### Free vs paid caps

`@mizyun/config/src/ai-tier.ts` is the single source of truth for
per-tier caps. Env overrides apply only on the `paid` tier; the
free tier is locked.

| Tier | Daily tokens | Per-minute | Concurrent |
| ---- | ------------ | ---------- | ---------- |
| Free | 5_000        | 3          | 1          |
| Paid | 100_000      | 6          | 1          |

Env overrides (`AI_DAILY_USER_TOKEN_BUDGET`,
`AI_USER_REQUESTS_PER_MINUTE`) are gated by `planTier === "paid"`
in the resolver. The plan tier resolves from `profiles.plan_tier`
with the `AI_USER_TIER_OVERRIDE` dev-only env knob as an override.

The migration `20260724120000_ai_ops_001_limits.sql` only stores the
tier; the caps are enforced at the API. The migration's only
authoritative statement about tier is the `check (plan_tier in
('free','paid'))` constraint.

### Photo / vision invariants

VISION-001 follows the existing rule from
`docs/AI_IMPLEMENTATION_PLAN.md` ("exclude progress-photo bytes
and URLs from the text-coach phase"):

- Photo bytes are transient: multipart upload → in-memory → provider
  → discard. No server-side persistence.
- No photo URL, photo bytes, or photo-derived text appears in the
  text-coach prompt, conversation persistence, analytics events,
  or log lines.
- The vision workspace is independent of the text workspace.
- A separate `food-draft` request rate bucket caps vision usage at
  free 1/min + paid 3/min. The shared daily AI token budget and
  global one-request concurrency limit prevent a vision call from
  starving the text coach.

### Memory invariants

MEM-001 follows the existing `groundingMessage` pattern in
`packages/providers/mistral/src/index.ts`:

- Memory text surfaces in the prompt as untrusted data, never as
  instructions.
- Memory `kind: "memory"` is filtered out of the user-visible
  `evidenceKinds` so the UI never claims "Used confirmed: memory".
- The `/v1/coach/memories/...` endpoints run `screenCoachInput`
  on user-edited fields to defend against prompt injection via
  the controls API.
- Active memories are filtered by `confidence ≥ 0.5` and
  `importance ≥ 3` (overridable per tier). Stale memories decay
  on write; the runtime never auto-promotes a candidate.

### Rate-limit buckets

The Coach and the memory writes share the same user but compete for
the user's patience. MEM-001 introduces a separate
`memoryWriteRateLimit` bucket so memory writes never displace
Coach requests. VISION-001 introduces a separate `food-draft`
request bucket on the same principle.

### ADR amendment policy

Subsequent AI capabilities (real-time audio, image generation,
multi-modal reasoning) require a new ADR amendment that:

- Names the new Mistral workspace + key handling.
- Defines the privacy invariants (what bytes leave the device, what
  stays on disk).
- Defines the rate-limit bucket relative to existing ones.
- Defines the wellness-scope boundary (what is and is not allowed).

This ADR is amended, not replaced, when subsequent segments ship.

## Consequences

- The text coach and the vision draft remain isolated: a key leak
  in one does not compromise the other.
- ZDR + training/feedback off means a user conversation cannot
  appear in a future Mistral training set, even accidentally.
- The free-vs-paid split is enforceable: the API rejects overrides
  for the free tier; the DB constraint prevents new tier values.
- Vision and memory drafts are bounded so they cannot starve the
  core Coach capability.
- The amendment policy keeps the policy document load-bearing: each
  new capability is a deliberate, reviewed decision rather than a
  drift.
- Operational burden: four env knobs (workspace key per capability
  - ZDR/training flags) must be set in PC secrets (mode 0600 on the
    Slovakia alpha host) before any alpha deployment. The self-hosted
    runbook (`docs/tutorials/SELFHOSTED_RUNBOOK.md`) enumerates them.
