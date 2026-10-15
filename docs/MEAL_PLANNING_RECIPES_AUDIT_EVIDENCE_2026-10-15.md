# Meal planning and "What can I cook?" audit — 2026-10-15

Claude Code coordinator session on `feat/248-weekly-calorie-review`, baseline
`9af188c3`. Scope: the Meals tab "What can I cook?" recipe flow (#241, #243)
and the recurring-meal planning surfaces (#242). Local, uncommitted at the time
of writing; no Dev deployment, native install or Production change.

## Method

- Three read-only audits (Sonnet: recipe engine/API, recurring meals; coordinator:
  recipe screen). Findings were checked against code before fixing.
- Implementation: coordinator (recipe mobile UI/controller), Sonnet helper
  (recurring-meals client), Opus helper (recipe API/provider).
- Reviews: independent Sonnet review of the mobile diff (no blocker/high; two
  medium findings fixed); independent Opus High review of the API/provider diff
  (AI access/budget path) — see "Review" below.

## Changes

### Recipes — mobile (`apps/mobile/src/features/meal-recipes/`)

- #243: a fresh `no_remaining_gaps` context shows known values as
  "Targets met for today" with over-target labels; unknown/stale stay unknown.
- Recipe cards follow the deterministic ranking order; "Best fit for what's left
  today" appears only for a fresh, scored, ready ranking. Each card states its
  own focus-macro contribution ("56 of 150 g carbs left").
- Recipe detail renders inside the selected card and shows catalog food names
  instead of IDs such as `chicken-breast-cooked`.
- Ingredient matching preselects only exact, unambiguous catalog foods (a
  generic "milk" never becomes "oat milk"; raw vs cooked stays a user choice);
  per-row search and Change replace the full catalog listed under every row.
- Bug: two reviewed rows mapping to one food failed the input contract
  (duplicate IDs) with a misleading message; rows are now merged.
- Prep minutes validated inline (no NaN/fractions); allergen/diet lists deduped;
  saved preferences reseed when editing; theme primary replaces a hard-coded hex.
- Suggestion failures show code-specific copy (daily limit, rate limit with
  bounded retry hint, consent, deletion, unsupported settings, provider down);
  `pendingRequestId` clears only on definitive 400/403/422/429 (not
  `RECIPE_LIMIT_INFLIGHT`), so real unknown outcomes stay flagged.

### Recipes — API/provider (`apps/api/src/modules/meal-recipes/`, Gemini)

- Halal/kosher profile diets made every suggest/revalidate return 422
  `RECIPE_INGREDIENTS_NEED_REVIEW`. One shared mapping (`profile-diet.ts`)
  now adds no catalog filter for them plus an advisory warning; no compliance
  claim. Other diet mappings unchanged.
- A complete empty day is a known zero intake (ready), per the plan; incomplete
  reads stay unknown.
- An empty model selection falls back to the deterministic top 3; with ≤3
  feasible recipes the provider is not called.
- The energy summary uses the profile time zone's offset instead of UTC.
- Gemini recognition downgrades a catalog id with `unknown` state to a named
  item instead of failing the whole scan; duplicate ids deduped.

### Recurring meals — mobile (`apps/mobile/src/features/recurring-meals/`)

- Specific 409/422 copy; Skip today hidden when today (in the schedule's zone)
  is not scheduled or the schedule is paused; DST-safe "Next:" line refreshed
  every 30 s; time zone shown only when it differs from the device; short
  visible button labels with full accessibility labels and hints; spoken
  weekday names.

## Verification (fresh, this session)

- `apps/mobile`: `npx vitest run src/features/meal-recipes src/features/recurring-meals src/features/log-meal` — 713 passed.
- `apps/api`: `npx vitest run src/modules/meal-recipes` — 119 passed.
- `packages/providers/gemini`: `npx vitest run` — 111 passed.
- `tsc --noEmit`: no errors in the owned mobile, API or provider paths. Mobile
  typecheck shows errors in concurrent, unowned Community files only.
- Not run: full `pnpm check` (the shared tree contains another session's
  in-progress Community edits), Dev deployment, native/device acceptance,
  live provider.

## Follow-up issues

#259 duplicate schedules double-log; #260 skip deletes edited entries / no
skipped state; #261 pending create locks editor; #262 over-target calorie
guard (product decision); #263 shared draft budget and minute cap; #264
context-load latency.

## Open gates

#241/#243 stay open until a settled-candidate `pnpm check`, Dev deployment and
installed iPhone acceptance of the text/photo journeys; qualified nutrition and
provider gates are unchanged.
