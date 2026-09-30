# ADR 0031: Community tab and Account header entry

- Status: Accepted
- Date: 2026-09-30
- Related: [ADR-0025](0025-root-stack-over-native-tabs.md), [ADR-0030](0030-explicit-community-publication.md)

## Context and decision

Adam approved a dedicated Community destination alongside private tracking, with Account accessible through a consistent header avatar. Community already has a feed, discovery, relationships and inbox, but entry through privacy settings obscured the feature.

Keep five primary tabs: Home, Workouts, Meals, Coach, Community. Home remains default. Move existing `/community` feed into the tabs group, with Find friends, Requests, Inbox and My profile/settings shortcuts. Move Account to the root Stack while preserving `/settings` and existing account detail URLs. All primary screens expose an accessible Account avatar button. Account keeps native Back to the originating tab, following ADR-0025's shared-screen pattern.

Opening Community does not enroll, grant consent, request notification permission, follow or publish. Adam's follow-up decision puts the deliberate joining/profile/consent form directly inside the Community tab, with a private tracking exit. Successful explicit enrollment revalidates membership before showing the feed. Account privacy controls and `/community/settings` remain secondary management entries. Retained tab state must revalidate participation on focus/foreground before showing feed content; loading/offline/denial cannot preserve stale access. Private workout sharing remains an explicit preview/publish action from the workout.

## Consequences and acceptance

Community settings remain available from Account privacy controls as a secondary entry. This navigation choice adds no public discovery, detailed workout sharing, admission, delivery or rollout authority. Current Dev-only operational restrictions and all original participant, device, operator, legal, restore and pilot gates remain. Verify five tabs, Account access/Back from each, join/leave return freshness, large text/safe areas and iOS/Android interaction separately from bundled routes and isolated tests.
