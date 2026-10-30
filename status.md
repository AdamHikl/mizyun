# Mizyun status

> Updated 2026-10-30 (Claude Code). [History][handoffs]; historical actions are not instructions. [Earlier detail](docs/archive/status/STATUS_PRE_WORKOUT_COMPANIONS_2026-10-09.md).

## Current authority and delivery

- **Oct8 ten/main:**10closed per Adam/pushed; gates/SQL/replay PASS. [Proof](docs/MAIN_DEV_DELIVERY_2026-10-08.md). Native/provider/release open.

- **GTM (Oct26–27):** [plan](docs/GO_TO_MARKET_PLAN_2026-10-26.md) adopted. #332–#336 merged on main Oct27: billing ADR0080, AI cost ADR0081, share card ADR0082, import ADR0083, activation ADR0084; migrations 20261026140000/150000/160000. ece07bd3 gatePASS(3818mobile/1442API+15skips); db:verify unrun. Pushed; Dev b06e3700 Oct27 17:02Z, 3 migrations, health200. iPhone Dev b46c6e2f Release 1.0.10(10) launched 17:10Z PID2508; acceptance open. Next: Adam Store products/webhook, device acceptance. [Entries](docs/archive/status/STATUS_GTM_PACKAGES_2026-10-27.md)
- **Review fixes (Oct27–28):** 17 high findings fixed in 12 branches, merged 081724f3; main 45e8d8ea pushed + Dev Oct29 07:29Z health200 (5 migrations applied): AI-01/L10N-01 Coach safety, AI-02/06 Coach messages ADR0087, TNS-01/PRIV-03 Community Prod maintenance ADR0086, PRIV-01/02 health consent+18+ ADR0088, OPS-01 alerts (ADR0085 draft), REL-01 TZ, REL-02 sets #290/#291, SEC-02 quota, A11Y-01/02, HLTH-01/03, DROID-03; migrations 20261027120000/120100/120200/120300/130000. gatePASS(3911mobile/1496API+15skips); db:verify PASS(61 files/2002). iPhone Release 07:35Z PID9461; Adam OK: consent, TZ, VoiceOver, Coach limit. Oct29 Adam accepted #345 (closed), legal drafts, ADR0085, cache pricing (#347 on claude/keen-liskov-965ff7 51568f30, unmerged). #346 offline Workouts be59ac97 (2 Opus reviews). Oct30 main 9f621ebd (incl. docs cleanup) gatePASS 3936/1496+15, pushed, Dev 12:17Z health200, iPhone installed 12:14Z (locked, no launch); Android Dev be59ac97 LYA-L29 (Android 10) 11:49Z PID20932. Oct30 Adam: OPS-01 setup deferred to real users (#349). Next: Adam Android keyboard/TalkBack, #346 retest, #348, AAB rebuild. [Handoff](docs/REVIEW_FIXES_MERGE_2026-10-28.md)
- **Issues:** #21/#23/#25/#26/#31 partial/gatePASS. #117/#118 done; gatePASS; Adam tests Dev/native. [Evidence](docs/MEAL_ISSUES_117_118_EVIDENCE_2026-10-08.md).

- **Build9 / #212 (#27/#32):** source`dd5b435385b379d8c0df1b69813f8d8fdd3d985a`,1.0.9/9/9; IPA/widget/dSYMs/AAB/upload cert/16KB LOAD/full gatesPASS. [Artifacts/evidence](docs/BUILD_9_RELEASE_EVIDENCE_2026-10-05.md). iPhone16Pro installed/launched1.0.9(9) PID6828; native/16KB runtime/Store exits open.
- **Dev (Oct21):** 70adb7cc (ADR0078 release) deploy:dev OK 17:18Z, migration 20261021120000, health200; revocation key added.
- **iPhone Dev (Oct18):** f388c722 Release installed/launched 11:10Z on 00008140-001114501A86801C; acceptance open. Xcode27.1 fix: patched expo-modules-jsi@57.1.0 + `with-ios-source-built-expo-modules`; drop at SDK58. #287 flaky core test.
- **Production (Oct23):** b2b1591c promoted 19:09Z (deploy backup, no migrations, health200); Prod Anthropic key rotated to Dev's new key (`production.env.bak-20261023T190033Z-anthropic-key`, models200). DB `community_operations` was closed since 0930 (join 404) → opened all users, delivery off (Adam). Join copy fix bdbd15d7; Adam Community PASS. Store 1.0.10(10) bdbd15d7: xcarchive (Organizer export by Adam) + signed AAB (cert match); uploads open; name/initials copy fix Dev-only. Oct21 70adb7cc env/flags retained. [Evidence](docs/PRODUCTION_RELEASE_2026-10-23.md)
- **Legal/Store (Oct21-22):** moderator adoh811 (no MFA yet); website 7a86144 live (Oct25 redesign, Worker 04773c31); optional Community features off. AAB 1.0.10(10) af11f072 signed (cert match). IPA archive kept; CLI export lacks Xcode account, Adam exports via Organizer. #319
- **AI (ADR0077/0078):** Anthropic only for features the stored consent names (Coach, typed meals/draft changes, Log activity); 2026-09-08 consent and all other features on Gemini3.8. `ANTHROPIC_ENABLED` acknowledgement; build-9 shapes for requests without `x-mizyun-api-compat`. Signed-in AI checks open; Qwen paused.

## Running and usability acceptance

**#216 running:** RUN-01–05 Dev; native/GPS open. RUN-06 Health run imports + Log run shortcuts (ADR0065, migration20261016120000): 2 reviews/gatePASS; db:verify/device open. [Evidence](docs/RUN_IMPORTS_EVIDENCE_2026-10-16.md). #210–#214/#207 exits: [detail](docs/COMMUNITY_MEAL_SHARING_EVIDENCE_2026-10-12.md#preserved-prior-runningusability-handoff).

**Next retained release checks:** version9 native workout journeys, physical/accessibility acceptance, then Adam's manual IPA/AAB upload. #27/#32 Store exits open; Community prior closure does not accept this new meal extension. Photos/App Preview remain Dev-only.

## Local follow-ups awaiting acceptance

- **#265/#324, Oct23 overnight fixes, #321/#322/#323, #326 Home flash, #320 join, #298/#325 stretch (Oct22–23):** Dev/iPhone; Adam device exits open. [Moved entries](docs/archive/status/STATUS_OCT22_23_FOLLOWUPS_2026-10-28.md)
- **#327/#329 offline cache (Oct23):** targeted invalidation, keep across background/token, shared weight read, 30min goals, API ETag/304 + no-store. Budget resume 19→2, meal write 20→7, cold 19→17. Reviewed; gatePASS(3707mobile/1377API+15skips/88client). 7c58761d; Dev 20806d8d 17:40Z health200, no-store+ETag live; iPhone 17:41Z; Adam device checks PASS (Oct23). Prod not released. Visuals 20s poll kept (ADR-0053, Adam). #328/#330. [P1](docs/OFFLINE_CACHE_PHASE1_2026-10-23.md) [P2](docs/OFFLINE_CACHE_PHASE2_2026-10-23.md)
- **#331 offline meal icons (Oct23):** ADR-0053 amended per Adam: bundled icons stay up to 48h after last Pro check when unreachable (incl. Auth refresh failure); denial hides now. Opus review + fixes; gatePASS(3723mobile/1377API). 6e86ea3c; iPhone 18:53Z; Adam offline check PASS (Oct23). [Handoff](docs/OFFLINE_MEAL_ICONS_2026-10-23.md)
- **#303, #314:** iPhone/Android device exits open. [Moved entries](docs/archive/status/STATUS_OCT12_15_ENTRIES_2026-10-23.md)
- **#290, #295/#297, #307/#313:** device exits open. [Moved entries](docs/archive/status/STATUS_OCT12_15_ENTRIES_2026-10-23.md)
- **#288/#299/#304 Log activity:** #288 gatePASS, Dev 47c814e5 ([evidence](docs/LOG_ACTIVITY_DRAFTING_EVIDENCE_2026-10-17.md)). #299 ADR0073 Gemini drafts; gatePASS; Dev 4/4 ([evidence](docs/LOG_ACTIVITY_AI_DRAFTS_EVIDENCE_2026-10-19.md)); iPhone 10:23Z. #300/#302 fixed, #301. #304 ADR0074 on-device, Haiku fallback on failure (Oct21), notes removed; Dev. Next: Adam iPhone; #304 latency+gate; #305/#306.
- **#292/#293, #278/#279, #308 (Oct17–19):** Dev; iPhone/device exits open. [Moved entries](docs/archive/status/STATUS_OCT17_ENTRIES_2026-10-26.md)
- **#276 bouldering:** BLD-00–06 641549ed; gate/db:verify/3 reviews PASS; Dev 45f1ccfe; device/share open. [Evidence](docs/BOULDERING_EVIDENCE_2026-10-16.md). Grade-row sends (Oct22): gatePASS; Dev+iPhone 4645debe; device open ([handoff](docs/BOULDER_GRADES_2026-10-22.md)).
- **#208/#248/Community audit (Oct9–15):** device/native exits open. [Moved entries](docs/archive/status/STATUS_OCT9_15_ENTRIES_2026-10-22.md)
- **#253–#257, #238:** device/native/Prod exits open. [Moved entries](docs/archive/status/STATUS_OCT12_15_ENTRIES_2026-10-23.md)
- **#244/#239/#237/#234/#235/#182/#232/#230/#233 (Oct9–14):** native/device/provider/release exits open. #139/#168/#169 [archived](docs/archive/status/STATUS_CLOSED_RETAINED_EXITS_2026-10-17.md). [Moved entries](docs/archive/status/STATUS_OCT9_14_FOLLOWUPS_2026-10-19.md)
- **#218/#225/#217 meal photos:** Dev; native/provider/AX exits open; Prod disabled. [Moved entries](docs/archive/status/STATUS_MEAL_PHOTO_PACKAGES_2026-10-18.md)
- **Usability #206/#202/#203/#208/#204/#205/#200/#182/#201/#197/#194/#196/#136:** impl/native/provider/release/combined exits open: [prior status](docs/archive/status/STATUS_PRE_MEAL_PHOTO_DELIVERY_2026-10-06.md).

## Earlier implemented packages with open exits

- **#183 recurring:** Dev SQL; tick/reopen/totals, edit/delete/pause/resume/skip/stop; TZ/DST/network/two-account open. [Evidence](docs/RECURRING_MEALS_PLAN_2026-10-03.md). **#242:** copy fix in main283bf05. [Fix](docs/MEAL_ROUTINE_COPY_REFRESH_2026-10-14.md); client/native next. **#252:** any-time fix Dev37ffcca9; device check open.
- **#184/#185/#188/#190/#222/#223/#226:** integrated/Dev; device acceptance exits open. [Moved entries](docs/archive/status/STATUS_EARLIER_PACKAGES_2026-10-17.md)
- **#186/#192, #187:** exits open. [Moved entries](docs/archive/status/STATUS_ANALYTICS_ONE_TIME_WORKOUTS_2026-10-23.md)
- **#189/#191 catalog:**609active/888original IDs; historical gatePASS. All609 need per-entry form/variant acceptance;3duplicate pairs/swimming/cycling gaps remain. Next: search/readability/history/targets/restart;200-record saved pagination deferred#191. [Evidence](docs/evidence/exercise-catalog/verification-2026-10-04.md).
- **#178/#179:** #178 closed per Adam (Oct8); device/#29 live checks unrun; #179 skip defect/scans retained. [AI](docs/AI_ADVANCED_NUTRIENTS_EVIDENCE_2026-10-02.md). **#227 Home closed per Adam (Oct8):** refs/cards/bars gatePASS; native checks unrun. [Home](docs/HOME_NUTRIENT_LABEL_REFERENCES_2026-10-08.md).
- **#170/#171–176:** [plans](docs/PROACTIVE_COACH_PLAN_2026-10-02.md); PC-01 first, no rollout. **#241:** Dev recipesON; UI fix in main283bf05; rebuild/native next. [UI/REC06](docs/RECIPE_UI_EVIDENCE_2026-10-14.md); live/qualified open. Oct15 [fixes](docs/MEAL_PLANNING_RECIPES_AUDIT_EVIDENCE_2026-10-15.md) 3513d0d8 gatePASS; Dev/device open.
- **#198/#215/#219 Health** — Dev preview/selected exports; isolated full gatePASS. [Evidence](docs/HEALTH_EXPORT_EVIDENCE_2026-10-06.md). Native/device/privacy gates open; Production disabled. Next: both-phone write/read-back; INT-03 separate.

## Community and release gates retained

**#224 closed per Adam (Oct8):** UI01–07/iPhone refinements7d5c9d0 Dev/iPhone9; independent review/full gatePASS(1754mobile/892API+15skips), exports/prior904SQL+concurrencyPASS. [Evidence](docs/COMMUNITY_UI_REDESIGN_EVIDENCE_2026-10-07.md). Native/pilot/release exits open.

Community #137/#140/#148/#150–151/#153–156/#158–162 open. [Oct8 gates/actions](docs/COMMUNITY_REMAINING_ISSUES_2026-10-08.md). Custody/retention/Storage erasure open; restore closed; archive transfer unauthorized.

**Oct10–11:** #142–147/#149/#152/#166–169 CLOSED; iOS accepted/no physical repeat;Android skipped. Cursorb60bf9b:39SQL/89focused/review/gatePASS; undeployed, approval/livecodec#137; externalpushOFF. [Exact source](docs/evidence/community-simulators-2026-10-10/feed-reactions-inbox-closure-2026-10-11.md); #144 proof in same directory.

**#150/#151/#156:** 33-category export/privacy6db9130; review/SQL/adapter/replay/gatePASS (counts in proof). Native consent/candidates/reportPASS; replyCONTROL-BLOCKED. [Proof/inputs](docs/evidence/community-simulators-2026-10-10/mobile-lifecycle-comments-2026-10-11.md). Migration undeployed; nextDevapproval/preflightPASS; VoiceOver/offline/Android/operator/custody/retention/archive unrun.

Retained exits: unrun offline/accessibility; trained named MFA moderation/contact/absence drills; provider/device push; legal/public/Store disclosures; adult research/four-week pilot. [Expansion proof](docs/COMMUNITY_EXPANSIONS_DEV_EVIDENCE_2026-10-01.md). Isolation unverified after shared-cloudflared freeze/mixed networks.

Q1–Q9: [remediation plan](docs/REMEDIATION_IMPLEMENTATION_PLAN_2026-09-08.md) and [evidence checklist](docs/REMEDIATION_EVIDENCE_CHECKLIST.md) define closure. Build7 backend/build6 core device accepted above; signed packages verified. Exact build7/native, restore, provider/lifecycle and Store exits remain open. Future promotion requires fresh exact-SHA backup/migration checks.

[handoffs]: docs/archive/status/STATUS_PRE_AGENT_WORKFLOW_2026-10-04.md

**#157 CLOSED/#158/#161 OPEN:**9dbf7b4; iOS/189SQL/28focused/reviewPASS; gate2059mobile/980API+15/3skips. [Proof](docs/evidence/community-simulators-2026-10-10/spaces-challenges-routines-2026-10-11.md). #158 realpilot/safety/AX;#161 Android/retry/retained-view. Restored;Dev2596;integrated above.
