# ADR 0025: Root Stack over Native Tabs for Cross-Tab Modal Navigation

- Status: Accepted
- Date: 2026-09-11
- Supersedes: [ADR-0006](0006-home-stack-inside-native-tabs.md)

## Context

In ADR-0006 (2026-07-19), Mizyun had three native tab triggers: Home, Coach, and Account. Capture and logging workflows (`log-meal`, `log-workout`, `log-weight`, `edit-meal`, `feedback`) were nested within a `Stack` inside `apps/mobile/src/app/(home)/` to prevent them from becoming undeclared or unwanted triggers in `NativeTabs`.

Subsequently, dedicated top-level tabs for **Workouts** (`/workouts`) and **Meals** (`/meals`) were introduced. Users frequently log meals from the Meals tab, start workout sessions from the Workouts hub, receive action proposals from the Coach tab, or report feedback from any tab via `FeedbackHeaderButton`.

Because the modal screens remained nested inside the `(home)` tab's Stack:

1. Navigating to `/log-workout` or `/log-meal` from other tabs forced Expo Router to switch the active tab to `(home)` before presenting the modal.
2. Dismissing or completing the modal via `router.back()` or native iOS swipe-to-dismiss popped the modal inside `(home)`'s stack, leaving the user stranded on the Home dashboard (`/`) rather than returning to the originating tab (`/workouts`, `/meals`, `/coach`, or `/settings`).

## Decision

Restructure mobile app navigation to the canonical Expo Router architecture:

1. **Root `<Stack>` in `apps/mobile/src/app/_layout.tsx`**:
   - Declares the `(tabs)` route group with `headerShown: false`.
   - Declares modal screens (`log-meal`, `log-workout`, `log-weight`, `edit-meal`, `feedback`) with `presentation: "modal"`.
   - Declares shared sub-screens (`body`, `energy-setup`, `progress-photos`, `onboarding`, `auth/callback`) at the root stack level.
2. **Tabs Group in `apps/mobile/src/app/(tabs)/`**:
   - `_layout.tsx` renders `<AppTabs />` (`NativeTabs` on iOS/Android, `Tabs` on web).
   - Contains tab screen exports: `index.tsx` (Home / Dashboard), `workouts.tsx`, `meals.tsx`, `coach.tsx`, and `settings.tsx`.
3. **Tab Triggers**:
   - Home tab trigger in `apps/mobile/src/components/app-tabs.tsx` uses `name="index"`.
   - Other tab triggers (`workouts`, `meals`, `coach`, `settings`) remain unchanged.

## Consequences

- **Cross-Tab Preservation**: Modals are presented over the entire tab navigator without altering the active tab. Dismissing or completing a modal via `router.back()` or native swipe-to-dismiss cleanly pops the modal and directly reveals the originating screen and tab with full state and scroll position preserved.
- **Stable Public Routes**: Route URLs (`/`, `/workouts`, `/meals`, `/coach`, `/settings`, `/log-meal`, `/log-workout`, `/feedback`, etc.) remain identical because Expo Router route groups `(...)` are omitted from URL paths. No calling code or deep-link handlers require changes.
- **Native Fidelity**: Interactive swipe-to-dismiss on iOS natively reveals the presenting tab screen without visual snapping or state jump.
- **ADR-0006 Superseded**: Replaces the nested `(home)` stack approach with the standard root stack wrapping tabs pattern.
