# Claude Haiku 5.5 Dev provider — 2026-10-17

Adam asked to test Claude Haiku 5.5 for every AI feature on Dev, ready once he pastes an API key. Decision record: [ADR-0069](adr/0069-anthropic-claude-provider-for-dev-testing.md). Model research: [AI_MODEL_SELECTION_RESEARCH_2026-10-17.md](AI_MODEL_SELECTION_RESEARCH_2026-10-17.md).

## Implemented and verified

- Source `bcfb68a3562b9132e22d075824a01d80c6ec28be` on `main`: new `packages/providers/anthropic`, config `ANTHROPIC_*`, API wiring, tests, ADR-0069.
- Focused tests: anthropic provider 85/85, config `server.test.ts` 49/49, API `app.test.ts` 9/9 (covers vendor selection, Gemini fallback without key, external-access off).
- `pnpm check` PASS, input SHA-256 `6b763d11b8ce4e693f70738778ae5947fc3c82600815efe92af0c51e32e7d95a`. Test counts: API 1189 passed, 15 skipped; mobile 3138; gemini 111; anthropic 85; config 102.
- Independent Opus review: found 1 enablement blocker and 4 should-fix items.
  - Blocker (consent): resolved by Adam's decision to route all Dev accounts and tell the testing partner himself.
  - Fixed: Dev-only acknowledgement, Haiku-only model enum, prefill-safe Coach history, truncated tool calls rejected, wiring tests.
  - A bounded re-review of the fixes found no findings.
- `pnpm deploy:dev` succeeded. The Dev database was already up to date (no migrations). Public `/v1/health` returned 200 at 14:32:51Z.

## Dev environment state

The first attempt (14:33Z) was blocked: the auto-mode permission classifier denied root writes to `/etc/mizyun/dev.env`. At 16:41Z, at Adam's explicit request, the key was copied from his Mac `.env`. It was never printed, passed in argv or logged:

- It was sent over SSH stdin and written with Python on the host.
- A SHA-256 prefix comparison between the Mac and the host matched.
- The host-role marker was checked first.
- A backup was saved to `/etc/mizyun/dev.env.bak-20261017-anthropic`, which contains the previous file and no Anthropic key.
- Both files kept `root:mizyun-dev-api 640`.

Settings now in effect:

- `AGENT_PROVIDER=anthropic`
- `ANTHROPIC_DEV_TESTING=true`
- `ANTHROPIC_API_KEY` set
- `AI_EXTERNAL_ACCESS=true`
- Gemini key retained, for illustrations and rollback.

`mizyun-api-dev.service` was restarted. Its new PID is 3527814. Production `mizyun-api.service` PID 4008015 was unchanged before and after.

Checks after the restart:

- Local `GET /v1/coach/status` at 16:42:18Z returned `{"ready":true,"provider":"anthropic","model":"claude-haiku-5-5","externalAccess":true}`.
- Models API `GET /v1/models/claude-haiku-5-5` with the Dev key returned HTTP 200, with `server_tools.web_search.supported=true` and `thinking.types.disabled.supported=true`.

These checks did not call `messages` and did not exercise the meal-draft schemas.

**Rollback:** set `AGENT_PROVIDER=gemini` in `/etc/mizyun/dev.env`, or empty `ANTHROPIC_API_KEY`, then restart `mizyun-api-dev.service`.

## Not verified

None of the following has been observed yet; no live `messages` call has been made:

- Live Claude calls.
- Whether web search is enabled for the organization. The Models API reports that the model supports it.
- Whether the structured-output schemas compile ("Schema is too complex" limits).
- Latency, cost and nutrition accuracy (#29).
- Device acceptance.

The consent copy, the privacy policy and `ai-eligibility.ts` still name Google Gemini. They are Production gates.

## Next action

Adam:

1. Tell the testing partner.
2. On the iPhone Dev app, test:
   - Coach chat, including a question that needs tools (e.g. "what is my goal?")
   - a photo meal draft
   - a text draft, plus a brand or restaurant text draft
   - refine
   - What can I cook? (ingredients and suggestions)
3. Report anything that fails. A failure there would show whether the structured-output schemas or web search are rejected live.
