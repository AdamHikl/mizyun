# Indoor bouldering evidence (BOULDER-001/#276) — 2026-10-16

Claude Code implemented every stage of the [plan](BOULDERING_IMPLEMENTATION_PLAN_2026-10-16.md) at source level on branch `worktree-bridge-cse_018Ygr4LHdqMb1XUUaMc7i8W` (base `79e8e75c`). Nothing is pushed, deployed, built natively or installed.

## Commits

| Stage  | Commit                 | Content                                                                                                                                  |
| ------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| BLD-00 | `1a7c2d42`             | [ADR-0066](adr/0066-indoor-bouldering-sessions.md), BOULDER-01–05, sketches                                                              |
| BLD-01 | `4af310c2`             | Font scale, calculations, contracts, port                                                                                                |
| BLD-02 | `c9014780`             | Migration `20261016140000`, RLS/RPCs/guards, `/v1/bouldering`, export/erasure, strength exclusion                                        |
| BLD-03 | `68fe626c`             | Mobile logging, durable pending commands, photo, summary                                                                                 |
| BLD-04 | `94206c73`, `2d95a404` | Projects migration `20261016160000`, progress/projects UI; Coach route owner fix                                                         |
| BLD-05 | `c872098e`             | Community card migration `20261016180000`, [ADR-0067](adr/0067-explicit-community-bouldering-publication.md), share UI, kind negotiation |
| BLD-06 | `641549ed`             | Challenge days migration `20261016200000`, picker; photo-on-card deferred                                                                |

## Verification on `641549ed`

- `pnpm check` (isolated worktree at the exact commit): **PASS**, input SHA-256 `1bf55d95503cc2046d4573bc648e759fdbaa98ae31ffaf2f425c3a39ffc84d08`; mobile 3046 passed, API 1183 passed/15 skipped, bundle check passed. A concurrent run beside `db:verify` was rejected as stale and not counted.
- `pnpm db:verify` (disposable local Mac database, same worktree): reset, lint and 52 pgTAP files / 1686 tests **PASS**, including `0048` (80), `0049` (50), `0050` (75), `0051` (14). The shared local database is left at migration `20261016200000`.
- Independent non-author Opus reviews: BLD-02 (no blocker; Dev flag, removed-session 410 and boundary tests fixed), BLD-04 server (no blocker; ADR semantics, live-project erasure test, `BOULDER_PROJECT_UNAVAILABLE` fixed), BLD-05 server (no privacy blocker; installed-client kind negotiation and publish lock order fixed). Mobile diffs were reviewed by the coordinator, not by an independent agent.

## Open exits

- Adam's review of the ADR-0066 layout sketches and the deviations recorded in ADR-0066/0067.
- iOS simulator journey (start → 5 boulders, one with photo → kill → resume → finish → summary; progress after three sessions) with light/dark, largest text and VoiceOver; paired-simulator share journey; Android.
- Dev deployment (`MIZYUN_ENVIRONMENT=dev` enables the API; Production stays off) together with a Dev build, then Adam's iPhone acceptance. Installed builds without `x-mizyun-activity-kinds` do not see bouldering cards.
- Photo on shared cards needs a new ADR and Adam's decision.
