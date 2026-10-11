# Workout companions — INT-07 / #232

Date: 2026-10-09. Source baseline: `0d9da8a46197f20b12f00d643851a84866368998` plus owned changes. Adam authorized the next wearable implementation and deferred physical phone testing. The existing unrelated meal-illustration/Coach edits were preserved. No commit, push, deployment, physical install or Production release is implied.

## Implemented package

Dev Apple Watch/Wear OS companions, strict portable protocol/receipt rules, optional Expo native transport, reproducible native projects, and an opt-in phone logger bridge. Watches show the current exercise, completed sets and phone-selected set type; editable reps/load, absolute rest timer, skip and explicit finish use phone-owned manual workflows. Phone foreground is required; leaving/backgrounding retires controls. Duration-only exercises remain on the phone. No health permission, sensor, cloud health table, watch Auth, vendor connection or Coach/Community sharing purpose is added. Coach inventory explicitly excludes general availability claims until device acceptance/release.

See [ADR-0054](adr/0054-dev-workout-companions.md). The phone's existing set API has no replay receipt, so uncertain commands are never automatically re-executed. Stable set sequence/time and fail-closed session receipts are implemented; server transaction isolation/background exactly-once processing is not claimed.

## Verification

Fresh coordinator checks: mobile companion/logger/workouts/Health exports316tests across24files PASS; core companion26PASS; contracts22PASS; module plugin3Node tests PASS, including actual Xcode source membership, source paths, watch embedding/idempotence/version updates and Production environment rejection. Coach knowledge9 and capability29 tests PASS. Mobile typecheck, build matrix and both bundle exports PASS. Independent non-author High review is clear after fixes to callbacks, uncertain retirement, planned IDs, late notification cleanup, completion acknowledgement lifetime and native plugin configuration.

Final `pnpm check` PASS on the combined stable local tree: input SHA256 `c722cef39b30832f9a10336c307e64854830a96fe03c059ca03030a9d6e49d7b`;1973mobile/970API tests,15credential-gated API skips. Navigation0errors/30historical coverage/review warnings; all remaining repository tooling/safeguard gates PASS. No live-provider or disposable database gate was run. [Full gate receipt](evidence/workout-companions-2026-10-09/full-gate-summary.txt) and [source/config hashes](evidence/workout-companions-2026-10-09/source-manifest.json) identify the verified scope; public indexes also retain unrelated additions. Subsequent edits record evidence only. Earlier sessions' results do not count as fresh evidence.

## Native compilation

| Check                              | Result                                                       |
| ---------------------------------- | ------------------------------------------------------------ |
| Standalone watchOS Debug simulator | Xcode27 build PASS, arm64/x86_64                             |
| Wear OS Dev APK                    | assembleDebug PASS;4JUnit tests PASS                         |
| Swift lease/outbox runner          | 19assertions PASS; coordinator reran it                      |
| Isolated Expo Dev prebuild         | iOS/Android PASS; source-native folders untouched            |
| Plugin-created watch target        | Native simulator build PASS, phone version1.0.9(9) inherited |
| Android phone transport module     | Expo57/Wear20.0.1 Kotlin compile PASS                        |
| iOS phone transport Pod            | ExpoModulesCore57.0.18 Swift compile PASS, arm64/x86_64      |

Coordinator inspected the actual completions, artifact hashes and source copies used by the isolated builds. See [native receipts](evidence/workout-companions-2026-10-09/native-receipts.json), [compiled source matches](evidence/workout-companions-2026-10-09/native-source-match.json) and [commands/identities](evidence/workout-companions-2026-10-09/native-commands.md). Generated watch build output is excluded from formatting; owned source remains checked. The native module compiles and watch target build do not establish a complete phone app native build, installation, connectivity, physical acceptance or release.

## Deferred acceptance

Both paired-device matrices remain open: phone/watch opt-in, first routine and one-time set, units/type, rest expiry/haptic and explicit finish; phone suspension/unreachable/offline, lost acknowledgements, changed commands, restart/restore/reinstall/unpair; account changes/logout and Dev/Production mismatches; accessibility, large text, keyboard/crown and battery behavior. Privacy/platform disclosures and explicit release authorization precede Production. Apple Health/Health Connect preview/export acceptance remains independently open under #215/#219.

Next exact action when Adam resumes phone testing: build/install the complete Dev phone and paired watch apps, then execute both matrices above on the same candidate. #232 remains open and ready for that acceptance. Optional INT-03 health synchronization is separate; no wearable sensor/import/vendor integration is claimed.
