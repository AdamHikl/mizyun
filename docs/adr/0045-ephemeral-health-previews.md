# ADR-0045: Ephemeral weight and workout health previews

Date: 2026-10-06. Status: accepted for the first implementation segment of [#215](https://github.com/AdamHikl/mizyun/issues/215), under [integration plan #198](../INTEGRATIONS_IMPLEMENTATION_PLAN_2026-10-04.md). Native/device and release acceptance remains separate from this design decision.

## Decision

Introduce strict preview-only records and pure normalization without widening existing manual body/workout schemas. An explicit category action confirms this device's health profile and requests only body-weight or completed-exercise read permission. A new owned Expo module wraps HealthKit and Health Connect; existing steps readers/preferences remain under ADR-0028.

The first preview is an in-memory foreground session in Dev builds, with a rolling 30-day requested window and a maximum of five 100-record pages. Native page tokens are bound to type/window and retired on clearing or backgrounding. Show source, canonical units converted to the user's display units, measured/start/end times and unavailable/empty/partial states. Missing HealthKit reads cannot establish a zero or denial. Completed exercise remains a summary without invented sets, calories or personal records.

No observation, consent preference, cursor or queue is persisted. Leaving the screen, account unmount/change, explicit Clear and backgrounding retire visible results and acquired buffers. An OS permission dialog may temporarily deactivate the app: preserve only its already-submitted permission action, and read only after an active-foreground check. Explicit Clear/destroy cancels that waiter; late callbacks cannot revive a retired action. Underlying provider calls may still finish, but retired responses cannot enter a preview or create another read.

Preview records confer only local-display eligibility. They do not enter backend/account export, Coach, Community, energy/trend/workout statistics, analytics or outbound sharing. No writes, background/history permissions, watch companions, vendor cloud credentials or developer grants are included. Production settings and direct detail routes deny this preview until native/device and disclosure gates are accepted.

## Consequences

- Restart/restore cannot reactivate a connection because no preview binding is durable. Future persistence needs a separately reviewed backup/extraction, reauthorization and account-lifecycle design from INT-03.
- Native compilation and physical permission/clear/revocation/older-Android acceptance are required before rollout; Metro bundles and mocked UI tests do not prove those behaviors.
- A new binary is needed to include the local native module. Older binaries and unsupported platforms show unavailable rather than breaking manual logging.
- History is bounded and attributed. Exact provider/source/id replays collapse; equal values from distinct source records stay distinct. Coverage limits are shown, not silently counted as complete.
- Future saved observations must retain source rights and deletion/reconciliation evidence. This ADR does not authorize server copies or silently extend ADR-0028 steps separation.

## Sources

Reviewed 2026-10-06: [Expo SDK57](https://docs.expo.dev/versions/v57.0.0/), [local module API](https://docs.expo.dev/modules/module-api/), [HealthKit authorization](https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data), [HealthKit sample queries](https://developer.apple.com/documentation/healthkit/hksamplequery), [Health Connect reads](https://developer.android.com/health-and-fitness/health-connect/read-data), [Health Connect setup](https://developer.android.com/health-and-fitness/health-connect/get-started). Source and acceptance evidence is in [the implementation handoff](../HEALTH_PREVIEW_EVIDENCE_2026-10-06.md).
