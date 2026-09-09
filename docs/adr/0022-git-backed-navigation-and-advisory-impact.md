# ADR-0022: Git-backed engineering knowledge and advisory impact analysis

- Status: accepted
- Date: 2026-09-09
- Related: ADR-0001, ADR-0016, Finding Q1–Q9, DOCS-NAV-001–004, INFRA-DUAL-004

## Context

As the Mizyun modular monolith expanded across core domain packages, server adapters, multiple API modules, and mobile workflows, agent and developer sessions faced severe context bloat:

1. Startup documentation exceeded 1,700 lines across root instructions, business alignment, operational journals, and an unstructured 901-line `status.md`.
2. Historical operational logs and superseded infrastructure instructions (such as Windows PC references and Mistral configurations) were interspersed with active deployment realities, causing agents to confuse historical claims with fresh live verification.
3. Discovering relevant files, contracts, tests, runbooks, and active release gates required manual exploratory grep or broad assumptions, risking accidental coupling across layer boundaries.
4. Heavy external solutions—such as embedding models, vector databases, local search servers, or remote indexing agents—introduce operational dependencies, credential requirements, out-of-sync indexes, and non-deterministic behavior unsuitable for an offline-capable, locally verifiable repository.

## Decision

1. **Keep Authoritative Knowledge in Git**:
   - All repository memory, routing, and decision records remain plain Git-tracked text files (`docs/`, `AGENTS.md`, `status.md`). No vector stores, search daemons, embeddings, or external indexing services are permitted for developer tooling.
   - Historical status logs are extracted to versioned archives under `docs/archive/status/` with explicit non-instructional provenance banners.
   - `status.md` is strictly constrained to a compact operational snapshot ($\le 120$ lines) containing only active package state, live environment SHAs, verifiable exit criteria, blockers, and next actions.

2. **Single Entry Point (`docs/START_HERE.md`)**:
   - Provide a concise routing index ($\le 100$ lines) directing sessions to product intent, architecture, decisions, runbooks, feature maps, and active evidence registers. Normal startup reading is reduced from ~1,700 to $\le 350$ lines.

3. **Machine-Readable Feature Manifest (`docs/feature-map.json`)**:
   - Maintain a single, versioned JSON schema (`schemaVersion: 1`) covering 100% of API modules and mobile workflows.
   - Map canonical entry points, owned paths, contracts, database tables, tests, typed dependencies (`dependsOn`, `affects`, `relatedTo`), and inert advisory verification commands.
   - Ensure paths are validated against filesystem reality; no speculative paths are committed.

4. **Deterministic Context CLI (`pnpm context <feature-id>`)**:
   - Provide bounded, prioritized context extraction with `--list`, `--json`, and `--all` flags.
   - Constrain default human-readable output to $\le 120$ lines, providing exact omissions and complete JSON options for agents.
   - Suggest nearest matches via Levenshtein distance on typos; fail closed with non-zero exit on unknown IDs.

5. **Advisory Impact Analysis (`pnpm impact --since <ref>`)**:
   - Combine three deterministic signals:
     1. Direct file ownership from `docs/feature-map.json`.
     2. Static TypeScript/JavaScript reverse dependency analysis of workspace packages and imports.
     3. Semantic forward affect edges (e.g. database table changes affecting data export and deletion lifecycles).
   - Use strict argument arrays and NUL-delimited Git plumbing commands (`git diff -z`, `git ls-files -z`) without shell interpolation.
   - Traverse dependency graphs with cycle detection.
   - Output remains strictly advisory: it highlights affected areas and suggested tests without waiving the mandatory `pnpm check` repository gate or release gates.

6. **Automated Structural & Boundary Validation (`pnpm navigation:check`, `pnpm test:navigation`)**:
   - Integrate validation directly into `pnpm check`.
   - Verify manifest schema integrity, filesystem path existence, local Markdown links and HTML/heading anchors.
   - Enforce architectural boundaries defined in `AGENTS.md`: pure core isolation, neutral agent-runtime/memory, and prevention of server secrets/adapters leaking into mobile bundles.

## Consequences

- Sessions start with clean, compact, unambiguous context in under 300 lines.
- Historical evidence and decisions are preserved permanently without polluting current operational instructions.
- Architecture boundaries are continuously verified on every commit via standard `pnpm check`.
- Zero runtime dependencies, network requirements, or background daemons added.
