# Mizyun current status

> Updated 2026-10-09. [Prior handoffs][handoffs]; historical next actions are not instructions. Limit:120 lines/12,288 UTF-8 bytes.

## Current authority and delivery

- **Latest ten/main (Oct8):** all10CLOSED/done per Adam; coherent main commits pushed; gate1931mobile/946API(+15/3skips),1049SQL/18replayPASS. [Delivery/gates](../../MAIN_DEV_DELIVERY_2026-10-08.md). Native/provider/release exits open.

- **Issues:** #21/#23/#25/#26/#31 partial/gatePASS. #117/#118 done; gatePASS; Adam tests Dev/native. [Evidence](../../MEAL_ISSUES_117_118_EVIDENCE_2026-10-08.md).

- **Git integration (Oct7):** main pushed; runtime/gate/reviewsPASS. [Evidence](../../archive/status/STATUS_PRE_COMPLETED_WORKOUT_REVIEW_2026-10-07.md). Native/device/release/privacy exits open.
- **Build9 / #212 (#27/#32):** source`dd5b435385b379d8c0df1b69813f8d8fdd3d985a`,1.0.9/9/9; signedIPA/widget/dSYMs and AAB/upload cert/16KB LOADPASS; fresh full gatesPASS. [Artifacts/evidence](../../BUILD_9_RELEASE_EVIDENCE_2026-10-05.md). iPhone16Pro installed/launched1.0.9(9) PID6828; native/16KB runtime/Store exits open.
- **Dev backend:** pristine1b9b5f61ca5123ebeb079b85cf670fdc2016326e; API4100/DB5433 PID3554357/instance0ec5687b; exact public database/Auth/Storage readinessPASS, ledger through20261008120000/zero pending. Approved tunnel correctionPASS;251Production200 samples/unchanged Prod-tunnel processes. [Receipt](../../MAIN_DEV_DELIVERY_2026-10-08.md).
- **Latest iPhone Dev:**1b9b5f6,1.0.9(9)/com.mizyun.development/iPhone16Pro; Releasebuild/signature/installPASS. Launch blocked: phone locked; processabsent. Next: unlock, launch/verify. Original workout UI retained; native/provider/accessibility/Apple-key exits open. [Receipt](../../MAIN_DEV_DELIVERY_2026-10-08.md).
- **Production:** pristine9b0c41a; API4000/DB5432 PID3086051, tunnel2515930 restored,57migrations through20261004110000. Backup20261005T060157Z/checksumsPASS; public health200/protected Coach401. Adam confirmed build6 meal/workout/Coach journeys on d610382; API/packages/schema unchanged in9b0c41a. New build7 device/Store exits remain separate.
- **Environment and AI:** Hetzner CX23 owns Dev/Production; Pi remains encrypted recovery storage. Gemini-or-disabled, consent-based adult admission, current usage/kill switches; no email allowlist. Retain the explicit founder/partner shared-Gemini Dev exception. Local Qwen remains paused. `../../BEFORE_TESTING.md` and live-provider gates remain in force.

## Running — #216 / RUN-01–05

**#210/#211/#213:** usability fixes/reviews/full gatePASS (mobile1476); fresh Dev simulator sign-in/meal/batch/resume/AX and live fonts verified. Physical/max-font/VoiceOver exits open. [Evidence](../../USABILITY_FOLLOWUP_EVIDENCE_2026-10-06.md).

**#214 simulator workflow:** skill/helper13PASS, High review clear; live signed Dev sign-in/read and warm reuse/full gatePASS. Evidence.

**Other active authority/gates:** #210/#211/#213 usability and #207 navigation source evidence and physical/max-font/VoiceOver/provider exits remain as recorded in [prior status](../../archive/status/STATUS_PRE_RUNNING_2026-10-06.md).

**Next:** accept #210/#213 physical/accessibility/max-font journeys on this candidate. Release: accept version9 native journeys, then manual IPA/AAB upload; test native workout status. #27/#32 native/Store exits open. Community closed; photos/App Preview Dev-only; no agent upload; broader gates remain.

## Local follow-ups awaiting acceptance

- **#208 (Oct9):** iOS selection;110tests/gatePASS; evidence/gate. Next: installed partial-copy/scroll/keyboard/themes/large-text/VoiceOver; per-block scope, native exits open.

- **#139 closed per Adam (Oct8):** installed type control/warmup metrics;243tests/review/gatePASS. Evidence. Routine/native checks unrun; #228 closed per Adam.
- **#226 completed workout review:** local on d5c2e06; Close/static date-duration-sets, active-only effects guarded. Focused276/typecheck/High review/source-previewPASS; isolated full gatePASS. Evidence. Included in latest Dev install; next: history/active-rest/accessibility acceptance.
- **#223 Home workout:** client3984c35; direct one-time start with exact ID/Resume/retry/account guards, focused85/review/gatePASS. Installed on latest Dev candidate. Next: device start/add/finish/resume; evidence, [prior](../../archive/status/STATUS_PRE_LATEST_TEN_ISSUES_2026-10-08.md).
- **#222 first meal:** client3984c35; complete yesterday-local-day earliest meal, rollover clearing, no older fallback. Focused96/TZ45/review/gatePASS; installed latest Dev. Next: device Copy to Today/empty-yesterday; evidence.
- **#218 photos / #225 copy fix:** local on7d5c9d0 fixes async copy races, iOS owner prefixes and raw errors;244focused/High review/full gatePASS:1765mobile/892API+15skips. Evidence/prior integration. Installed above; next: iPhone selection/Process/Save/reopen/retry acceptance; native/offline/account/multi-photo/accessibility/Android/provider exits open, Production disabled.
- **#217 Pro multi-photo:**3984c35 preserved in this Dev/mobile candidate; Meals/Coach up to3 and separate drafts. Focused477/High review/full gatePASS; native/live-provider acceptance open. Evidence.
- **Usability #206/#202/#203/#208/#204/#205/#200/#182/#201/#197/#194/#196/#136:** implementation/native/provider/release exits: [prior status](../../archive/status/STATUS_PRE_MEAL_PHOTO_DELIVERY_2026-10-06.md); combined-candidate acceptance open.

## Earlier implemented packages with open exits

- **#183 recurring meals** — Exact Dev migration delivered; app-closed minute/reopen/totals, edit/delete/pause/resume/skip/stop, timezone/DST/network/two-account journeys remain open. [Plan/evidence](../../RECURRING_MEALS_PLAN_2026-10-03.md)
- **#184 Coach envelopes** — Verified fix source `17c6c49a0886b9b191b178d25e2c7bdbfa6ea9de` integrated. Accept historical and new replies on exact Dev/provider/device candidate. [Handoff][handoffs]
- **#185 per100g nutrition** — Verified source `b57b5aa3022eeca7d94dbe839b81bdb957fa031a` integrated. Accept weight/decimal keyboard, preview/Save/reopen, advanced nutrients, draft/lost-response retry and large text. [Handoff][handoffs]
- **#186 private analytics** — Real on-demand Mac dashboard 3034 initialized; synthetic 3033 remains isolated. Use `pnpm analytics:dashboard` and ignored private login. Exact instrumentation delivery, consenting/denied/revoked device capture, automatic/Community coverage and official Store imports remain open. Zero Production opt-ins means unobserved usage. #192 tracks local synthetic-verifier Docker guards. Pi hosting is superseded; 8 GB upgrade deferred until revenue. [Runbook/evidence](../../DEVELOPER_ANALYTICS_DASHBOARD_2026-10-03.md)
- **#187 one-time workouts** — Delivered to Dev; accept start/add-before-first-set/restart/log/finish/history, retries/offline, appearance/keyboard/accessibility. Only saved selections/sets are claimed restart-safe. Evidence
- **#188 prior-day meals** — Delivered to Dev; accept heading/date retention, paginated history, manual/recent/AI/Clear, restart/lost-response/conflicts/DST and accessibility. Arbitrary date picker remains outside scope. [Handoff][handoffs]
- **#189 exercise catalog / #191 pagination** — 609 active entries, original 888 IDs preserved; full gate historically passed. All 609 require qualified per-entry form/variant acceptance, 3 candidate duplicate pairs and swimming/outdoor cycling gaps remain. Accept search/readability/history/targets/restart; 200-record saved pagination deferred to #191. [Verification](../../evidence/exercise-catalog/verification-2026-10-04.md)
- **#190 direct Coach entry** — Delivered to Dev; accept first text/photo, cancellation/consent, failed creation/retry, existing threads and last deletion on both devices. [Handoff][handoffs]
- **#168/#169 Community navigation/UX** — Retained content preserves original 10s authority; cold/expired/background/account/write reads revalidate. Two-account/offline/lease/revocation/nested-screen/accessibility exits open. [Navigation evidence](../../COMMUNITY_NAVIGATION_READS_EVIDENCE_2026-10-02.md), [UX audit](../../COMMUNITY_UX_AUDIT_2026-10-02.md), [Dev guide](../../COMMUNITY_DEV_TEST_GUIDE_2026-10-02.md)
- **#178/#179:** #178 closed per Adam (Oct8); nutrients Dev-delivered/installed; device/#29 live checks unrun; #179 skip defect/actual scans retained. [AI](../../AI_ADVANCED_NUTRIENTS_EVIDENCE_2026-10-02.md). **#227 Home closed per Adam (Oct8):** refs/cards/bars installed;50focused/review/gatePASS; native checks unrun. [Home](../../HOME_NUTRIENT_LABEL_REFERENCES_2026-10-08.md).
- **#170 proactive Coach / #171–176** — Documentation-only plan; implementation requires its selected bounded package and sparse-day regression. No proactive rollout accepted. [Plan](../../PROACTIVE_COACH_PLAN_2026-10-02.md)
- **#216 Running** — Manual logging/history/edit/delete/drafts source938efc5 preserved in Deva64a158; full gate/API proofPASS, iPhone launched. Next: native acceptance; imports/GPS staged.
- **#198/#215/#219 Health** — Dev preview/selected exports; isolated full gatePASS. [Evidence](../../HEALTH_EXPORT_EVIDENCE_2026-10-06.md). Native/device/privacy gates open; Production disabled. Next: both-phone write/read-back; INT-03 separate.
- **#195/#199 CI** — Forward Community lint repair delivered; Linux43deployment fixtures and quality/navigation CI pass at9b0c41a; #199 closed. Hosted DB workflow #23 remains separate. [Delivery][handoffs]

## Community and release gates retained

**#224 COMMUNITY-UI-001:** Quiet feed UI-01–07 plus iPhone refinements on7d5c9d0; false sign-out and membership recovery fixed; social/settings/safety journeys retained. Non-author High review clear; full gatePASS:1754 mobile/892 API(+15 gated skips), iOS/Android exports; prior904 SQL/concurrencyPASS. Exact SHA pushed/deployed to Dev with three migrations; standalone iPhone9 installed/launched. [Evidence/next action](../../COMMUNITY_UI_REDESIGN_EVIDENCE_2026-10-07.md). Two-account/native/pilot/release gates open; #224closed per Adam.

Community #140/#142–162/#166–167 exits remain open; delivery false/cohort required under founder/partner Dev policy. Revocation ledger/replay, fallback and closure materials added2026-10-08; review clear; isolated gatePASS:1811mobile/937API,15gated+3config skips;1049SQL/19race/18replayPASS. [Evidence](../../COMMUNITY_IMPLEMENTATION_EVIDENCE_2026-10-08.md), [per-issue actions](../../COMMUNITY_REMAINING_ISSUES_2026-10-08.md). Independent ledger durability/coverage and physical Storage erasure open (#151/#153); restored traffic closed. Real archive transfer/decryption needs explicit authorization; none occurred. Next: choose ledger destination + run device batch; external reconciliation open.

Remaining Community exits: exact-candidate two-account iPhone/Android/offline/accessibility journeys; trained named MFA moderation/contact, alerts/absence drills; real provider/device push; legal/public/Store disclosures; adult research and four-week pilot. [Expansion evidence](../../COMMUNITY_EXPANSIONS_DEV_EVIDENCE_2026-10-01.md) preserves SQL/Auth/Storage assertions, host marker/configuration and prior artifacts. Shared-cloudflared freeze/mixed-network history requires effective isolation verification before recovery; names do not prove isolation.

Q1–Q9: [remediation plan](../../REMEDIATION_IMPLEMENTATION_PLAN_2026-09-08.md) and [evidence checklist](../../REMEDIATION_EVIDENCE_CHECKLIST.md) define closure. Build7 backend/build6 core device accepted above; signed packages verified. Exact build7/native, restore, provider/lifecycle and Store exits remain open. Future promotion requires fresh exact-SHA backup/migration checks.

[handoffs]: STATUS_PRE_AGENT_WORKFLOW_2026-10-04.md
