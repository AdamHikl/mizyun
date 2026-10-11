# Remaining 23 audit — 2026-10-11

This follows the closure of #166–169. Original GitHub criteria were retrieved afresh; the coordinator read the narrow runtime exits directly, and an independent GPT-6.1 Sol Medium helper mapped evidence while the coordinator verified source hashes. This is an evidence-scope audit, not a replacement sensitive code review. No runtime implementation, new native build or deployment occurred. Original non-author sensitive review and full gates remain dated.

## #152 retry/cache engineering closure — CLOSED

Original issue explicitly says **device acceptance is separate**. Its three engineering exits map to:

1. Committed-but-lost response has one durable effect: real SQL0014/0011 plus simultaneous publication transaction races. The October8 disposable database receipt contains the same current SQL0008/0009/0010/0011/0014/0017/0019/0023/0034 Community files and publication-concurrency script. All compared Community hashes MATCH; unrelated retained-meal-photo0034 changed and is excluded. October8 receipt: 1049 SQL assertions/39 files/19 concurrency cases; these are dated results, not reruns today.
2. Old principal results cannot render: real transport with controlled session-resolution tests, scoped client, feed controller and read cache. No claim of new live Auth integration from those controls.
3. Background/foreground/current authority and memory-only shared cache: controller background retirement, revoked previous-page revalidation, actual Feed foreground verification, token/account retirement and visibility epochs. Coordinator inspected memory-only Map/WeakMap storage and clear paths. No Community shared-health persistence adapter is introduced by the retained personal cache.

Historical independent non-author authorization/lifecycle review is recorded in [final review](../../COMMUNITY_FINAL_REVIEW_2026-09-30.md#fresh-verification) and [navigation reads](../../COMMUNITY_NAVIGATION_READS_EVIDENCE_2026-10-02.md). The latest checked Community UI full gate remains October10: f76ee946bbf9a5e3982e889f23acd9cd96c9d54fd55447975ccc21425c11b001, mobile2128/API979+15 credential skips. Its six pinned current UI runtime hashes MATCH. Current source/test hashes: [manifest](152-closure-source-2026-10-11.json). Fresh focused verification is recorded below after completion.

Physical remote-A revocation/B resume, offline/account-switch and full accessibility/Android acceptance remain on #137/#150 and the shared acceptance matrix. Engineering closure does not certify them, global rollout or Production.

## Other highest-value engineering gaps

- #145: allowlist/native preview/publish/read and real private-source denial/source-delete concurrency covered. Exact one-logical-event publication semantics need a direct proof crosswalk before claiming the complete lost-response/event exit.
- #146: equal-time author timeline SQL0034 and client deduplication exist; exact feed RPC inserted/deleted/equal-time pagination and old-cursor boundary proof still needs a dedicated real-database scenario. Author timeline is not silently counted as feed RPC acceptance.
- #147: native Clap/remove plus direct denied access/version/event suppression covered. Rapid/lost-response/restart one-reaction/one-logical-notification proof needs the exact durable boundary recorded before closure.
- #142/#143/#144/#149/#150 retain their explicit actual device/routing/physical/provider/accessibility exits. #148/#151/#153/#154 additionally require staffed operations, custody/restore/erasure or qualified legal/publication evidence. #140/#155/#158/#162 need genuine human research/pilot evidence. #156–161 retain expansion-specific acceptance/admission boundaries. #137 depends on its children.

These agent-run proof/native gaps require no new product decision from Adam; exact external inputs remain in the [per-issue table](README.md#exact-per-issue-completion-needs). No synthetic user, screenshot or automated suite substitutes for a genuine four-week pilot, named operator/contact or physical push/restore/erasure evidence.

## Native continuation and cleanup

[Controller record](additional-native-2026-10-11.md): exact B identity/A discovery observed; no new mute/message/lifecycle acceptance. A screenshot took245s and subsequent controls returned only retired state; unchanged retries stopped. Fixture preparation timed out; subsequent own-auth read verified both profiles active and both following and outgoing-pending lists empty. No follow mutation is inferred and none was blindly retried. Dev documented /v1/health returned200; the initial /health path returned404 and was corrected. Task-owned Metro61047 stopped; no8085listener. Only task-booted Max/A shut down; initially booted Pro/B/data/Auth retained. No account/private record/export erased.

## Fresh final focused verification

Fresh final focused command: pnpm --filter @mizyun/mobile test src/features/community/scoped-client.test.ts src/features/community/state/read-cache.test.ts src/features/community/state/visibility-epoch.test.ts src/features/community/feed/controller.test.ts src/features/community/feed/feed-screen.test.tsx --maxWorkers=1 --minWorkers=1. PASS exit0:86tests/5files, no skips. Ten selected source/test hashes remained unchanged after run. Log /private/tmp/mizyun-comm-152-final-focused-20261011.log. No new runtime edit; earlier full gates/SQL remain dated, and no unnecessary full/provider/native suite was repeated.

## Current disposition

[GitHub #152 closure](https://github.com/AdamHikl/mizyun/issues/152#issuecomment-6108013420) completed after the fresh focused pass; status:done. Five selected issues closed (#152/#166–169),22remain (#137/#140/#142–151/#153–162). Separate physical acceptance remains qualified.
