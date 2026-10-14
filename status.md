# Mizyun status

> Updated 2026-10-14. [History][handoffs]; historical actions are not instructions. [Earlier detail](docs/archive/status/STATUS_PRE_WORKOUT_COMPANIONS_2026-10-09.md).

## Current authority and delivery

- **Latest ten/main (Oct8):** all10CLOSED per Adam; pushed; gate1931mobile/946API(+15/3skips),1049SQL/18replayPASS. [Delivery/gates](docs/MAIN_DEV_DELIVERY_2026-10-08.md). Native/provider/release exits open.

- **Issues:** #21/#23/#25/#26/#31 partial/gatePASS. #117/#118 done; gatePASS; Adam tests Dev/native. [Evidence](docs/MEAL_ISSUES_117_118_EVIDENCE_2026-10-08.md).

- **All-local main (Oct14):**0135228 base; review/gatePASS; source428c317; Git receipt. [Proof](docs/ALL_LOCAL_SEPARATE_COMMITS_2026-10-14.md). Dev/Prod/native open.
- **Build9 / #212 (#27/#32):** source`dd5b435385b379d8c0df1b69813f8d8fdd3d985a`,1.0.9/9/9; IPA/widget/dSYMs/AAB/upload cert/16KB LOAD/full gatesPASS. [Artifacts/evidence](docs/BUILD_9_RELEASE_EVIDENCE_2026-10-05.md). iPhone16Pro installed/launched1.0.9(9) PID6828; native/16KB runtime/Store exits open.
- **Dev backend (Oct11):** iPhone-matching0135228778059dc25c1a4925738f0b6934ed4f0c deployed; fresh fullgate/clean checkout/API4100/DB5433 readinessPASS, instancef7aa5a43; migration20261011120000 applied. [Receipt](docs/DEV_BACKEND_MAIN_DEPLOYMENT_2026-10-11.md). Production unchanged.
- **iPhone Dev (Oct14):** local0135228+uncommitted;gate/build/sign/install/launchPASS;1.0.9(9),PID39993. [Receipt](docs/DEV_IPHONE_LOCAL_DELIVERY_2026-10-14.md). Dev backend unchanged; native/provider/AX/watch open.
- **Production:** pristine9b0c41a; API4000/DB5432 PID3086051, tunnel2515930 restored,57migrations through20261004110000. Backup20261005T060157Z/checksumsPASS; public health200/protected Coach401. Adam confirmed build6 meal/workout/Coach journeys on d610382; API/packages/schema unchanged in9b0c41a. New build7 device/Store exits remain separate.
- **Environment and AI:** Hetzner Dev/Production; Pi encrypted recovery. Gemini-or-disabled; adult consent admission/usage/kill switches; no email allowlist. Founder/partner shared-Gemini Dev exception retained. Qwen paused. `docs/BEFORE_TESTING.md` and live-provider gates remain in force.

## Running and usability acceptance

**#216/RUN-01–05:** source/Dev evidence and native/import/GPS exits retained below. #210/#211/#213 automatic/usability gate and Dev simulatorPASS; physical/max-font/VoiceOver remain open. #214 workflow/source/full-gatePASS; #207 navigation and physical/provider gates retained. [Preserved detail](docs/COMMUNITY_MEAL_SHARING_EVIDENCE_2026-10-12.md#preserved-prior-runningusability-handoff).

**Next retained release checks:** version9 native workout journeys, physical/accessibility acceptance, then Adam's manual IPA/AAB upload. #27/#32 Store exits open; Community prior closure does not accept this new meal extension. Photos/App Preview remain Dev-only.

## Local follow-ups awaiting acceptance

- **#239:** consent/reminders local;289tests/review/gatePASS; Dev/native next. [Proof](docs/ANALYTICS_CONSENT_REMINDERS_EVIDENCE_2026-10-12.md).

- **#238 meals:** local; Community608/SQL148/review/isolated fullgatePASS. iOS simulator deferred by Adam; Dev/Prod unrun. [Evidence](docs/COMMUNITY_MEAL_SHARING_EVIDENCE_2026-10-12.md).

- **#237:** 438/review/gatePASS; native deferred. [Proof](docs/MEAL_COPY_RETAINED_PHOTO_EVIDENCE_2026-10-12.md).

- **Agents #236:** Sol Medium/High exceptions; bounded reviews/stable gates. [Rules](docs/SESSION_GUIDE.md); measure next.

- **#234/#235:** Dev81.67%; Material1.14/resizable; build/gate/API36 rotation PASS; RN/older/device/Play open. [Evidence](docs/ANDROID_WINDOW_DEV_EVIDENCE_2026-10-11.md).

- **#182 (Oct12):** first-render cache; combined gatePASS; signed-in native next. [Evidence](docs/FIRST_RENDER_TAB_CACHE_EVIDENCE_2026-10-12.md).

- **#232/INT-07:** foreground Watch/Wear source/review/gatePASS; watch/phone compile. Adam deferred physical; Health/privacy/Prod exits open. [Evidence](docs/WORKOUT_COMPANIONS_EVIDENCE_2026-10-09.md).

- **#230/#233 visuals:**4fa20a8 Dev; Pro display/save locked;31food categories/no plate; export/erase preserved. Isolated/exact gatePASS(2008mobile/979API+15skips),120SQL+6races/reviewPASS. iPhone unavailable/update pending; native/provider/release open. [Evidence](docs/PRO_MEAL_VISUALS_EVIDENCE_2026-10-09.md).

- **#208 (Oct9):** iOS selection;110tests/gatePASS; [evidence/gate](docs/COACH_TEXT_SELECTION_HANDLES_EVIDENCE_2026-10-09.md). Next: installed partial-copy/scroll/keyboard/themes/large-text/VoiceOver; per-block scope, native exits open.

- **#139 closed per Adam (Oct8):** installed type control/warmup metrics;243tests/review/gatePASS. [Evidence](docs/WORKOUT_SET_TYPES_VERIFICATION_2026-10-08.md). Routine/native checks unrun; #228 closed per Adam.
- **#226:** d5c2e06 completed-workout review installed on latest Dev; focused276/typecheck/review/preview/isolated gatePASS. Next: history/active-rest/accessibility acceptance. [Evidence](docs/COMPLETED_WORKOUT_REVIEW_EVIDENCE_2026-10-07.md).
- **#223:**3984c35 Home one-time start/Resume/retry/account guards installed latest Dev; focused85/review/gatePASS. Next: device start/add/finish/resume. [Evidence](docs/HOME_ONE_TIME_WORKOUT_EVIDENCE_2026-10-07.md).
- **#222:**3984c35 first-meal shortcut installed latest Dev; focused96/TZ45/review/gatePASS. Next: device Copy to Today/empty-yesterday. [Evidence](docs/FIRST_MEAL_SHORTCUT_EVIDENCE_2026-10-07.md).
- **#218/#225 photos:** local7d5c9d0; async copy/iOS owner/raw-error fixes;244focused/review/gatePASS (1765mobile/892API+15skips). Installed above. Next: selection/Process/Save/reopen/retry; native/offline/account/multi-photo/AX/Android/provider exits open; Production disabled. [Evidence](docs/MEAL_PHOTO_COPY_FIX_EVIDENCE_2026-10-07.md).
- **#217 Pro multi-photo:**3984c35 preserved in this Dev/mobile candidate; Meals/Coach up to3 and separate drafts. Focused477/High review/full gatePASS; native/live-provider acceptance open. [Evidence](docs/PRO_MULTI_PHOTO_EVIDENCE_2026-10-06.md).
- **Usability #206/#202/#203/#208/#204/#205/#200/#182/#201/#197/#194/#196/#136:** implementation/native/provider/release and combined acceptance exits open: [prior status](docs/archive/status/STATUS_PRE_MEAL_PHOTO_DELIVERY_2026-10-06.md).

## Earlier implemented packages with open exits

- **#183 recurring:** Dev SQL; tick/reopen/totals, edit/delete/pause/resume/skip/stop; TZ/DST/network/two-account open. [Evidence](docs/RECURRING_MEALS_PLAN_2026-10-03.md). **#242:** local PASS; copies count. [Proof](docs/MEAL_ROUTINE_SUGGESTIONS_EVIDENCE_2026-10-13.md); Dev/native next.
- **#184 Coach envelopes** — Verified fix source `17c6c49a0886b9b191b178d25e2c7bdbfa6ea9de` integrated. Accept historical and new replies on exact Dev/provider/device candidate. [Handoff][handoffs]
- **#185 per100g nutrition** — Verified source `b57b5aa3022eeca7d94dbe839b81bdb957fa031a` integrated. Accept weight/decimal keyboard, preview/Save/reopen, advanced nutrients, draft/lost-response retry and large text. [Handoff][handoffs]
- **#186/#192 analytics:** Mac3034 real/3033 synthetic; manual collector. #240 CLOSED: SQL64/unit69/review/gate/livePASS; reload next. [Evidence](docs/ANALYTICS_REGISTRATION_ZERO_DAYS_2026-10-12.md).
- **#187 one-time workouts** — Delivered to Dev; accept start/add-before-first-set/restart/log/finish/history, retries/offline, appearance/keyboard/accessibility. Saved selections/sets are restart-safe. [Evidence](docs/ONE_TIME_WORKOUTS_EVIDENCE_2026-10-04.md)
- **#188 prior-day meals** — Delivered to Dev; accept heading/date retention, paginated history, manual/recent/AI/Clear, restart/lost-response/conflicts/DST and accessibility. Date picker excluded. [Handoff][handoffs]
- **#189/#191 catalog:**609active/888original IDs; historical gatePASS. All609 need per-entry form/variant acceptance;3duplicate pairs/swimming/cycling gaps remain. Next: search/readability/history/targets/restart;200-record saved pagination deferred#191. [Evidence](docs/evidence/exercise-catalog/verification-2026-10-04.md).
- **#190 direct Coach entry** — Delivered to Dev; accept first text/photo, cancellation/consent, failed creation/retry, existing threads and last deletion on both devices. [Handoff][handoffs]
- **#168/#169 CLOSED engineering (Oct11):** regressions/review/full gate met; original10s authority preserved. Device/offline/background/nested/AX exits separate. [Scope audit](docs/evidence/community-simulators-2026-10-10/closure-scope-audit-2026-10-11.md)
- **#178/#179:** #178 closed per Adam (Oct8); nutrients Dev-delivered/installed; device/#29 live checks unrun; #179 skip defect/actual scans retained. [AI](docs/AI_ADVANCED_NUTRIENTS_EVIDENCE_2026-10-02.md). **#227 Home closed per Adam (Oct8):** refs/cards/bars installed;50focused/review/gatePASS; native checks unrun. [Home](docs/HOME_NUTRIENT_LABEL_REFERENCES_2026-10-08.md).
- **#170/#171–176:** [plans](docs/PROACTIVE_COACH_PLAN_2026-10-02.md); PC-01 first, no rollout. **#241 REC-06:** offline/review/gatePASS. [Proof](docs/AI_MEAL_RECIPES_REC06_EVIDENCE_2026-10-13.md). NextQ01; native/live/qualified open.
- **#216 Running** — Manual logging/history/edit/delete/drafts source938efc5 preserved in Deva64a158; full gate/API proofPASS, iPhone launched. Next: native acceptance; imports/GPS staged.
- **#198/#215/#219 Health** — Dev preview/selected exports; isolated full gatePASS. [Evidence](docs/HEALTH_EXPORT_EVIDENCE_2026-10-06.md). Native/device/privacy gates open; Production disabled. Next: both-phone write/read-back; INT-03 separate.
- **#195/#199 CI** — Forward Community lint repair delivered; Linux43deployment fixtures and quality/navigation CI pass at9b0c41a; #199 closed. Hosted DB workflow #23 remains separate. [Delivery][handoffs]

## Community and release gates retained

**#224 closed per Adam (Oct8):** UI01–07/iPhone refinements7d5c9d0 Dev/iPhone9; independent review/full gatePASS(1754mobile/892API+15skips), exports/prior904SQL+concurrencyPASS. [Evidence](docs/COMMUNITY_UI_REDESIGN_EVIDENCE_2026-10-07.md). Native/pilot/release exits open.

Community #137/#140/#148/#150–151/#153–156/#158–162 open. [Oct8 gates/actions](docs/COMMUNITY_REMAINING_ISSUES_2026-10-08.md). Custody/retention/Storage erasure open; restore closed; archive transfer unauthorized.

**Oct10–11:** #142–147/#149/#152/#166–169 CLOSED; iOS accepted/no physical repeat;Android skipped. Cursorb60bf9b:39SQL/89focused/review/gatePASS; undeployed, approval/livecodec#137; externalpushOFF. [Exact source](docs/evidence/community-simulators-2026-10-10/feed-reactions-inbox-closure-2026-10-11.md); #144 proof in same directory.

**#150/#151/#156:** 33-category export/privacy6db9130; review/206SQL/41adapter/8Node/8Python/28replayPASS; gate2047mobile/980API+15/3skips. Native consent/candidates/reportPASS; replyCONTROL-BLOCKED. [Proof/inputs](docs/evidence/community-simulators-2026-10-10/mobile-lifecycle-comments-2026-10-11.md). Migration undeployed; nextDevapproval/preflightPASS; VoiceOver/offline/Android/operator/custody/retention/archive unrun.

Retained exits: unrun offline/accessibility; trained named MFA moderation/contact/absence drills; provider/device push; legal/public/Store disclosures; adult research/four-week pilot. [Expansion proof](docs/COMMUNITY_EXPANSIONS_DEV_EVIDENCE_2026-10-01.md). Effective isolation needs verification after shared-cloudflared freeze/mixed-network history; names alone are insufficient.

Q1–Q9: [remediation plan](docs/REMEDIATION_IMPLEMENTATION_PLAN_2026-09-08.md) and [evidence checklist](docs/REMEDIATION_EVIDENCE_CHECKLIST.md) define closure. Build7 backend/build6 core device accepted above; signed packages verified. Exact build7/native, restore, provider/lifecycle and Store exits remain open. Future promotion requires fresh exact-SHA backup/migration checks.

[handoffs]: docs/archive/status/STATUS_PRE_AGENT_WORKFLOW_2026-10-04.md

**#157 CLOSED/#158/#161 OPEN:**9dbf7b4; iOS/189SQL/28focused/reviewPASS; gate2059mobile/980API+15/3skips. [Proof](docs/evidence/community-simulators-2026-10-10/spaces-challenges-routines-2026-10-11.md). #158 realpilot/safety/AX;#161 Android/retry/retained-view. Restored;Dev2596;integrated above.
