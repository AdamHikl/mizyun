# ADR-0070: Forgiving weekly logging goal and protein range framing

Date: 2026-10-17. Status: proposed; Adam asked for both packages on 2026-10-17 ("start on 1 and 2 in dev"). Packages [#292](https://github.com/AdamHikl/mizyun/issues/292) and [#293](https://github.com/AdamHikl/mizyun/issues/293).

## Context

Users log meals for a day or two, pause for a day or two, then return. Adam suggested a Duolingo-style streak. Vegetarian users also find protein progress discouraging: the dashboard target from `packages/core/src/energy.ts` is 1.6–2.0 g/kg shown as one number. Research is collected in [TRACKING_ENGAGEMENT_PSYCHOLOGY_2026-10-17](../research/TRACKING_ENGAGEMENT_PSYCHOLOGY_2026-10-17.md).

## Decision

1. **No reset-to-zero streak.** `packages/core/src/logging-consistency.ts` counts a day as logged when it has at least one confirmed meal entry on the local date, and reports days logged in the current ISO week (Monday start, reusing `isoWeekStart` from the weekly calorie review) against a user-chosen goal of 3–7 days (default 5). Skipping a day never loses progress; the week restarts each Monday.
2. **Welcome back.** With no meal today and two or more days since the last logged day, the card greets the user without naming missed days. It adds no buttons: the existing Quick log and first-meal card directly below own logging actions.
3. **Data and storage.** The card reads 28 days of `/v1/food-entries` (at most 5 pages of 200). A failed, thrown or incomplete read renders nothing, never "0 of 5". The goal and a hide switch are stored per user in SecureStore (`mizyun.logging-consistency.<userId>`) and erased with other local data on account deletion. Settings → Goal & target pace edits them.
4. **Protein range.** `packages/core/src/protein-range.ts` presents the unchanged target as a range whose lower end is the coaching plan's existing minimum (1.4 g/kg maintenance, 1.6 g/kg otherwise), capped at the target. The protein bar shows "low–target g", a marker at the lower end and "In range" from the lower end. Unknown intake stays unknown. Without a confirmed weight only the target shows. Amended 2026-10-18 (Adam): the protein bar again shows only the single target ("x / target g"), with no range text, marker or "In range" label; the range still decides when protein ideas appear.
5. **Protein ideas.** For vegetarian or vegan Coach preferences, once a meal is logged and protein is still below the range, the nutrition card lists up to four food names (vegan excludes dairy and eggs; gluten-free and lactose-free are respected). No nutrition values are invented.
6. **Unchanged.** No migration, route, contract, target calculation or notification change.

## Consequences

- No reward points, badges or leaderboards yet; any later mechanic follows the research guardrails (reward logging, never lower calories or weight; opt-out; no shame notifications).
- Deferred: a one-tap "rough estimate" day needs an explicit estimate flag so the weekly calorie review (ADR-0064) can exclude it; a user-chosen protein focus needs research and calculation gates.
- The energy target (cut/recomp 2.0 g/kg) and coaching plan (1.8 g/kg) still differ; this ADR does not reconcile them.
- Device acceptance by Adam remains open.
