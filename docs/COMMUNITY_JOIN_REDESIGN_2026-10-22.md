# Community join screen redesign — 2026-10-22

Status: **committed 6045ee7c, `pnpm check` PASS, on Dev and Production, Production app installed on Adam's iPhone. Device acceptance open.**

## Why

An iPhone screenshot from Adam showed the embedded Join Community screen in its
error state. The status-load error sat below three paragraphs of joining copy
and a stray "Keep tracking privately" text button. It read "Community
information changed. Try again." followed by "Changes are not confirmed", which
is save wording shown after a failed read. The rest of the screen was flat
hairline sections with a square-cornered primary button.

## Architect reviews (read-only Opus helpers)

- **UI architect:** found error/loading buried below marketing copy, no
  surfaces, home-made buttons instead of `components/ui/Button`, a text "✓"
  glyph, and a weak type scale. Proposed `Card`/`ListGroup`/`ListRow`/`Notice`/
  `Icon`, a privacy summary card with icons, collapsed optional fields, and
  list rows for navigation.
- **IA architect:** traced the copy to `context_changed` (request retired by
  backgrounding or account-scope change), and noted that `status:"error"` is
  shared by load failures and ambiguous save/leave failures. Proposed
  state-specific content, separate load and save copy, and removal of
  duplicated statements.
- **Coordinator decision against one IA proposal:** "Leave Community" stays
  available in the error state. The existing test pins this, and withdrawal
  must stay as easy as joining (consent rule in `docs/RESEARCH_LOG.md`). It is
  moved to its own group at the bottom, away from the retry action.

## Changes

`apps/mobile/src/features/community/community-settings-screen.tsx`:

- **Loading/error first.** The joining intro and promises render only in the
  ready state. Loading is a single card. An error is a danger `Notice` with
  the "Check Community status" action, followed by the private exit.
- **Error origin tracked** (`load` / `save` / `leave`):
  - A failed load says "We could not check your status". An interrupted check
    (`COMMUNITY_CONTEXT_CHANGED_MESSAGE`) reads "Your status check was
    interrupted."
  - A save says "Your changes are not confirmed".
  - A leave says "Leaving is not confirmed".
  - Only save and leave ask for a fresh check before trying again.
- **"Always your choice".** Now one card with three icon rows. The privacy and
  Store claims keep their exact wording.
- **Form.** Identity fields use `FormField`/`FormTextInput`, with a live badge
  preview. Initials and bio sit behind "Add initials or a bio (optional)"; the
  section opens automatically when either has a value or in the identity
  editor.
- **Checkbox.** It uses an icon check instead of a text glyph, with
  `checkbox` semantics unchanged.
- **Grouping and actions.** Consent stays in "Before you join" with
  unchecked 18+ and rules checkboxes. The primary button uses `Button` with a
  loading state. Navigation, Help & safety and Leave are inset `ListGroup` rows.
- **Repeated birth-year text.** It now shows once, inside the ineligible
  notice.

`community-client.ts` exports `COMMUNITY_CONTEXT_CHANGED_MESSAGE`. The text
is unchanged.

`community-settings-screen.test.tsx` changes:

- It mocks `expo-symbols`.
- Button lookup also matches `accessibilityLabel`.
- Two new cases cover the interrupted-load copy (with the join copy hidden)
  and the ambiguous-join copy.

## Evidence

- `npx vitest run src/features/community/community-settings-screen.test.tsx src/features/community/feed/feed-screen.test.tsx`
  (apps/mobile): 2 files, 64 tests passed.
- `npx tsc --noEmit -p apps/mobile`: exit 0.
- **iOS simulator:**
  - Device: iPhone 17 Pro `F4939E5D-BA85-4479-AA1E-92B21441FB8C`, already
    booted and left booted.
  - Build: cold Debug `com.mizyun.development` 1.0.10(10) at
    `/private/tmp/mizyun-ios-simulator.LhG96k`, with native-input hashes
    matching after the build.
  - Metro: owned instance on 8085, stopped afterwards.
  - Account: an existing synthetic Dev account that is already enrolled.
  - Inspected visually: the non-embedded Community settings screen (identity
    card, discovery, sharing choices, inline rules link, Communication,
    Help & safety and Leave lists).
- **Not run:** `pnpm check`.

## Open

1. View the join, error and ineligible states on an **unenrolled** account.
   The synthetic account is enrolled, and leaving was not authorized.
2. Dark mode and large Dynamic Type pass.
3. `pnpm check`, commit, Dev deploy and iPhone acceptance.

## Release (2026-10-22)

- `pnpm check` PASS for input SHA-256 `669486e4…` (an earlier run was stale after an outside file touch; all steps had passed).
- Commit `6045ee7c2b69f97c98dfe530ffd42589384b5f45` pushed to `main`.
- `pnpm deploy:dev`: Dev runs 6045ee7c; `/v1/health` 200 at 14:18:51Z; no migrations.
- `pnpm deploy:production`: driver re-ran gates; Production runs 6045ee7c; `/v1/health` 200 at 14:28:04Z; database up to date.
- `pnpm mobile:install:ios:production`: Release `com.mizyun.app` built (team LQJNDVBL43), installed and launched on `00008140-001114501A86801C` at 14:32:50Z. Launch is not feature acceptance.

## Follow-up fix: non-members always saw the error state (2026-10-22)

Adam reported on the Production iPhone that the Community tab showed "We could not check your status" ("You must join Mizyun Friends…"). He had to press Leave to reach "Join again", the screen showed "@undefined", and switching tabs brought the error back.

- **Cause.** `GET /v1/community/profile` correctly returns 404 `COMMUNITY_NOT_ENROLLED` for a non-member or withdrawn account. `CommunityReadCache` retires its own failed read (`clear()` bumps the revision) and returns `{ kind: "context_changed", cause }`, as pinned by `read-cache.test.ts`. `CommunityProfileController.load()` checked the outer error code and fell into the error state. This predates the redesign; the first screenshot's "Community information changed" had the same source.
- **Fix.** `load()` now unwraps with `communityErrorCause` before the not-enrolled check. Its revision and principal guards still reject stale or wrong-account results. The withdrawn notice falls back to "Your handle" when the profile is unknown.
- **Regressions.**
  - `use-community-profile.test.ts` runs a real `CommunityReadCache` over a 404. It failed before the fix with status `error`.
  - The screen test checks that no `undefined` handle appears.
  - Community suites pass: 721 tests.
- **Review.** An independent Opus reviewer returned **ship**, with no blockers. Three display-only callers with the same pattern are tracked in #320.
