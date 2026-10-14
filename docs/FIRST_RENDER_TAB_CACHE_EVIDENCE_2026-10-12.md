# First-render tab cache — 2026-10-12

Issue [#182](https://github.com/AdamHikl/mizyun/issues/182). Adam reported Meals showing `0 days` and `Loading logged meals…` for the first second of navigation, with the same flash on other tabs, after the Oct11 standalone Dev installation on main `0135228778059dc25c1a4925738f0b6934ed4f0c`.

## Failure and implementation

Startup populated authenticated endpoint records but screen state still started empty/loading and waited for asynchronous focus/mount work. Expo57 native tabs eagerly render all tab content, so endpoint warming can also finish after unfocused screens have mounted. Four coordinator first-render regressions against the original Home/Meals screen implementation failed, including an already-warm snapshot and cold-mounted tabs receiving a later startup fill. The old Meals test rendered the exact `0 days / Loading logged meals…` state. [Original failure](evidence/first-render-cache-2026-10-12/baseline-regression.log).

Personal screens synchronously project validated cache records on their first render and subscribe to startup fills while mounted, independently of focus. Complete empty snapshots are loaded; missing/partial reads retain truthful loading. Async and sync paths share request identities and projections. Existing content remains visible while refreshing. Disk hydration publishes only after account/generation acceptance and preserves saved timestamps; expired personal display reads retain the existing48-hour limit. Account/token/day/timezone/foreground/schema/query/mutation/storage-generation fences prevent wrong-context snapshots. Account cleanup cannot re-tag old hydrated rows, reuse old in-memory rows asynchronously, or persist sibling records from an earlier cleanup generation.

Home, Meals, Workouts and Coach secondary state is fenced on the first new-account frame, including Health count, search results, editors, transcript, unsent text and pickers. Prior-account deferred Coach results cannot replace a new account's warm transcript or release its operation lock. Same-user token rotation retains the intended draft/history behavior; live provider/consent still controls actions.

Community has its own synchronous projection and cache-fill subscriptions. Only still-valid active/adult membership and feed records can hydrate an untouched controller. Owner/token/foreground/day/epoch and the original10-second server deadline remain required. Hydration never starts a new authorization lifetime, overrides existing pagination/mutations or persists Community to disk. Expired authority still requires revalidation.

Two helpers authored disjoint Workouts/Coach and Community changes; a third independent non-author reviewer audited sensitive boundaries. Coordinator inspected actual diffs and reproduced original screen failures. The settled mobile suite passed all2,225 tests across178 files; the telemetry mock was updated for the synchronous seam. The first full gate ran all suites successfully but rejected evidence because concurrent AGENTS/session-guide edits changed fingerprinted inputs. A stable isolated candidate is required below; no new native delivery or device acceptance is implied yet.

## Verification and delivery

The original isolated gate remained pending at the Oct12 handoff. The complete later source passed the [combined Oct14 gate](ALL_LOCAL_SEPARATE_COMMITS_2026-10-14.md), including the cache implementation and current integration repairs. The [Oct14 iPhone build/install](DEV_IPHONE_LOCAL_DELIVERY_2026-10-14.md) used its separately recorded snapshot; signed-in first-render/native acceptance is still open. The isolated scope is exact baseline0135228778059dc25c1a4925738f0b6934ed4f0c plus26 owned mobile files, this evidence document/baseline regression, and only the Oct12 research/status updates. Excluded: pre-existing Oct11 backend/iPhone receipts and concurrent AGENTS/session-guide edits. Current user-supplied instructions still govern execution. Third-party dependencies are reused with workspace imports redirected into the candidate; no new native configuration is required for these TypeScript changes. Final result receipts are post-check records, not tested source inputs. The current backend is the Oct11 source above; these changes are mobile presentation/cache only and require no new backend endpoint or migration. Preserve the pre-existing Oct11 delivery documents/status/research work in the shared tree.

Next exact acceptance: current-candidate cold launch, wait on Home, then first visit to all tabs; restart/offline; account/token change; write/refresh; expired Community permission; light/dark/large text and VoiceOver. Automated first-render assertions are distinct from signed-in native acceptance.

## Oct14

Adam's iPhone showed the "Loading Coach…" spinner and the Community Feed skeleton on tab visits.

**Coach** (`d50e7e59`). The read cache is keyed per token, so a same-user access-token rotation (for example on resume) blanked the history until a network round-trip finished. A refresh of an empty history also flashed the loader.

- Same-user rotation now keeps the displayed history while it revalidates. Readiness and generation actions are re-checked for the new token, and account changes still blank immediately.
- The independent review found a false empty state when the token rotated during an unfinished load. That is fixed and covered by a regression test.
- The three new regression tests fail on the original code.

**Community** (`aa12c2bb`; Adam approved stale-while-revalidate on 2026-10-14 and accepted brief stale visibility for a newly blocked user). The 10s authority lifetime was unchanged, but it had usually expired by the first visit.

- A memory-only, single-user display snapshot of the active membership and the first page now renders read-only while membership and the feed revalidate.
- Share, reactions, comments, details, author links, card options and pagination are disabled while the snapshot is stale.
- The snapshot is cleared on principal change, sign-out, 401/403/session/blocked/ineligible/not-active responses, a membership/feed 503 (the kill switch fails closed), and Community or account writes.
- An Opus helper authored it in an isolated worktree. A non-author Opus review found no cross-user leak; the live author link, kill-switch persistence and stored cursor findings were repaired and then re-reviewed.
- The 7 screen regression tests fail on the original code.

**Gate.** `pnpm check` on `0ee20191` passed (EXIT 0): mobile 214 files/2669 tests, API 1109 passed/15 skipped. Two earlier runs failed on 24 unhandled rejections from leaked Meals polling intervals. The harness was fixed in `0ee20191`, which closes #247.

**Open.** Not pushed or installed. Next: install on the iPhone and accept cold launch, resume after more than one hour, a Coach first visit, a Community first visit after more than 10s, a blocked/withdrawn account, account switch, and VoiceOver.
