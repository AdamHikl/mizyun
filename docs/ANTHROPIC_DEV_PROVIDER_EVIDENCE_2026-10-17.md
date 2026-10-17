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

The Dev env file was not changed. The auto-mode permission classifier denied root writes to `/etc/mizyun/dev.env`. A read-only check at 14:33Z showed:

- `AGENT_PROVIDER=gemini`
- `AI_EXTERNAL_ACCESS=true`
- `NODE_ENV=production`
- a Gemini key present
- no `ANTHROPIC_*` keys

Dev therefore still serves Gemini.

## Not verified

None of the following has been observed yet; there was no key for a live call:

- Live Claude calls.
- Whether Haiku 5.5 supports web search, or whether search is enabled for the organization.
- Whether the structured-output schemas compile ("Schema is too complex" limits).
- Latency, cost and nutrition accuracy (#29).
- Device acceptance.

The consent copy, the privacy policy and `ai-eligibility.ts` still name Google Gemini. They are Production gates.

## Next action

Adam:

1. Tell the testing partner.
2. Add the following to `/etc/mizyun/dev.env`:
   - change the existing line to `AGENT_PROVIDER=anthropic`
   - add `ANTHROPIC_DEV_TESTING=true`
   - add `ANTHROPIC_API_KEY=<key>`
3. Restart `mizyun-api-dev.service`.
4. Confirm that `GET /v1/coach/status` reports `provider: "anthropic"`.
5. Test Coach, photo, text and brand drafts, refine, and recipes on the iPhone Dev app.
