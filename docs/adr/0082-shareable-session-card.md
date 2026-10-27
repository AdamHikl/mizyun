# ADR 0082: Shareable session card image

Date: 2026-10-26

Status: Accepted for implementation ([#334](https://github.com/AdamHikl/mizyun/issues/334), GTM-03 of [the go-to-market plan](../GO_TO_MARKET_PLAN_2026-10-26.md)). Implemented in source; iOS and Android device acceptance remain open.

## Context

Word of mouth among climbers and lifters needs something they can post to Instagram Stories or WhatsApp. Community sharing ([ADR-0030](0030-explicit-community-publication.md), [ADR-0067](0067-explicit-community-bouldering-publication.md)) reaches only approved followers inside Mizyun and needs an enrolled profile. A card image must work for anyone, without Community, and must never carry health data.

## Decision

A completed bouldering session summary and a completed workout show **Share as image**. It opens a preview sheet. The preview is the very view that is captured; **Share image** captures it as a 1080 × 1350 px PNG (4:5) in the app cache, hands the file to the system share sheet. The temporary file is deleted when the preview closes or before the next capture, because Android targets may read it after the chooser returns. Android takes the capture size in output pixels and iOS in points, so the size is passed per platform. There is no network call and no server change. Nothing leaves the device unless the user picks a target in the system sheet.

**Allowlist.** `packages/core/src/share-card.ts` builds `ShareCardContent` field by field, so the card component cannot see anything else. The card shows exactly:

- **Bouldering:** the session's local day, top grade, sends, flashes and sends per grade (hardest first, up to six rows, then "+N more"). These are the ADR-0067 fields.
- **Workout:** the local day; the number of exercises and working sets; working-set volume and each exercise's top set, both in the user's unit; duration in whole minutes; exercise names; and a "PR" mark for exercises the caller names as personal records (not yet supplied, see below).
- **Both:** a gym name only when the user types it for this card (it is never read from the session), and a small Mizyun mark. The Community `@handle` appears only for an enrolled member who switches it on for this card.

**Never on the card:** food, body weight, measurements, photos, notes, Coach text, workout or routine names (users type body weight there), hold colours, attempts, projects, times of day, and the session's own gym field. Warm-up sets are not counted. Typed text has control and bidi characters removed and is capped at 40 characters. Exercise names, including custom ones, appear as the user typed them; the preview says so. Card text ignores the system text size, so large type cannot clip the fixed 4:5 image; the card is one accessible image with a spoken summary.

**Preferences.** Card style (light or dark, default follows the system) and an off-by-default **Remember gym name** are stored per user in SecureStore on the device. When remembering is off, no gym name is stored.

**Native modules.** The card uses `react-native-view-shot` 5.1.0 and `expo-sharing` ~57.0.24 (SDK 57 bundled versions; outgoing sharing needs no config plugin or permission). Builds installed before this change lack both modules. The button is hidden unless both are present (`TurboModuleRegistry` / `globalThis.expo.modules`), and the capture module is loaded only on demand.

**Not built (later hook).** Community posts could reuse the same card image as an attached visual. That needs its own media decision (ADR-0067 left photos on cards open) and is not part of this change. The "PR" mark on the workout card waits for an all-time personal-best source ([#339](https://github.com/AdamHikl/mizyun/issues/339)). The core function already accepts `personalRecords`; the mobile screen passes none, because 50 recent sets cannot support a truthful all-time claim.

## Consequences

- A test in `packages/core`, a test of the rendered mobile tree and a wiring test of the completed-workout screen feed food, weight, measurements, photos, notes, Coach text, workout names, a session gym name and a non-member handle into the builders and prove that none of them appears in the output.
- Snapshot tests cover the rendered layout in light and dark, metric and imperial.
- A native rebuild (Dev and Store) is required before anyone can see the action.

## Sources checked

- [Expo SDK 57 captureRef (react-native-view-shot)](https://docs.expo.dev/versions/v57.0.0/sdk/captureRef/)
- [Expo SDK 57 Sharing](https://docs.expo.dev/versions/v57.0.0/sdk/sharing/)
- [react-native-view-shot README](https://github.com/gre/react-native-view-shot)

Accessed 2026-10-26.
