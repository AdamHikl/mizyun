# Running Dev delivery — 2026-10-06

Completed manual-running implementation is deployed to Hetzner Dev and installed/launched on the connected iPhone. Physical running UI, accessibility and real offline/restart acceptance remain open. Production was not promoted.

## Scope and provenance

- Running source: `938efc5856642d5974d7cf78d1508ec6d43572fa`, branch `codex/running-dev`, remote SHA independently verified. Initial implementation commit: `2ea23093a4e98699d3b2bed197a01924dbb09922`.
- Isolated managed checkout: `/Users/adam/.codex/worktrees/running-dev/mizyun`, baseline `f40e8941afc5307efce6d5c5909c0146ed1f3dda`. Its source tree is clean. Root concurrent health-preview/export, simulator and Pro multi-photo3984c35 work was preserved and excluded from this candidate. Reconcile shared workout/cache/account-cleanup/Coach-version changes during later main integration.
- [Research and implementation plan](RUNNING_IMPLEMENTATION_PLAN_2026-10-06.md), [ADR-0046](adr/0046-manual-running-authority.md), [issue216](https://github.com/AdamHikl/mizyun/issues/216). User authorized Dev implementation after the plan. The bounded first release implements RUN-01–04 and delivers the RUN-05 Dev candidate; native acceptance and requester discovery remain open. Imports/GPS/routes/programs retain later stages.

## Delivered behavior

Workouts has direct **Log run** with required elapsed minutes/seconds, optional distance in km/miles and calculated average pace. Calendar date is authoritative; date-only entries do not invent an observed start time. Outdoor/treadmill, effort and notes are secondary. History has All/Strength/Running filters, dedicated cards, View/Edit/Delete, pagination and Monday–Sunday totals. Missing distance stays unknown; bounded weekly loading discloses incompleteness.

Encrypted account-bound drafts save before dispatch. Immutable operations survive lost responses; CAS edits, delete/cancel tombstones and strict hydration/identity guards prevent stale resurrection or another account seeing/saving a draft. Notes-only editing preserves exact canonical metres and any observed instant. Running uses its own typed API over the existing workout session table, with owner-scoped receipts and strict database validation. Generic strength writes, sets and Community routine/challenge/publication paths cannot bypass run semantics.

Account exports include complete summaries and minimal private receipts; erasure cascades them and local account cleanup clears drafts. Strength counts/progression and calorie credit exclude runs. Coach has separately labelled bounded running context and app knowledge `mizyun-app-v3` / prompt `coach-system-v3-app-v3`; live provider behavior is not accepted by source tests. No new native permission is introduced.

## Verification and independent review

- Independent High nonauthor source review approved after resolving SQL-null validation, accidental export receipt cleanup, observed-start/imperial precision loss, account-switch hydration/autosave/dialog leaks and stale first-render records. Settled initial62-file digest: `e262ea9ece77286190ecf592f15c04a1a58fe47fe2d7e9525238cf1b8653298c`.
- Initial final focused suites238 passed: contracts13/core38/adapter27/API36/mobile124. Initial local disposable `pnpm db:verify`:33 SQL files/893 assertions passed, migrations through20261006120000 and lint clean. No Hetzner/Pi reset was used.
- The live stale-edit probe exposed PostgREST retries of domain SQLSTATE40001. Forward migration20261006183000 changes only the four run_create/update/cancel conflict branches toPT409; signatures, owner/grants, receipts/CAS/tombstones are preserved. Independently reviewed exact-function equivalence approved. [Official Supabase guidance](https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b), [PostgREST custom errors](https://docs.postgrest.org/en/stable/references/errors.html), checked2026-10-06.
- Repair adapter7 tests, current41-assertion SQL suite passed, including cancel-on-edit conflict. [SQL output](evidence/running-dev-2026-10-06/conflict-sql.log). Actual simultaneous local transactions passed create/cancel in both lock orders and two-device CAS: exactly one edit accepted, no resurrection; synthetic local account/receipts removed.
- Final source `pnpm check` PASS input SHA256 `42676772a7599bebfef4c2410c36d61a9980a75d2fd80dcd6c836d578b061f65`. Canonical deployment reran full check on committed938efc5: PASS input SHA256 `e3c3a639dfe9111a12dfcbf5b5c51fc34ab6142735aa9f0a58627420596c8036`. Mobile1526/API860/adapter161 passed;15 existing API integration skips and3 config bundle-path skips (#179) remain unrun. Both actual platform exports, formatting/types, navigation117, offline AI and operational/build safeguards passed. No external provider calls occurred.

## Exact Dev acceptance

Canonical `pnpm deploy:dev 938efc5856642d5974d7cf78d1508ec6d43572fa` succeeded at2026-10-06T18:18:30Z. Narrow operator verification confirmed pristine exact checkout `/var/lib/mizyun/dev/repo`, service `mizyun-api-dev.service` active/running MainPID3291091, API4100/DB5433 and both migrations20261006120000/20261006183000 recorded. Public Dev health returned200.

[Public authenticated probe](evidence/running-dev-2026-10-06/public-api.json), PASS2026-10-06T18:19:01Z:

- Anonymous reads401; another account cannot get/edit/list the owner's run.
- Duration-only90-minute create and exact replay use one record; keyset pagination returns each run once.
- Legacy strength listing excludes runs; generic update rejects them.
- Accepted edit and lost-response replay preserve revision; stale edit and cancelling an edit operation return409 promptly.
- Account export contains the full edited summary and private receipts.
- Repeated deletion and delayed-create replay cannot resurrect a run; cancel-before-create tombstone works.
- Both probe Auth accounts deleted through the account lifecycle API. The four earlier probe accounts were also removed through the same API.

Initial harness mistakes (PATCH instead of PUT; JSON header on a bodyless POST) were corrected without feature changes. The existing global error handler maps that parser error to500; [separate issue220](https://github.com/AdamHikl/mizyun/issues/220) tracks it. No synthetic account is intentionally retained.

## iPhone delivery

`pnpm mobile:install:ios:dev --device 00008140-001114501A86801C` built standalone Release, installed2026-10-06T18:06:35Z. Initial launch was blocked by the locked phone; after unlock, explicit launch succeeded and independent process inventory confirmed PID9578. iPhone16Pro, iOS27.0(24A437), bundle `com.mizyun.development`, version1.0.9(9), teamLQJNDVBL43. Dev endpoint preflight passed; no Metro listener was present before installation.

Artifact: `/Users/adam/.codex/worktrees/running-dev/mizyun/apps/mobile/ios/build/Build/Products/Release-iphoneos/MizyunDev.app`. Binary source2ea23093; repair938efc5 changes only server adapter, SQL/tests and research/evidence, with no mobile/core/contracts/API-client delta, so the installed client is compatible. Host `codesign --verify --deep --strict` passed with signing-store access; CDHash `2ded00059c9363983d60eb6a01fcef899f92140b`.

Installation, signing and a running process do not prove signed-in native run interactions.

## Next exact action and open gates

On the installed iPhone open Workouts → Log run. Accept a30-minute5km run and a duration-only run; find/edit/delete them and inspect Running/Strength filters and weekly totals. Check decimal miles precision, a90-minute duration, date/keyboard/Back/draft restoration, offline/restart/retry and account switching, narrow/large text, themes and VoiceOver. Repeat on Android with its own exact installation. Coach/provider acceptance remains consent-gated and separate. Requester interviews/prototype targets remain unmeasured.

Issue216 stays active. Imports require reconciling the concurrent health integration owner and real native data samples. GPS requires the demand/native reliability/battery spike. Main integration must preserve concurrent changes and run a new combined gate. Production/Store actions need their explicit release scope; none occurred here.
