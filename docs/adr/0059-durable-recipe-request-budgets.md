# ADR 0059: Durable recipe request budgets

- Date: 2026-10-13
- Status: Accepted for local REC-03 engineering; live, Dev and device acceptance open
- Package: AI-RECIPES-001 / #241

## Decision

Recipes and ingredient recognition use provider-neutral ports, authenticated API routes and a non-conversation durable request ledger. The API fetches owned profile, Home energy targets and known logged macros for the profile's IANA day. Missing/truncated intake stays unknown; known intake is labelled logged-so-far. Profile, goal/energy inputs, constraints, intake and local-day revisions fence a generation response. Selection never creates consumed food entries or Coach memories.

The first model path selects at most three IDs from feasible REC-02 templates. The server retains the fixed ingredients, weights, instructions and deterministically calculated nutrition. Invalid or invented selections reject the bounded response as a whole; no model-authored cooking steps or numeric nutrition become authoritative. Recognition returns suspected catalog matches or unsupported names, with no quantities and explicit review requirements. This narrower proposal space keeps the initial cooking/safety boundary reviewable. Broader recipe authoring is a separate design and evaluation package.

Each owner/request UUID/operation is bound to a canonical client-input fingerprint. An atomic service-only PostgreSQL reservation shares existing Coach token, draft, minute and concurrency counters. Existing Coach denial must not release another caller’s shared slot: release only after successful acquisition. The REC-03 independent review found and repaired the two durable denied-acquisition releases. It charges the complete bounded text/image/output estimate and one draft before dispatch. Content-free durable statuses survive process restart; in-flight duplicates are busy, changed input conflicts, and any terminal or expired identity is outcome-unavailable. Outputs remain transient. A new generation requires an explicit new UUID; neither server nor API client retries automatically or falls back to another model. No-feasible selections reserve an identity, one token and one draft but make zero provider calls.

Successful trustworthy usage can reduce the charge on the frozen original admission day. Missing usage, timeout, malformed/refused output, failures and expiry retain the full estimate. Admission and finalization use the accepted-deletion owner lock and current consent; expired/deleted/revoked responses cannot publish. The storage deletion stage erases recipe metadata under its worker lease, and export includes only request UUID/operation/status/time/day/charged tokens. Missing migration fails AI readiness closed; only explicit undefined-table compatibility permits empty metadata on old databases.

The default live switch is off. Enabling requires MIZYUN_MEAL_RECIPES_ENABLED=true, AI_EXTERNAL_ACCESS, supported provider status, current authenticated adult consent and durable readiness. Fake ledgers require an explicit synthetic shared-budget gate and are never a production fallback. Gemini uses one bounded generateContent call, no tools, redirects, retries, caching or conversation history, API key in a header, LOW media resolution and store:false. Supported configured models are 3.8-flash and 2.5-flash, without migration/fallback. Estimates count full serialized non-image UTF-8 bytes plus maximum output; image allowance is 2048 for Gemini3 LOW and 8192 for earlier models. Actual usage above the reservation rejects publication. An enabled deployment still needs environment cost monitoring and live prompt/injection/quality evaluation.

## Images and client lifecycle

Multipart accepts requestId plus repeated images only: Free one image, paid/approved Beta Pro up to three; aggregate4MiB, JPEG/PNG/WebP, single frame,4096dimension/16MP ceiling. Sharp0.35.5 actually decodes format-matched bytes, corrects rotation and emits metadata-free JPEG at most1024pixels/1MiB. No retained storage, photo paths or filenames reach the model. Photos cannot establish quantity, hidden contents, allergens or freshness.

The public API client requires a caller-persisted UUID and owner/session generation fence before dispatch and after parsing, forwards cancellation and makes at most one network attempt. REC-04 owns the mobile controller's persisted request identity and ingredient confirmation. Native multipart compatibility remains an acceptance gate.

## Primary sources checked 2026-10-13

- [Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output), [generateContent reference](https://ai.google.dev/api/generate-content), [image input](https://ai.google.dev/gemini-api/docs/image-understanding), [media resolution](https://ai.google.dev/gemini-api/docs/media-resolution), [3.8 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash): bound output, validate semantics locally, explicit model/thinking/media configuration and request logging control. LOW Gemini3 images are approximately280tokens; the chosen2048allowance is conservative, not a measured billing promise.
- [Sharp constructor](https://sharp.pixelplumbing.com/api-constructor/) and [output](https://sharp.pixelplumbing.com/api-output/): input decode/pixel guards and default metadata stripping.
- [Fastify multipart](https://github.com/fastify/fastify-multipart): explicit part/file/field limits and consuming bounded file streams.
- [PostgreSQL17 locks](https://www.postgresql.org/docs/17/explicit-locking.html) and [error codes](https://www.postgresql.org/docs/17/errcodes-appendix.html): transaction and consent-row fences; 42P01-only compatibility.
