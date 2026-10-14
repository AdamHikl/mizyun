---
name: test-ios-simulator-pair
description: >-
  Test Mizyun sharing, recipient and permission flows on two iOS simulators,
  with a separate synthetic Dev account retained on each. Reuse one verified
  build and Metro server, serialize native input, and capture focused UI/IA and
  correctness acceptance. Use for paired simulators, not physical installs or releases.
---

# Test Mizyun with two iOS simulators

Work in the current Mizyun checkout (usual path `/Users/adam/Documents/mizyun`).
Read its `.agents/skills/test-ios-simulator/SKILL.md` and
`.agents/skills/test-ios-simulator/references/native-testing.md` for maintained
setup/build/helper/CUA mechanics.
This skill adds the paired-account strategy; do not create another launcher.
Use [pair-session.md](references/pair-session.md) for a small reusable results record.

## Select the missing work

- Map the selected issues' **original exits** to existing automatic proof, passed
  native actions and exact gaps. Reuse unchanged, dated proof; retest only when
  the relevant candidate/contract changed or an actual exit is missing.
- Select a small batch with explicit actor, recipient, expected values and result.
  Focus on UI clarity, navigation, ease of use, correctness and persistence.
  Add denial/restart/offline/accessibility cases only when relevant to the exits
  or changed boundary. Avoid a blanket regression tour.
- Honor requested ordering: finish the implementation batch before expensive
  tests; after fixes/review settle, run appropriate focused checks and the final
  required gate once. Retest only affected native flows.
- One native controller owns **both** devices. Helpers may inspect source,
  evidence or captured pixels concurrently. Use Sonnet subagents
  for this workflow's helpers (Claude Code, adopted 2026-10-14) unless Adam
  changes it, and follow project escalation rules (Opus) for sensitive work. Set
  the Agent tool's `model` field explicitly; prose does not select a model.

## Prepare once, reuse twice

1. Inventory existing devices; choose **two explicit simulator UUIDs**. Record
   initial boot state and reuse suitable accounts/devices. Never use `booted`
   as a destination or repeatedly sign out to swap actors.
2. Verify one signed **Debug-iphonesimulator** artifact's provenance, native input
   hashes/inventory and Dev routes with the base skill/helper. Reuse it for both
   devices when compatible; rebuild once only when native inputs require it.
   Derive bundle ID from the artifact/helper: observed Dev Debug used
   `com.mizyun.development`, despite topology shorthand `com.mizyun.dev`.
3. Share one owned canonical Dev Metro server on a free port. Reuse an existing
   server only if its owner, checkout, environment and bundle match; otherwise
   choose a free port. Do not kill unidentified listeners or routinely clear caches.
   Retain the task tool-session ID/log for cleanup.
4. Use the base helper's `doctor`/`launch` for each explicit UUID only where setup
   or attachment requires it; do not relaunch an untouched compatible device.
   Install only where absent/incompatible. Save/Close drafts before replacement
   or relaunch. Verify fresh bundle attachment **and** actual current feature
   rendering independently on each; a running PID does not prove current Metro.
5. Retain account A on one simulator and B on the other. A fresh authenticated
   feature read may confirm a retained correct Dev session; otherwise sign in
   normally once. Confirm Community enabled on both and inspect current graph,
   sources and membership before assuming old fixtures survived. Never copy
   Auth/Keychain data between devices. Keep credentials outside evidence/logs/Git.

Save the device/account map, artifact/source/backend identity, Metro ownership and
initial theme/text/keyboard settings. Historical Pro/B and ProMax/A assignments
are examples to rediscover, not fixed UUIDs, credentials or current fixture state.

## Run short paired flows

Community used a **10-second** permission lease in the observed candidate.
Long observations or approval waits retire controls. Do not lengthen authorization
or weaken app safeguards for testing.

1. Establish recipient baseline and exact synthetic target. Check existing scope
   and approvals before consequential actions; reuse authorization already given.
   Scoped reversible synthetic testing does not approve unrelated deployments,
   real-user actions, permission changes or external sharing.
2. Select the intended simulator through normal DeviceHub UI. Before consequential
   input, require actual window title, selected sidebar/Info UUID and current
   native actor/content to agree. Cached inspector UUIDs and tool prefixes have
   disagreed with actual pixels. Mixed identity means **no input**.
3. Use fresh AX targets and verify entered text before Submit/Save. Read enough
   current state to ground each action; capture pixels at acceptance/failure
   checkpoints rather than every harmless tap. Short sequential action/result
   packets are useful only while each target is grounded in fresh state. Do not
   queue inputs from stale indices or guess undocumented control APIs.
4. Perform only the selected actor's action (A or B); verify the relevant
   counterpart/private result and persistence after a fresh read. Retained
   prerequisites do not require a new A mutation. Check source/copy where relevant.
   Serialize API fixture writes with
   native actions so setup does not invalidate an observation mid-flow.
5. Distinguish fresh-list disappearance, fresh-detail denial and retained-screen
   revocation within its original lease. An already-expired view does not prove
   immediate revocation. Record these separately.
6. Restore approved temporary ownership/block/mute/preferences after observation.
   Track destructive withdrawal separately; re-enrollment must not restore old
   follows. Record API fixture restoration as setup, never native Join acceptance.

Owner-authenticated synthetic API reads may corroborate a result. API200, a row
or setup mutation does not prove native Join, Send, upload or report Submit worked.

## Bound control recovery

- Two no-progress inputs permit **one** grounded recovery: reacquire the intended
  window/fresh AX or pixels and try one supported method. `setValue` works only
  when exposed on that field. A caret/success return is not proof of entered text;
  verify it before saving and never retry blind paste.
- An exposed Capture Keyboard toggle may be tried once for a newly grounded
  input failure; verify the value and restore its initial state.
- Empty/ambiguous controls mean no input. If a call takes roughly30 seconds or
  observations repeatedly age every lease, stop after the current call rather
  than queueing expensive screenshots/rebinds. The last stalled screenshot took
  **245 seconds without new acceptance**. Record a tool blocker, not an app bug.
  `simctl` pixels are an observation fallback, not an input mechanism.
- For an inaccessible system prompt, request one concise human dismissal only
  if no supported action reaches it. Leave it pending; do not assume dismissal
  or repeatedly restart. An automatic approval rejection needs its stated reason
  and specific action, not a fresh permission request for already-authorized work.
- Continue independent useful work or finish with the exact missing action.
  Do not restart the same blocked scenario on every continuation without a
  material control/state change.

## Accept and leave a reusable pair

Record **PASS / FAIL / PARTIAL / CONTROL-BLOCKED / NOT RUN** for each actual action,
with evidence/candidate links. A form or picker opening is observation, not a
successful submit/upload. Reuse common passed steps across issue criteria.

Adam accepted passed Community iOS simulator actions for closure on 2026-10-11
without physical repetition. Honor that decision for those flows; do not ask for
redundant physical tests. Close only exits supported by actual native plus
applicable engineering proof. Unrun actions and separate provider/Storage-byte/
staff/legal/recovery/research/pilot evidence stay explicit. A new workflow follows
its current acceptance requirements; this skill grants no release authority.

Save/Close drafts and leave a known screen. Stop only recorded task-owned Metro/
awake processes and shut down only simulators this task booted. Retain both
accounts/data and initially booted devices; do not erase/reseed as routine cleanup.
Leave one short resume record so the next run revalidates identity/auth/state
without automatically rebuilding, relogging or repeating accepted tests.
Coordinator owns issue/status mutations and checks actual closure.
