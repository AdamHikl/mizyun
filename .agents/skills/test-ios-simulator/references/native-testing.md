# Native controls, scenarios and recovery

This reference records observed DeviceHub/cua behavior from the October5–6 usability review. Re-check current tool documentation and state; element IDs and coordinates are not permanent.

## DeviceHub interaction

First CUA call must be exactly one documented entrypoint:

```javascript
var hub = await cua.getApp("com.apple.dt.Devices");
```

If continuing after context compaction, call `await cua.rewriteDocumentation()` first. Read the returned documentation. Prefer the pinned simulator's expanded device window when compact-window inputs report `noWindowsAvailable`. Select that window using its actual observed title; do not assume the first available window is the simulator. Use only exposed APIs/actions.

- After every action, inspect fresh AX before choosing the next target. `getApp` rebinds can renumber AX elements. After screenshot-only observation, request fresh full AX before index-based input.
- Use `setValue(index, syntheticText)` for iOS text fields, then verify the value. In this session `paste` inserted the user's existing clipboard into a routine name instead of the supplied test text. Do not retry blind paste or persist/capture the unintended text; correct via `setValue` and verify before saving. Secure field values must not be printed.
- Prefer AX targets. A target below the visible viewport can scroll into view and tap the sticky workout mini-bar instead. Drag the form/card until the intended control is visibly above overlays, inspect fresh state/pixels, then click. Verify the destination: opening the existing workout is not proof that One-time start succeeded.
- Coordinates come from the **current CUA window screenshot**, including DeviceHub chrome. Do not guess Retina scaling or reuse coordinates from native `simctl` screenshots: those have a different frame. One first click sometimes only activated the window; verify before a second attempt.
- If AX exposes `Raise` on the relevant window root, invoke that actual action before coordinate input. Never guess a secondary-action name or index.
- On two failed gesture/input attempts, reacquire the actual window and fresh AX/screenshot once. Prefer expanded window/visible target; if still blocked, record the specific tool failure and continue independent source/review work. Native `simctl` capture is an observation fallback, not another input mechanism.
- Device menu Increase/Decrease Text Size actions worked with freshly observed menu indices. Count increments/decrements and restore exactly; check readable full labels, not just headings. Maximum accessibility category and VoiceOver need their own observed evidence.

## Choose the smallest relevant scenario set

Record concrete expected values and whether the view was cold-rendered or remained mounted. These are examples from synthetic fixtures, not fixed account data to recreate every run.

| Feature              | Native actions and observable acceptance                                                                                                                                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in/routing      | Fresh normal Dev sign-in → known synthetic profile plus authenticated feature load; a health200 or cached Home does not prove routing.                                                                                                                                                                        |
| Meal entry           | Reuse recent meal → header Save → correct day/total. Keyboard open + blank Name → visible validation; repeated identical missing-weight Save still scrolls to error.                                                                                                                                          |
| Draft                | Normal Close → reopen → unsaved name/weight preserved. Restart/lost-storage durability is a separate explicit case; never restart an open draft to speed setup.                                                                                                                                               |
| Historical meal      | Select yesterday → Add/reuse/Save → stays on selected local day; today's totals unchanged.                                                                                                                                                                                                                    |
| Resume               | Home and Hub Resume open the existing session with its entries; session count does not increase.                                                                                                                                                                                                              |
| Batch exercise       | Select two across search, deselect/reselect → Add count/selected state → save → reopen both entries → retry retains two without duplicates. Test routine, existing logger and one-time logger separately when shared behavior changes.                                                                        |
| Picker accessibility | Separate Details/Quick select AX controls, independent expanded/selected states, readable labels and accessible Add control. AX exposure alone is not VoiceOver acceptance.                                                                                                                                   |
| Settings             | Gear → search alias → direct destination → Back/Back; compact identity does not hide search/categories.                                                                                                                                                                                                       |
| Responsive text      | Fixed enlarged font/cold render, then live increase/decrease while Home stays mounted; inspect all quick-action labels, nutrition badge/full numbers/macros, workout Resume and card Delete. Restore category. Theme changes, narrow screens, keyboard, Copy/selection and VoiceOver are separate conditions. |

After a save, reopen the feature to distinguish real persistence from optimistic display. For retries/validation repeat the same action and inspect the actual failure boundary. Avoid provider/consent-dependent paths unless separately authorized and ready.

## Evidence and proven limits

The real failures and successful paths are in [first-pass evidence](../../../../docs/USABILITY_REVIEW_EVIDENCE_2026-10-05.md) and [follow-up evidence](../../../../docs/USABILITY_FOLLOWUP_EVIDENCE_2026-10-06.md). The first pass's ignored dotenv override is historical and must not be recreated; current [ADR-0044](../../../../docs/adr/0044-native-bound-mobile-environment.md) binds effective routes and installed identity before clients.

Automatic approval review rejected a restart with an open draft. Normal Close/reopen was the safe tested alternative. DeviceHub capture/gesture intermittence left the full maximum-font/VoiceOver/keyboard matrix unverified; a source fix or reopened readable view does not close those gates.

Dated sources checked2026-10-06: [Expo environment](https://docs.expo.dev/guides/environment-variables/), [Metro customization](https://docs.expo.dev/guides/customizing-metro/), [Expo CLI](https://docs.expo.dev/more/expo-cli/), [Apple command-line tools](https://developer.apple.com/documentation/xcode/xcode-command-line-tool-reference). Installed `xcrun simctl help launch` documents app arguments; RN0.86.3 `RCTBundleURLProvider.mm` reads `RCT_jsLocation` from `NSUserDefaults`. The helper uses launch arguments rather than persistent writes; verify real rendering on the current native candidate. Expo's general dotenv documentation does not by itself prove the Debug virtual-env boundary fixed by #211.
