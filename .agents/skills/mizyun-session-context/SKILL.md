---
name: mizyun-session-context
description: >-
  Resume or begin substantive Mizyun engineering work, or reconcile conflicting handoffs. Constructs a fast, focused context packet using repository navigation tooling without full-codebase re-reading. Skip for simple explanations or already established context.
---

# Mizyun Session Context Skill

Use this skill at the beginning of a substantive task, when resuming after a context reset, or when resolving conflicting handoffs. Do not load this skill for trivial one-off queries, simple explanations, or when feature context is already loaded.

## 1. Startup Inspection (Run Once)

1. **Working Tree & History**:
   Inspect local changes and latest commit without modifying global configuration:

   ```bash
   git -c core.fsmonitor=false status --short
   git -c core.fsmonitor=false log -n 5 --oneline
   ```

   > [!IMPORTANT]
   > Strictly preserve any pre-existing uncommitted changes from prior or concurrent sessions.

2. **Operational State & Routing**:
   Read root [`AGENTS.md`](../../../AGENTS.md), [`status.md`](../../../status.md), and [`docs/START_HERE.md`](../../../docs/START_HERE.md).
   - Identify the active work package, current deployed SHAs, and open gates. Read these mandatory startup documents in full once; an outline is only a locator, not a substitute for policy or gate contents.
   - Reuse already loaded context until it changes. For later status lookups, use `pnpm nav:read status.md --outline` and read the newest applicable section completely with `--heading`; use the full document if authority or continuity is uncertain.
   - For product intent or pricing questions, consult [`goals.md`](../../../goals.md) and [`docs/BUSINESS_ALIGNMENT.md`](../../../docs/BUSINESS_ALIGNMENT.md).
   - For roadmap sequencing changes, consult [`plan.md`](../../../plan.md).

## 2. Feature Context Selection

Do not read entire module trees or scan arbitrary files. Use repository navigation scripts:

1. **Resolve Feature ID**:
   - If the feature ID is known (e.g. `meal-logging`, `auth`, `coach-consent-budgets`):
     ```bash
     pnpm context <feature-id>
     ```
   - If unknown or ambiguous:
     ```bash
     pnpm context --list
     ```
     Select the closest matching vertical feature and run `pnpm context <feature-id>`.

   For a task-specific packet, use `pnpm context <feature-id> --query "<task>"`; when the owner is unknown, use `pnpm context --query "<task>"`, `--path <file>` or `--symbol <exact-declaration>`. Default text is bounded by bytes and lines. Read returned current source and applicable instructions. `--json` returns the retained metadata packet; `--no-cache` bypasses disposable local cache. Files/configuration refresh on each request; reviewed dates and acceptance do not.

2. **Assess Change Blast Radius**:
   When proposing changes that span packages or existing contracts, inspect advisory downstream impacts:
   ```bash
   pnpm impact --since origin/main
   pnpm impact --path packages/contracts/src/food-entry.ts
   ```
   With `--path`, only selected seeds are analyzed; unrelated working-tree edits are excluded. Use `--include-working-tree` deliberately for a combined report. Without paths, `--since` retains merge-base plus local changes. Default text is bounded; JSON retains the structured report. Impact remains advisory and never waives `pnpm check` or release gates.

## 3. Targeted File Reading

From the `pnpm context <feature-id>` output, read only the specific files relevant to your task in architectural order:

1. Contracts & schemas (`packages/contracts/...`)
2. Pure domain rules & calculations (`packages/core/...`)
3. Ports & adapters (`packages/adapters/...` or `packages/providers/...`)
4. Transport & routes (`apps/api/src/modules/...`)
5. Presentation & hooks (`apps/mobile/src/features/...`)
6. Focused test suites (`*.test.ts`)

Use `pnpm nav:read <file> --symbol <exact-name>`, `--lines <start:end>`, or `--heading "Exact heading"` to request a complete selection with current hash/line provenance. `--outline` locates document headings. The default is 8,192 bytes and 120 lines; oversized selections fail explicitly. Narrow the selection or raise the explicit bounds. Read every applicable instruction file in full; bounded instruction-file excerpts are rejected.

Keep bounded navigation output in separate calls from large file reads so aggregate output limits do not erase the packet. Expand to the surrounding code and caller/test bodies when needed to understand a change; a symbol excerpt is not complete semantic impact or acceptance evidence.

## 4. Assemble the Context Packet

Before implementing, formulate a concise mental or written context packet containing:

- **Task Intent & Mode**: Substantive implementation, bug fix, or documentation-only plan.
- **Baseline State**: Current HEAD SHA, list of pre-existing modified files to preserve.
- **Feature Pointers**: Primary entry points, schema contracts, and applicable nested instructions (e.g. `apps/mobile/AGENTS.md`).
- **Requirement & Gate IDs**: Applicable requirement IDs (e.g. `NUTR-01`) and open remediation checklist items (e.g. `Q2`, `Q9`).
- **Helper Delegation**: Define at least one concrete, bounded subtask with disjoint file ownership to delegate to a helper agent (per `AGENTS.md`). Give it the task baseline, relevant locations, applicable requirements/gates, allowed files, constraints and expected evidence. Helpers read their applicable instructions and focused sources; do not ask every helper to reconstruct the coordinator's operational history. Return a compact result with changed paths, checks and unresolved risks, not entire file bodies.
