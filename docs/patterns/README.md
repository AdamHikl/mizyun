# Mizyun Engineering Patterns Index

> Reusable architectural and implementation patterns proven across Mizyun. Every pattern documents problem trigger, applicability, invariants, canonical source references, verification tests, and status.

| ID                  | Title                                              | Status   | Last Verified SHA | Date       | Applicability                                   |
| ------------------- | -------------------------------------------------- | -------- | ----------------- | ---------- | ----------------------------------------------- |
| [PAT-001](#pat-001) | Principal-scoped storage & Row Level Security      | verified | `7faec30`         | 2026-09-09 | All user data tables & Storage buckets          |
| [PAT-002](#pat-002) | Provider-neutral runtime ports & model adapters    | verified | `7faec30`         | 2026-09-09 | AI features, vision drafts, moderation          |
| [PAT-003](#pat-003) | Pure deterministic calculations in core            | verified | `7faec30`         | 2026-09-09 | Energy targets, macros, workout volume, trends  |
| [PAT-004](#pat-004) | Deployment safeguards, port enforcement & rollback | partial  | `7faec30`         | 2026-09-09 | Promotion scripts, systemd units, Pi deployment |

---

<a id="pat-001"></a>

### PAT-001: Principal-scoped storage & Row Level Security

- **Problem / Trigger**: Multi-tenant isolation; preventing any user or compromised client query from reading, modifying, or generating signed URLs for another user's private data or media objects.
- **Applicability**: Every PostgreSQL table containing user-owned data and every Supabase Storage bucket path.
- **Invariant**:
  1. Every user-owned table requires PostgreSQL Row Level Security enabled (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY;`).
  2. Every user-owned table requires a `user_id` index and policies checking `auth.uid() = user_id`.
  3. Storage object paths must follow the prefix convention `{bucket}/{user_id}/*`, and Storage RLS policies must strictly enforce `(storage.foldername(name))[1] = auth.uid()::text`.
  4. Never rely on client-side filtering or application-layer authorization alone.
- **Canonical Sources**:
  - `supabase/migrations/20260714101000_user_data.sql`
  - `supabase/migrations/20260714103000_private_media.sql`
  - `packages/adapters/supabase-server/src/account-repository.ts`
- **Relevant Tests**:
  - `supabase/tests/database/0002_user_isolation.test.sql`
  - `apps/api/src/account-deletion.e2e.test.ts`
- **Decisions & Links**: [ADR-0001](../adr/0001-modular-monolith.md), [ADR-0012](../adr/0012-user-scoped-private-media-persistence.md)
- **Status**: `verified`
- **Limitations**: Storage RLS relies on GoTrue JWT subject; service-role key bypasses RLS and must NEVER be exposed to mobile clients.

---

<a id="pat-002"></a>

### PAT-002: Provider-neutral runtime ports & model adapters

- **Problem / Trigger**: Integrating large language and multimodal models without coupling business rules, mobile clients, or persistent data models to a specific vendor SDK or proprietary API shape.
- **Applicability**: Conversational Coach, photo nutrition drafting, input screening, safety moderation.
- **Invariant**:
  1. Vendor SDKs (e.g. `@google/genai`, `@mistralai/mistralai`) belong exclusively in `packages/providers/<vendor>`.
  2. `@mizyun/agent-runtime` defines provider-neutral interfaces (`AgentProvider`, `VisionDraftProvider`, `ContentModerator`) and shared types.
  3. Domain packages (`@mizyun/core`, `@mizyun/contracts`) must never import a vendor package.
  4. `apps/api` is the server composition root selecting the active adapter based on environment configuration or user preference.
- **Canonical Sources**:
  - `packages/agent-runtime/src/index.ts`
  - `packages/providers/gemini/src/index.ts`
  - `apps/api/src/modules/coach/routes.ts`
- **Relevant Tests**:
  - `packages/providers/gemini/src/index.test.ts`
  - `packages/providers/gemini/src/vision.test.ts`
  - `scripts/run-ai-evaluation.mjs`
- **Decisions & Links**: [ADR-0015](../adr/0015-stateless-mistral-coach.md), [ADR-0019](../adr/0019-gemini-provider-and-dynamic-switching.md)
- **Status**: `verified`
- **Limitations**: Live model benchmarking remains gated per `docs/BEFORE_TESTING.md`. Offline invariant screener verifies contract compliance and safety heuristics.

---

<a id="pat-003"></a>

### PAT-003: Pure deterministic calculations in core

- **Problem / Trigger**: Fitness calculations (TDEE, BMR, surplus/deficit, macro splits, weight EMA trends, progressive overload targets) must be consistent, reproducible, auditable, and never subject to model hallucinations.
- **Applicability**: Energy goal targets, nutrition progress rollups, workout volume, and body weight trend smoothing.
- **Invariant**:
  1. All mathematical domain formulas live in `packages/core`.
  2. Core functions are pure: synchronous or deterministic, side-effect-free, taking explicit inputs and returning typed results.
  3. Core has zero dependencies on databases, HTTP APIs, Expo/React Native, or AI model providers.
- **Canonical Sources**:
  - `packages/core/src/energy.ts`
  - `packages/core/src/body-measurement.ts`
  - `packages/core/src/training-prescription.ts`
- **Relevant Tests**:
  - `packages/core/src/energy.test.ts`
  - `packages/core/src/body-measurement.test.ts`
  - `packages/core/src/training-prescription.test.ts`
- **Decisions & Links**: [ADR-0001](../adr/0001-modular-monolith.md), [ADR-0010](../adr/0010-weight-trend-semantics.md), [ADR-0011](../adr/0011-dashboard-review-and-local-energy-day.md)
- **Status**: `verified`
- **Limitations**: Calculations depend on user-provided inputs (body weight, height, age, activity level). Estimates are ranges/guidelines, not medical prescriptions.

---

<a id="pat-004"></a>

### PAT-004: Deployment safeguards, port enforcement & rollback

- **Problem / Trigger**: Preventing inadvertent cross-environment deployments, database corruption, or service interruption when promoting software to Raspberry Pi Dev and Production stacks.
- **Applicability**: Promotion scripts (`scripts/promote-dev.sh`, `scripts/promote-production.sh`) and deployment runners.
- **Invariant**:
  1. Strict DB port binding check: Dev must target 5433; Production must target 5432. Any cross-target URL exits immediately.
  2. Working directory check: promotion scripts fail closed if invoked from the wrong checkout or a dirty git state.
  3. Pre-promotion automated backup of PostgreSQL database and Storage before schema changes.
  4. Health check validation on public endpoints; failed health triggers automatic rollback and journals rollback state.
  5. File-based mutex lock (`flock` / lockfile) preventing concurrent promotions.
- **Canonical Sources**:
  - `scripts/promote-dev.sh`
  - `scripts/promote-production.sh`
  - `scripts/test-deployment-safeguards.mjs`
- **Relevant Tests**:
  - `scripts/test-deployment-safeguards.mjs` (23 passing automated safeguard checks)
- **Decisions & Links**: [ADR-0020](../adr/0020-dual-pi-environments-and-explicit-releases.md), [Finding Q1/Q9 Remediation](../REMEDIATION_IMPLEMENTATION_PLAN_2026-09-08.md)
- **Status**: `partial`
- **Limitations**: Safeguards are fully unit/fault-tested locally (23/23 tests passing), but physical-device restore rehearsal (R8) and final store-distributed binary verification (R3 Part B) remain open before production promotion.
