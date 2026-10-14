# Dev live recipes enabled — 2026-10-14

Adam instructed that Dev is for testing and implemented features must stay available while acceptance is incomplete. Live recipe recognition and generation are now enabled for existing founder/testing-partner Dev access. Production availability and authentication/consent/adult eligibility/usage controls are unchanged.

## Actual change and verification

- Existing deployed source remains `d7e2055b260552c785325414756c6beeea1b7d8c`; the clean checkout, exact host marker, Dev service/user/path and shared deployment lock were verified. No source deployment, migration, unit change, credential change or Production operation was performed.
- Set only `MIZYUN_MEAL_RECIPES_ENABLED=true` in `/etc/mizyun/dev.env`; `AI_EXTERNAL_ACCESS=true` retained. Original secret-bearing file backup remains root-only on the server; no secret values enter the evidence. Dev service restarted; current PID3922741, instance `90ba3719-8ac1-4b69-9b6c-9c78b3080a2c`.
- Current process flags confirm both settings true, Gemini key present and configured `gemini-3.8-flash` supported by both recipe adapters. This configuration check makes no model request and does not measure model output quality.
- Public Mac HTTP readiness passed on the exact SHA, with Database/Auth/Storage ready. Public recipe capabilities without authentication returned401 `AUTHENTICATION_REQUIRED`. The Production environment hash and process PID2221089 stayed unchanged across the Dev restart.
- Independent non-author High review found a lock-timing issue before mutation; the repair was accepted. The first immediate post-restart environment assertion failed; the read-only follow-up confirmed the effective flag and readiness without another mutation. A server-side Python public probe encountered Cloudflare1010; normal Mac curl probes passed. These initial probe errors do not represent paid provider tests or device acceptance.

[Preflight](evidence/dev-recipes-enabled-2026-10-14/preflight.json), [postflight](evidence/dev-recipes-enabled-2026-10-14/postflight.json), [public readiness](evidence/dev-recipes-enabled-2026-10-14/public-readiness.json), [unauthenticated capabilities](evidence/dev-recipes-enabled-2026-10-14/public-unauthenticated-capabilities.json), [provider configuration](evidence/dev-recipes-enabled-2026-10-14/provider-configuration.json) and [review](evidence/dev-recipes-enabled-2026-10-14/independent-review.txt) are redacted actual evidence.

## Next action and remaining evidence

Open the installed matching Mizyun Dev app, use Meals → What can I cook? (or its shared Coach entry), review AI sharing consent if prompted, then try ingredients/photos, suggestions and editable Save/reopen. The previous install record reports launch blocked by the locked phone; this turn makes no device interaction claim.

Named qualified nutrition/food-safety review, real-photo/provider quality, measured costs/latency/aggregate-spend and signed-in native/lifecycle/accessibility acceptance remain open evidence. They do not disable founder/partner Dev trials under Adam’s instruction. Participant expansion and Production/Store release remain separate milestones; #241 remains open. Existing source gate evidence is preserved, with no runtime source changes or repeated full gate. This turn only adds operational/policy documents; unrelated delivery records are preserved.
