# ADR 0076 — AI-tailored evening stretch on top of the deterministic plan

- Date: 2026-10-19
- Status: accepted for local engineering; Dev only; live-provider and device acceptance open
- Package: #298 follow-up (Adam, 2026-10-19: "Can't we combine the deterministic engine with AI to help us improve it, make it more precise and relevant?")

## Context

The evening stretch (ADR-0072) picks catalog stretches from muscle loads computed with fixed rules. It cannot reason about how an exercise loads muscles beyond the catalog's primary/secondary labels, custom exercises contribute nothing, and choices between similar stretches are by level and catalog order only. Adam asked for AI to make the session more precise and relevant: Dev only, automatic once a day, no AI consent version bump.

## Decision

- **Deterministic first, AI as a bounded refiner.** The screen always renders the deterministic plan immediately. For accounts with current AI consent and adult eligibility (no prompt is shown to others), it requests a tailored plan; the list is replaced only while the session has not started.
- **Ids, never prose.** `POST /v1/stretch-plans/refine` sends only today's exercise names, completed set counts and run/climb activities (the local date stays on the device and only keys the cache). The server rebuilds the deterministic plan and the allowed bodyweight stretch list from the catalog, and the model returns only: stretch ids (3–6, from the list), holds (clamped 20–45 s per side), up to four focus muscles, and muscle tags for exercise names the catalog cannot resolve (catalog vocabulary only). `stretchPlanFromChoice` in `packages/core` validates both on the server and again on the device; instructions always come from the catalog. Unusable output is an error and the app keeps the deterministic plan.
- **Same admission and budget as activity drafts (ADR-0073).** Authenticated, adult-eligible, current consent (ADR-0024), deletion fence, provider kill switches and `AI_EXTERNAL_ACCESS`; one call counts as one text draft on the shared daily draft budget. Dev is on (`stretchAiEnabled`: `MIZYUN_ENVIRONMENT=dev`, else `MIZYUN_STRETCH_AI_ENABLED=true`); Production stays off. The app asks only in Dev builds (`isStretchAiEnabled`), and the consent and Settings copy name the evening stretch only there; revoking consent clears the cached plan.
- **Once a day on the device.** The tailored plan is cached in SecureStore per user and local date with a fingerprint of today's training; once a tailored plan is cached the same training never calls again, and at most two calls are made per day. Each attempt is counted before the request, so an offline or rate-limited attempt uses one of the two; a changed workout may ask again within that limit. The Home row reads the cache only. Local account erasure removes the cache.
- **Disclosure without a version bump.** The consent modal's per-feature list and the Settings consent/revoke text name the evening stretch and the data it sends (exercise names, set counts, ran/climbed). Following #300, the consent version is unchanged by Adam's decision.

## Consequences and limits

- About 2–3k tokens per call (policy, ~60 compact stretch options, today's exercises); free accounts spend one of their daily drafts on the first stretch of a training day. Usage is visible in the existing AI usage card.
- Exercise names are user text sent to the provider. The prompt JSON-encodes them as data and the output schema has no free text, so an injected name can at most influence which listed stretch ids are chosen.
- Model quality is not proven by mocked provider tests; `docs/BEFORE_TESTING.md` gates for live evaluation remain open. Holds and choices are advisory and the screen keeps its general-guidance notice.
- A provider outage, budget exhaustion or offline device silently keeps the deterministic plan.
