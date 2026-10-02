# ADR-0036: Focused agent retrieval and validated graph reuse

- Status: accepted
- Date: 2026-10-02
- Related: ADR-0022, ADR-0034, AGENT-NAV-006 / GitHub #180; real-client acceptance #54

## Context

A real Codex task used repository navigation but still emitted broad source/startup reads. Explicit-path impact unintentionally unioned unrelated dirty work. Warm metadata reuse avoided parsing but repeated import resolution cost roughly half of an index request.

## Decision

Make explicit paths the default impact seeds; require an explicit flag to combine worktree changes. Preserve no-path merge-base/local-change semantics and advisory limitations. Bound human reports and retain structured/unbounded escape hatches.

Provide inert current-file excerpts for exact top-level declarations, ranges and complete Markdown sections. Include current content provenance and omissions. A successful selection is complete under its explicit output budget; failure never silently drops a policy gate. Instruction files require normal full reads. Outlines locate sections and never substitute for required instructions, startup context or acceptance criteria.

Extend the disposable local parse cache with resolved-import metadata. Continue hashing the complete permitted inventory on every request. Reuse resolution only when capture identity and all positive/negative configuration filesystem witnesses (content and canonical path identities) remain current. Key by worktree root and implementation versions; validate before return, rebuild on corruption/uncertainty, publish atomically, and disable both caches with no-cache. The cache is not authoritative knowledge or executable configuration.

Update portable shared skills to reuse loaded mandatory startup context, request complete focused excerpts, separate bounded calls from huge batches and give helpers disjoint scope plus exact gates. Keep all root/nested safety instructions and repository-wide verification requirements.

## Consequences

The tools keep up with code/configuration changes on demand without a watcher, server or manual index maintenance. Warm resolution can be avoided while full freshness checks retain a meaningful cost. Excerpts can fail when a selection is too large; the agent must narrow it or raise explicit bounds instead of receiving partial gates. Static dependency coverage remains advisory.

Measure index timing and output sizes honestly. No model-token, aggregate subagent cost, installed Antigravity acceptance or accepted-task speed claim follows from these proxies. Actual client/workflow measurements remain #54. Embeddings, vector databases and MCP daemons remain deferred until measured retrieval failures justify a separate design.

## Sources

Accessed 2026-10-02: [OpenAI skills](https://learn.chatgpt.com/docs/build-skills), [OpenAI prompting/skills guidance](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra), [Aider repository maps](https://aider.chat/docs/repomap.html), [Claude best practices](https://code.claude.com/docs/en/best-practices), [Antigravity skills](https://www.antigravity.google/docs/skills?tab=ide), [TypeScript compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API), [TypeScript extends](https://www.typescriptlang.org/tsconfig/extends.html), [Node 22 filesystem API](https://nodejs.org/docs/latest-v22.x/api/fs.html). Detailed dated consequences are in the [research log](../RESEARCH_LOG.md).
