# ADR 0078 — Production feature release with consent-gated AI routing

- Date: 2026-10-21
- Status: accepted (Adam, 2026-10-21); device acceptance skipped by Adam's decision
- Package: promote main to Production with Community, indoor bouldering, AI-tailored evening stretch, Health run imports, retained meal photos, recipe ideas/ingredient photos/cooking assistant and the ADR-0077 AI routing. Amends ADR-0065, ADR-0066, ADR-0069, ADR-0076 and ADR-0077, which kept these Dev-only.

## Context

Adam asked to release these Dev features to Production and to install a new Production iPhone build, "without altering the capabilities of the current version and current app". The installed Store build 1.0.9 (9, source `dd5b4353`) must keep working against the promoted API. A compatibility audit against build 9 found that the promoted API would break account export for every user, account deletion for Apple-linked users without an authorization code, goal editing after a new build cleared the target date, and Coach threads holding multi-photo proposals. Build 9's AI consent (`2026-09-08`) names Google Gemini only.

## Decision

- **Server switches.** Each feature keeps its Dev rule and gains an explicit Production flag in `/etc/mizyun/production.env`:

  | Feature                                            | Production switch                                                                                                 |
  | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
  | Community                                          | `COMMUNITY_ENABLED`, `_ENROLLMENT_`, `_DISCOVERY_`, `_PUBLISH_`, `_ENGAGEMENT_` = true; `_DELIVERY_ENABLED=false` |
  | Indoor bouldering                                  | `MIZYUN_BOULDERING_ENABLED=true`                                                                                  |
  | AI-tailored evening stretch                        | `MIZYUN_STRETCH_AI_ENABLED=true`                                                                                  |
  | Health run imports                                 | `MIZYUN_RUN_IMPORTS_ENABLED=true` (new)                                                                           |
  | Retained meal photos                               | `MIZYUN_MEAL_PHOTOS_ENABLED=true` (new)                                                                           |
  | Recipe ideas, ingredient photos, cooking assistant | `MIZYUN_MEAL_RECIPES_ENABLED=true`                                                                                |
  | Anthropic routing                                  | `ANTHROPIC_ENABLED=true` (new; `ANTHROPIC_DEV_TESTING` stays an alias) and the eight ADR-0077 provider keys       |

- **Community is open to every Production user** (Adam). The `community_operations` default has `cohort_required=false`. The safety contact is `adoh811@gmail.com` with the Terms page as the standards URL. Push delivery stays off, as on Dev.
- **App build flags.** The Production build sets `extra.enableCommunity`, `enableBouldering`, `enableStretchAi`, `enableRunImports` and `enableMealPhotos`. Community enrollment still opens only on the canonical Production endpoints. Health preview, Health exports, Watch/Wear companions, progress photos and preview mode stay Dev-only.
- **Consent-gated AI routing, per feature.** A request reaches Anthropic only when the user's stored, granted, adult-confirmed and unrevoked consent version names Anthropic for that feature (`aiConsentDisclosesAnthropicFor`). The `2026-10-20` and `2026-10-21` disclosures name Anthropic for Coach chat, typed meal estimates and draft changes, and Log activity only. Every other feature (photos, recipe ideas, ingredient photos, cooking assistant, stretch, illustrations) and every other case, including no consent context, is served by Gemini. This holds even if a `*_PROVIDER` key or `AGENT_PROVIDER` routes such a feature to Anthropic, so Production also sets `RECIPE_IDEAS_PROVIDER=gemini`. Each AI route runs its provider call inside `runWithAiConsent` (AsyncLocalStorage `run`), and every object that can reach Anthropic is a gated wrapper. Build-9 users therefore stay on Gemini, as their disclosure says. New builds ask upgrading users to consent again.
- **Legacy client shapes.** The current API client sends `x-mizyun-api-compat`. Requests without it are treated as build 9 or older and receive build-9-compatible shapes for account export, goals, AI consent status, Coach proposals and Community activity.
- **Apple deletion.** With an authorization code, revocation stays strict. Without one (Android, or an older client), deletion proceeds and records that revocation was skipped. Production gets the Apple key, `APPLE_CLIENT_ID=com.mizyun.app` and its own `APPLE_REVOCATION_ENCRYPTION_KEY`.
- **Release tuple** 1.0.10 / 10.

## Consequences and limits

- Device, native, accessibility and two-account acceptance were skipped by Adam's decision. They remain open evidence, not passed gates.
- Whether Apple key `D8TB43DBS5` covers `com.mizyun.app` could not be proved with a dummy request; only a real Apple-linked deletion proves it. A failed exchange fails closed.
- No Production moderator is configured: `itinn@itinn.eu` had no Production account at release time. Reports are recorded but not reviewable until `COMMUNITY_MODERATOR_USER_IDS` is set.
- `docs/TERMS_OF_SERVICE.md` has no Community clause and `docs/COMMUNITY_STANDARDS.md` is still a draft. App Store Connect privacy labels and Play Data safety must be updated by Adam (`docs/STORE_LISTING_DISCLOSURES.md` §5) before the Store submission.
- Energy formula v2 (ADR-0064) changes daily targets for every user on promotion, including build-9 users. This is intended product behaviour, not a compatibility shim.
- Anthropic usage and billing are shared with Dev (same key), as Gemini already is.
- A user who granted the `2026-10-21` consent in the new app and then opens build 9 sees build 9's Gemini-only wording as accepted, while Coach, typed meals and Log activity still go to Anthropic under the newer consent they gave. Nothing is stored by this mapping, and re-granting in build 9 stores the Gemini-only version.
- Build 9's export files drop top-level sections it does not know (for example `recurringMealSuggestions`, `bouldering`, `calorieAdjustmentProposals`), and the Community subtree is labelled `2026-10-01` for it although it holds two newer categories. Current builds export everything.
- `ANTHROPIC_ENABLED` is an acknowledgement, not a kill switch: with an Anthropic route and no acknowledgement the API refuses to start. The `*_PROVIDER` keys (or `AI_EXTERNAL_ACCESS=false`) are the off switches. `ANTHROPIC_ENABLED=false` does not override the Dev alias `ANTHROPIC_DEV_TESTING=true`.
- Rollback hazard: after migration `20261021120000`, an API rolled back to `9b0c41a` rejects `skipped_no_authorization_code` revocation rows when resuming those deletion jobs.
