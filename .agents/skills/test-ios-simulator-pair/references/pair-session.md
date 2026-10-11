# Paired simulator session record

Use one dated record in `docs/evidence/<feature>-simulators-<date>/`. Omit irrelevant
sections. Put credentials, sensitive exports and private fixture inputs outside
evidence/Git. Replace the fields below with actual observations.

## Setup receipt

| Item           | Record                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------------- |
| Selected exits | Issue numbers and exact criteria this batch will satisfy                                            |
| Source         | HEAD, owned overlay paths/hashes, unchanged earlier proof                                           |
| Native         | Absolute Debug simulator app path, ID/version/signature, build receipt, native inventory/hash match |
| Backend        | Dev hosts and observed running release/migrations where relevant                                    |
| Metro          | Port, checkout/environment, owner/session/log, each device's attachment proof                       |
| A              | Name/UUID/runtime, initial boot state, synthetic alias, current enrollment/graph                    |
| B              | Name/UUID/runtime, initial boot state, distinct alias, current enrollment/graph                     |
| Preferences    | Observed theme/text category or increments/Capture Keyboard                                         |
| Scope          | Existing scoped authorizations and excluded unrelated actions                                       |

## Focused results

| Issue/exit         | Fresh baseline              | Native actor action | Recipient/private-source result           | Verdict                                   | Evidence/remaining action          |
| ------------------ | --------------------------- | ------------------- | ----------------------------------------- | ----------------------------------------- | ---------------------------------- |
| Selected criterion | Actual A/B state and values | What was performed  | Native result; separate API corroboration | PASS/FAIL/PARTIAL/CONTROL-BLOCKED/NOT RUN | Pixels/AX/proof link and exact gap |

When a publication boundary requires it: permitted recipient baseline → explicit
actor publish/revoke → fresh recipient read/denial → private source preserved.
Reuse graph/membership prerequisites, rather than recreating them per row. Choose
lease/restart/offline cases from actual criteria, not a universal checklist.

For UI/IA, record concrete behavior: wrong destination, hidden/overlapping control,
unclear label/state, keyboard obstruction, excessive taps or failed persistence.
Theme/text/keyboard/AX exposure do not establish blanket VoiceOver acceptance.

## Closure and resumption

- Map original exits to native result, applicable automatic proof and remaining gap.
- Verify actual GitHub state/status label for newly closed issues; link closure.
- List exact unrun actions and reasons, separately from confirmed app defects.
- Record restored ownership/graph/preferences and intentional fixture changes.
- Record owned sessions stopped, task-booted devices shut down and original devices retained.
- Resume from retained account/device/build map: first check fresh identity/auth/state,
  then the next missing case. Do not force a rebuild/sign-out or repeat accepted cases.

## Historical examples and limits

In the Mizyun checkout, `docs/evidence/community-simulators-2026-10-10/` contains:

- `native-continuation-summary.json`: signed artifact, pair, Metro and cleanup.
- `controller-continuation.md`: A→B→A ownership, detailed sharing, routine-copy
  independence and fixed native export. Read the latest checkpoint: later actual
  results superseded some earlier blocked attempts.
- `remaining-native-2026-10-11.md`: follow removals/block/invitation revoke/fresh
  denial, carefully distinguished from within-lease revocation.
- `additional-native-2026-10-11.md`: conflicting device metadata and18s AX/245s
  screenshot stall, with no new mute/message acceptance.
- `simulator-results-approved-2026-10-11.md`: exact accepted actions and original
  issue criteria, including Adam's decision against physical repetition.

These are dated examples, not current PIDs, available devices, credentials,
fixture state or proof that a changed future candidate passed.
