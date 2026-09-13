# Model Routing & Safety Boundaries

This rule governs how tasks are allocated between **Astra (Architect/Reviewer)**, **Gemini 3.8 Flash (Antigravity Coordinator)**, and **Qwen3.8:27b-q8_0 (Local Ollama Workhorse)**.

---

## 1. Role Boundaries

### Tier 1: Architect & Escalation Reviewer (Astra / GPT-6)

- **Authority**: High-level architecture, difficult domain trade-offs, security and compliance reviews.
- **Escalation Trigger**:
  - Any proposed changes to Authentication, Authorization, Row Level Security (RLS) policies, or schema migrations.
  - User privacy, account deletion, or data export flows.
  - Health data, photo storage, or external provider secrets.
  - Ambiguous edge-case failures or regressions unresolved after 2 local Qwen cycles.
  - Final architectural diff review prior to production release promotion.

### Tier 2: Coordinator & Dispatcher (Gemini 3.8 Flash in Antigravity)

- **Authority**: Control plane and session continuity.
- **Responsibilities**:
  - Decompose high-level plans and work packages into discrete, self-contained task packets.
  - Assign routine tasks to the local Qwen worker via MCP (`qwen_run_task`) or CLI runner.
  - Monitor execution, evaluate worker reports, and integrate diffs across packages.
  - Run full repository verification checks (`pnpm check`, `pnpm test`).
  - Maintain session continuity documents (`status.md`, `backlog.md`, `docs/LOCAL_WORKER_BASELINE.md`).
  - **Exclusive actions**: Only the coordinator (or the user) may execute git commits, pushes, remote deployments (`deploy:dev`, `deploy:production`), or database resets. Workers must never perform these.

### Tier 3: Workhorse (Qwen3.8:27b-q8_0 via Ollama)

- **Authority**: Fast, bounded, localized implementation tasks.
- **Scope**:
  - Writing unit tests and vitest test cases.
  - Pure function implementations and local refactoring within explicitly whitelisted files (`allowedFiles`).
  - Linting, formatting, and type-definition adjustments.
  - Codebase documentation and docstring updates.
  - Reproducing and debugging local unit test failures.
- **Limits**:
  - Strictly limited to `allowedFiles`. Never edit files outside the provided whitelist.
  - Never run destructive commands or external network operations.
  - Bound to at most **two correction cycles** (one initial attempt + one retry). If still failing, return report with `status: "failed"` for Gemini coordination or Astra escalation.

---

## 2. Safety & Data Protection

- **No Sensitive Data**: Never pass user health records, user photos, API credentials, service-role keys, or production environment variables to local prompts or external prompts without sanitization.
- **Sanitized Context**: Only supply sanitized code snippets, type definitions, and test expectations in task packets.
- **Pristine State**: Local workers must leave no unverified or dirty files that break `pnpm check`.

---

## 3. Worker Contract Summary

Every task dispatched to Qwen must include:

1. `taskId`: Unique identifier (e.g. `task-20260913-01`).
2. `objective`: Clear, single-goal description of the change.
3. `allowedFiles`: Array of relative paths permitted to be edited or created.
4. `prohibitedActions`: List of forbidden operations (e.g. "do not touch migration files", "do not commit").
5. `verificationCommand`: Specific test/lint command to validate success (e.g. `pnpm --filter @mizyun/core test`).
6. `contextSnippet`: Minimal necessary code context or interfaces.

Every worker report returned to Gemini must follow:

```json
{
  "status": "success" | "failed",
  "filesChanged": ["string"],
  "commandsRun": [
    { "command": "string", "exitCode": 0, "summary": "string" }
  ],
  "unresolvedRisks": ["string"],
  "suggestedNextAction": "string"
}
```
