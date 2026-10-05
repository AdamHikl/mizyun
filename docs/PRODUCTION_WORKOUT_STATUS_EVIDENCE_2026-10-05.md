# Production workout status — build7 rebuild

Adam explicitly selected1.0.7/build7 on2026-10-05 for iOS workout Live Activity/Dynamic Island, Android16+ workout Live Updates and the existing iOS rest-timer next exercise/set hint. The “Community is coming soon” text is also included; enrollment remains closed. Tracking: [#209](https://github.com/AdamHikl/mizyun/issues/209), release [#27](https://github.com/AdamHikl/mizyun/issues/27)/[#32](https://github.com/AdamHikl/mizyun/issues/32).

## Scope and boundaries

Runtime no longer restricts these workout capabilities to Dev. Settings preserves the opt-out, preference loading still gates synchronization, and finish/discard/logout/authoritative no-workout recovery cleans up status. Android below API36 keeps ordinary notifications; API36 native posting preserves permission denial, fallback and dismissed-workout suppression. Each package accepts its own link scheme only. iOS and Android display remain subject to user/system controls.

Every build profile includes the native plugins with isolated widget identities: Production `com.mizyun.app.ExpoWidgetsTarget` and `group.com.mizyun.app`; Dev uses its own bundle/group. Updates remain app-driven with no new Live Activity push provider. Canonical IPA export checks the embedded extension, executable, version, app group and signing before publication. Existing HealthKit purpose-string guards remain mandatory.

Community enrollment, private progress photos and App Preview remain disabled in Production. No API, database migration or backend configuration changes. Both backends remain accepted `9b0c41acbb7e4ee70592cab40b6148fc76a393ed`; historical build6 compatibility evidence is in [build7 release evidence](BUILD_7_RELEASE_EVIDENCE_2026-10-04.md).

## Verification and artifacts

Production bridge regressions reproduced10 failures before runtime edits. Independent review also found pending-update cleanup and channel opt-out boundaries: generation invalidation plus serialized native mutations prevent recreation after logout/finish/opt-out; a disabled Android status channel returns suppressed instead of bypassing the choice through another channel. Two deferred-update regressions failed before the fix. Coordinator focused8 suites/92tests passed afterward, including in-flight post/cleanup order, preferences/opt-out, fallback/suppression, status/rest/completion/failure, cleanup and Production timer hint. Build matrix passes all profiles and hostile environment/identity cases. Account opt-out also reproduced two failures before its correction: a successful disable immediately clears status, and every post checks account-scoped persisted preferences, declining status if storage cannot be read. This prevents a mounted logging screen’s stale toggle from reposting. Failed saves restore the toggle and show retry feedback. Final coordinator focused19 suites/218tests and mobile typecheck pass. IPA tooling passes one synthetic publication and55 expected rejection cases (26 new extension/signing cases); Bash syntax and formatting pass. The initial full gate was deliberately stopped when review found the Account opt-out gap; only a fresh settled-source rerun can accept the candidate. Independent final review/full gate and actual packages remain pending.

Previous IPA `b07513367be204e40474566697cd884d7a00e341` and AAB `9b0c41acbb7e4ee70592cab40b6148fc76a393ed` lack this feature promotion and new copy. Preserve them as historical artifacts; new exact-source signed packages are pending.

## Remaining physical and Store gates

On the rebuilt Production iPhone: enable Settings → workout Live Activity, start a workout, log a set and check rest/next-set hint; lock/background and check Lock Screen/Dynamic Island, tap back into that workout, let rest expire, finish/discard and verify status removal. Also test opt-out, app termination/reopen and logout cleanup. Devices without Dynamic Island can accept Lock Screen presentation separately.

On Android16+: enable workout notifications, start/log/rest, check ongoing notification and promoted presentation where the system permits it, tap into the matching workout, dismiss it and ensure ordinary updates do not recreate it; finish/discard/logout and opt-out must remove status. Check denied permissions and an older Android device's ordinary fallback separately. Real native interaction, accessibility and recovery are not established by mocks or signed artifacts.

Adam uploads the final IPA with Transporter and final AAB with Play Console. Upload acceptance, Store review and Store-delivered installation remain open; no agent upload or submission is authorized by package preparation.
