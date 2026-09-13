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
   ```

3. **Format Verification**:
   Ensure files match Prettier style:

   ```bash
   pnpm format:check
   ```

4. **Serialized Full Repository Gate**:
   After all subagents finish writing and files are stable, execute the comprehensive quality gate:
   ```bash
   pnpm check
   ```
   > [!IMPORTANT]
   > Never substitute an advisory impact report or a cached/prior session result for a fresh passing `pnpm check`.

## 3. Mandatory Non-Author Review

Pursuant to root [`AGENTS.md`](../../../AGENTS.md), an independent non-author subagent review is **mandatory** for changes affecting:

- Authentication & session tokens (`auth`)
- Authorization & access controls
- Account lifecycle, export & deletion (`account-lifecycle`, GDPR)
- Database schema, migrations & RLS policies (`database-schema`)
- AI consent, admission & token budgets (`coach-consent-budgets`)
- Deployment scripts, systemd units & Pi host configuration (`environment-build-deployment`)

The non-author reviewer must independently audit the diff, test edge cases, and certify approval. Findings must be resolved or logged as open blockers before closing the work package.

## 4. Distinct Evidence Tiers

Never conflate implementation with release. Maintain strict distinction across the 5 evidence tiers:

1. **Implemented**: Code written and syntax checked.
2. **Automatically Verified**: Unit tests, bundle checks, safeguards, and `pnpm check` passed locally.
3. **Dev Deployed**: Migration and API deployed to the Raspberry Pi Dev environment (`pnpm deploy:dev <sha>`) with HTTP 200 health.
4. **Device Accepted**: Physically verified on an installed release build on a physical iPhone or Android device without Metro.
5. **Production Released**: Promoted to production (`pnpm deploy:production <sha>`) following clean pre-promotion database backup and device verification.

## 5. Session Handoff Update

Update shared continuity documents (coordinator only):

1. **`status.md`**:
   - Record completed work package outcome with commit SHA.
   - List pass/fail counts and exact verification commands.
   - Separate verified from remaining gates.
   - Set the next exact action.
2. **`backlog.md`**:
   - Update statuses (`[x]` completed, `[-]` blocked) and link to evidence.
3. **Commit & Clean Tree**:
   - Format changed files.
   - Commit with a structured commit message linking feature IDs.
