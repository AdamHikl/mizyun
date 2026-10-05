# Production Community placeholder — 2026-10-05

Issue: [#212](https://github.com/AdamHikl/mizyun/issues/212). User explicitly requested fixing the Production Community screen while retaining1.0.8 / iOS build8 / Android code8.

## Cause and implementation

The previous enrollment gate disabled Join but did not gate the tab. Failed membership/session reads mounted the settings recovery screen; coming-soon existed only inside the successful, adult-eligible form. Help was unconditional and Leave appeared on errors without confirming enrollment.

`FeedScreen` now selects the closed placeholder before mounting auth, membership or feed components. It shows the exact visible heading “Community is coming soon”, the shared header, private-tracking copy and a48-point Home action. Scrollable themed text, header and bottom-tab insets support narrow/large-text layouts. Canonical configured Dev keeps its existing Community flow. Standalone account settings/withdrawal routes and server admission remain unchanged. No native permissions, backend or migrations changed.

## Verification and provenance

Base: `cf2462acb3626d0fad7c8cde5d773223b30237d5`. Owned source: `apps/mobile/src/features/community/feed/feed-screen.tsx` and its test. Unrelated dirty usability/UI edits are excluded from the isolated release candidate and preserved in the primary checkout. App configuration has no diff and retains1.0.8/8/8.

Four new closed-state regressions (signed-out, error, loading, stale-enrolled) failed against the original source;35feed tests pass after the fix. They assert exact visible coming-soon text, shared header/private navigation, no membership/feed/auth mounting or reads and no recovery/join/leave controls. Fresh full Community plus admission suite:40files /405tests PASS. Independent GPT-6.1 Sol High non-author review approved the implementation; its visible-text assertion suggestion was incorporated and included in the final405test run.

Full isolated `pnpm check` and corrected signed artifacts are pending. Prior3384b3f build8 artifacts remain immutable history and do not contain this fix; they must not be used as the corrected candidate. Native-device/Store acceptance and existing Community launch gates remain open.

## Research

Current [Expo57](https://docs.expo.dev/versions/v57.0.0/), [Router57](https://docs.expo.dev/versions/v57.0.0/sdk/router/) and [React effects](https://react.dev/reference/react/useEffect) reviewed; consequences recorded in `RESEARCH_LOG.md`. Static component selection avoids mounting Community effects when closed. No new durable architecture decision or dependency upgrade.

## Next action

Verify the isolated candidate, regenerate signed1.0.8/build8 IPA and AAB, inspect exact embedded configuration/source/checksums, then manually upload the corrected packages and accept the Community placeholder on physical devices. No Store upload or backend deployment is part of this session.
