# Selected outbound health export

Owned Expo SDK 57 native writer. It does not import observations, enqueue background jobs, call a server, or request permissions during apply/retry. Only deliberate foreground `requestWritePermissionAsync("nutrition" | "workout")` calls may show a platform sheet. iOS requests selected share types with an empty read set. Android requests one category's WRITE permission; the manifest declares no READ permissions.

The coordinator's encrypted, device/account/install-bound outbox owns eligibility, explicit confirmation, stable random client UUIDs, increasing positive safe-integer revisions, serialization, and retry policy. Native operation payloads contain only the projected timestamp/energy/macros or generic completed workout times. Unknown nutrients remain null; zero remains zero. The module never writes titles, food names, notes, sets, routes, weight, active energy, or estimated expenditure.

`installationIdAsync(): Promise<string | null>` returns an account-independent UUID from iOS Application Support (directory and file excluded from backup; complete file protection) or Android `noBackupFilesDir`. Absence creates a new UUID; unreadable/invalid storage fails closed. The outbox must refuse old bindings after reinstall/restore. This native sentinel supplements the encrypted SecureStore payload; SecureStore alone can survive an iOS reinstall.

## Operation and acknowledgment rules

`applyOperationAsync(operation)` accepts `{type, category, clientId, revision, nutrition? , workout?}` as defined in `index.ts`. **Delete retains the last attempted export projection's timestamps**, including timestamps from a write whose acknowledgment was lost. New payloads require a higher revision; retry the same immutable ID/revision/payload. Never overlap calls, advance to a newer operation after an uncertain mutation while native reports busy, or replay an old upsert after its delete.

iOS gives each nutrient a stable `mizyun.export.v1.<uuid>.<component>` sync ID and uses the item's revision as `HKMetadataKeySyncVersion`. Save replaces an older revision without a delete-first gap. Same-version replay relies on HealthKit synchronization semantics. Each save/delete acknowledgment is independent. Null nutrients remove the app's exact prior component; successful absence/deletion is acknowledged too. `ready` has all four nutrient components or `workout`. Deletion uses an exact sync ID, current app source, and sync version at most the operation revision. HealthKit enforces own-object deletion and write authorization. A successful delete API acknowledgment does not prove user-visible platform read-back.

Android uses an app-scoped `mizyun.export.v1.<uuid>.<category>` client ID plus `clientRecordVersion`; `insertRecords` replaces older versions. Nutrition is one record; a one-millisecond interval preserves the exact consumed timestamp while satisfying the interval record requirement. Workouts use generic strength training start/end only. Upserts replace by stable ID even when timestamps change. Delete reads only current-package records in the **last attempted projection's interval**, capped at ten pages of 100, matches the exact client ID and checks revision/ownership again, then deletes only those provider IDs. A successful own-origin query with no match handles lost-delete-response replay; read failures/history limitations never acknowledge absence. No broad read grant is requested or added. On Android 13 and lower, the module conservatively refuses to verify deletion of projections older than 30 days because it does not know the first permission-grant date and a provider might omit restricted history; the UI must retain cleanup status and direct the user to platform management. If earlier attempted revisions moved timestamps and remain uncertain, the outbox must retain their bounded interval union and process each delete interval sequentially before marking cleanup complete.

Calls require a foreground app and current generation. Clear/logout invalidates waiting work and late acknowledgments. Android keeps deliberate authorization authority separate from mutation generation: the permission activity's host pause retires mutations but preserves its own permission response; clear/logout retires both. iOS partial nutrition authorization returns a partial result so the category can retain its permitted components. Permission prompts keep their launch gate until the original callback even after timeout; native cannot cancel a system sheet. HealthKit mutations cannot be cancelled either, and Health Connect IPC may commit after cancellation. Both implementations therefore retain an in-flight mutation gate until the underlying callback/task completes. The bounded caller result may be `operation_timeout`/invalidated while the OS mutation is unknown. Native never starts an automatic retry or a later component after retirement. A permanently stalled provider leaves subsequent operations busy, visibly pending, rather than allowing old insert/new delete races.

Android checks API 28 before resolving Health Connect or `java.time` operations, while preserving the app's API 24 manifest floor. Runtime launch on API 24 still needs physical/emulator acceptance. No raw platform records, provider exceptions, IDs, or values are logged or returned.

## Verification boundaries

Run focused JS bridge tests:

```sh
pnpm exec vitest run apps/mobile/modules/mizyun-health-export/index.test.ts
```

The bounded Mac check uses real installed HealthKit/UIKit and Health Connect 1.1.0/Android 36/coroutines APIs with **Expo bridge scaffolds**. It type-checks full Swift/Kotlin definitions and runs native parser plus queued mutation/clear assertions. It is not a full app build or proof of OS permissions or actual writes:

```sh
python3 apps/mobile/modules/mizyun-health-export/checks/native-api-check.py --mode all
```

Still required: rebuilt native binary, independent review, real iPhone/Android permission grants/partial grants/denial/revocation; actual same-version lost-response replay; moved-timestamp correction; nutrient-null removal; owned deletion/replay; cancellation/lock/restore/reinstall; API 24 app launch; permission rationale/Store declarations; own-origin exclusion from read previews. Platform records and user-visible read-back require device evidence. Shared app configuration and outbox/settings wiring are outside this module's ownership.

## Primary sources checked 2026-10-06

- [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/) and [module API](https://docs.expo.dev/modules/module-api/): owned local modules, optional native lookup and foreground bridge callbacks; app minimum OS remains unchanged.
- [HealthKit sync identifier](https://developer.apple.com/documentation/healthkit/hkmetadatakeysyncidentifier) and [sync version](https://developer.apple.com/documentation/healthkit/hkmetadatakeysyncversion): stable ID plus monotonically increasing version replaces older samples.
- [HealthKit owned-object delete](<https://developer.apple.com/documentation/healthkit/hkhealthstore/deleteobjects(of:predicate:withcompletion:)>): the app can delete only its own saved objects; revoking share authorization blocks deletion.
- [Health Connect write guidance](https://developer.android.com/health-and-fitness/health-connect/write-data) and [Metadata reference](https://developer.android.com/reference/androidx/health/connect/client/records/metadata/Metadata): write-only category grants, optional nutrient values, manual recording provenance and app-scoped client ID/version replacement.
- [HealthConnectManager readRecords](<https://developer.android.com/reference/android/health/connect/HealthConnectManager#readRecords(android.health.connect.ReadRecordsRequest,%20java.util.concurrent.Executor,%20android.os.OutcomeReceiver)>): write permission permits reads of the caller's own records only; explicit current-package origin filtering adds defense in depth.
- [Health Connect historical reads](https://developer.android.com/health-and-fitness/health-connect/read-data) and [deleteRecords reference](https://developer.android.com/reference/androidx/health/connect/client/HealthConnectClient): older-provider history limits can prevent verification, and repeated/nonexistent ID deletion may fail; use scoped owned lookup and retain unverified cleanup honestly.
- [Apple backup exclusion](https://developer.apple.com/documentation/foundation/urlresourcevalues/isexcludedfrombackup), [complete file protection](https://developer.apple.com/documentation/foundation/fileprotectiontype/complete), and [Android no-backup directory](<https://developer.android.com/reference/android/content/Context#getNoBackupFilesDir()>): retain the installation binding locally with explicit non-restoration behavior; file/keychain contents are not proof of fresh install binding by themselves.
