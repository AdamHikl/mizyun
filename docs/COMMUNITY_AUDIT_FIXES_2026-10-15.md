# Community audit fixes — 2026-10-15 (Claude Code)

Baseline `9af188c38a0bd6b2415fd14c00f91383a72f9a41` (branch `feat/248-weekly-calorie-review`). Uncommitted at time of writing. Concurrent, unrelated meal-recipes/recurring-meals edits from another session were present in the tree and are excluded from this scope.

## Method

Four read-only reviewers (API/adapters on Opus; feed/share UI, social screens, client data layer on Sonnet) audited the whole Community feature. Findings were verified against source before changing anything. One Sonnet helper implemented the confirmation/label/colour batch in disjoint files. An independent Opus reviewer (non-author) reviewed the final diff: **no blocking findings**; low-severity suggestions 4/5 were applied (resume context cleared on empty text, `try/finally` on the share guard) and transient-classification tests were added.

Many reported "bugs" (feed/comments/relationships/messaging/groups blanking every 10 s, activity detail false "unavailable", share-meal preview expiry) are the deliberate ADR-0033 authority-lease presentation. They were **not** changed; the proposal is [#265](https://github.com/AdamHikl/mizyun/issues/265) and needs Adam's decision.

## Fixed

Server

- Kill switch (`operations.ts`): `POST /meal-activities` now gated by `publish` (was ungated); `POST /media/:id/content` gated as `browsing` (was `publish`); own invitation list `GET /invitations` and revoke no longer hidden by `discovery` (only `GET /invitations/:token`).
- Supabase adapter: follower/following/request pages kept reading past inactive peers (`#activeRelationshipPage`, 20-round bound). Previously one inactive peer in the first `limit+1` rows ended pagination and undercounted follower counts.
- Feed/profile activity: a card revoked between the feed read and its reaction read is dropped instead of returning 404 for the whole page. **Reverses the #153 test assertion "fails the entire page when a card becomes unauthorized"**; other failures still reject the page and counts are never substituted.

Mobile

- Push tap while offline/5xx/429 routes to `inbox?notice=offline` (was "update unavailable"); inbox open/load-more keep loaded items on transient errors (`isTransientCommunityError`).
- Comments: expired reply/edit context shows a notice and re-tapping Reply/Edit on the same comment resumes the kept text (consent and new intent still required).
- Shared workout sets numbered per type (warm-ups no longer shift "Set N").
- Workout share sheet synchronous double-tap guard.
- Confirmations for message delete (both forms), challenge remove/leave/cancel, routine unshare.
- Peer display name on message bubbles; group audience toggle exposes checkbox role/state; readable membership states.
- Hard-coded colours → theme tokens (Block action, report modal, settings banner).

## Verification (fresh, this session)

- Mobile `vitest run src/features/community`: 51 files / 631 tests PASS; `tsc --noEmit` clean outside the other session's meal-recipes/recurring-meals files.
- API `vitest run src/modules/community`: 20 files / 199 PASS; `tsc` clean outside meal-recipes.
- `packages/adapters/supabase-server` `vitest run`: 29 files / 260 PASS; `tsc` clean.
- New regressions shown failing before the fix: set numbering, double-tap publish, relationship pagination.
- Prettier check PASS on owned files. ESLint via `npx` did not load the repo config (not run). **`pnpm check` not run**: the shared tree contains another session's in-progress edits with type errors; run it on an isolated candidate before commit.
- Not deployed; no device/native acceptance.

## Follow-ups filed

[#265](https://github.com/AdamHikl/mizyun/issues/265) lease presentation (blocked on decision) · [#266](https://github.com/AdamHikl/mizyun/issues/266) server: rate-limit keys behind cloudflared, error mapping, N+1, unbounded reads · [#267](https://github.com/AdamHikl/mizyun/issues/267) mobile data layer: push deregistration, token rotation, profile demotion · [#268](https://github.com/AdamHikl/mizyun/issues/268) UI: chat, inbox, comments, groups.
