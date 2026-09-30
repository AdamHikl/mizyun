# Mizyun current status

> Updated 2026-09-30. Earlier package evidence, operational snapshots and concurrent work are preserved in [the pre-review archive](docs/archive/status/STATUS_COMMUNITY_PRE_FINAL_REVIEW_2026-09-30.md). Historical next actions are not current instructions.

## Community joining inside the tab — 2026-09-30

Adam requested joining directly in Community. In progress under #142/#150 from clean `2b1e0ead461413c28d098b39ef8d441c5a289a52`: reuse the enrollment/profile/consent form inside the tab, preserve secondary Account privacy settings, and verify membership before showing the feed. Explicit adult/rules consent, server admission, private profile separation and private tracking exit remain. Helper owns embedded form/tests; coordinator owns feed integration/continuity/resources; independent review covers recovery and lifecycle boundaries. No backend or Production change.

**Automatically verified:** independent non-author review approved corrected lost-response recovery; focused61tests pass. Fresh settled-source `pnpm check` exit0 (mobile1011/API730,15 gated API skips, dual Hermes/typechecks/safeguards). [Durable inline joining evidence](docs/COMMUNITY_INLINE_JOIN_DEV_2026-09-30.md). **Next exact action:** commit/push and install exact Dev candidate on Adam’s iPhone. Earlier navigation acceptance applies only to the previous build; inline enrollment acceptance remains pending.

## Community primary navigation — 2026-09-30

Adam approved five tabs Home / Workouts / Meals / Coach / Community, with Account in a consistent header avatar. Work is active under #150 on `codex/community-140-145`, baseline `0ac0371eb4900a19e77afb7e531d83e5f3b1e3fe`; initial tree clean. Existing `/community` moves into tabs and `/settings` moves to root Stack without changing URLs; private Home remains default. Community groups feed/Find friends/Requests/Inbox/My profile, with voluntary join/private exit and no auto enrollment/sharing. [ADR-0031](docs/adr/0031-community-tab-account-header.md) records the approved navigation choice.

Helper owns feed UI/tests; coordinator owns routes/header/continuity/resources. Independent review found and accepted the corrected retained-tab membership refresh: focus/foreground hides feed before a fresh profile read, with late-response guards. Fresh full `pnpm check` exit0 (mobile1006/API730, 15 gated API skips, dual Hermes/typechecks/safeguards); focused independent screen/controller checks50pass. Signed standalone Dev1.0.6(6) installed from exact clean source `9112498d457218f9b96b64bf21d97a0052abab65` at19:46:37Z, signature/Apple capability/Dev endpoints pass, JS hash `be68134747490eb809379a0a86a2f36e0f388ee2f0ae5709af8e938924b3580d`. Console launch mainPID70440 at19:47:17Z. [Durable navigation evidence](docs/COMMUNITY_NAVIGATION_DEV_2026-09-30.md). Adam confirms Community tab and Account/Back work; remaining per-tab/large-text/VoiceOver/offline/join/leave/sharing journeys are unaccepted. No backend, schema or Production operation.

**Next exact action:** Adam deliberately joins Community, verifies profile persistence and workout preview/publish/unpublish, then join/leave return, offline and accessibility on the installed Dev app. Source9112498 is committed/pushed; no backend update needed. Original Community/partner/operator/legal/restore/push/pilot gates and returning Apple login stay separate.

## Community Dev Apple sign-in blocker — 2026-09-30

Adam reported Apple sign-in failing before the Apple sheet. Actual native project and signed Dev app lacked Apple capability. Dev installer reused matching bundle ID without checking entitlements. Added Dev-only missing-capability regeneration and signed Default-capability refusal before install; baseline installer fails the new regression, corrected installer passes7checks. Independent non-author review approved. Fresh `pnpm check` exit0 (mobile995/API730, 15 gated skips, dual Hermes/typechecks/safeguards). [#164 and durable evidence](docs/COMMUNITY_APPLE_DEV_ACCEPTANCE_2026-09-30.md) retain exact proof and separate acceptance.

Corrected standalone Dev1.0.6(6) installed on Adam's exact iPhone at19:15:36Z; actual signed capability and signature verification pass. Embedded JS hash remains `0d56edb625cf0a31cd41021f34c0eae58e87a5c32a27e62815b57cb3c19f9cc7`. Console attached to corrected mainPID70346 at19:16:17Z. No backend changes/deploy required; Dev remains282d740. No Production actions.

**Device sign-in accepted:** Adam confirms the Apple sheet appears and sign-in succeeds; Dev Auth ID-token200 corroborates at19:16:28Z. **Next exact action:** verify returning-user sign-out/sign-in, then resume deliberate Community join/share/unpublish. Community acceptance remains pending; no issue closed. Partner identity still requires separate authorization.

## Community founder Dev testing activation — 2026-09-30

Adam authorized interactive Dev Community testing and explicitly excluded Production. **Dev deployed** at `282d740d93b338fb508cbad2a8fa27f5a605b9c8` (runtime `d81c10f60c0aebc6b2240e48e69e4678addc8079`), fresh exact-candidate `pnpm check` passes, remote checkout pristine, migration ledger current through230000. Public health200 and anonymous profile/feed401. Exactly one supplied eligible Dev principal is admitted; cohort_requiredtrue, master/growth true, deliveryfalse. No auto-enrollment/consent/profile/graph/publication occurred. Independent review approved source and transaction assertions. Dev privacy timer runs with zero push claims/receipts. [Durable evidence and 193-path source manifest](docs/COMMUNITY_DEV_TESTING_2026-09-30.md) record the exact scope and checks.

**iPhone installed:** latest signed standalone Dev Release1.0.6(6), bundle `com.mizyun.development`, new embedded bundle hash verified. Launch is currently blocked by the locked device; installation does not prove signed-in UI acceptance.

**Next exact action:** unlock/open Mizyun Dev, sign into the admitted account and open Account → Privacy & data → Community. Exercise deliberate Join, explicit workout sharing and leave/rejoin; obtain a separately authorized partner Dev identity for follow/approval/reaction tests. Push delivery and original participant/device/operator/legal/restore/pilot gates stay open. Production received no changes or further probes.

## Community Dev deployment — 2026-09-30

Adam confirmed deployment and standalone iPhone installation of `49d3e19f5cc0e7d0c4bc4c1fd5ff68adad651300`. **Dev deployed**: fresh exact-candidate `pnpm check` passes; encrypted Dev DB snapshot taken; all14 Community migrations through230000 applied; remote HEAD/journal/pristine checkout match. Public health200, unauthenticated profile401 and globally closed feed503. Live REST service-JWT own-target controls200 and both cross-targets401; new Dev aggregate RPC200. [Durable deployment evidence](docs/COMMUNITY_DEV_DEPLOYMENT_2026-09-30.md) records exact targets, snapshot, checks and qualifications.

**iPhone installed**: signed standalone Release `com.mizyun.development`1.0.6(6), Xcode27.0, Adam's iPhone16Pro `00008140-001114501A86801C`; Dev endpoints/embedded bundle/entitlements verified. Initial automatic launch was blocked by the locked device; Adam later opened the app and main PID69763 was verified. No signed-in Community feature acceptance claimed. Admission/delivery controls and cohort stay closed. Logging follow-up [#163](https://github.com/AdamHikl/mizyun/issues/163) records missing requestId in the disabled-operation503 response.

This is the earlier closed candidate. Adam reported it open but unable to access interactive Community; the newer founder Dev testing entry above is current. No broader cohort, push delivery or Production/Store release is inferred.

## Community #140–155 source review and publication (before deployment)

Review/fixes complete in source on `codex/community-140-145`, base `f37a0f7491b4d1f3732c00c62f6385c7bcc7a59e`, preserving prior #146–155 work and the existing settings fix. [Final review evidence](docs/COMMUNITY_FINAL_REVIEW_2026-09-30.md) supersedes older Community candidate claims; prior dated manifests/log results remain historical.

Corrected closed admission/cohort/global read controls, frozen privacy reductions, invitation discovery bypass, Auth-deletion lock ordering, bounded deduplicated reporting receipts/ambiguous activity query, expired-card delivery, original queue-age metrics, short serial push leases, terminal-control injection and erased moderation audit copies. Mobile/identity review fixes captured-session logout/SDK transition ordering, newer push bindings, reaction permission-loss card invalidation and cold-start/profile owner isolation. At review completion, forward210000/220000/230000 were Mac-scratch-only; the newer deployment entry above records their actual Dev application.

Fresh `pnpm check` passes (mobile 977/API 730, 15 existing gated skips, dual Hermes exports, typechecks, safeguards, 56 offline invariants and 26 CLI/worker tests). Isolated SQL passes 526 assertions/22 files plus real enrollment/relationship/publication/moderation races and synthetic capacity. Combined runtime SHA `f063d7a78e38e3bf6cad7e44f0b7edfcc74f16c9` matches the final 187-file manifest. Original participant/device/provider/operator/legal/restore/pilot exits remain open; #141 local foundation remains done. Admission/delivery defaults closed and require explicit target/cohort activation. Source completion is separate from release acceptance.

The six implementation/evidence commits were pushed at `49d3e19f5cc0e7d0c4bc4c1fd5ff68adad651300`. Adam subsequently confirmed the Dev/iPhone action; see the newer deployment entry above. Original participant/device/operator/legal/restore/pilot exits remain open.

## Active priority — InVenture, October 2–3

Founder decision 2026-09-23: prioritize a presentable, distinctive demo and program partnerships toward a longer-term ambition of over 100,000 users. [INVENTURE-001 / #125](https://github.com/AdamHikl/mizyun/issues/125) is ready for execution; the [program plan](docs/INVENTURE_PROGRAM_PLAN_2026-09-23.md) defines the nine-day schedule, pitch, acceptance checks and growth experiments. Planning documents are updated; demo assets, interviews, pilot commitments and event-build acceptance remain outstanding. Defer SIMPLIFY-03 and unrelated feature expansion. All release gates below remain in force.

## Other active work and evidence

The pre-review archive preserves workout reordering/set types (#138/#139), iPad consent (#135), Pro nutrition (#134), Account/theme/steps (#133/#132/#39/#40), website (#127/#128), native workout status (#123/#126/#130), reminders/progression/timers (#118/#119/#121/#122), Q1–Q9 and infrastructure/account acceptance. Current Community work does not close their independent device/provider/Store/restore gates. Website remains a separate checkout; Production IPA upload remains Adam's manual Transporter action.

## Current environment authority

| Environment | Authority                                                          | Last evidenced source                                                                          | Scope                                                                                                                     |
| ----------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Local       | `/Users/adam/Documents/mizyun`                                     | `9112498d457218f9b96b64bf21d97a0052abab65` (Community navigation candidate)                    | Navigation source/automatic verification and Dev iPhone installation; physical navigation acceptance pending              |
| Dev         | Hetzner CX23, `/var/lib/mizyun/dev/repo`, `mizyun-api-dev.service` | `282d740d93b338fb508cbad2a8fa27f5a605b9c8`; public health200 at2026-09-30T18:38:30Z            | Community migrations through230000; one-account Dev admission enabled, delivery off; signed-in feature acceptance pending |
| Production  | Hetzner CX23, `/var/lib/mizyun/repo`, `mizyun-api.service`         | `0aadf95b5ff85d9cfc8bf5485e68a72525080e84`; public health HTTP 200 at 2026-09-24T17:19:09.447Z | Promoted accepted SHA, encrypted backup taken, migrations applied, older clients verified                                 |
| Recovery    | Raspberry Pi 5                                                     | Encrypted daily Production archive workflow and accepted restore point `20260919T103343Z`      | Recovery storage only; not a deployment target or writable failover                                                       |

## Rules and open gates that must survive handoff

- AI access is consent-based for authenticated adult-eligible users. `AI_ALLOWED_EMAILS` is deprecated and ignored. Preserve consent/revocation, authentication, provider kill switches and usage limits. Dev retains its explicit shared-Gemini testing exception.
- The local Qwen/MLX/OpenCode worker is paused by user decision and must not receive tasks. Built-in repository subagents remain required for substantive work.
- Keep **implemented**, **automatically verified**, **Dev deployed**, **device accepted** and **Production released** separate. Historical checks are not fresh verification.
- Q1–Q9 remain governed by [`docs/REMEDIATION_EVIDENCE_CHECKLIST.md`](docs/REMEDIATION_EVIDENCE_CHECKLIST.md). Known open release work includes Q2 durable unknown-outcome persistence, Q7 consent-context continuation, Q8 live model evaluation, Q9 effective-target/rollback proof, signed distribution evidence and Gate R8 physical-device plus off-device restore acceptance.
- Account export/deletion (#25), founder alpha (#37), provider/live-evaluation work (#29/#30/#36) and store publication remain separate work packages; simplification does not close them.
- Production promotion requires an explicit accepted 40-character SHA, fresh local `pnpm check`, accepted Dev/device evidence, pre-promotion backup/migration safeguards and explicit user authorization.
