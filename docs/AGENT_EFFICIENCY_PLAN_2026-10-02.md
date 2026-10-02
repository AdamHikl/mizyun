# AGENT-NAV-006: focused reads and faster current navigation

Date: 2026-10-02. Status: implemented, independently reviewed and automatically verified; real-client acceptance remains #54.

## Problem and scope

AGENT-NAV-005 already provides provider-independent source indexing, bounded task packets, current import impact, and shared skills. An actual Codex session used `pnpm context community` and `pnpm impact --path ...`, establishing uptake. It still read large startup/file batches, and impact merged the selected path with unrelated dirty nutrition work (365 impact entries). Warm indexing still resolves every import after reusing parsed metadata.

Implement these improvements in an isolated worktree; preserve concurrent Community/nutrition changes. No application, deployment, provider, database, consent or release behavior changes. RAG, embeddings, a vector database and a persistent MCP daemon remain deferred under ADR-0022/0034 until deterministic retrieval failures justify their complexity.

## Implementation sequence and ownership

1. **Task impact scope — helper impact_graph.** When `--path` is supplied, use only those normalized seed paths by default. Add `--include-working-tree` for an explicit union. Keep no-path merge-base plus local-change behavior. Report scope and excluded local changes; `--since` alone preserves existing semantics. Validate flags and conflicting options. Bound ordinary text to 8,192 UTF-8 bytes and 120 lines, with explicit omissions and mandatory limitations; retain JSON and `--all` escape hatches. Put selected tests/check commands early. Own impact.mjs and impact tests only.
2. **Safe excerpts — helper bounded_reads.** Add `pnpm nav:read <file>` with exactly one of `--symbol`, `--lines`, `--heading`, or `--outline`. Read and parse only the selected file. Exact top-level declaration selection uses original AST byte/character boundaries and reports original line/column positions; full line ranges and Markdown sections include subordinate headings. Outline locates sections but is not evidence for their contents. Include a content hash and explicit omitted bytes/lines. Default rendered output is at most 8,192 bytes/120 lines. Return the whole selection or fail without partial source; never silently truncate a gate. Reject bounded instruction-file reads (AGENTS.md/SKILL.md), secrets, archives, outside paths and unsafe symlinks. Revalidate opened-file identity and content across concurrent writes. Own new read.mjs and read.test.mjs only.
3. **Resolved graph cache — helper source_index.** Preserve current full content hashing and parse cache. Cache resolved imports and package summaries, not bodies or duplicated declarations. Key by canonical worktree root, complete capture, HEAD and schema/parser/resolver versions. Record positive and negative configuration filesystem lookups including inherited installed JSON and symlink identities. Validate dependencies before reuse and before returning. Corrupt, unsafe or unprovable entries rebuild; `cache:false` disables both caches. Atomically publish ignored local metadata. Expose actual graph cache hits and resolution counts. Own repository-index.mjs and its tests (plus a focused cache module if needed).
4. **Focused agent workflow — coordinator.** Wire commands; update shared session/handoff skills and session guide to use bounded packets separately from large output, exact excerpts, task-only impact and scoped helper assignments. Preserve full mandatory root startup reads and all acceptance/deployment gates. Once mandatory startup context is loaded, do not reread it per helper or per edit. Use outlines to locate later relevant status sections and read those sections completely; conflicting or uncertain continuity requires the full document. Capture a task baseline and disjoint ownership; helpers load their applicable instructions and focused requirements. Do not route to paused Qwen.
5. **Measurements and evidence — coordinator.** Add a repeatable benchmark reporting cold/warm medians, parsed/reused/resolved counts, output bytes/lines, and source-excerpt versus whole-file size. Keep these labelled proxies: they are not model tokens, task completion speed, cost, or accepted-change quality. No brittle wall-clock CI threshold. Compare equivalent inputs before/after and use a fixture with unrelated dirty files to prove impact isolation.

Only the coordinator changes package.json, shared continuity/evidence documents and GitHub Issues, commits/pushes or integrates. Helpers must not write outside ownership or execute deployment/database/native workflows. An independent helper reviews final code and workflow behavior after implementation, alongside coordinator documentation work.

## Acceptance

- Demonstrate selected-path isolation against unrelated staged/unstaged/untracked changes; explicit union and legacy comparison behavior remain available. Cover deletion, type edges, cycles, config fallback, strict flags and Unicode text budgets.
- Excerpts retain whole selected declarations and nested policy sections, reject ambiguous/missing selections and unsafe/instruction paths, and report real source provenance. Oversized selections fail visibly. Cover file changes, symlink escapes and concurrent-write retry/failure.
- Warm graph hits perform zero new resolutions; dirty/new/deleted source, same-size/same-time inherited config edits, negative lookup appearance, symlink changes, branch/worktree changes and corrupted caches invalidate safely. No configuration execution.
- Existing navigation/new-source ownership gates pass. Format only owned files, then run fresh `pnpm check` after helper writes settle. Preserve disabled provider integration suites and record skips as skips.
- Record measured baselines and final results with exact commands/runtime/commit context. Real Antigravity uptake and controlled accepted-task/token metrics remain open in issue #54.
- Save durable research, design decision, user-facing guide and qualified handoff. Implemented and automatically verified are separate from real-client acceptance and deployment.

## Research and consequences

Existing research in docs/RESEARCH_LOG.md and ADR-0022/0034 supports deterministic local retrieval and content-based freshness. Fresh primary sources reviewed on 2026-10-02:

- [OpenAI: rethinking skills and prompts](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra): concise routers and progressive disclosure; remove redundant reads, not repository safety gates.
- [OpenAI: build skills](https://learn.chatgpt.com/docs/build-skills): load relevant instructions/resources when needed; preserve portable shared skill entrypoints.
- [Aider repository map](https://aider.chat/docs/repomap.html): rank relevant graph context inside an explicit output budget.
- [Claude Code best practices](https://code.claude.com/docs/en/best-practices): file/tool output consumes context; bounded delegated summaries isolate coordinator context. This does not establish lower aggregate agent cost.
- [Antigravity skills](https://www.antigravity.google/docs/skills?tab=ide): discover skill metadata and activate focused instructions; keep commands independent of Codex.
- [TypeScript compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API): inert AST selection of declarations rather than executing project configuration.
- [TypeScript extends](https://www.typescriptlang.org/tsconfig/extends.html): inherited configuration can change resolution, so cache dependencies include installed configuration files and absence probes.
- [Node filesystem API](https://nodejs.org/docs/latest-v22.x/api/fs.html): verify file identity/safe opens and atomic cache publication using supported Node 22 APIs.
- [Git diff](https://git-scm.com/docs/git-diff), [Git ls-files](https://git-scm.com/docs/git-ls-files): distinguish explicit task seeds from worktree changes; retain current inventory/deletion handling.

## Initial measurement

Read-only helper instrumentation on the 1,080-file/2,355-edge base: cold index 1,300ms; warm samples 642/653/669/676ms, median 661ms. Mandatory content capture/revalidation is about 320ms; repeated resolution about 315ms. A local warm-index target of approximately 450ms is a measurement goal, not a correctness gate or a promise on other hardware.

The audited session's startup/read batches emitted roughly 48,000 characters. This observation identifies avoidable reads; it is not a token count or a controlled before/after saving.

## Gate-blocker correction during implementation

The first full gate found two documentation link failures: our app-specific chat link was replaced with a plain thread identifier, and an existing archived sibling-website link was made portable using a verified immutable GitHub source permalink. The next gate passed navigation116/116 and formatting but fresh mobile dependencies exposed existing TS2339 timer narrowing failures in Community comments/controller.ts and state/read-cache.ts, both present at base1797fed. Scope expands only to type assertions on already object-guarded optional unref calls; emitted runtime behavior is unchanged. Coordinator owns these two corrections; independent review and existing lifecycle regressions validate them before restarting the full gate. Concurrent original-checkout edits remain untouched.
