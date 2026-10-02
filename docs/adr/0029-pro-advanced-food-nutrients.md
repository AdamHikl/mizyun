# ADR-0029: Pro advanced food nutrients

**Status:** Accepted for NUTR-PRO-001, 2026-09-29

**2026-10-02 amendment:** [ADR-0035](0035-ai-advanced-nutrient-drafts.md), authorized by Adam in #178, extends the local AI draft/refine implementation to the five additional nutrients. The basic-only AI restriction below describes the original release scope; live quality and device acceptance remain separate gates. Storage, entitlement, missing-value and confirmation rules remain in force.

## Context

Mizyun stores confirmed food entries with typed nullable calories and basic macros. Pro needs optional fibre, saturated fat, total sugars, sodium, and dietary cholesterol. Existing users and older clients must continue to work; missing nutrient data must not be misrepresented as zero. Authenticated clients can also reach Supabase's Data API, so an API-only Pro check is insufficient.

## Decision

- Store the five values as nullable, bounded columns on `public.food_entries`. Use grams for fibre/saturated fat/total sugars and milligrams for sodium/cholesterol. Keep historical rows `NULL`; do not backfill from other macros or AI estimates.
- The `advanced_nutrition` capability is resolved on the server from an approved Beta Pro request or the server-owned `profiles.plan_tier = 'paid'`. The capability endpoint reports `beta_pro`, `paid`, or `none` as its grant source. A pending request grants nothing.
- Check advanced writes at the API and in a database trigger. The trigger protects direct Data API writes; existing owner RLS still protects rows. A downgraded user can retain, correct, or clear an already recorded value, but cannot fill a previously missing advanced field.
- Ordinary food-entry reads and account export retain historical values after downgrade. Advanced daily/weekly aggregate views require the capability. Aggregation preserves unknown when any meal lacks a value and reports known-value coverage separately.
- Keep AI drafts and Coach nutrition advice on the existing confirmed basic fields until separately evaluated.

## Consequences

The migration is additive and compatible with old clients. Future paid billing needs to set the existing server-owned paid tier only after verified entitlement; a client flag must never do so. Direct SQL changes to `plan_tier` or Beta Pro approval remain privileged operations. Cross-layer tests must cover old rows, local-day totals, direct Data API attempts, downgrade, export, and account deletion.

## Sources

- [Supabase RLS and grants](https://supabase.com/docs/guides/database/postgres/row-level-security), accessed 2026-09-29.
- [European Commission nutrition labelling](https://food.ec.europa.eu/food-safety/labelling-and-nutrition/food-information-consumers-legislation/nutrition-labelling_en), accessed 2026-09-29.
- [USDA zero versus missing nutrient data](https://fdc.nal.usda.gov/docs/cndb-documentation-cn27.pdf), accessed 2026-09-29.
