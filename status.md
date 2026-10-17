# Mizyun status

> Updated 2026-10-17 (Claude Code). [History][handoffs]; historical actions are not instructions. [Earlier detail](docs/archive/status/STATUS_PRE_WORKOUT_COMPANIONS_2026-10-09.md).

## Current authority and delivery

- **Oct8 ten/main:**10closed per Adam/pushed; gates/SQL/replay PASS. [Proof](docs/MAIN_DEV_DELIVERY_2026-10-08.md). Native/provider/release open.

- **Issues:** #21/#23/#25/#26/#31 partial/gatePASS. #117/#118 done; gatePASS; Adam tests Dev/native. [Evidence](docs/MEAL_ISSUES_117_118_EVIDENCE_2026-10-08.md).

- **Claude Code (Oct14):** replaces Codex; #203/#241/#242, Workouts key and gate-symlink fixes pushed (main283bf05); gatePASS(2612mobile/1109API+15skips), fix reviewed.
- **Build9 / #212 (#27/#32):** source`dd5b435385b379d8c0df1b69813f8d8fdd3d985a`,1.0.9/9/9; IPA/widget/dSYMs/AAB/upload cert/16KB LOAD/full gatesPASS. [Artifacts/evidence](docs/BUILD_9_RELEASE_EVIDENCE_2026-10-05.md). iPhone16Pro installed/launched1.0.9(9) PID6828; native/16KB runtime/Store exits open.
- **Dev=main (Oct17):**45f1ccfe9afabdcd2768573dcb8693ef2d57c164 (#278+#279+plate calculator on d175da95 incl. #276 bouldering, #216 imports) gatePASS(3108mobile/1186API+15skips), deploy:dev OK, migrations through20261016200000, health200 10:49Z. Merge review: no blockers; #285/#286 filed. Prior: [Oct15](docs/MEAL_PLANNING_RECIPES_AUDIT_EVIDENCE_2026-10-15.md); Recipes ON [proof](docs/DEV_RECIPES_ENABLED_2026-10-14.md).
- **iPhone Dev (Oct17):** main45f1ccfe+Expo JSI fix installed/launched on iPhone 00008140-001114501A86801C 11:29Z (1.0.9/9); acceptance open. Xcode27.1/Swift6.4 fix: patch expo-modules-jsi@57.1.0 (expo#50569/#51234) + plugin `with-ios-source-built-expo-modules` (EXPO_USE_PRECOMPILED_MODULES=false); drop at SDK58. #287 flaky core test.
- **Production:** pristine9b0c41a; API4000/DB5432 PID3086051, tunnel2515930 restored,57migrations through20261004110000. Backup20261005T060157Z/checksumsPASS; public health200/protected Coach401. Adam confirmed build6 meal/workout/Coach journeys on d610382; API/packages/schema unchanged in9b0c41a. New build7 device/Store exits remain separate.
- **AI:** Gemini live. Claude Haiku5.5 (ADR0069) bcfb68a3 Dev gatePASS/2 reviews; off until Adam sets dev.env provider/ack/key. [Evidence](docs/ANTHROPIC_DEV_PROVIDER_EVIDENCE_2026-10-17.md). Adult/consent/usage/kill switches; partner Dev exception; Qwen paused; BEFORE_TESTING gates kept.

## Running and usability acceptance

**#216 running:** RUN-01–05 Dev; native/GPS open. RUN-06 Health run imports + Log run shortcuts (ADR0065, migration20261016120000): 2 reviews/gatePASS; db:verify/device open. [Evidence](docs/RUN_IMPORTS_EVIDENCE_2026-10-16.md). #210–#214/#207 exits: [detail](docs/COMMUNITY_MEAL_SHARING_EVIDENCE_2026-10-12.md#preserved-prior-runningusability-handoff).

**Next retained release checks:** version9 native workout journeys, physical/accessibility acceptance, then Adam's manual IPA/AAB upload. #27/#32 Store exits open; Community prior closure does not accept this new meal extension. Photos/App Preview remain Dev-only.

## Local follow-ups awaiting acceptance

- **#288 Log activity (Oct17):** runs here (no hub Log run), typed activity, any date/time, text drafts; reviews/gatePASS; Dev 47c814e5 health200;iPhone install 13:08Z;Adam next. [Evidence](docs/LOG_ACTIVITY_DRAFTING_EVIDENCE_2026-10-17.md)
- **#278 timed workouts (Oct17):** load/reps·duration·duration+distance modes, Swimming/Outdoor Cycling/Hiking, Log activity; no migration (ADR0068). 2 reviews resolved; on main/Dev 45f1ccfe. Next: device acceptance. [Evidence](docs/TIMED_WORKOUTS_EVIDENCE_2026-10-17.md)
- **#279 past workouts (WO-08, Oct17):** Log past workout form; resumable save; recent sets by completed_at. 3 reviews resolved; on main/Dev 45f1ccfe. Next: device acceptance. [Evidence](docs/PAST_WORKOUT_LOGGING_EVIDENCE_2026-10-17.md)
- **#276 bouldering:** BLD-00–06 source 641549ed; gate/db:verify/3 reviews PASS; Dev 45f1ccfe. Next device. [Evidence](docs/BOULDERING_EVIDENCE_2026-10-16.md). **Share sheet:** device check open.
- **#248 ENG-07/08 (Oct15):** goal modes, energy v2, weekly calorie review (migration20261015090000); 3 reviews resolved; pgTAP0045 58ok; gatePASS. Dev deployed; iPhone Dev check next. [ADR0064](docs/adr/0064-rate-based-goal-modes-and-weekly-calorie-review.md)
- **Community audit (Oct15):** 8b9fc0d5; review/gatePASS; Dev/device open. #265 needs Adam. [Evidence](docs/COMMUNITY_AUDIT_FIXES_2026-10-15.md)
- **#253–#257:** e2ee8b3a habit automation; reviews/gatePASS; Dev1642d9dd; ship app before Prod (old builds hide weekly). [Evidence](docs/HABIT_AUTOMATION_EVIDENCE_2026-10-15.md)
- **#244 UI:** phases1–3 075a7647; Adam OK iPhone56777345. Open: VoiceOver/Android/populated-edge.
- **#239:** consent/reminders gatePASS; Dev installed; native next. [Proof](docs/ANALYTICS_CONSENT_REMINDERS_EVIDENCE_2026-10-12.md).
- **#238 meals:** review/gatePASS; Dev delivered; iOS sim deferred by Adam; native/Prod open. [Evidence](docs/COMMUNITY_MEAL_SHARING_EVIDENCE_2026-10-12.md).
- **#237:** gatePASS; native deferred. [Proof](docs/MEAL_COPY_RETAINED_PHOTO_EVIDENCE_2026-10-12.md).
- **#234/#235:** Dev81.67%; Material1.14/resizable; build/gate/API36 rotation PASS; RN/older/device/Play open. [Evidence](docs/ANDROID_WINDOW_DEV_EVIDENCE_2026-10-11.md).
- **#182 (Oct14):** Coach history kept on token rotation; Feed stale read-only (Adam OK);0ee20191 gatePASS; device next. [Evidence](docs/FIRST_RENDER_TAB_CACHE_EVIDENCE_2026-10-12.md#oct14).
- **#232/INT-07:** Watch/Wear source/review/gatePASS, compiles; physical deferred (Adam); Health/privacy/Prod open. [Evidence](docs/WORKOUT_COMPANIONS_EVIDENCE_2026-10-09.md).
- **#230/#233 visuals:**4fa20a8 Dev; Pro display/save locked; gate/120SQL+6races/reviewPASS. iPhone update pending; native/provider/release open. [Evidence](docs/PRO_MEAL_VISUALS_EVIDENCE_2026-10-09.md).
- **#208 (Oct9):** iOS selection;110tests/gatePASS; [evidence/gate](docs/COACH_TEXT_SELECTION_HANDLES_EVIDENCE_2026-10-09.md). Next: installed partial-copy/scroll/keyboard/themes/large-text/VoiceOver; per-block scope, native exits open.
- **#139/#168/#169 closed; native/device exits open:** [archived detail](docs/archive/status/STATUS_CLOSED_RETAINED_EXITS_2026-10-17.md).
- **#226:** d5c2e06 workout review on Dev; review/gatePASS. Next: history/active-rest/accessibility acceptance. [Evidence](docs/COMPLETED_WORKOUT_REVIEW_EVIDENCE_2026-10-07.md).
- **#223:**3984c35 Home one-time start/Resume/retry/account guards on Dev; review/gatePASS. Next: device start/add/finish/resume. [Evidence](docs/HOME_ONE_TIME_WORKOUT_EVIDENCE_2026-10-07.md).
- **#222:**3984c35 first-meal shortcut on Dev; TZ/review/gatePASS. Next: device Copy to Today/empty-yesterday. [Evidence](docs/FIRST_MEAL_SHORTCUT_EVIDENCE_2026-10-07.md).
- **#218/#225 photos:** local7d5c9d0; async copy/iOS owner/raw-error fixes;244focused/review/gatePASS (1765mobile/892API+15skips). Installed above. Next: selection/Process/Save/reopen/retry; native/offline/account/multi-photo/AX/Android/provider open; Prod disabled. [Evidence](docs/MEAL_PHOTO_COPY_FIX_EVIDENCE_2026-10-07.md).
- **#217 Pro multi-photo:**3984c35 on Dev; Meals/Coach up to3, separate drafts. Focused477/review/gatePASS; native/live-provider acceptance open. [Evidence](docs/PRO_MULTI_PHOTO_EVIDENCE_2026-10-06.md).
- **Usability #206/#202/#203/#208/#204/#205/#200/#182/#201/#197/#194/#196/#136:** implementation/native/provider/release and combined acceptance exits open: [prior status](docs/archive/status/STATUS_PRE_MEAL_PHOTO_DELIVERY_2026-10-06.md).

## Earlier implemented packages with open exits

- **#183 recurring:** Dev SQL; tick/reopen/totals, edit/delete/pause/resume/skip/stop; TZ/DST/network/two-account open. [Evidence](docs/RECURRING_MEALS_PLAN_2026-10-03.md). **#242:** copy fix in main283bf05. [Fix](docs/MEAL_ROUTINE_COPY_REFRESH_2026-10-14.md); client/native next. **#252:** any-time fix Dev37ffcca9; device check open.
- **#184/#185/#188/#190:** integrated/Dev; device acceptance exits open. [Moved entries](docs/archive/status/STATUS_EARLIER_PACKAGES_2026-10-17.md)
- **#186/#192 analytics:** Mac3034 real/3033 synthetic; manual collector. #240 CLOSED: SQL64/unit69/review/gate/livePASS; reload next. [Evidence](docs/ANALYTICS_REGISTRATION_ZERO_DAYS_2026-10-12.md).
- **#187 one-time workouts** — Dev; accept start/add-before-first-set/restart/log/finish/history, retries/offline, appearance/keyboard/AX. Restart-safe. [Evidence](docs/ONE_TIME_WORKOUTS_EVIDENCE_2026-10-04.md)
- **#189/#191 catalog:**609active/888original IDs; historical gatePASS. All609 need per-entry form/variant acceptance;3duplicate pairs/swimming/cycling gaps remain. Next: search/readability/history/targets/restart;200-record saved pagination deferred#191. [Evidence](docs/evidence/exercise-catalog/verification-2026-10-04.md).
- **#178/#179:** #178 closed per Adam (Oct8); device/#29 live checks unrun; #179 skip defect/scans retained. [AI](docs/AI_ADVANCED_NUTRIENTS_EVIDENCE_2026-10-02.md). **#227 Home closed per Adam (Oct8):** refs/cards/bars gatePASS; native checks unrun. [Home](docs/HOME_NUTRIENT_LABEL_REFERENCES_2026-10-08.md).
- **#170/#171–176:** [plans](docs/PROACTIVE_COACH_PLAN_2026-10-02.md); PC-01 first, no rollout. **#241:** Dev recipesON; UI fix in main283bf05; rebuild/native next. [UI/REC06](docs/RECIPE_UI_EVIDENCE_2026-10-14.md); live/qualified open. Oct15 [fixes](docs/MEAL_PLANNING_RECIPES_AUDIT_EVIDENCE_2026-10-15.md) 3513d0d8 gatePASS; Dev/device open.
- **#198/#215/#219 Health** — Dev preview/selected exports; isolated full gatePASS. [Evidence](docs/HEALTH_EXPORT_EVIDENCE_2026-10-06.md). Native/device/privacy gates open; Production disabled. Next: both-phone write/read-back; INT-03 separate.
- **#195/#199 CI** — Community lint repair delivered; Linux43 fixtures/quality/navigation CI PASS at9b0c41a; #199 closed. Hosted DB workflow #23 separate. [Delivery][handoffs]

## Community and release gates retained

**#224 closed per Adam (Oct8):** UI01–07/iPhone refinements7d5c9d0 Dev/iPhone9; independent review/full gatePASS(1754mobile/892API+15skips), exports/prior904SQL+concurrencyPASS. [Evidence](docs/COMMUNITY_UI_REDESIGN_EVIDENCE_2026-10-07.md). Native/pilot/release exits open.

Community #137/#140/#148/#150–151/#153–156/#158–162 open. [Oct8 gates/actions](docs/COMMUNITY_REMAINING_ISSUES_2026-10-08.md). Custody/retention/Storage erasure open; restore closed; archive transfer unauthorized.

**Oct10–11:** #142–147/#149/#152/#166–169 CLOSED; iOS accepted/no physical repeat;Android skipped. Cursorb60bf9b:39SQL/89focused/review/gatePASS; undeployed, approval/livecodec#137; externalpushOFF. [Exact source](docs/evidence/community-simulators-2026-10-10/feed-reactions-inbox-closure-2026-10-11.md); #144 proof in same directory.

**#150/#151/#156:** 33-category export/privacy6db9130; review/SQL/adapter/replay/gatePASS (counts in proof). Native consent/candidates/reportPASS; replyCONTROL-BLOCKED. [Proof/inputs](docs/evidence/community-simulators-2026-10-10/mobile-lifecycle-comments-2026-10-11.md). Migration undeployed; nextDevapproval/preflightPASS; VoiceOver/offline/Android/operator/custody/retention/archive unrun.

Retained exits: unrun offline/accessibility; trained named MFA moderation/contact/absence drills; provider/device push; legal/public/Store disclosures; adult research/four-week pilot. [Expansion proof](docs/COMMUNITY_EXPANSIONS_DEV_EVIDENCE_2026-10-01.md). Isolation unverified after shared-cloudflared freeze/mixed networks.

Q1–Q9: [remediation plan](docs/REMEDIATION_IMPLEMENTATION_PLAN_2026-09-08.md) and [evidence checklist](docs/REMEDIATION_EVIDENCE_CHECKLIST.md) define closure. Build7 backend/build6 core device accepted above; signed packages verified. Exact build7/native, restore, provider/lifecycle and Store exits remain open. Future promotion requires fresh exact-SHA backup/migration checks.

[handoffs]: docs/archive/status/STATUS_PRE_AGENT_WORKFLOW_2026-10-04.md

**#157 CLOSED/#158/#161 OPEN:**9dbf7b4; iOS/189SQL/28focused/reviewPASS; gate2059mobile/980API+15/3skips. [Proof](docs/evidence/community-simulators-2026-10-10/spaces-challenges-routines-2026-10-11.md). #158 realpilot/safety/AX;#161 Android/retry/retained-view. Restored;Dev2596;integrated above.
