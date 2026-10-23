# Mizyun status

> Updated 2026-10-23 (Claude Code). [History][handoffs]; historical actions are not instructions. [Earlier detail](docs/archive/status/STATUS_PRE_WORKOUT_COMPANIONS_2026-10-09.md).

## Current authority and delivery

- **Oct8 ten/main:**10closed per Adam/pushed; gates/SQL/replay PASS. [Proof](docs/MAIN_DEV_DELIVERY_2026-10-08.md). Native/provider/release open.

- **Issues:** #21/#23/#25/#26/#31 partial/gatePASS. #117/#118 done; gatePASS; Adam tests Dev/native. [Evidence](docs/MEAL_ISSUES_117_118_EVIDENCE_2026-10-08.md).

- **Claude Code (Oct14):** replaces Codex; #203/#241/#242, Workouts key/gate-symlink fixes (main283bf05); gatePASS(2612mobile/1109API+15skips), reviewed.
- **Build9 / #212 (#27/#32):** source`dd5b435385b379d8c0df1b69813f8d8fdd3d985a`,1.0.9/9/9; IPA/widget/dSYMs/AAB/upload cert/16KB LOAD/full gatesPASS. [Artifacts/evidence](docs/BUILD_9_RELEASE_EVIDENCE_2026-10-05.md). iPhone16Pro installed/launched1.0.9(9) PID6828; native/16KB runtime/Store exits open.
- **Dev (Oct21):** 70adb7cc (ADR0078 release) deploy:dev OK 17:18Z, migration 20261021120000, health200; revocation key added.
- **iPhone Dev (Oct18):** f388c722 Release installed/launched 11:10Z on 00008140-001114501A86801C; acceptance open. Xcode27.1 fix: patched expo-modules-jsi@57.1.0 + `with-ios-source-built-expo-modules`; drop at SDK58. #287 flaky core test.
- **Production (Oct21, ADR0078):** 70adb7cc promoted 17:39Z; deploy backup OK; 24 migrations through 20261021120000; health200. Env (bak-20261021T174040Z-release): Community (all users), bouldering, AI stretch, run imports, meal photos, recipes, Haiku for Coach/typed meals/activity (consent-gated per feature), Apple revocation. iPhone 1.0.10(10) Release installed 17:31Z. Adam skipped device tests; moderator unset; Store labels/ToS open (#319). [Evidence](docs/PRODUCTION_RELEASE_2026-10-21.md)
- **Legal/Store (Oct21-22):** moderator adoh811 (no MFA yet); website a7742b0 live; optional Community features off. AAB 1.0.10(10) af11f072 signed (cert match). IPA archive kept; CLI export lacks Xcode account, Adam exports via Organizer. #319
- **AI (ADR0077/0078):** Anthropic only for features the stored consent names (Coach, typed meals/draft changes, Log activity); 2026-09-08 consent and all other features on Gemini3.8. `ANTHROPIC_ENABLED` acknowledgement; build-9 shapes for requests without `x-mizyun-api-compat`. Signed-in AI checks open; Qwen paused.

## Running and usability acceptance

**#216 running:** RUN-01–05 Dev; native/GPS open. RUN-06 Health run imports + Log run shortcuts (ADR0065, migration20261016120000): 2 reviews/gatePASS; db:verify/device open. [Evidence](docs/RUN_IMPORTS_EVIDENCE_2026-10-16.md). #210–#214/#207 exits: [detail](docs/COMMUNITY_MEAL_SHARING_EVIDENCE_2026-10-12.md#preserved-prior-runningusability-handoff).

**Next retained release checks:** version9 native workout journeys, physical/accessibility acceptance, then Adam's manual IPA/AAB upload. #27/#32 Store exits open; Community prior closure does not accept this new meal extension. Photos/App Preview remain Dev-only.

## Local follow-ups awaiting acceptance

- **#265 Community lifetime (Oct23):** own previews no deadline; others 60s+renewal (Adam). ca9a0955 3 reviews, gatePASS(3656mobile/1365API+15skips); Dev 13:24Z health200; iPhone 13:56Z PID85043. Next: Adam device. #324. [Handoff](docs/COMMUNITY_READ_LIFETIME_2026-10-23.md)
- **Overnight fixes (Oct23):** #316/#310/#317/#284/#285/#286/#315/#301/#320/#318/#245 Dev 8823fa47 08:20Z health200 (AGENT_PROVIDER=gemini); gatePASS(3614mobile/1365API). iPhone Release installed 08:21Z; launch blocked (locked). Next: Adam device checks. [Handoff](docs/OVERNIGHT_FIXES_2026-10-23.md)
- **#321 local-first photos (Oct22, ADR0079):** photos on device, optional backup; reviewed; gatePASS; Dev 8823fa47; device open. #322/#323. [Handoff](docs/LOCAL_FIRST_PHOTOS_2026-10-22.md)
- **Home flash (Oct22):** reads retired on leaving the app no longer show "Couldn't update"; test; gatePASS. Next: iPhone.
- **Community join redesign (Oct22):** 6045ee7c Dev+Prod; fix: non-members saw a status error (cache-wrapped 404), @undefined; Opus review ship; #320. Next: Adam Join/leave on Prod iPhone. [Handoff](docs/COMMUNITY_JOIN_REDESIGN_2026-10-22.md)
- **#292/#293 (Oct17):** weekly "X of Y days", no streak; protein ideas (ADR0070); on Dev f388c722. Next: iPhone Dev.
- **#298 evening stretch (Oct23):** AI plans cover top 3 muscles (biceps via chest); no list swap while tailoring. dc64d2bd review/gatePASS; Dev 15:35Z health200; iPhone 15:29Z. Next: Adam device. #325. [Handoff](docs/EVENING_STRETCH_AI_COVERAGE_2026-10-23.md)
- **#307/#313 (Oct19-20, f02fbf94 Dev, reviewed):** #307 evening catch-up queue+pending sweep, next iPhone one-per-evening; #313 Claude multi-photo, live 2-photo 7/7.
- **#314 goal target date (Oct20):** optional/editable in Goal settings; no invented 90-day date; Home warning links there. Contract nullable, no migration; 2 reviews. Old builds reject null. Shared gatePASS(3452mobile/1226API+15skips); committed Oct20 merge with #303/#308, Dev. Next: iPhone.
- **#303 native pickers (Oct19):** shared Native{Date,Time}Picker (SwiftUI/Material3) replaces every custom/typed date-time input; JS-only. Reviewed; gatePASS(3296mobile); committed Oct20 merge, Dev. Android 24h (expo-localization, native rebuild) merged Oct21; device open.
- **#308 custom exercises (Oct19):** library create/edit/delete, tracking type, My exercises, rename via previousNames; API PUT/DELETE 409 when sets exist (ADR0075). 2 reviews resolved; shared-tree gatePASS(3439mobile/1221API+15skips); committed Oct20 merge, Dev. Next: iPhone. #311/#312.
- **#295/#297 (Oct18):** photo+chat assistant (ADR0071); 2 reviews; 57815004 gatePASS(3186mobile/1195API+15skips), Dev health200, iPhone installed; Free 10k blocks photo turns. Next: Adam device. #296;#294.
- **#290 (Oct17):** lock/resume keeps sets, no false sign-out; 2 reviews/gatePASS; on main. Next: Dev/iPhone lock test; #291.
- **#288/#299/#304 Log activity:** #288 gatePASS, Dev 47c814e5 ([evidence](docs/LOG_ACTIVITY_DRAFTING_EVIDENCE_2026-10-17.md)). #299 ADR0073 Gemini drafts; gatePASS; Dev 4/4 ([evidence](docs/LOG_ACTIVITY_AI_DRAFTS_EVIDENCE_2026-10-19.md)); iPhone 10:23Z. #300/#302 fixed, #301. #304 ADR0074 on-device, Haiku fallback on failure (Oct21), notes removed; Dev. Next: Adam iPhone; #304 latency+gate; #305/#306.
- **#278/#279 timed + past workouts (Oct17):** main/Dev 45f1ccfe; device acceptance open. [Moved entries](docs/archive/status/STATUS_OCT17_WORKOUT_PACKAGES_2026-10-22.md)
- **#276 bouldering:** BLD-00–06 641549ed; gate/db:verify/3 reviews PASS; Dev 45f1ccfe; device/share open. [Evidence](docs/BOULDERING_EVIDENCE_2026-10-16.md). Grade-row sends (Oct22): gatePASS; Dev+iPhone 4645debe; device open ([handoff](docs/BOULDER_GRADES_2026-10-22.md)).
- **#208/#248/Community audit (Oct9–15):** device/native exits open. [Moved entries](docs/archive/status/STATUS_OCT9_15_ENTRIES_2026-10-22.md)
- **#253–#257:** e2ee8b3a habit automation; reviews/gatePASS; Dev1642d9dd; ship app before Prod (old builds hide weekly). [Evidence](docs/HABIT_AUTOMATION_EVIDENCE_2026-10-15.md)
- **#238 meals:** review/gatePASS; Dev delivered; Adam deferred iOS sim; native/Prod open. [Evidence](docs/COMMUNITY_MEAL_SHARING_EVIDENCE_2026-10-12.md).
- **#244/#239/#237/#234/#235/#182/#232/#230/#233 (Oct9–14):** native/device/provider/release exits open. [Moved entries](docs/archive/status/STATUS_OCT9_14_FOLLOWUPS_2026-10-19.md)
- **#139/#168/#169 closed; native/device exits open:** [archived detail](docs/archive/status/STATUS_CLOSED_RETAINED_EXITS_2026-10-17.md).
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
