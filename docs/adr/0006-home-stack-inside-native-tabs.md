# ADR 0006: Home workflow stack inside native tabs

- Status: accepted
- Date: 2026-07-19

## Context

The Expo SDK 57 mobile shell uses `NativeTabs` with three declared triggers: Home, Coach, and Account. The first MOB-DAILY-001 capture slice added meal, workout, and weight files beside those tab routes and navigated to them imperatively.

Expo Router Native Tabs uses declared triggers to define the tab navigator. A hidden trigger cannot be navigated to, while exposing each workflow route as a trigger would incorrectly turn logging and edit screens into top-level tabs. The daily capture flows also require normal push/back history so a saved or cancelled form returns to the dashboard or list that opened it.

## Decision

Place the dashboard and all Home-owned workflow routes under the `(home)` route group. The `(home)` group owns a standard Expo Router `Stack`; the root `NativeTabs` layout declares `(home)` as its Home trigger alongside the existing Coach and Account triggers.

The initial routes in this stack are:

- dashboard (`(home)/index`);
- manual meal capture, daily nutrition list, and meal edit;
- minimal workout capture;
- weight capture.

The route group does not change public paths: `/`, `/log-meal`, `/nutrition`, `/edit-meal`, `/log-workout`, and `/log-weight` remain stable. Feature screens remain under `apps/mobile/src/features`; route files are composition-only exports.

## Sources consulted

- Expo SDK 57 Router API: https://docs.expo.dev/versions/v57.0.0/sdk/router/
- Expo SDK 57 Router Stack API: https://docs.expo.dev/versions/v57.0.0/sdk/router/stack/
- Expo SDK 57 Router Native Tabs API: https://docs.expo.dev/versions/v57.0.0/sdk/router/native-tabs/

## Consequences

- Home logging and detail routes receive normal stack push/back behavior without appearing in the native tab bar.
- Selecting Home continues to use the platform-native tab implementation; Coach and Account remain independent tab roots.
- Future Home-owned history, trend, energy, and progress screens join the `(home)` stack rather than becoming root tab siblings.
- The web tab implementation continues to point its Home trigger at `/`; route-group segments do not appear in URLs.
- Moving a workflow to a different top-level product area requires an explicit route-group change rather than silently adding another native tab.
