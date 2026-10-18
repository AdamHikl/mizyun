# ADR 0072 — Evening stretch reminder from today's training

- Date: 2026-10-18
- Status: accepted for local engineering; Dev build and device acceptance open
- Package: #298 (Adam, 2026-10-18: "I often forget to stretch at the end of the day")

## Context

Adam wants an automatic end-of-day nudge that also helps him stretch the muscles he trained. The app already sends several local reminders (evening meal catch-up, weigh-in, weekly check-in) through expo-notifications with per-user SecureStore settings, and the exercise catalog already holds 79 RepDB `stretching` entries with primary/secondary muscles and instructions. There is no Home Screen widget; the only Build 9 "widget" is the active-workout Live Activity.

## Decision

- **Delivery: local notification plus a Home row.** A widget cannot remind and an in-app pop-up appears only when the app is already open, which is the moment that is forgotten. One DATE-trigger notification for tonight only (SDK57 `SchedulableTriggerInputTypes.DATE`, Android channel `evening-stretch`) deep-links to `/evening-stretch`; a "Tonight's stretch" Home row covers opening the app before the reminder. Lock-screen copy stays generic ("Your 5-minute stretch for today's training is ready.") with no muscles or workout names.
- **On by default at 21:00, training days only.** Settings → Workouts & reminders → Evening stretch has a switch and the shared time picker. The reminder is scheduled only after finished training today (completed strength/activity workout, run including Dev imports, or bouldering session) and cancelled once tonight's session ends. No rest-day reminder in the MVP.
- **Permission timing.** Automatic syncs prompt at most once per user, from a save screen after training (`noteTrainingSaved`); app-foreground and Home syncs never prompt. Saving the setting with the switch on asks explicitly. Denial leaves nothing scheduled and the card explains how to enable notifications.
- **Deterministic session, no AI.** `buildEveningStretchSession` in `packages/core` weights catalog muscles by completed sets (secondary at half), adds fixed loads for running and bouldering, redirects muscles without a catalog stretch (biceps, brachialis, rhomboids, side shoulders), ranks them, and greedily picks 4–6 bodyweight beginner-first stretches (30 s, per side when the instructions say so). Unresolved custom names fall back to a fixed full-body set.
- **Device-only state.** Settings, the pending notification id and the completion date live in SecureStore under `mizyun.evening-stretch.<userId>`. Every read-modify-write is serialized; each sync also retires orphaned stretch notifications for the same user; account changes sweep other users' pending reminders and taps are owner-fenced. Local account-data erasure clears the key and cancels the notification. Nothing is sent to the server and no migration is needed.

## Consequences and limits

- Training saved on another device or imported in the background reaches the phone only when the app next syncs (foreground, Home focus or a save). If the app is never opened after training on that device, there is no reminder that night.
- Catalog stretch content is `pending_professional`; the screen labels it general guidance, not medical advice.
- Muscle mapping is a heuristic: exact-name catalog matches only, so custom exercises do not contribute muscles.
- No keep-awake or haptics (not installed; adding them needs a native rebuild). The countdown is wall-clock based, so backgrounding does not drift it.
- Source tests do not prove notification delivery, permission prompts, tap routing or accessibility on device; those remain Dev iPhone acceptance gates.
