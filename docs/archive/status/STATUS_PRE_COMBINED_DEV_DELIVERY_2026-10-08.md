# Mizyun current status

> Updated 2026-10-08. [Prior handoffs][handoffs]; historical next actions are not instructions. Limit:120 lines/12,288 UTF-8 bytes.

## Current authority and delivery

- **Issues:** prior approvals; #21/#23/#25/#26/#31 partial/gatePASS. #117/#118 done; gatePASS; Adam tests Dev/native. [Evidence](../../../docs/MEAL_ISSUES_117_118_EVIDENCE_2026-10-08.md).

- **Git integration — 2026-10-07:** main packages pushed; runtime32d1d790cf072171da8fe38527256fef7b33c898/full gate/High reviewsPASS. [Preserved evidence](../../../docs/archive/status/STATUS_PRE_COMPLETED_WORKOUT_REVIEW_2026-10-07.md). Exact-candidate native/device and all release/privacy exits remain open.
- **Build9 / #212 (#27/#32):** source`dd5b435385b379d8c0df1b69813f8d8fdd3d985a`,1.0.9/9/9; signedIPA/widget/dSYMs and AAB/upload cert/16KB LOADPASS; fresh full gatesPASS. [Artifacts/evidence](../../../docs/BUILD_9_RELEASE_EVIDENCE_2026-10-05.md). iPhone16Pro installed/launched1.0.9(9) PID6828; native/16KB runtime/Store exits open.
- **Dev backend:** pristine7d5c9d0ecfd52629995af25d896dd6cdfef1abaf, API4100/DB5433 PID638748; committed full gate/promotionPASS, three Community migrations through20261007130000; health200/new protected routes401. Earlier running/photo proof retained; prompt `coach-system-v3-app-v3`. [Delivery](../../../docs/COMMUNITY_UI_REDESIGN_EVIDENCE_2026-10-07.md).
- **Latest iPhone Dev install:** 2026-10-07T17:12:35Z,7d5c9d0+local#225; iPhone16Pro/com.mizyun.development1.0.9(9) PID13101; standalone Release/signature/install/launchPASS,845 source/config hashes stable. [Evidence](../../../docs/MEAL_PHOTO_COPY_FIX_EVIDENCE_2026-10-07.md). Photo/native/two-account/accessibility exits open.
- **Production:** pristine9b0c41a; API4000/DB5432 PID3086051, tunnel2401546 active,57migrations through20261004110000. Fresh backup20261005T060157Z/checksumsPASS; public health200/protected Coach401. Adam confirmed build6 meal/workout/Coach journeys on d610382; API/packages/schema unchanged in9b0c41a. New build7 device/Store exits remain separate.
- **Environment and AI:** Hetzner CX23 owns Dev/Production; Pi remains encrypted recovery storage. Gemini-or-disabled, consent-based adult admission, current usage/kill switches; no email allowlist. Retain the explicit founder/partner shared-Gemini Dev exception. Local Qwen remains paused. `docs/BEFORE_TESTING.md` and live-provider gates remain in force.

## Running — #216 / RUN-01–05

**#210/#211/#213:** usability fixes/reviews/full gatePASS (mobile1476); fresh Dev simulator sign-in/meal/batch/resume/AX and live fonts verified. Physical/max-font/VoiceOver exits open. [Evidence](../../../docs/USABILITY_FOLLOWUP_EVIDENCE_2026-10-06.md).

**#214 simulator workflow:** skill/helper13PASS, High review clear; live signed Dev sign-in/read and warm reuse/full gatePASS. [Evidence](../../../docs/SIMULATOR_WORKFLOW_EVIDENCE_2026-10-06.md).

**Other active authority/gates:** #210/#211/#213 usability and #207 navigation source evidence and physical/max-font/VoiceOver/provider exits remain as recorded in [prior status](../../../docs/archive/status/STATUS_PRE_RUNNING_2026-10-06.md).

**Next:** accept #210/#213 physical/accessibility/max-font journeys on this candidate. Release: accept version9 native journeys, then manual IPA/AAB upload; test native workout status. #27/#32 native/Store exits open. Community closed; photos/App Preview Dev-only; no agent upload; broader gates remain.

## Local follow-ups awaiting exact-candidate acceptance

- **#139:** type control/warmup metrics;243tests/High review/full gatePASS. [Evidence/steps](../../../docs/WORKOUT_SET_TYPES_VERIFICATION_2026-10-08.md). Next: Dev install/routine acceptance; not installed.
- **#226 completed workout review:** local on d5c2e06; Close/static date-duration-sets, active-only effects guarded. Focused276/typecheck/High review/source-previewPASS; isolated full gatePASS. [Evidence](../../../docs/COMPLETED_WORKOUT_REVIEW_EVIDENCE_2026-10-07.md). Next: exact Dev iPhone/Android history/active-rest/accessibility acceptance; not installed.
- **#223 Home workout shortcut:** client correction on3984c35, versioned separately; Start creates/opens a one-time session directly, Resume preserved, duplicate/retry/account guards. Focused85/typecheck/helper review/full gatePASS (mobile1589). [Evidence](../../../docs/HOME_ONE_TIME_WORKOUT_EVIDENCE_2026-10-07.md). Included in latest iPhone Dev install above. Next: accept Home start/add/finish/resume on device; backend unchanged.
- **#222 first-meal shortcut:** client correction on3984c35, versioned separately; complete yesterday-local-day history selects earliest consumed meal, clears on rollover, no older fallback. Focused96/TZ45/full gatePASS (mobile1584); helper regression/review clear. [Evidence](../../../docs/FIRST_MEAL_SHORTCUT_EVIDENCE_2026-10-07.md). Included in latest iPhone Dev install above. Next: accept earliest-meal Copy to Today/empty-yesterday on device; backend unchanged.
- **#218 photos / #225 copy fix:** local on7d5c9d0 fixes async copy races, iOS owner prefixes and raw errors;244focused/High review/full gatePASS:1765mobile/892API+15skips. [Evidence/prior integration](../../../docs/MEAL_PHOTO_COPY_FIX_EVIDENCE_2026-10-07.md). Installed above; next: iPhone selection/Process/Save/reopen/retry acceptance; native/offline/account/multi-photo/accessibility/Android/provider exits open, Production disabled.
- **#217 Pro multi-photo:**3984c35 preserved in this Dev/mobile candidate; Meals/Coach up to3 and separate drafts. Focused477/High review/full gatePASS; native/live-provider acceptance open. [Evidence](../../../docs/PRO_MULTI_PHOTO_EVIDENCE_2026-10-06.md).
- **Usability #206/#202/#203/#208/#204/#205/#200/#182/#201/#197/#194/#196/#136:** prior implementation/evidence and exact native/provider/release exits retained in [pre-photo status](../../../docs/archive/status/STATUS_PRE_MEAL_PHOTO_DELIVERY_2026-10-06.md); combined-candidate acceptance open.

## Earlier implemented packages with open exits

- **#183 recurring meals** — Exact Dev migration delivered; app-closed minute/reopen/totals, edit/delete/pause/resume/skip/stop, timezone/DST/network/two-account journeys remain open. [Plan/evidence](../../../docs/RECURRING_MEALS_PLAN_2026-10-03.md)
- **#184 Coach envelopes** — Verified fix source `17c6c49a0886b9b191b178d25e2c7bdbfa6ea9de` integrated. Accept historical and new replies on exact Dev/provider/device candidate. [Handoff][handoffs]
- **#185 per100g nutrition** — Verified source `b57b5aa3022eeca7d94dbe839b81bdb957fa031a` integrated. Accept weight/decimal keyboard, preview/Save/reopen, advanced nutrients, draft/lost-response retry and large text. [Handoff][handoffs]
- **#186 private analytics** — Real on-demand Mac dashboard 3034 initialized; synthetic 3033 remains isolated. Use `pnpm analytics:dashboard` and ignored private login. Exact instrumentation delivery, consenting/denied/revoked device capture, automatic/Community coverage and official Store imports remain open. Zero Production opt-ins means unobserved usage. #192 tracks local synthetic-verifier Docker guards. Pi hosting is superseded; 8 GB upgrade deferred until revenue. [Runbook/evidence](../../../docs/DEVELOPER_ANALYTICS_DASHBOARD_2026-10-03.md)
- **#187 one-time workouts** — Delivered to Dev; accept start/add-before-first-set/restart/log/finish/history, retries/offline, appearance/keyboard/accessibility. Only saved selections/sets are claimed restart-safe. [Evidence](../../../docs/ONE_TIME_WORKOUTS_EVIDENCE_2026-10-04.md)
- **#188 prior-day meals** — Delivered to Dev; accept heading/date retention, paginated history, manual/recent/AI/Clear, restart/lost-response/conflicts/DST and accessibility. Arbitrary date picker remains outside scope. [Handoff][handoffs]
- **#189 exercise catalog / #191 pagination** — 609 active entries, original 888 IDs preserved; full gate historically passed. All 609 require qualified per-entry form/variant acceptance, 3 candidate duplicate pairs and swimming/outdoor cycling gaps remain. Accept search/readability/history/targets/restart; 200-record saved pagination deferred to #191. [Verification](../../../docs/evidence/exercise-catalog/verification-2026-10-04.md)
- **#190 direct Coach entry** — Delivered to Dev; accept first text/photo, cancellation/consent, failed creation/retry, existing threads and last deletion on both devices. [Handoff][handoffs]
- **#168/#169 Community navigation/UX** — Retained content preserves original 10s authority; cold/expired/background/account/write reads revalidate. Exact-candidate two-account, offline, lease/revocation, nested-screen and accessibility journeys remain open. [Navigation evidence](../../../docs/COMMUNITY_NAVIGATION_READS_EVIDENCE_2026-10-02.md), [UX audit](../../../docs/COMMUNITY_UX_AUDIT_2026-10-02.md), [Dev guide](../../../docs/COMMUNITY_DEV_TEST_GUIDE_2026-10-02.md)
- **#178/#179:** nutrients Dev-delivered/installed; #178 Save/reopen/free-downgrade/refinement device and #29 live exits open; #179 skip defect/actual scans retained. [AI](../../../docs/AI_ADVANCED_NUTRIENTS_EVIDENCE_2026-10-02.md). **#227 Home:**128tests/review/gatePASS; next exact Dev install/device checks. [Home](../../../docs/HOME_NUTRIENTS_EVIDENCE_2026-10-08.md).
- **#170 proactive Coach / #171–176** — Documentation-only plan; implementation requires its selected bounded package and sparse-day regression. No proactive rollout accepted. [Plan](../../../docs/PROACTIVE_COACH_PLAN_2026-10-02.md)
- **#216 Running** — Manual logging/history/edit/delete/drafts source938efc5 preserved in Deva64a158; full gate/API proofPASS, iPhone launched. Next: native acceptance; imports/GPS staged.
- **#198/#215/#219 Health** — Dev preview/selected exports; isolated full gatePASS. [Evidence](../../../docs/HEALTH_EXPORT_EVIDENCE_2026-10-06.md). Native/device/privacy gates open; Production disabled. Next: both-phone write/read-back; INT-03 separate.
- **#195/#199 CI** — Forward Community lint repair delivered; Linux43deployment fixtures and quality/navigation CI pass at9b0c41a; #199 closed. Hosted DB workflow #23 remains separate. [Delivery][handoffs]

## Community and release gates retained

**#224 COMMUNITY-UI-001:** Quiet feed UI-01–07 plus iPhone refinements on7d5c9d0; false sign-out and membership recovery fixed; social/settings/safety journeys retained. Non-author High review clear; full gatePASS:1754 mobile/892 API(+15 gated skips), iOS/Android exports; prior904 SQL/concurrencyPASS. Exact SHA pushed/deployed to Dev with three migrations; standalone iPhone9 installed/launched. [Evidence/next action](../../../docs/COMMUNITY_UI_REDESIGN_EVIDENCE_2026-10-07.md). Two-account/native/pilot/release gates open; issueactive.

Community #140/#142–162/#166–167 exits remain open; delivery false/cohort required under founder/partner Dev policy. Revocation ledger/replay, fallback and closure materials added2026-10-08; review clear; isolated gatePASS:1811mobile/937API,15gated+3config skips;1049SQL/19race/18replayPASS. [Evidence](../../../docs/COMMUNITY_IMPLEMENTATION_EVIDENCE_2026-10-08.md), [per-issue actions](../../../docs/COMMUNITY_REMAINING_ISSUES_2026-10-08.md). Independent ledger durability/coverage and physical Storage erasure open (#151/#153); restored traffic closed. Real archive transfer/decryption needs explicit authorization; none occurred. Next: choose ledger destination + run device batch; external reconciliation open.

Remaining Community exits: exact-candidate two-account iPhone/Android/offline/accessibility journeys; trained named MFA moderation/contact, alerts/absence drills; real provider/device push; legal/public/Store disclosures; adult research and four-week pilot. [Expansion evidence](../../../docs/COMMUNITY_EXPANSIONS_DEV_EVIDENCE_2026-10-01.md) preserves SQL/Auth/Storage assertions, host marker/configuration and prior artifacts. Historical shared-cloudflared freeze dependency and mixed-network observations require effective isolation verification before recovery operations; names alone do not prove isolation.

Q1–Q9: [remediation plan](../../../docs/REMEDIATION_IMPLEMENTATION_PLAN_2026-09-08.md) and [evidence checklist](../../../docs/REMEDIATION_EVIDENCE_CHECKLIST.md) define closure. Build7 backend/build6 core device accepted above; signed packages verified. Exact build7/native, restore, provider/lifecycle and Store exits remain open. Future promotion requires fresh exact-SHA backup/migration checks.

[handoffs]: ../../../docs/archive/status/STATUS_PRE_AGENT_WORKFLOW_2026-10-04.md
