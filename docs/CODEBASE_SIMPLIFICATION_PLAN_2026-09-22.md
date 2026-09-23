# Codebase simplification and agent navigation plan

Work package: `CODEBASE-SIMPLIFY-001` · Researched 2026-09-22 · Status: Stages 1–2 implemented and automatically verified in the working tree; Stages 3–7 remain staged/conditional.

## A. Context and scope

**Recommendation:** keep the existing modular monolith, improve the reliability of its navigation, and extract cohesive responsibilities from a few difficult files. Start with documentation and tooling, prove the approach on Settings, and expand only when measured navigation and review effort improve.

The goal is that an agent can identify the correct owner, public interface, constraints, tests, and edit boundary without reading whole screens or reconstructing historical sessions. Smaller files are useful when they isolate a responsibility; file count and line count alone are not success metrics.

In scope: compact session context, current feature routing, navigation CLI fixes, incremental import-boundary enforcement, small behavior-preserving refactors, and repeatable navigation exercises. This plan defines the implementation order within this package; it does not reprioritize the product roadmap.

Non-goals: new product behavior, framework or dependency upgrades, new services/packages by default, a new state-management system, database/schema changes, deployment, store submissions, rewriting all documentation, or deleting historical evidence. No code, builds, remote configuration, or GitHub issues were changed during this planning session. Proposed issue slices below are a handoff, not a second executable backlog.

## B. Baseline and constraints

### Observed baseline

- HEAD: `ed70df727fdb38940b686b1dd2647d519f8478cd`.
- Initial worktree: 80 porcelain entries, including untracked directories. Substantial existing work spans meal pagination/grouping, dashboard/cache, authentication, legal routes, deployment tooling, CI, screenshots, `package.json`, `status.md`, and `docs/RESEARCH_LOG.md`. These are working-tree observations, not a clean-commit audit.
- Mandatory startup documents total 986 lines: `AGENTS.md` 131, `status.md` 801, `docs/START_HERE.md` 54. Status alone is 148,463 bytes before this planning handoff. The existing navigation plan already calls for status ≤120 lines and startup ≤350; restore those goals instead of inventing another documentation system.
- Fresh helper runs: `pnpm test:navigation` passes 27/27; `pnpm navigation:check` reports 0 errors and 14 stale-review warnings. Passing tests do not establish current prose or comprehensive import boundaries.
- GitHub open issue titles were read on 2026-09-22. Relevant existing work: [#33 current guidance](https://github.com/AdamHikl/mizyun/issues/33), [#54 real-client skill acceptance](https://github.com/AdamHikl/mizyun/issues/54), [#102 grouped meals](https://github.com/AdamHikl/mizyun/issues/102), [#117 pagination/search](https://github.com/AdamHikl/mizyun/issues/117), [#31 durable retries](https://github.com/AdamHikl/mizyun/issues/31), [#25 account lifecycle](https://github.com/AdamHikl/mizyun/issues/25), and [#23 promotion](https://github.com/AdamHikl/mizyun/issues/23). Read full issue acceptance before starting the corresponding slice.
- Declared stack: Expo `~57.0.23` (installed 57.0.23), Router `~57.0.21`, React `19.2.3`, Fastify `^5.0.0`, pnpm `10.33.0`; application CI pins Node `22.13.0`. These are declared versions except the explicitly inspected Expo installation.

### Findings grounded in current source

| Priority | Observation and source                                                                                                                                                                                                                                        | Consequence / proposed response                                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First    | `status.md` contains many completed handoffs and older Pi/Qwen next actions; `docs/feature-map.json:757` still describes Pi hosting and `:600` email admission. `pnpm context environment-build-deployment` repeats Pi limitations and routes to Qwen guides. | Agents can follow obsolete operational guidance. Archive history and reconcile active routing against AGENTS and current evidence.                                |
| First    | `context.mjs:311–312` treats suggested string IDs from `feature-map.mjs:145–148` as objects. `node scripts/navigation/context.mjs meal-loggin` prints `undefined (undefined)`.                                                                                | Fix the actual CLI failure and test its stdout/stderr and exit code.                                                                                              |
| Next     | `context.mjs:39–72` hardcodes instruction discovery; `check.mjs:295–328` checks top-level directory coverage; `:493` starts selected forbidden-import checks.                                                                                                 | Improve existing tooling to discover applicable instructions and distinguish ownership from consumption. Green navigation is not proof of all architecture rules. |
| Next     | Mobile cross-feature imports include Coach → meal form/photo and workout data; log-workout → workout internals; settings → Coach reminders. Auth also imports onboarding, while onboarding imports Auth.                                                      | Define small explicit public surfaces; measure cycles before adding barrels. Re-exporting everything can worsen existing coupling.                                |
| Pilot    | `settings-screen.tsx` is 1,644 lines and includes screen composition, principal fetching, collapsible UI, feedback/legal cards, analytics, and sign-out UI. Existing sibling cards already establish an extraction pattern.                                   | Extract one presentational responsibility first, then reassess; leave sensitive workflows alone in the pilot.                                                     |
| Later    | Coach screen 2,661 lines; meal list 2,093; workout logging 2,058; dashboard 1,419. Several have active uncommitted feature work.                                                                                                                              | Split by workflow/state ownership after the current work settles; avoid concurrent structural rewrites.                                                           |
| Later    | `packages/agent-runtime/src/index.ts` is 1,222 lines mixing ports, policy, screening, errors, registry, orchestration and vision stubs. `apps/api/src/app.ts` is 1,035 lines resolving repositories and wiring routes. Coach `tools.ts` is 1,648 lines.       | Extract internally while retaining public exports, initialization order, repository instance identity, and policy behavior.                                       |
| Optional | `packages/core/src/exercise-catalog.ts` is 17,993 lines, mainly literal data followed by lookup/search functions around line 17,799. `country-data.ts` is also mostly data.                                                                                   | Separate data from logic only if it helps an actual task. Do not rank a data table as the worst complexity merely because it is longest.                          |

These are focused observations, not a comprehensive dependency-cycle or dead-code audit. Historical navigation review findings are research leads; only fresh reproductions above are current findings.

### Rules to preserve

Keep core pure, contracts portable, agent-runtime provider-neutral, adapters technology-specific, API wiring in its composition layer, and mobile device/UI concerns in mobile. Preserve route URLs, package exports, HTTP/schema shapes, cache keys, mutation identity, consent rules, and repository lifetimes. Keep Expo route files under `src/app` thin. Do not rename migrations or operational paths merely for visual consistency.

The coordinator owns continuity and issue updates; helpers get disjoint bounded scopes. Require independent non-author review for auth, account lifecycle, AI admission/budgets, and deployment changes. Qwen remains paused. Existing Q1–Q9 gates remain open unless separately evidenced; this plan is not a remediation closure.

## Research and design rationale

Primary documentation accessed 2026-09-22; dated findings also recorded in `docs/RESEARCH_LOG.md`.

- [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/) and [Router core concepts](https://docs.expo.dev/router/basics/core-concepts/): non-route components belong outside `src/app`. Retain current route paths and extract implementation into existing features; no router migration is needed.
- [React custom hooks](https://react.dev/learn/reusing-logic-with-custom-hooks): extract meaningful stateful responsibilities. Hooks share logic rather than a state instance; splitting a controller must not accidentally duplicate network calls or independent state. Pure calculations remain plain functions.
- [Node package entry points](https://nodejs.org/api/packages.html#package-entry-points): exports specify public package entry points. Preserve current package root imports; internal restructuring does not require a new workspace per feature. This source is current Node documentation, not proof of resolver parity across Node 22, TypeScript, and Metro; verify all three consumers through existing checks.
- [Fastify encapsulation](https://fastify.dev/docs/latest/Reference/Encapsulation/): plugin boundaries affect visibility of hooks/decorators. Initially extract plain dependency factories and registration functions without introducing a new encapsulation boundary or moving security hooks.
- [pnpm filtering](https://pnpm.io/filtering): use existing workspace filters for focused feedback. Focused checks and impact suggestions remain advisory; full `pnpm check` remains the commit gate.

Design inference: these practices fit the current repository without another task runner, agent index, dependency framework, or configuration registry. No ADR is adopted by this plan. If implementation changes module ownership or public protocols, propose the ADR before that change.

## C. Staged implementation

### Stage 1 — Restore trustworthy startup (`SIMPLIFY-01`)

Files: [MODIFY] `status.md`, `docs/START_HERE.md`, `docs/SESSION_GUIDE.md`, `docs/ARCHITECTURE.md`, `docs/feature-map.json`, `.agents/skills/mizyun-verify-handoff/SKILL.md`; [NEW] a dated file under `docs/archive/status/`; [MODIFY] `docs/AGENT_NAVIGATION_ACCEPTANCE.md`. Touch other skill/runbook links only where the reconciliation finds a concrete contradiction.

1. Reuse #33 for guidance reconciliation. Build a small current-state table retaining each active package, issue, qualified evidence, blocker and next exact action. Preserve all historical handoffs in linked archives; repair relative links and any inbound anchors after moving content.
2. Target status ≤120 lines and total startup ≤350 lines, with a byte-size measurement too. Use a warning, not truncation or removal of safety gates, when the budget is exceeded. Keep detailed evidence in existing registers and linked session artifacts.
3. Replace active Pi/Qwen/Mistral/email-allowlist guidance where contradicted by current authoritative rules. Historical documents remain labeled history. In particular, repair the verification skill's stale Pi deployment wording and architecture's stale provider/React Query assertions after inspecting actual composition.
4. Review each touched feature entry before updating its review SHA/date. Link to issue/evidence sources for changing acceptance status rather than maintaining several copied checklists. A working-tree review must disclose that state; do not imply every change is in HEAD.

Acceptance: navigation passes; moved evidence and links remain accessible; the environment context identifies Hetzner and paused Qwen correctly; no old next action is presented as current; all active gates survive compaction. Record before/after lines and bytes. This stage is documentation-only.

### Stage 2 — Repair and strengthen existing navigation (`SIMPLIFY-02`)

Files: [MODIFY] `scripts/navigation/context.mjs`, `feature-map.mjs`, `check.mjs`, `impact.mjs`, and `test/*.test.mjs`; [MODIFY] `docs/feature-map.schema.json` and `docs/feature-map.json` only if a schema extension is necessary; [MODIFY] `docs/AGENT_NAVIGATION_ACCEPTANCE.md`.

1. Fix typo suggestions first with a process-level regression for `meal-loggin`, unknown IDs and ambiguous aliases.
2. Discover actual ancestor `AGENTS.md` files for selected entry/owned paths, deduplicate them, and distinguish instruction files from documentation directories. Keep output bounded; offer explicit expansion rather than dumping entire source trees.
3. Separate direct owner matches from consuming/referenced features in impact output. Report unmapped changed paths explicitly. Preserve staged, unstaged, untracked and rename coverage, reverse workspace dependencies, missing-base failures, and inert command suggestions.
4. Distinguish committed review freshness from local modifications. Add fixtures proving a dirty mapped file is visible even when HEAD is unchanged.
5. Extend coverage to relevant shared code/scripts/tests with explicit exemptions for generated output and historical artifacts. Add an advisory startup-size check to the existing validator rather than a separate monitoring system.

Acceptance: old 27 tests plus new failure-boundary fixtures pass; typo output contains real IDs and no `undefined`; instruction discovery works outside mobile; representative unmapped changes are visible; context output stays bounded and does not execute recommended commands. Do not suppress the existing stale warnings just to make the report green.

Implementation result (2026-09-23): completed under #124. The suite expanded from 27 to 38 fixtures; typo/alias/unknown rendering, real ancestor instructions with symlink containment, owner/reference/propagated impact groups, local-versus-committed review drift including missing review history, missing-base and inert-command behavior, broad advisory coverage, and startup line/byte budgets are exercised. The validator deliberately retains committed/local drift and unmapped-source warnings. No deployment or feature-map schema change was required.

### Stage 3 — Establish narrow feature interfaces (`SIMPLIFY-03`)

Files: [MODIFY] `docs/ARCHITECTURE.md`, existing navigation boundary checker/tests and selected mobile importers; [NEW] `public.ts` in selected feature directories only where a cross-feature consumer exists; [MODIFY] feature map entries for those surfaces.

1. Inventory actual cross-feature and cross-package imports with source resolution. Capture existing cycles and distinguish type-only dependencies from runtime edges. Keep a scoped dated exception list in the existing navigation acceptance register, with owner/issue and removal condition.
2. Pilot one narrow interface, such as workout preference reads or Coach reminder helpers. `public.ts` exports only what consumers need; feature-internal imports stay direct and never import their own barrel. Do not expose screens, adapters or every helper by default.
3. Ratchet new violations: allow reviewed legacy edges temporarily, reject newly introduced private cross-feature imports and forbidden layer dependencies. Account for aliases, relative traversal, re-exports, dynamic imports and composition-root exceptions.
4. Do not move domain responsibilities or create generic `utils`/`services` buckets as part of the import migration. Resolve Auth/onboarding cycle ownership before touching that interface; it is a separate sensitive slice.

Acceptance: no new runtime cycles; existing root package exports remain compatible; fixture violations fail for the right reason; allowed imports pass; affected package tests/typechecks and mobile bundle checks pass. Boundary results state their coverage and limitations.

### Stage 4 — Prove the refactor pattern on Settings (`SIMPLIFY-04`)

Files: [MODIFY] `apps/mobile/src/features/settings/settings-screen.tsx`; [NEW] sibling `collapsible-section.tsx`, `feedback-card.tsx`, `legal-card.tsx` as warranted; [MODIFY] feature map/test references. New files are proposed names, not files already created.

Extract CollapsibleSection and the presentation of feedback/legal cards in small patches, colocating styles with their owner. Keep parent state and effects in place initially. Match the existing sibling-card organization; do not introduce several empty `components/hooks/services` levels. Leave AnalyticsCard, principal loading, sign-out, account export/deletion and consent behavior for separately reviewed work.

Acceptance: unchanged labels, category/accordion behavior, legal links, accessibility and navigation; no new effects/API requests; focused tests and full gate pass; exercise affected Settings UI on physical iOS and Android before calling it device accepted. Reviewers can identify a card's implementation without reading the screen's unrelated workflows. Stop and adjust the pattern if the extraction merely scatters one tightly coupled component across files.

### Stage 5 — Apply selectively to complex mobile workflows (`SIMPLIFY-05`, several independent slices)

Files per slice: [MODIFY] exactly one of `dashboard/dashboard-screen.tsx`, `log-meal/meal-list-screen.tsx`, `log-workout/log-workout-screen.tsx`, or `coach/coach-setup-screen.tsx`; [NEW] feature-local named view components/controllers only when needed; [MODIFY] existing focused tests and manifest entries.

Suggested order after the pilot: dashboard presentational cards; settled meal-history sections/controller; workout session view/controller; Coach conversation/composer. One workflow per PR. Decide the exact extraction after re-reading current source; this plan does not prescribe a generic hook for every screen.

Dependencies: coordinate with the owners of #102/#117 before touching meal history; preserve #31 durable retry acceptance; require independent review for Coach consent/budget paths. Do not combine this work with new pagination, nutrition, consent or retry behavior.

Acceptance: dashboard partial failure cannot overwrite fresh data; pagination preserves ordering/deduplication and drops stale search responses; mutations preserve stable identity through retry and restart; workout state/timers survive their existing lifecycle; Coach consent continues exactly once with unchanged admission/budget rules. Use real boundary regressions and affected native journeys. If an existing defect appears, track it separately and keep the refactor's behavioral scope explicit.

### Stage 6 — Separate backend and runtime responsibilities (`SIMPLIFY-06`, separate sensitive slices)

Files: [MODIFY] `packages/agent-runtime/src/index.ts`; [NEW] cohesive internal modules such as `ports.ts`, `tool-registry.ts`, `orchestrator.ts`, `safety.ts`, `vision.ts`; [MODIFY] runtime tests. Separately [MODIFY] `apps/api/src/app.ts`; [NEW] composition helpers under `apps/api/src/composition/`. Later [MODIFY] `apps/api/src/modules/coach/tools.ts` with feature-local tool modules.

Keep runtime `index.ts` as a compatible public facade. Preserve exact exported symbols, error class identity, system policy text, evaluation corpus, tool ordering and budget semantics. Use type-only imports where appropriate to prevent cycles. Split Coach tools by existing responsibilities, retaining the registry and established `meal-history.ts`/`exercise-history.ts` pattern.

For API wiring, keep `buildApp` as the public composition entry and preserve explicit override precedence, default dependencies, shared repository instances for deletion/export, hook order and startup/shutdown behavior. Do not turn this into a dependency-injection framework or relocate all in-memory repositories at once.

Acceptance: runtime and API tests plus offline AI evals pass; add focused identity/override/order regressions where existing coverage is insufficient; independent review covers AI/security/lifecycle effects. #25/#30/#36 acceptance stays separate. No live provider calls until `docs/BEFORE_TESTING.md` permits them.

### Stage 7 — Optional cleanup only after measured benefit (`SIMPLIFY-07`)

Files if justified: [MODIFY] `packages/core/src/exercise-catalog.ts`; [NEW] `exercise-catalog-data.ts` and `exercise-catalog-types.ts`; [MODIFY] catalog tests. Other cleanup files require a fresh explicit allowlist.

Separate catalog data, types and lookup logic while preserving IDs, order, content, exported API and search ranking. Do not change data format, introduce runtime loading or split into many tiny files. Preserve provenance/licensing if generation is introduced later.

Inventory scripts and deprecated deployment path names before proposing moves. Prefer a command index grouped by purpose over moving scripts that CI, skills and external operations may call. Retain `deploy/raspberry-pi` filenames until all current consumers and compatibility requirements are understood. Worker tooling remains paused; non-use is not proof it is safe to delete. Deletion requires reference/consumer evidence and separate review; no deletion is pre-approved by this plan.

Acceptance: equivalent catalog contents and search results; affected tests and full gate pass. Operational changes, if separately pursued, require safeguard tests and independent review. Stop optional cleanup when it offers no demonstrated navigation benefit.

## D. Verification and success measures

Use `docs/QUALITY_GATES.md` as the definition of done. Maintain existing test coverage while moving code; add tests for real failure boundaries, not every extracted presentational wrapper.

For each implementation slice, select focused commands from its context, for example:

```sh
pnpm test:navigation
pnpm navigation:check
pnpm --filter @mizyun/mobile test src/features/settings
pnpm --filter @mizyun/agent-runtime test
pnpm --filter @mizyun/api test
pnpm --filter @mizyun/core test
```

Run only the applicable subset during iteration. After all writes settle, format the exact changed files, run `pnpm format:check`, `pnpm check`, and `git diff --check` before commit. Full `pnpm check` includes mobile bundle exports and is deliberately deferred from this documentation-only planning session. Do not run builds, DB resets, live-provider suites or remote operations to validate this plan.

Repeat five cold-start navigation exercises before/after: meal retry/pagination; account deletion; AI consent; a shared-contract change; Hetzner preflight. For each record exact baseline SHA plus dirty state, commands, elapsed time, files/bytes actually read, correct owner/interface/tests/instructions, and missed gates. A read-only agent can perform the after exercise while the coordinator validates evidence. Reuse #54 for actual Codex/Antigravity skill discovery; do not claim cross-client acceptance from one agent.

Targets: ≤350 startup lines and ≤120 status lines without losing gates; all five exercises locate correct source/tests/instructions and avoid obsolete guidance; touched cross-feature imports use reviewed public surfaces; no new cycles; no growth in unexplained unmapped paths. Provisional usefulness target: ≥30% lower median context bytes read across the same five exercises, with no accuracy regression. Timing/token savings are unmeasured hypotheses until controlled before/after runs exist. If smaller files increase searching or indirection, revise or stop the next extraction.

Rollback is per reviewed slice: revert that slice on its isolated branch, retaining compatible entry points. Never reset the shared dirty worktree. Device acceptance, Dev deployment and Production release remain separate, explicitly authorized milestones.

## Suggested issue slices and implementation order

At implementation kickoff, reconcile current GitHub inventory, reuse #33 and #54, and create only missing bounded slices. Suggested labels: `priority:P2`, `status:ready`, `area:docs` for navigation/guidance or `area:session` for tooling; use the relevant existing feature area for code refactors. Promote only the selected slice to `status:active`; mark blocked slices with concrete dependencies. This session did not create or modify issues.

Order: Stage 1 → Stage 2 → Stage 3 narrow pilot → Stage 4 → measure. Stages 5–7 are conditional follow-ups, not a commitment to rewrite the repository. Stage 6 can proceed independently of Stage 5 only after a successful pilot, settled file ownership and available non-author review. Keep #25 and other release blockers visible; simplification does not close or replace them.

## E. Next-session prompt

> Start `SIMPLIFY-03` only after reviewing the current dirty tree and the completed Stage 2 evidence. Inventory actual cross-feature imports with source resolution, distinguish runtime from type-only edges, and select exactly one low-risk public-interface pilot with no auth/onboarding, account lifecycle, AI admission/budgets, database, or deployment changes. Preserve existing package exports and record a scoped legacy exception list with owner/removal condition. Add positive and negative boundary fixtures, run affected checks plus full `pnpm check`, and stop before the Settings extraction in Stage 4.
