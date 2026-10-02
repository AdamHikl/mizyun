# Development session guide

> Continuity protocol for humans and coding agents. The goal is to let a new session resume safely without reconstructing project intent from chat history.

## Source-of-truth order

When documents appear inconsistent, use this order and repair the lower source during the same session:

1. `AGENTS.md` — mandatory engineering and safety rules
2. `goals.md` — stable product intent and non-negotiables
3. `docs/BUSINESS_ALIGNMENT.md` — target customer, launch wedge, business model, and validation milestones
4. accepted `docs/adr/` records — durable technical decisions
5. `docs/PRODUCT_REQUIREMENTS.md` — required behavior
6. `plan.md` — roadmap order and phase exit criteria
7. `status.md` — current operational snapshot
8. GitHub Issues (`AdamHikl/mizyun/issues`) — executable inventory and task tracking
9. code, migrations, tests, and Git history — actual implementation evidence

### The two authority questions

Always separate two distinct questions:

1. **What should happen?** User instructions, applicable engineering rules (`AGENTS.md`), product requirements (`goals.md`, `PRODUCT_REQUIREMENTS.md`), and accepted decisions (`docs/adr/`) define intent and acceptance criteria.
2. **What exists or passed?** Current code and reproducible evidence, qualified by source SHA, environment, and verification date, support implementation claims. A roadmap, old handoff, or retrieved summary cannot override contradictory evidence.

If evidence is insufficient, label a claim unverified with a source link. Never turn old test runs into fresh results. Preserve Q1–Q9 IDs and their stated exit criteria until live proof is recorded.

## Start-of-session checklist

1. Read root `AGENTS.md` and inspect repository state:
   ```bash
   git status --short
   git log -n 5 --oneline
   ```
   Preserve any pre-existing changes from another session.
2. Read the compact current `status.md` and [`docs/START_HERE.md`](./START_HERE.md). (Read full `goals.md` and `docs/BUSINESS_ALIGNMENT.md` when addressing product direction, pricing, scope changes, or uncertain intent; read full `plan.md` when changing roadmap sequencing).
3. Identify the active work item and its definition of done from `status.md` and GitHub Issues (`gh issue list --label "status:active"` or `--state open`); read any applicable nested instructions (e.g. `apps/mobile/AGENTS.md`).
4. Use [`docs/feature-map.json`](./feature-map.json) or `pnpm context <feature-id>` to select relevant requirements, ADRs, runbooks, open findings, source code, and tests.
   Narrow discovery with `pnpm context <feature-id> --query "<task>"`, `pnpm context --path <file>` or `--symbol <name>`. Read returned source and instruction files before editing; automatic index refresh does not accept review drift. See [shared navigation](AGENT_NAVIGATION_GUIDE.md).
5. State expected impacts and delegate a bounded independent subtask with disjoint file ownership and acceptance checks, per `AGENTS.md`. Include the baseline, focused requirements/gates, allowed files and expected evidence. Each helper reads its applicable instructions; the coordinator owns full session continuity.

Run mandatory startup reads once in full and reuse them while current. For subsequent status lookups, `pnpm nav:read status.md --outline` locates sections; `--heading "Exact heading"` reads a complete relevant section. Read full status when current authority, applicable gates or conflicting handoffs are uncertain. An outline does not establish gate contents.

Normal startup reading (`AGENTS.md` + `status.md` + `docs/START_HERE.md`) should remain at or below 350 lines, with `status.md` at or below 120 lines. Record lines and bytes when compacting; `SIMPLIFY-02` will add an advisory validator warning. Never truncate safety rules or active gates merely to satisfy the budget.

## During a session

- Keep one active work package unless the user changes priority. Independent agent subtasks within that package are encouraged and required for substantive work under AGENTS.md; they do not create competing work packages.
- The coordinator owns shared continuity documents, integration, commits, remote mutations and final verification. Assign disjoint helper write ownership; serialize operations on shared database and native-build resources. Preserve work from other active sessions.
- Get independent agent review for authentication, authorization, privacy lifecycle, migrations/RLS, AI access/budgets and deployment changes. Review findings must be resolved or recorded as open blockers, not hidden behind passing helper tests.
- Prefer feature-vertical changes: contract/domain → port → adapter → API/UI → tests.
- Keep bounded navigation calls separate from large output batches. Use `pnpm nav:read` for complete symbols, line ranges and document sections; expand callers/tests when needed. Instructions must be read in full. Use task-only `pnpm impact --path <file>` by default; add `--include-working-tree` explicitly to examine combined changes.
- Use `pnpm navigation:bench --json` for repeatable cache/timing/output-size proxies. Parent-context isolation does not imply lower aggregate helper cost; actual model-token and accepted-task comparisons require client evidence under #54.
- Do not bypass an interface merely because only one provider exists today.
- Update tests with behavior, not afterward as cleanup.
- Run focused tests frequently; run the full gate before committing.
- When a discovered task is outside scope, add it as a GitHub issue (`gh issue create`) with priority/status/area labels and continue the active item.
- When blocked, record the exact condition and evidence in `status.md`; do not mark an incomplete item done.
- Never use real user health information, body photos, credentials, or model secrets in fixtures or documentation.

## Research procedure

For each affected technology:

1. Identify the exact installed/current version and platform.
2. Read primary official documentation, migration notes, limits, and security guidance.
3. Record URL, access date, affected decision, and actionable findings in `docs/RESEARCH_LOG.md`.
4. Distinguish verified facts from design inference.
5. Create an ADR when the choice changes module boundaries, data format, provider strategy, security, or operations.
6. Recheck time-sensitive details when implementation begins; an older log entry is context, not permission to skip current research.

## End-of-session checklist

1. Run the relevant focused suites and then:

   ```bash
   pnpm check
   git diff --check
   ```

2. Review `git diff` for secrets, generated artifacts, unrelated edits, and architecture violations.
   Inspect helper changes and evidence yourself after writes have settled. Record which work was delegated and any unresolved independent-review findings.
3. Update:
   - `status.md` with completed work, verification evidence, blockers, next exact action, latest commit;
   - GitHub Issues statuses (close completed issues, update `status:*` labels) and newly discovered work;
   - `plan.md` only if phase/current-focus or sequencing changed;
   - `goals.md` only if the user changed product direction;
   - requirements/ADR/research log when behavior or decisions changed.
4. Commit a coherent segment and push only after checks pass.
5. Ensure the working tree is clean or document precisely why it is not.
6. Provide a concise handoff using the template below.

## Handoff template

```markdown
### Outcome

- What now works
- What intentionally remains disabled/incomplete
- Agent subtasks, independent review outcome, or the reason delegation was unavailable/inapplicable

### Verification

- Commands and pass/fail counts
- Simulator/device/database evidence
- Separate implementation, automated verification, Dev deployment, device acceptance and Production release status; include skipped/unrun checks and reasons

### Repository

- Branch and commit
- Push status
- Working-tree status

### Next action

- One exact work package
- First research/check to perform
- Any required user input or external credential

### Risks/blockers

- Evidence-backed blockers only
```

## Documentation ownership

| File                           | Purpose                                        | Update frequency                               |
| ------------------------------ | ---------------------------------------------- | ---------------------------------------------- |
| `goals.md`                     | Product mission, scope, non-goals, principles  | Rarely, with product-direction changes         |
| `plan.md`                      | Phase order, dependencies, exit criteria       | At phase/work-package transitions              |
| `status.md`                    | Current implementation and next exact action   | Every development session                      |
| GitHub Issues                  | Executable tasks and dependencies              | Whenever work is discovered/started/completed  |
| `docs/PRODUCT_REQUIREMENTS.md` | Stable behavioral requirements                 | When accepted behavior changes                 |
| `docs/QUALITY_GATES.md`        | Definition of done and release criteria        | When testing/risk policy changes               |
| `docs/tutorials/`              | Setup, build, test, and troubleshooting memory | Whenever a proven operational workflow changes |
| `docs/RESEARCH_LOG.md`         | Primary-source findings                        | Before each affected implementation segment    |
| `docs/adr/`                    | Durable technical decisions                    | When a decision is accepted/superseded         |
| `docs/BEFORE_TESTING.md`       | AI activation gate                             | During evaluated AI-provider work only         |

## Avoiding documentation drift

- Link instead of copying detail across files.
- Put facts in the narrowest appropriate document.
- Move completed handoffs into dated `docs/archive/status/` files and keep only current authorities, active packages, unresolved gates, and one next action in `status.md`.
- Use requirement/issue IDs (e.g. `[PLAY-001]`) when referring to behavior or work.
- Never mark a milestone complete based only on code presence; cite reproducible exit evidence.
- If a session changes no project state, do not churn timestamps or status prose unnecessarily.
