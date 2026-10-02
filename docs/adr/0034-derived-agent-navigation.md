# ADR-0034: Derived, local navigation for coding agents

- Status: accepted
- Date: 2026-10-02
- Related: ADR-0022, AGENT-NAV-005 / GitHub #177, client acceptance #54

## Context

The repository is growing faster than a manually curated list of source symbols, tests and package links can track. Agents need current change relationships and narrow task context across Codex and Antigravity without loading whole modules. Static facts and reviewed product/acceptance intent have different freshness requirements.

## Decision

Extend the existing provider-independent `pnpm context`, `pnpm impact` and navigation checks. Derive source metadata from the TypeScript AST, current Git inventory, workspace manifests and inherited configuration. Resolve static import/reexport relationships, preserve uncertainty and produce bounded location/intent packets. Do not execute repository configuration or suggested commands during discovery.

Keep feature intent, semantic relationships, privacy rules, requirements and acceptance pointers in Git. Newly added files inherit existing directory ownership; CI rejects new source ownership gaps and broken references. Do not auto-approve reviews or rewrite reviewed dates after source changes.

Permit an ignored, worktree-local, disposable parse cache containing file hashes and metadata. Revalidate content/configuration on demand and key cache entries by parser/schema version and root. No committed generated map, mandatory watcher, MCP server, vector database, embedding provider or network service is introduced. This refines ADR-0022's Git-only authority: cache data is neither an authoritative knowledge store nor a new runtime dependency. Any future semantic index requires a separate decision supported by measured retrieval failures.

Use shared `.agents/skills` and standard commands for all clients. CLI tests prove tooling behavior; actual skill discovery and followed instructions in each installed client remain separate acceptance under #54.

## Consequences

New files, moves, imports and supported configuration changes appear on the next request. Warm requests avoid reparsing unchanged files but still rehash inventory and resolve imports. Default text has both byte and line budgets, and never silently discards mandatory instructions or acceptance gates.

The graph is advisory. Dynamic registration, SQL/RLS effects and real test coverage require human/agent inspection. Coarse package effects and unresolved imports remain explicit. There is no claim of measured token savings, installed-client acceptance or complete semantic impact coverage.

## Sources

Accessed 2026-10-02: [TypeScript compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API), [TypeScript module reference](https://www.typescriptlang.org/docs/handbook/modules/reference.html), [Git diff](https://git-scm.com/docs/git-diff), [Antigravity skills](https://www.antigravity.google/docs/skills?tab=ide). Dated consequences are recorded in the [research log](../RESEARCH_LOG.md).
