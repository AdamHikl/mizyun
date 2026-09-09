# Agent navigation implementation review — 2026-09-09

Verdict: **partially implemented; DOCS-NAV-001–004 are not ready for closure**. Reviewed the uncommitted navigation work over `7faec30d0c2e7e165891dd970004c8865936ccde` against `AGENT_NAVIGATION_IMPLEMENTATION_PLAN.md`. This is a local tooling/documentation review, not new Pi or application release acceptance.

## What works

The implementation retains the existing code layout, adds no database/server dependency, preserves root safety and required collaboration rules, shortens normal startup, retains historical status text, and provides usable feature lookup with aliases, JSON, and bounded text. Direct manifest relationships propagate with a visited set. Git commands use argument arrays and NUL-delimited paths. Suggested checks remain inert. Navigation checks are included in local `pnpm check`.

The current navigation validator and all 15 navigation tests pass. The findings below explain why those passes do not establish the plan's full exit criteria.

## Findings

### N1 — P1: Boundary check misses the actual server adapter import

Location: `scripts/navigation/check.mjs:296–299`; `packages/adapters/supabase-server/package.json:2`.

The mobile deny patterns check `@mizyun/adapters-supabase-server` and `@mizyun/supabase-server`, but the actual exported package is `@mizyun/adapter-supabase-server`. A temporary fixture importing that exact package into mobile returns `{errors:[],warnings:[]}`. Core side-effect imports of Supabase and literal dynamic imports of Gemini also return no errors. Regex checks do not implement the planned resolver-based boundaries, public entry-point rules, or relative/alias protections.

Fix: resolve imports/re-exports using installed TypeScript, enforce explicit allowed boundaries on resolved targets/package identities, and report unresolved expressions. Test actual package names, static/side-effect/dynamic imports, aliases, and public versus internal imports. Do not label the current regex gate strict server-secret isolation.

### N2 — P2: Impact analysis has no source-derived dependency graph

Location: `scripts/navigation/impact.mjs:147–162` and `analyzeImpact`.

`PACKAGE_FEATURE_MAP` is a second hard-coded mapping. The analyzer never reads package dependencies or resolves imports. Its reverse-dependency signal is only reverse traversal of manually declared `dependsOn` relationships. Adding a new importer or package dependency therefore does not teach the tool about the new consumer. It also emits no unresolved-import coverage and records only the final propagation edge rather than a source-to-impact chain. This does not meet C1 or the acceptance claim of workspace reverse-dependency coverage.

Fix: derive package/import edges from source, retain explicit semantic relationships, expose distinct signal names and complete reason chains, and surface unresolved/unmapped coverage. Add a fixture where a consumer imports a changed producer without a manifest relationship and require the consumer to appear.

### N3 — P2: Validator accepts invalid metadata and incomplete coverage

Location: `scripts/navigation/check.mjs:54–127`, `scripts/navigation/feature-map.mjs:18–70`.

The JSON schema exists but is not enforced. Validation omits `migrationPaths` and feature `docs`, relationship types, review SHA format, required field types, source staleness, and feature directory coverage. A fixture combining nonexistent migration/doc paths, an invalid relation type, and `lastReviewedSha: "not-a-sha"` passes with zero errors/warnings. Actual direct map coverage leaves `apps/mobile/src/features/dev` unmapped, contrary to the claimed 14/14 mobile coverage. Impact's generic package fallback does not constitute an explicit supporting-area classification.

Path checks do not resolve symlinks or enforce containment across every reference category. A lexical `..` check is not the planned realpath boundary.

Fix: validate the complete schema/reference model, check all categories, explicitly classify supporting areas, reject escaped/sensitive/generated targets before reading, and implement meaningful stale-source warnings. Add negative tests for these cases.

### N4 — P2: Archive and verified-pattern references are broken

Locations: `docs/archive/status/STATUS_HISTORY_THROUGH_2026-09-09.md:29` (also 383, 391, 441, 445, 905); `docs/patterns/README.md:26–27,52`; `scripts/navigation/check.mjs:134–144`.

The helper verified preservation of the original status body, but relative archive links were not rebased. A link to `docs/IMPLEMENTATION_REVIEW_...` now resolves beneath `docs/archive/status/docs/`, which does not exist. Pattern records marked verified cite nonexistent `20260714151500_init.sql`, `20260721110000_private_media_storage.sql`, and `apps/api/src/composition/coach-service.ts`.

The checker omits archive bodies and does not validate canonical paths stored as inline code in pattern records. Missing anchors produce warnings only; duplicate-heading slugs and fenced-link exclusions are also incomplete.

Fix: rebase moved links, replace invented references with actual inspected sources, validate structured pattern references, and include archive links in the gate. Test broken links/anchors, duplicate headings, and fence handling. Preserve the history itself.

### N5 — P2: Current guidance still contains contradictory and unsupported claims

Locations: `plan.md:56`, `docs/adr/README.md:26`, ADR-0020 header, `status.md` implementation/release section, `docs/AGENT_NAVIGATION_ACCEPTANCE.md` reconciliations.

Windows provisioning remains the current milestone in the plan. The ADR index says accepted while the original ADR remains proposed. The new acceptance record says Mistral is preserved as a secondary adapter despite the current provider tree containing Gemini only. Recording these contradictions elsewhere is not reconciliation. Compact status groups Q1–Q9 under implemented/verified while the remediation checklist retains several partial implementation findings.

Fix: reconcile authoritative current records, distinguish design adoption from live installation evidence, and retain explicit open implementation work in the compact handoff. Qualify inherited deployment evidence by date/source. Do not close release findings during a navigation cleanup.

### N6 — P2: Focused context omits the rules and open-work links it was meant to surface

Locations: `scripts/navigation/context.mjs:43–139`; `docs/feature-map.json` feature `docs` arrays.

The command formats manifest fields without discovering nested AGENTS or checking review freshness. Meal context does not expose `apps/mobile/AGENTS.md`; account-lifecycle context links an ADR and export inventory but omits Q4/Q5 acceptance/open findings. Feature records have no targeted requirements/backlog IDs or evidence links. Global startup documents offer a fallback, but the promised focused reading path remains incomplete.

Fix: surface applicable nested instructions, requirement/work-item IDs and evidence/limitation links per feature, and staleness/coverage warnings. Exercise deletion and meal retries with fresh helpers who must find the currently open acceptance work, not just entry points.

### N7 — P2: Tests rely on this checkout's history instead of controlled regressions

Location: `scripts/navigation/test/impact.test.mjs:20–48`.

Tests use real `HEAD~1` and `HEAD~5`, check `totalFilesChanged >= 0`, and infer cycle coverage by calling the existing repository. No synthetic cycle or rename/deletion fixture is constructed. A checkout with fewer than six commits cannot satisfy the hard-coded history reference. The 15 tests do not exercise the advertised matrix of Git edge cases, boundary violations, CLI truncation, escaping, or staleness.

Fix: create disposable fixture repositories with explicit commits/working states and assertion-rich expected impacts. Test CLI execution separately and guard `impact.mjs`'s unconditional `main()` so importing its API does not run a CLI against the caller's repository. Re-run cold-start acceptance after the defects are fixed; preserve old results as scoped historical evidence.

### N8 — P2: Required automated CI integration is missing

Location: `.github/workflows/` and `package.json`.

Local `pnpm check` includes the navigation gate, but none of the three current workflows invokes `pnpm check` or the navigation commands. The plan required inspecting and updating CI if the combined gate was absent. Future navigation-only changes can bypass automated validation in PRs.

Fix: add a suitable PR workflow/step with relevant coverage and required dependencies. Use fixture tests that work in a shallow checkout; do not solve missing test history by relying on unrelated application commits.

## Fresh verification and limitations

- `pnpm navigation:check`: passes, zero errors/warnings despite N1/N3/N4.
- `pnpm test:navigation`: 15/15 pass; this is existing-suite evidence, not acceptance of untested cases.
- Read-only feature inventory: API 15/15; mobile 13/14 direct classifications, with `dev` unmapped.
- Temporary fixture probes: actual mobile server import, core side-effect/dynamic imports, and invalid migration/doc/type/SHA metadata all incorrectly pass validation. No application source was modified for probes.
- Independent helper reviewed Stage 1, archive preservation, pattern paths, contradictory current records, and targeted context omissions. Coordinator inspected tooling and ran probes/checks.
- Full `pnpm check`: passed with exit 0 during this review, including navigation tests, formatting, workspace typechecks, iOS/Android bundle exports, unit tests, deployment safeguards, build matrix, and offline AI invariants. This does not cover the missing regressions above. No remote, database, live-provider, or device acceptance was run for this review.

## Next implementation package

Repair N1–N3 first so validation can detect defects, then N4–N6 for accurate context. Complete N7–N8 before rerunning the plan's five independent exercises and declaring DOCS-NAV-001–004 done. Preserve all working-session files; this review does not implement the fixes or authorize a deployment.
