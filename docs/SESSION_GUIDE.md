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
8. `backlog.md` — executable inventory
9. code, migrations, tests, and Git history — actual implementation evidence

Code is truth about what exists; it is not automatically truth about what should exist. If implementation conflicts with a higher-level safety rule, stop and correct or escalate the conflict.

## Start-of-session checklist

1. Read completely:
   - `AGENTS.md`
   - `goals.md`
   - `docs/BUSINESS_ALIGNMENT.md`
   - `plan.md`
   - `status.md`
2. Read `backlog.md` and the requirements/ADR files relevant to the active work package.
3. When the session needs local services, native builds, simulators/emulators, or acceptance tests, open [`docs/tutorials/README.md`](./tutorials/README.md) and follow the narrowest runbook instead of reconstructing commands from chat history.
4. Inspect repository state:

   ```bash
   git status --short
   git log --oneline --decorate -10
   ```

5. Preserve any pre-existing user changes. Do not reset or overwrite unrelated work.
6. Confirm the active work item and its definition of done from `status.md` and `backlog.md`.
7. Research current official documentation for every platform/service materially affected.
8. Add the sources and consequences to `docs/RESEARCH_LOG.md`; create an ADR if the result is durable.
9. State assumptions and begin with the smallest vertical slice that can be verified end to end.
10. For substantive work, follow AGENTS.md's required agent collaboration: assign a bounded independent subtask, explicit file ownership and acceptance checks while the coordinator progresses other useful work. Use agent tools rather than creating user-visible tasks. Record narrow/unavailable-tool exceptions honestly.

## During a session

- Keep one active work package unless the user changes priority. Independent agent subtasks within that package are encouraged and required for substantive work under AGENTS.md; they do not create competing work packages.
- The coordinator owns shared continuity documents, integration, commits, remote mutations and final verification. Assign disjoint helper write ownership; serialize operations on shared database and native-build resources. Preserve work from other active sessions.
- Get independent agent review for authentication, authorization, privacy lifecycle, migrations/RLS, AI access/budgets and deployment changes. Review findings must be resolved or recorded as open blockers, not hidden behind passing helper tests.
- Prefer feature-vertical changes: contract/domain → port → adapter → API/UI → tests.
- Do not bypass an interface merely because only one provider exists today.
- Update tests with behavior, not afterward as cleanup.
- Run focused tests frequently; run the full gate before committing.
- When a discovered task is outside scope, add it to `backlog.md` with a dependency and continue the active item.
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
   - `backlog.md` statuses and newly discovered work;
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
| `backlog.md`                   | Executable tasks and dependencies              | Whenever work is discovered/started/completed  |
| `docs/PRODUCT_REQUIREMENTS.md` | Stable behavioral requirements                 | When accepted behavior changes                 |
| `docs/QUALITY_GATES.md`        | Definition of done and release criteria        | When testing/risk policy changes               |
| `docs/tutorials/`              | Setup, build, test, and troubleshooting memory | Whenever a proven operational workflow changes |
| `docs/RESEARCH_LOG.md`         | Primary-source findings                        | Before each affected implementation segment    |
| `docs/adr/`                    | Durable technical decisions                    | When a decision is accepted/superseded         |
| `docs/BEFORE_TESTING.md`       | AI activation gate                             | During evaluated AI-provider work only         |

## Avoiding documentation drift

- Link instead of copying detail across files.
- Put facts in the narrowest appropriate document.
- Use requirement/backlog IDs when referring to behavior or work.
- Never mark a milestone complete based only on code presence; cite reproducible exit evidence.
- If a session changes no project state, do not churn timestamps or status prose unnecessarily.
