# ADR-0054 — Dev phone-owned manual workout companions

Date: 2026-10-09. Status: accepted for the user-authorized Dev implementation under [#232](https://github.com/AdamHikl/mizyun/issues/232), INT-07 and [the integration plan](../INTEGRATIONS_IMPLEMENTATION_PLAN_2026-10-04.md). Physical acceptance is deferred, not waived.

## Decision

Add native Apple Watch and Wear OS companions for current exercise/set display, manual repetitions/load with the phone-selected set type, an absolute rest deadline, skip rest and explicitly confirmed completion. The authenticated phone logger remains canonical and owns API calls, progression effects, drafts, notifications and saved-workout export eligibility. Watch transport contains no account identifier, token, note, media, sensor record or Coach payload. Watch entry is deliberate manual entry, not a Health import.

Initial authority is Dev-only and lasts only while the active phone workout screen is foreground and explicitly connected. Leaving, backgrounding, logout, account/workout changes or restart retires the random binding. The user reconnects deliberately. Unreachable/suspended phone operation is represented as pending or unavailable; this slice does not promise background/standalone workout execution.

## Protocol and recovery

Strict version1 JSON schemas bound payloads, identifiers, performance values, revisions, timestamps and expiry. A watch issues a fresh launch/activation nonce before accepting a personalized phone snapshot. Snapshots are memory-only, lease-bound and sent by immediate messages; retained Watch Connectivity application context or Wear Data Layer items carry only nonsensitive clear tombstones. Wear Data Layer may traverse Google's end-to-end encrypted cloud relay and requires identical package/signature pairs; do not claim strictly local transport.

Phone commands are checked against current nonce, random binding, workout, semantic revision, category availability and lease. A 64-entry in-memory receipt ledger claims an immutable operation before dispatch; it never evicts a potentially attempted operation. A duplicate returns its receipt, while altered payload, stale state, concurrent action or exhausted capacity fails closed. A possibly committed result is uncertain and blocks another watch action in that session. Disable/foreground retirement cannot erase an in-flight uncertainty barrier. Fresh bindings never authorize old commands. Protected bounded watch command outboxes retain exact immutable messages for acknowledgement; new bindings discard them rather than reinterpreting them as current input. Watch snapshots/bindings and queues are excluded from restore/transfer authority.

The existing set endpoint does not implement operation receipts. This slice therefore never automatically repeats an attempted API mutation. Watch saves include a stable observed timestamp and explicit unique per-workout sequence. A collision cannot be claimed as success without the original response; the user checks saved sets on the phone. This is a bounded foreground command guarantee, not server compare-and-swap or full multi-device transaction isolation. Reliable background/cloud retry requires a separately reviewed server receipt package.

## Workflow reuse

Routine and one-time sessions use the existing logger. Planned exercise identifiers remain bounded opaque IDs until the logger resolves their saved exercise. `working` in the companion protocol explicitly maps to existing `normal` set type. Canonical kilograms cross the transport; display units are selected by the phone. Duration-only exercises remain phone-only in this first manual strength slice.

Watch completion reuses existing progression, completion, notification and draft cleanup. It remains on the saved phone screen so its acknowledgement can be delivered; a watch command cannot automatically publish Community content. Health export consent remains a separate purpose.

## Acceptance

Regression tests must exercise lost acknowledgements, changed-payload replay, expiry, stale revisions, in-flight disable, unknown saves, completed/history guards, units and shared logger effects. Independent non-author High review checks privacy and binding retirement. Native watch builds and generated-project integration are separate evidence from schema tests/Metro exports. Physical paired-device suspend/offline/restart/unpair/account/reinstall/accessibility and privacy/platform declaration checks remain required before Production. [Evidence](../WORKOUT_COMPANIONS_EVIDENCE_2026-10-09.md) owns actual outcomes and limitations.

Primary sources checked: [Expo57](https://docs.expo.dev/versions/v57.0.0/), [Apple Watch Connectivity](https://developer.apple.com/documentation/watchconnectivity), [Wear Data Layer](https://developer.android.com/training/wearables/data/overview), [Wear synchronization](https://developer.android.com/training/wearables/data/sync).
