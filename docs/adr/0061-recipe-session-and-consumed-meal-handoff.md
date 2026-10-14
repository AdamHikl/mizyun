# ADR0061 — Recipe sessions and consumed-meal handoff

- Status: Accepted for local engineering; native/live/release acceptance remains open
- Date: 2026-10-13
- Scope: REC-05 / AI-RECIPES-001 / #241

## Decision

Meals owns one `meal-recipes` route; Coach opens the same route with no food, health or photo parameters. Explicit ingredient confirmation is followed by a human choice of the catalog food and preparation state. Unsupported foods are not guessed. The existing authenticated generation/recognition admission, consent, provider switches and durable budget ledger remain authoritative.

Authenticated session-context and revalidation endpoints use current owner records and pinned templates without a provider call. Revalidation checks catalog revision, currently confirmed ingredients, exclusions and profile dietary restrictions, and reads context before and after to detect changes. A failed check leaves archival details with cooking and recipe-derived handoff unavailable. Unknown macro context permits ordinary supported recipes with **Macro fit unavailable**. A bounded pure core serving calculation scales original reference totals and declared yield once; fresh deterministic ranking never calls a model for subtraction or portion adjustment.

Local recipe recovery is a strict owner envelope with confirmed input, catalog/result versions, selected serving, pending provider identity and selected meal operation identity. It excludes raw photos and URIs, expires after 24 hours, uses the existing validated SecureStore chunk adapter and content-free cleanup journal, and prunes at authenticated startup. Owner/token/lifecycle fences cover loading, writes and provider completions. Account export includes retained recipe data and completion receipts; explicit erasure invalidates queued writes. AI revocation stops future provider work while preserving ordinary manual logging. A successful current remote adult-consent grant emits an owner event only after required local persistence; the host synchronously retires its captured lifetime and remounts the shared flow. Readiness or cached consent never restores locally retired AI. Serialized local writes remove retired native results before newer grants proceed.

Selection stages an ordinary editable meal draft only after required persistence and current server revalidation. Atomic comparison preserves every unrelated saved form, including advanced-only and blank forms, unless replacement is explicitly chosen; an unresolved submission cannot be replaced. The shared meal lifecycle persists the exact submitted payload and UUID before POST, restores it after restart, and preserves it through autosave, Clear, age and recipe expiry. The originating owner and current session fence travel separately from the frozen payload into the HTTP request; an account switch during asynchronous authentication cannot redirect that payload to the next principal. Only a confirmed success releases that identity. A bounded owner receipt of the last 32 completed UUIDs is written before release; older unexplained resume identities fail closed. Reopening a completed recipe consumption does not create a new record. An explicit separate consumption gets a new identity. Account deletion has a separate forced local erase boundary; recipe expiry and consent retirement do not call it.

## Consequences and acceptance

Recipes and portions never modify intake. Only explicit Save in the editable form submits an entry. Required storage failure blocks dispatch/navigation and offers retry. A recipe session can expire while its consumed meal outcome remains unknown; the meal operation survives under the ordinary mutation lifecycle. This extends the common meal durability boundary instead of adding another recipe acceptance engine.

Source checks and synthetic races do not prove native Keychain capacity, app-kill recovery, accessibility or food safety. Live recipes remain disabled until REC-06/provider, qualified nutrition/food-safety and applicable release gates are accepted. Dev deployment, signed-in native journeys and Production release are separate actions.

## Primary sources

- [Expo SDK57 Router](https://docs.expo.dev/versions/v57.0.0/sdk/router/): shared file route and opaque navigation.
- [Expo SDK57 SecureStore](https://docs.expo.dev/versions/v57.0.0/sdk/securestore/): native error handling and owner/expiry/erase checks; reuse the REC-04 validated chunk adapter.
- [React Native0.86 accessibility](https://reactnative.dev/docs/0.86/accessibility): labelled roles, selected/disabled state and flexible touch/text layout.
- [Fastify routes](https://fastify.dev/docs/latest/Reference/Routes/): authenticated preHandlers and bounded request bodies.
- [Zod objects](https://zod.dev/api?id=objects): strict validated wire and recovery envelopes.
