# Shared agent navigation

The repository owns one navigation system for Codex, Antigravity/Gemini and other agents that can run local commands. It uses current Git files, workspace manifests and TypeScript configuration. No provider account, network call, embedding service or daemon is needed.

## Start a task

Read `AGENTS.md`, compact `status.md` and [START_HERE](START_HERE.md) once. Then select a feature or a narrow task:

```bash
pnpm context community --query "follow back"
pnpm context --symbol saveAiConsent
pnpm context --path packages/contracts/src/food-entry.ts
pnpm context --query "meal retry"
pnpm context --list
```

Use the returned file/line locations to read current source and applicable instructions before editing. Symbol search matches exact declarations; query search ranks paths, top-level declared symbols and document headings, not every source body. A feature limits initial matches; direct neighbors may cross module boundaries. Suggested commands and test locations are inert, advisory candidates.

Default text is bounded to 8,192 bytes and at most 120 lines. Instructions, explicit requirements, open gates and warnings have priority over optional locations. If required information exceeds the budget, the command fails explicitly; narrow the selection or raise `--budget-bytes`. Use `--json` for structured metadata, `--all` for unbounded text, and `--no-cache` to bypass the local cache. Task selection retains at most 16 initial matches, 32 locations and 40 direct relationships, with omission counts; JSON is the complete retained packet rather than a full repository dump.

## Read a focused source or document selection

```bash
pnpm nav:read apps/mobile/src/features/community/state/read-cache.ts --lines 1:30
pnpm nav:read scripts/navigation/bench.mjs --symbol median
pnpm nav:read docs/QUALITY_GATES.md --outline
pnpm nav:read docs/QUALITY_GATES.md --heading "Every implementation segment"
```

Read only the requested current file. Successful output contains the complete selected declaration, line range or heading section (including nested headings), original source boundaries and SHA256. An outline lists locations and is not proof of section contents. Defaults are 8,192 rendered UTF-8 bytes and 120 lines; oversized selections fail without partial content. Narrow the selection or set `--budget-bytes` and `--max-lines` explicitly. Recheck surrounding code/callers/tests as needed. AGENTS.md and SKILL.md require full reads through normal file tools; bounded excerpts reject instruction files. Unsafe, secret, archive and outside paths are rejected. Markdown selection supports ATX/setext headings and fenced code; HTML comments are ignored. Other HTML blocks cause an explicit heading/outline failure because their section boundaries cannot be proven; use a complete explicit line range instead. Terminal control characters are escaped in displayed excerpts; hashes describe the original bytes.

Keep each bounded packet/excerpt separate from a large file-read batch, whose aggregate output cap could erase useful context. Full mandatory startup policies and acceptance gates remain required; avoid rereading already loaded, unchanged context. Helpers receive a focused baseline, ownership and relevant gates and report concise evidence.

## Check the impact

```bash
pnpm impact --path packages/contracts/src/food-entry.ts
pnpm impact --path packages/contracts/src/food-entry.ts --include-working-tree
pnpm impact --since origin/main
pnpm impact --since origin/main --json
pnpm navigation:check --since origin/main
```

With `--path`, only selected seeds contribute impacts. Unrelated local/committed comparison changes are excluded and counted; `--include-working-tree` explicitly adds them. With no paths, `--since` uses the existing merge-base plus staged/unstaged/untracked changes. Ordinary text fits 8,192 bytes/120 lines with limitations and omission counts; use `--all` for unbounded text or `--json` for the retained structured report.

Impact combines explicit feature intent with reverse source imports/reexports and workspace dependencies. It reports reason chains, runtime/type relationships, likely tests, unresolved imports and traversal bounds. Package/configuration effects are labelled coarse. Dynamic registries, data ownership, SQL/RLS behavior and installed-client behavior still need inspection and verification. Neither a current graph nor a mapped test proves complete coverage or acceptance.

## Automatic upkeep

Every context/impact request inventories tracked and nonignored untracked files, checks current content hashes, refreshes configuration resolution and includes current HEAD/content provenance. Changes, additions, moves, deletions, branches and worktrees are reflected without a separate regeneration step. Repeated requests reuse unchanged parsed declarations/imports/headings in the ignored `.cache/mizyun-navigation/` directory. Files are still rehashed. Valid warm graph entries reuse resolved imports after checking all positive/negative configuration lookups and safe canonical identities. Configuration/source/branch/worktree changes or corrupt entries rebuild resolution. This is cached metadata with freshness checks, not an incremental compiler or zero-cost search. Cache corruption is recoverable; `--no-cache` avoids cache reads/writes. The cache is disposable metadata, never authoritative documentation.

PR navigation checks run regardless of changed paths, refresh discovery and reject new/renamed source ownership gaps under `apps`, `packages`, `scripts` and configured workspace package roots against the PR merge base. A new file inside an existing owned directory inherits its feature intent automatically. New domains need an explicit feature owner, requirements and gates. The new-path check follows safe index source policy, including handwritten declarations; generated/private/symlink paths remain excluded. Existing legacy source gaps remain visible warnings; modifying an old gap does not silently mark it mapped. Feature/document paths, anchors, relationships and architectural boundaries remain validated.

Reviewed feature dates/SHAs are never advanced by indexing. Review drift stays visible. Agents still maintain genuine design decisions, privacy constraints and acceptance evidence when behavior changes; generated facts cannot safely infer product intent. Keep the [shared session skill](../.agents/skills/mizyun-session-context/SKILL.md) and [handoff skill](../.agents/skills/mizyun-verify-handoff/SKILL.md) as the common workflow rather than duplicating vendor configurations.

## Measure the tooling

```bash
pnpm navigation:bench
pnpm navigation:bench --samples 5 --json
```

The benchmark reports no-cache/warm synchronous index medians, actual parse/reuse/resolution counts, fresh-process CLI timings and rendered bytes/lines for fixed Community context/impact/excerpt selections. It verifies a stable snapshot across the run and fails on concurrent changes. Cold means cache disabled, not a cold operating-system disk cache. Results vary with hardware and repository state; no wall-clock CI threshold applies. Whole-file/excerpt byte comparisons are output proxies, not model token savings, cost or accepted-task performance.

## Scope and limits

The index excludes secret-like paths, environment files, private/archive/generated/build/dependency bodies and source symlinks. Installed inherited JSON configuration can be read only when its canonical path remains inside this worktree. Markdown contributes headings; SQL contributes locations, not schema relationship analysis. Shared `.agents` instructions are read through the skills workflow rather than indexed. The bounded workspace parser supports ordinary block-list directory globs and fails explicitly on unsupported syntax.

Cross-client compatibility is architectural and statically checked; [#54](https://github.com/AdamHikl/mizyun/issues/54) tracks fresh Codex/Antigravity discovery and behavior. No token reduction or accepted-change speedup is claimed without comparable measured tasks. See the [efficiency plan](AGENT_EFFICIENCY_PLAN_2026-10-02.md), [ADR-0036](adr/0036-focused-agent-retrieval-and-graph-cache.md), [ADR-0034](adr/0034-derived-agent-navigation.md) and [acceptance evidence](AGENT_NAVIGATION_ACCEPTANCE.md).
