# Community #150 / #151 / #156 — October11

This batch implements genuine #151 gaps and performs only missing iOS acceptance subsets. Android remains explicitly skipped. Passed simulator actions need no physical repetition; actual VoiceOver, operator, retention and recovery exits have never passed and remain separate.

## Source and review

Isolated base `b60bf9b27fd6af2b4e3e4de906975cb86d51617e` plus the [owned source hashes](lifecycle-source-2026-10-11.json). Pre-existing meal/cache/Android/watch work is excluded from the verification candidate and preserved in the primary checkout. The nine tracked owned diffs applied cleanly over saved root pre-images; three new SQL files were integrated without replacing existing files.

#151 now exports **33 social categories**, adding participant-only challenge memberships and author per-card comment settings. Both use caller-scoped sanitized keyset RPCs. The subtree version is `2026-10-11`, while earlier versions remain readable. Null/non-array/oversized pages and malformed rows abort export instead of being treated as a complete empty category. See [inventory](../../ACCOUNT_EXPORT_INVENTORY.md).

Forward migration `20261011120000` records content-free mute/mention/comment-setting/notification reductions, detailed-to-summary sharing and edited-away comment/message content. Replay preserves owner/artifact generation fences and closed quarantine. Edited prior artifacts are conservatively revoked; notification narrowing conservatively mutes all delivery. Same-generation later opt-ins may need deliberate re-consent after an independently accepted restore. The prior applied migration was not rewritten. [ADR extension](../../adr/0052-community-revocation-capture-and-quarantined-replay.md), [independent review](lifecycle-review-2026-10-11.md).

The independently reviewed changes leave messaging-muted metadata, retention pruning and custody unchanged. Review found no actionable finding; a new High reviewer could not spawn because the tool reached its thread limit, so the existing nonauthor reviewer was reused with non-introspectable effort, explicitly qualified in the review receipt.

## Final focused execution

Implementation/review writes settled before tests:

- Exporter and account adapter: **41/41 PASS** (11 exporter and30 account tests), `/private/tmp/mizyun-lifecycle-focused-20261011.log`.
- Node ledger reader: **8/8 PASS**; Python reader: **8/8 PASS**. Malformed new-kind owner/generation/peer scopes rejected.
- Real disposable SQL: **206 assertions /6files PASS**, including25 new privacy-reduction assertions and18 committed restart assertions. [Receipt](lifecycle-db-2026-10-11.json).
- The committed scratch fixture starts with61 invented accounts/120 incoming+outgoing edges/50 shares/50 invitations/60 incoming delivery references. It establishes positive read authority before accepting deletion, commits a bounded batch, expires/replaces the lease, proves stale workers do nothing, resumes through a new lease and exhausts social references. A remaining physical row is unreadable after the committed barrier. This is SQL lease recovery, not a deployed worker-process or physical Storage drill.
- Network-isolated synthetic replay: **28 events PASS**, repeated application0; old generations cannot narrow newer health projections/preferences; exact owner denial, idempotence, conflict and open-environment rejection pass. [Receipt](lifecycle-replay-2026-10-11.json). External completeness, physical bytes, retained report audit and reopening remain explicitly false/unverified.
- Requested `src/account.test.ts` contract filter matched no file; its exit0 ran **no tests** and is not counted as acceptance. Contract/core version changes are covered by the final full typecheck/suite gate.

The final `pnpm check` receipt is recorded in the final handoff. The native packet is complete below. No provider suite, blanket Community tour or unchanged identity/follow/sharing/reaction test was repeated.

## Simulator scope

Retained two normal synthetic Dev accounts, Community enabled; A on Max `74C55221-5CFB-434F-BE42-492349429896`, B on Pro `F4939E5D-BA85-4479-AA1E-92B21441FB8C`; signed Debug `com.mizyun.development`1.0.9(9), iOS26.5. Fifty-eight native hashes matched; removing exactly two new Android-only plugin entries reproduces the saved59th iOS config hash. No rebuild or reinstall. One owned Metro8085/session71564 served both fresh processes A58386/B58639. Debug+Metro is distinct from standalone physical/Release acceptance.

Current Dev remains `2596a69b3fe4d20920a173de91fb4dc533b9bd4a`; the33-category/new-ledger candidate has **not** been deployed. Native comment acceptance uses the unchanged comment runtime and current two-account Dev cohort; it does not prove the new backend migration is live.

Own-authenticated fixture setup, separately qualified from native acceptance, restored one B→A approved prerequisite and one A summary share from the retained private synthetic source, opened its comments and added one clearly marked synthetic root comment. Both mention preferences began false. The sole controller uses fresh title/sidebar/Info UUID/actor agreement and bounded recovery. [Native results](comments-native-2026-10-11.md).

Apple explicitly states VoiceOver is unavailable in Simulator; source/native AX inspection does not prove spoken focus/gesture operation. [Primary Apple documentation](https://developer.apple.com/documentation/accessibility/performing-accessibility-testing-for-your-app). #150 therefore retains its genuine screen-reader exit.

## Original exits and exact remaining inputs

| Issue | Completed source/accepted subsets                                                                                                                                              | Remaining original exit and exact next input                                                                                                                                                                                                                                                                                                                                                        |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #150  | Existing accessible navigation/state source; reused accepted enroll/invite/follow/share/reaction/block/withdrawal subsets; new native record below                             | Actual VoiceOver discovery/operation of primary and safety controls; unrun offline/disabled/full layout conditions. Provide an unlocked suitable physical iPhone for the missing VoiceOver-only check. Android was skipped at Adam’s request; no TalkBack/Android pass is inferred.                                                                                                                 |
| #151  | Own export/source categories fixed; malformed transport denied; real committed SQL high-degree lease recovery/generation cleanup; additional capture and28-event closed replay | Accept exact Dev candidate deployment for fresh33-category native export/deployed restart. Choose independent encrypted ledger destination plus responsible operator/key custodian, accepted archive horizon/retention/holds; separately authorize a real Dev archive recovery and relevant Storage/Auth/RLS/ACL verification. Synthetic replay cannot certify archive-to-cutover custody/coverage. |
| #156  | Existing partial-failure edit/delete/moderation/forged-parent/spam/denial SQL; prior own native edit/delete; new bounded native record below                                   | Operator drill and both-platform thread accessibility before broader activation remain explicit original readiness exits. Name the MFA-trained moderation/absence/escalation operator and permit the bounded drill once shared safety/pilot dependencies are ready. No global expansion/staff/provider flag changed.                                                                                |

These are the original issue exits, not invented extra physical repeats. An issue remains open where its original required evidence is missing; no gate is moved elsewhere to manufacture closure.

## Final native outcome and restoration

Native PASS: A deliberate mention opt-in and opt-out; B eligible mention candidate before opt-out and absent after a fresh refresh; one B Other report with native acknowledgement and own report persistence. [Owner-API corroboration](comments-api-corroboration-2026-10-11.json) confirms restored A/B mention preferences false and exactly one synthetic report.

CONTROL-BLOCKED: B reply text remained blank after one supported Capture Keyboard recovery. No reply publication, A recipient mention event or destination pass is claimed. A material input-control change is needed before another attempt, not another unchanged retry.

The controller stopped with both matching Home screens and Capture Keyboard off. Root then revoked only the exact synthetic share and removed only the sole B→A prerequisite edge through normal owner-authenticated APIs. Both accounts remain Community-active with five graph/block counters zero; private source retained, mention preferences restored false, one synthetic report retained. Owned Metro71564 stopped; only task-booted Max shut down, initially booted Pro retained. No Storage erase, Auth deletion, global configuration, deployment or Production operation occurred.

## Final full gate

Standard `pnpm check` **PASS/exit0**, input SHA256 `9f229ff6a97d8ec385b202a5adb4e46fcd23155671c0b75b13ebc5006b29e72b`: **2047mobile/980API**, all typechecks, dual Hermes bundles, formatting, navigation and safeguards. Existing15 credential-gated API and3 config bundle-path skips remain unrun. [Exact receipt](lifecycle-full-gate-2026-10-11.json). Runtime/test inputs stayed unchanged afterwards; only receipt/status/evidence prose was updated after the gate and formatted separately. Initial candidate continuity link/size failures were corrected before this final passing run. No new deployment or issue closure claimed.

Local committed candidate `6db9130d26705506f96696f6027d77c6ff3e9632`, branch `codex/community-lifecycle-comments-20261011`, preserved in the primary repository without moving its checkout. Candidate clean; no push/deployment.

Read-only exact-candidate preflight PASS: clean checkout, Hetzner primary marker and public Dev health200. [Final handoff/issue links](lifecycle-handoff-2026-10-11.json). All three issues remain OPEN/status:blocked with completed subsets and exact original missing exits recorded. Push/Dev migration approval remains pending; no deployment occurred.
