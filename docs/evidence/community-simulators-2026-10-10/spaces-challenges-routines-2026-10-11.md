# Groups, challenges and routines — October 11, 2026

Selected issues: #157 (COMM-18), #158 (COMM-19), #161 (COMM-22). Adam accepts passed iOS simulator actions without physical repetition; Android remains explicitly skipped. This packet does not admit a wider cohort or release Production.

## Candidate and environment

Isolated candidate baseline `6db9130d26705506f96696f6027d77c6ff3e9632`; current package adds the previously native-fixed challenge screen/15 regressions, one routine notice fix/regression and two scratch SQL suites. The primary checkout contains concurrent startup/Coach/meals/native work excluded from the isolated gate. No unrelated source was staged or reset.

Dev backend remains `2596a69b3fe4d20920a173de91fb4dc533b9bd4a`, migrations through `20261009150000`. No push, backend deployment, Production, flag or credential changes this package. Existing undeployed export/privacy capture remains tracked in [prior packet](mobile-lifecycle-comments-2026-10-11.md).

One signed Debug `MizyunDev.app` reused from `/private/tmp/mizyun-comm-ios-20261010/Build/Products/Debug-iphonesimulator/MizyunDev.app`: `com.mizyun.development`, 1.0.9(9), iOS26.5. Native compatibility: 58 exact saved hashes; app.config reproduces the 59th after removing only two new Android-only plugin lines; inventory adds exactly those two Android source plugins plus generated Android build output, removes nothing. No iOS native input changed. One owned Metro8085/session30934 served fresh bundles and the routine fix.

A retained on ProMax `74C55221-5CFB-434F-BE42-492349429896`; B on Pro `F4939E5D-BA85-4479-AA1E-92B21441FB8C`. Native Home greetings and refreshed inspector UUIDs matched before actions. Both accounts Community-active. No login/account switching or private-source editing.

Controller Medium worker creation was unavailable (agent thread limit); coordinator performed serialized CUA input and does not claim verified Medium controller effort. Explicit GPT-6.1 Sol High non-author audit/review was used for permission/lifecycle boundaries. Its writes were confined to the two scratch tests; no helper remote mutations.

## Fresh native acceptance

Normal own-auth Dev APIs prepared only fictional prerequisites: B→A approved follow, new “Synthetic October11 group”, pre/post-join text, one cooperative challenge with B rest day, one exact allowlisted routine share. API preparation is not native Create/Join/Publish acceptance. Earlier native owner transfer/create/invite/join/import/source-edit passes are reused from [dated inventory](simulator-results-approved-2026-10-11.md), [controller record](controller-continuation.md) and `native-continuation-summary.json`.

| Issue | Actor/action                                                    | Actual result                                                                                                                                                             |
| ----- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #157  | B fresh group read                                              | PASS: current A/B posts visible; pre-join A text absent.                                                                                                                  |
| #157  | B Report group → Other → Submit                                 | PASS: native “Report submitted.”; own API corroborates exactly one case. Optional notes stayed blank.                                                                     |
| #157  | A Make moderator; B fresh members                               | PASS: B moderator, A owner; B cannot remove/promote owner.                                                                                                                |
| #157  | B moderator removes exact A fictional current post              | PASS: confirmation executed after Adam approved; A post absent, B post retained.                                                                                          |
| #157  | A Make member → Remove member; B fresh read                     | PASS: group title/posts/admin controls hidden; only private-group removal/appeal shell remains.                                                                           |
| #157  | Fresh-code B request/A approval prerequisite, then B fresh read | PASS history/authority: ordinary member, no moderator controls, “No posts are visible in your current membership.” This rejoin was API setup, not a new native Join pass. |
| #157  | B Leave group → Confirm                                         | PASS: group content revoked.                                                                                                                                              |
| #157  | A Disband only new group → Confirm → fresh all-groups           | PASS: new group absent; older “Synthetic simulator circle” retained. Both own API group reads404.                                                                         |
| #158  | B current challenge                                             | PASS: explicit rest day and one declared day; workout/rest alternatives labeled. No automatic private diary ingestion.                                                    |
| #158  | B Leave and remove my declarations → Manage my challenges       | PASS: no longer joined, declared/shared days not declared; new challenge absent from joined list; own getMine404. Private routines unchanged.                             |
| #161  | B exact routine preview                                         | PASS: version1; Barbell Back Squat1×8–8,10kg/rest60s; independent-copy explanation. Existing copy/import/source-edit proofs reused without reimporting.                   |
| #161  | B Report unsafe routine → Other → Submit                        | PASS: native Report Submitted with receipt, confidential-staff handling and no automatic sanction copy; own API exactly one case.                                         |
| #161  | Exact task share withdrawn through own API; B refresh           | PASS fresh empty list + own exact detail404; retained B private copy intact. Already-expired screen does not establish immediate retained-screen revocation.              |
| #161  | Expired access hint → successful empty refresh                  | Reproduced UI defect, fixed and native PASS: old “Refresh shared routines to check current access.” disappears, empty state remains and old import control absent.        |

Control recovery was finite: expanded navigation no progress, one compact-window recovery succeeded; warning dismissal exposed tabs. AX controls may alternate button/element/link and async results need a fresh read before selection. Five-step routine report completed in8.67s within the existing ten-second lease; no guard was weakened. No report was submitted by an API helper.

No new permission/RLS defect was found. Group appeal submission and real staff disposition were not exercised; scope remains in #148. Passed group report/moderation/leave plus existing SQL and owner transfer satisfy #157's selected feature exits, without wider expansion admission.

## Source and automatic proof

`CommunityRoutinesScreen` clears only the exact expired-read notice after accepted successful page/deadline/account/lifecycle guards. It preserves success notices and authorization timers. Non-author High review found no issue. The integration regression first failed at the reproduced stale-message assertion, then passed; native refresh verified the fix.

Challenge overlay carries prior native fixes: hide unavailable group totals, native Text nesting, live AbortSignal workout choices and stale authority/confirmation retirement. Independent review clear. Its cache regression was adapted to the candidate's real memory cache by seeding an empty normal display read and proving a fresh signal-bound raw read; no unrelated persistent-cache implementation was imported.

Fresh focused mobile command: `pnpm --filter @mizyun/mobile test src/features/community/routines/screen.test.tsx src/features/community/challenges/privacy-flow.test.tsx`: **28 PASS (13 routines,15 challenge)**. One initial cache test timed out because the isolated baseline lacks the concurrent persistence constructor; its test fixture was corrected, then the entire two-file focused suite passed.

Fresh scratch command: `python3 scripts/verify-community-local-db.py --logs /private/tmp/mizyun-spaces-routines-db-20261011 --test 0044_community_challenge_time_source.test.sql --test 0045_community_routine_projection_refusal.test.sql --test 0026_community_groups.test.sql --test 0027_community_routines.test.sql --test 0031_community_challenges.test.sql --skip-concurrency`: **189 assertions/5 files PASS** (72groups/30routines/33challenges +24time/source +30projection). New tests cover real authenticated SQL late-sync7-day acceptance/8-day and prejoin refusal, duplicate replacement, timezone/DST, still-completed edit invalidation/redeclaration and unsafe/bad target/reference/forged snapshot refusal. Disposable schema-only scratch rolled back/removed; no shared user data copied. Unchanged concurrency suites skipped intentionally. [Bound receipt](spaces-routines-sql-summary-2026-10-11.json).

Final full gate runs only after owned edits/review/native writes settle; log `/private/tmp/mizyun-spaces-routines-full-final-20261011.log`. Provider integration remains credential-gated; do not count skips as passes.

## Exact closure boundaries

- **#157:** selected group implementation/direct-RLS/native report/moderation/leave exits accepted; no physical repetition. Wider rollout/staff operations stay disabled or tracked separately in #148/#155.
- **#158 OPEN:** automatic edge proof and synthetic native rest/departure accepted. Adam explicitly has no real safety/accessibility review or consenting-group pilot to cite. Needed: a named reviewer and recorded safety/accessibility findings, then one consenting real group pilot with benefit/pressure/leave/rest findings and an explicit expansion go/no-go. Simulator accounts cannot satisfy that original gate.
- **#161 OPEN:** iOS preview/import/source independence/report/revocation accepted; Android import/report/reference/retry UX never run because Adam explicitly skipped Android. Immediate retained-screen revocation and native duplicate-retry UX remain unrun. Needed: resume Android after working keyboard/control, or explicitly change the issue's both-platform acceptance scope; execute missing retry/retained-screen subset. No repeat of passed iOS actions requested.

## Restoration and next resume

New share revoked, new group disbanded natively, exact task follow removed. Both Community-active; five relationship/block counts returned to `[0,0,0,0,0]`; A's private source and B's pre-existing private routine IDs unchanged. Original circle retained. Reports remain fictional Dev moderation cases; no real user was sanctioned. Setup guard/404/422 failures stopped before the affected mutations and were corrected against current contracts, never recorded as app defects.

Accounts retained. A known all-groups route, B known empty-routines route; no draft, keyboard captureOFF. Owned Metro stopped; only task-booted A shut down, initially booted B retained. Next reuse validates UUID/session/Dev availability once and does not rebuild/relogin/reimport automatically.

## Independent challenge safety/accessibility review

GPT-6.1 Sol High non-author source review PASS: strict workout/rest-only commands, explicit confirmation,42-day bounded duration/current-local-day/start limits/achievable goals; equal one-day rest credit; duplicate replacement; missing-as-null, source-version invalidation and deletion cleanup; owned post-opt-in sources and group/withdrawal removal without editing private logs. No body/calorie/ranking/prize/payment/automatic Health import. Labeled rest/workout/join/leave controls, roles/disabled states,48-height controls, wrapping/scrolling/keyboard avoidance inspected. This is completed engineering review, not professional certification or real screen-reader/pilot acceptance. Native labeled alternatives and departure passed. Actual VoiceOver/TalkBack, maximum fonts/contrast and slower assisted completion within the existing ten-second lease remain unverified. Adam confirmed there is no real consenting-group pilot or external review to cite. Next external step for #158: consenting-group pilot with recorded safety/accessibility/benefit/pressure/leave/rest findings and expansion decision.

Reviewed sources: `packages/contracts/src/community-challenges.ts`, `packages/core/src/community-challenges.ts`, `supabase/migrations/20261001205000_community_challenges.sql`, challenge screen, expansions form and shared Community UI. Official [React Native0.86 Text](https://reactnative.dev/docs/0.86/text) documentation complements the accessibility reference in the research log.

## Final source/gate and issue outcomes

Local source commit `9dbf7b4c0f6be43d13c4ff3bffd795f9adbeaf37`, branch `codex/community-spaces-routines-20261011`, preserved as a primary-repository local ref. Isolated working tree clean. No push/deployment. Full `pnpm check` PASS on source/proof snapshot inputSHA-256 `891b3e05be0892a0d1c30a5351ccb7af29405e3cdb4c85eef3b44a5b0602a7df`:2059mobile/980API;15credential-gated E2E/3existing config skips; typechecks, dual bundles, navigation/format/module and deployment/native tooling safeguards PASS. Root-only final continuity/results and safety-review supplement were recorded after the immutable source gate; concurrent primary changes were excluded.

#157 original feature acceptance complete and closed per Adam's passed-simulator acceptance. #158/#161 retain explicit original external/unrun exits and were updated with exact current proof and inputs. Final setup reads: both group details404; own challenge getMine404; revoked share detail404; exactly one group/routine synthetic report each. Five graph/block counts `[0,0,0,0,0]`, private routines unchanged. AShutdown/BBooted verified after cleanup.
