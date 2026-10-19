# ADR 0073 — AI drafts for Log activity descriptions

- Date: 2026-10-19
- Status: accepted for local engineering; Dev deployment and device acceptance open
- Package: #299, follow-up to #289 (Adam, 2026-10-19: "when I said I did yardwork or boxing, it didn't know … we need to use AI for this")

## Context

Log activity's **Fill in from description** used only the deterministic on-device parser `draftActivityFromDescription` (#288, ADR-0068). It recognizes running and the ten catalog timed activities, so "yardwork" or "boxing" left the activity empty, although the Activity field accepts any custom name. Extending word lists cannot cover every activity people describe. #288 recorded AI drafting as an option in #289.

## Decision

- **AI first for consenting users, parser as fallback.** Approved by Adam: accounts that already gave current AI consent and confirmed adult eligibility send the description to `POST /v1/activity-drafts/text`. Everyone else, and every AI failure (offline, provider error, daily limit, rejected text), uses the on-device parser. The screen does not prompt for consent. Consenting users see a one-line note under the button that the description is sent to the AI provider. The parser also runs when the AI draft fills nothing or the request throws. When the fallback is used after an AI attempt, the status line says why ("…filled in on your device"). A provider refusal returns 422, like rejected text.
- **Same admission and budget as meal text drafts.** The route requires authentication, adult eligibility and current consent (ADR-0024), honours `AI_EXTERNAL_ACCESS` through the provider, applies `screenCoachInput`, and acquires the shared per-minute limiter and the durable daily draft ledger as a `text` draft. It commits reported tokens (estimate 600) and releases the slot on any failure. One budget covers meal and activity drafts, so neither endpoint bypasses the other.
- **Data minimization.** The provider receives only the description and the device's local date, weekday and time, so it can resolve "yesterday". The account id and request id are not sent. Nothing is saved; the user reviews the filled fields before **Save**.
- **One shared prompt and schema.** `packages/agent-runtime/src/activity-draft.ts` holds the policy, the user prompt, a JSON Schema that both Gemini `responseJsonSchema` and Anthropic `output_config.format` accept, and `normalizeActivityDraftOutput`. Bounds and the environment values are enforced in code rather than the schema (a `null` enum member is not documented for Gemini): an out-of-range field becomes null instead of failing the draft, and a date after the local date is dropped. The `activity-draft-v1` prompt asks for a short title-case activity name, using the exact catalog name when one matches, so the app's `resolveActivityName` keeps known activities in the catalog and saves others as custom activities. A sets-and-reps exercise name is left for the user, as before.
- **Response contract.** `packages/contracts/src/activity-draft.ts` validates the route response. A provider draft outside the contract returns 503 instead of reaching the app.

## Consequences and limits

- Activity names now depend on the model. Similar descriptions may yield different custom names ("Yard work" vs "Yardwork"), which become separate custom activities. The user can edit the name before saving.
- Each fill by a consenting user uses one of the shared daily AI drafts. When the limit is reached, the parser fills what it can.
- Users who never gave AI consent keep the parser and are not told that AI could help. A consent prompt here can be added later.
- The AI consent modal and Settings text now list Log activity descriptions with the other AI features (#300, ADR-0024 amendment). Per Adam, the consent version is unchanged, so existing consents stay valid.
- Gemini keeps its full output-token cap for this call because `gemini-3.8-flash` may spend thinking tokens even at budget 0; the answer itself is small.
- An inherited limiter mismatch in the meal draft route is tracked in #301; the activity route releases the in-memory slot on a durable denial.
- Mocked provider tests do not prove that a live provider accepts the request or answers sensibly. Live Dev requests and iPhone acceptance remain open gates.
