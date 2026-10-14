# UI design system, phase 1 — 2026-10-14

Issue [#244](https://github.com/AdamHikl/mizyun/issues/244). Adam asked for the app to stop looking "made by a coder and not a graphic designer". He chose the calm iOS-native direction. He also chose this rollout: the foundation plus Home and Meals first, then a screenshot review, then the remaining tabs. Tab headers become a large title with one settings button, and Feedback stays reachable in Settings. The rules are in [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md).

## Baseline audit (main `a49e3b6a`)

Feature code had these problems:

- 588 hex literals across 97 unique colours.
- 20 font sizes, 14 corner radii and only 8 theme tokens.
- No shared Button, Card or Row primitives. Only Community had local ones.
- Emoji and `→`/`›`/`＋` glyphs used as icons.
- ALL-CAPS section labels and long explanatory copy.
- Dark mode detected in 21 places by comparing a background hex. The new tokens made the type checker flag every one of these.

## Change

- **Tokens:** semantic colours (surface, separator, tertiary text, on-primary, success/warning/danger/info, protein/carbs/fat, overlay), `Radius`, `PageGutter` and `MinTouchTarget`.
- **Type scale:** an iOS-style scale in `ThemedText` (largeTitle, title3, headline, footnote, caption). The existing types were retuned to that scale, and `linkPrimary` now uses the brand colour.
- **Primitives:** `@/components/ui` provides Button, IconButton, Card, ListGroup/ListRow, SectionHeader, Notice, EmptyState, Icon/IconBadge and the `IconNames` vocabulary.
- **Tab header:** a large title plus the settings button. The tab bar uses the brand tint. Workouts and Coach move their titles into the header. Community keeps its own header until phase 2.
- **Home:**
  - Date line and a hero calories card with token-coloured macro bars.
  - Quick log as one grouped list with symbols.
  - First-meal card restyled.
  - Weight, training and steps grouped under "Body & activity".
  - Energy formula details behind a "How this is calculated" disclosure.
  - Segmented week/month control.
- **Meals** (helper-authored, coordinator-reviewed):
  - One primary Log meal button, then the shortcuts as a grouped list.
  - History search and day cards.
  - Per-meal secondary actions behind "More actions for <meal>", with labels, handlers and busy states preserved.
- **Scheme detection:** colour-literal checks were replaced with token comparisons.

Behaviour, data loading, ownership and race guards, analytics events, routes, consent and nutrition semantics are unchanged. No backend, schema or native-dependency changes were made.

## Verification

- Focused: dashboard 112 tests, log-meal 413, coach 140, workouts/components 295 — PASS; mobile typecheck PASS. New regression: per-meal actions stay reachable behind the more button with labels, handlers, busy state and owner reset.
- Independent non-author review (Sonnet) of `283bf05e..40351bd7`: no blockers. Noted (accepted): the type scale and tokens are global by design, so untouched screens reflow — Settings/Body screenshots show no clipping; AI-calc/grams badges now live in the per-meal menu; the main Meals button label is "Log meal" (no e2e flow references the old label). A once-observed unhandled rejection in the log-meal test mock did not reproduce in 6 runs on main or this branch; tracked separately.
- The colour-literal scheme checks previously compared against a background that no longer existed after the token change; they now compare tokens, so light mode selects the light branch.
- Full `pnpm check`: first run failed only on formatting (`dashboard-data.ts`), fixed; the final result and input hash are recorded in `status.md`.

Simulator screenshots (iPhone 17 Pro, iOS 26.5, synthetic Dev account, Metro from this branch, light and dark) are in [evidence/ui-design-system-2026-10-14](evidence/ui-design-system-2026-10-14/). The account had no meals logged, so these were not visually verified:

- populated day cards
- the per-meal action menu
- macro values above zero
- maximum Dynamic Type and VoiceOver

These remain open, along with physical-device checks.
