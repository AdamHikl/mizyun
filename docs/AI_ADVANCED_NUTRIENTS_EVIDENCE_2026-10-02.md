# AI additional nutrients — implementation and acceptance evidence

Date: 2026-10-02. Work item [#178](https://github.com/AdamHikl/mizyun/issues/178), requirement NUT-08, [ADR-0035](adr/0035-ai-advanced-nutrient-drafts.md). Baseline `1797fedbf3818b2f228b88decde6f2a91bfa2405`; clean `main` startup, implementation branch `codex/ai-advanced-nutrients`.

## Implemented behavior

Photo/text meal drafts, Coach meal proposals and deliberate saved-meal refinement support fibre, saturated fat, total sugars, sodium and dietary cholesterol. The server uses the same paid/approved Beta Pro grant as advanced editing. Free quotas, consent, adult eligibility and provider controls retain their existing behavior. An entitlement lookup error disables extras while basic drafting continues. No database migration or automatic historical backfill.

The provider requests grams for the first three fields and milligrams for sodium/cholesterol. Optional nullable contracts preserve older drafts, unknown and zero. Finite bounded estimates use existing two-decimal storage precision. Contradictory saturated fat/sugars become unknown with a warning; unsafe responses clear all fields. Pro requests prefer supported product/label values, otherwise food/portion estimates with explicit uncertainty. Provider versions: `nutrition-draft-v4` / `nutrition-draft-refine-v3`.

The editor fills editable values, uses current manual edits for AI refinement, refreshes capability before input and output, protects in-flight edits, preserves missing legacy fields and requires deliberate Save. Portion resizing retains known advanced values. Historical nutrients remain accessible under the existing downgrade policy.

## Reproduced failures and synthetic verification

- Contract regression reproduced six failures before extending the schema: the five nutrients disappeared, and invalid values were accepted as ignored keys. After change, focused contract suite17/17 PASS.
- Provider helper reproduced nine initial rich-output/validation/refine/unsafe failures, then two consistency/warning-cap failures. Final provider package51/51 and runtime50/50 PASS; package typechecks PASS. These are synthetic clients, not live Gemini nutrition evaluation.
- Coordinator API tests130/130 PASS across food entries/drafts and Coach text/photo proposals. Tests cover free/pending/rejected/approved/paid grants, a paid quota override on a free profile, input/output stripping, failed lookup, client flag rejection, persisted proposals and absence of automatic confirmed-meal creation.
- Mobile helper focused meal tests136/136 PASS across12files, mobile typecheck PASS. Real Edit screen regressions cover editable filling, explicit Save, unknown/zero, missing legacy fields, portion scaling, capability arriving late, edits during refinement and lapse before Save.
- Mandatory independent non-author review covers server entitlement/consent/ownership, provider bounds, current-form refinement, pending edits and confirmation. Contradictory estimates, capability/form races and stale nutrients on new meal replacement were resolved. Final independent review has no unresolved blocker; accessibility disabled-state polish was also applied.

Full repository gate: isolated `pnpm check` PASS (exit0), log `/private/tmp/mizyun-ai-nutrients-isolated-check-2026-10-02.log`. Final counts: navigation72, mobile1157, API794(15 existing credential-gated skips), contracts165, core351, server adapter144, runtime50 and Gemini51. Formatting/typechecks, dual Hermes exports, safeguard/operations/build/offline evaluation checks all passed. The shared-workspace attempt stopped on formatting in concurrent Community edits. A temporary detached checkout at the exact baseline contains only the nutrient changes, cloned local dependencies, standard ignored Expo type declarations and a sibling documentation link. No concurrent Community edit is accepted as part of this candidate. Initial isolated setup lacked the sibling website link and ignored Expo types; these environment prerequisites were copied/linked, then the complete final gate passed. Runtime files match the owned shared-workspace files byte for byte.

The config suite initially skipped three purity assertions because its legacy bundle path differed from current dual export paths. Direct scans of the actual iOS/Android Hermes artifacts passed three checks each; with a temporary iOS artifact alias, `pnpm --filter @mizyun/config test src/mobile-public.test.ts` passed6/6. [#179](https://github.com/AdamHikl/mizyun/issues/179) tracks the existing test-path defect. No live provider, database/RLS or native journey suite was run; no schema changed.

## Remaining acceptance and next exact action

No live model call, Dev backend deployment, native installation or physical-device acceptance occurred in this implementation session. Provider quality is unmeasured for the new fields. Existing `docs/BEFORE_TESTING.md` and #29 gates remain open; synthetic fixtures do not satisfy them. No Production release or new public availability claim.

Next: deploy the exact checked candidate to Hetzner Dev and install a standalone Dev app when authorized, then on the existing founder/partner accounts:

1. With Pro and current AI consent, draft a synthetic labelled meal from text and a label/meal photo. Confirm the five fields are filled where supported, unknown is blank, zero displays as0 and unit conversion is correct. Review assumptions and uncertainty.
2. Open an older meal whose additional nutrients are blank. In **Refine meal with AI**, ask “Estimate fibre, saturated fat, total sugars, sodium and cholesterol for this meal.” Verify editable filling, current manually corrected values, explicit Save and reopen.
3. Resize the saved portion and verify known values scale, unknown remains blank and all units remain correct. Repeat via Coach text/photo proposal and review before logging.
4. Start refinement, edit a field while waiting and confirm newer edits survive. Check failure/offline recovery, draft restart, pending-request Save, capability-loading and grant lapse before Save. Use current two-account ownership checks; free basic logging remains usable and extra fields cannot be newly written after lapse.
5. Exercise keyboard, large text, VoiceOver/TalkBack and light/dark modes on standalone iOS/Android candidates. Record source/build/device IDs and PASS/FAIL/NOT TESTED per case without recording real health data in evidence.

Actual model accuracy against known labels/weighed synthetic meals is a separate gated evaluation, with per-nutrient coverage/error and model/cost/latency evidence. Never call these estimates exact or medically authoritative.
