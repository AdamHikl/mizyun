---
name: mizyun-verify-handoff
description: >-
  Select verification checks, run quality gates, record qualified evidence, and prepare compliant session handoffs. Use when completing, reviewing, or closing a Mizyun work package. Skip for trivial edits or early drafting.
---

# Mizyun Verify and Handoff Skill

Use this skill when preparing to complete a task, reviewing a completed diff, or closing an active work package. Do not trigger full release audits for minor local edits.

## 1. Inspect the Actual Diff

Review the actual changes before making verification claims:

```bash
git -c core.fsmonitor=false diff --stat
git -c core.fsmonitor=false diff --check
```

Examine the diff for:

- Sensitive secrets, API keys, or private user health/photo data.
- Accidental changes to concurrently edited files or unrelated features.
- Adherence to module boundaries (pure core, portable contracts, neutral ports).

## 2. Execute Tiered Verification

Follow the verification progression from focused to repository-wide:

1. **Focused Package Checks**:
   Run the specific unit and integration tests for the modified feature (from `pnpm context <feature-id>`):

   ```bash
   pnpm --filter @mizyun/contracts test
   pnpm --filter @mizyun/core test
   pnpm --filter @mizyun/api test src/modules/<feature>
   pnpm --filter @mizyun/mobile test src/features/<feature>
   ```

2. **Navigation & Boundary Validation**:
   Validate that new files and routes are mapped in `docs/feature-map.json` and internal markdown links resolve:

   ```bash
   pnpm navigation:check
   pnpm navigation:check --since origin/main
   ```

   Use `pnpm impact --path <owned-file>` for focused review, and `--include-working-tree` only when the full combined scope is intended. Do not treat unrelated concurrent edits as part of this task.

   The comparison rejects new/renamed source ownership gaps; existing unmapped paths remain visible warnings. Inspect advisory `pnpm impact --since origin/main` reason chains, unresolved imports and candidate tests. Current source discovery and cached parse reuse are not acceptance evidence.

3. **Format Verification**:
   Ensure files match Prettier style:

   ```bash
   pnpm format:check
   ```

4. **Serialized Full Repository Gate**:
   After all helper/review/preview/source writes settle, run the focused suite for every new or edited test (including late additions) and format owned files. Then execute one comprehensive quality gate:

   ```bash
   pnpm check
   ```

   > [!IMPORTANT]
   > Never substitute an advisory impact report or a cached/prior session result for a fresh passing `pnpm check`.

   `pnpm check` serializes same-user full gates across local chats, worktrees and snapshots and rejects changing inputs. Do not invoke internal `check:steps` directly. If the shared source is known to be changing, use a stable isolated candidate with exact baseline/overlays and report excluded concurrent scope before launching the gate. Keep check output in a log and wait on the command session for 30–60 seconds at a time; read failures or a compact completion result instead of repeatedly tailing logs. Rerun after a material fix or unresolved failure, not merely to repeat already current evidence. The lock does not coordinate arbitrary native/database/deployment commands. Capture `pnpm navigation:bench --json` when measuring tooling efficiency. Its bytes/lines and local timings are proxies, not model tokens, cost or accepted-task speed.

## 3. Mandatory Non-Author Review

Pursuant to root [`AGENTS.md`](../../../AGENTS.md), an independent non-author subagent review is **mandatory** for changes affecting:

- Authentication & session tokens (`auth`)
- Authorization & access controls
- Account lifecycle, export & deletion (`account-lifecycle`, GDPR)
- Database schema, migrations & RLS policies (`database-schema`)
- AI consent, admission & token budgets (`coach-consent-budgets`)
- Deployment scripts, systemd units, Hetzner host safeguards, or Pi recovery configuration (`environment-build-deployment`)

The non-author reviewer must independently audit the diff, test edge cases, and certify approval. Findings must be resolved or logged as open blockers before closing the work package.

## 4. Distinct Evidence Tiers

Never conflate implementation with release. Maintain strict distinction across the 5 evidence tiers:

1. **Implemented**: Code written and syntax checked.
2. **Automatically Verified**: Unit tests, bundle checks, safeguards, and `pnpm check` passed locally.
3. **Dev Deployed**: Exact accepted SHA deployed to Hetzner Dev (`pnpm deploy:dev <sha>`), with service/PID, checkout SHA, route-specific response, and client recovery evidence appropriate to the change. Generic HTTP 200 health alone is insufficient.
4. **Device Accepted**: Physically verified on an installed release build on a physical iPhone or Android device without Metro.
5. **Production Released**: Exact accepted SHA promoted to Hetzner Production (`pnpm deploy:production <sha>`) following the clean pre-promotion backup/migration checks and required device verification.

## 5. Session Handoff Update

Update shared continuity documents (coordinator only):

1. **`status.md`**:
   - Record completed work package outcome with commit SHA.
   - Keep the current summary within 120 lines/12,288 bytes; link detailed counts, logs, hashes and historical retries from evidence documents or a dated archive. Replace the existing package summary rather than appending another full handoff.
   - Separate verified from remaining gates.
   - Set the next exact action.
2. **GitHub Issues**:
   - Update issue statuses (close completed issues via `gh issue close`, update `status:*` labels) and link to evidence.
3. **Commit & Clean Tree**:
   - Format changed files.
   - Commit with a structured commit message linking feature IDs.
