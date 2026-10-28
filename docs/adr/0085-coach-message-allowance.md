# ADR-0085 — Coach messages per day and a smaller Coach prompt

- Status: accepted for Dev implementation, 2026-10-27 (review finding AI-02, with AI-06). Production release needs migration `20261027120000_coach_message_allowance.sql` and a separate release decision.
- Amends: ADR-0081 §4 ("Coach tokens stay at 100k paid and 10k free") and ADR-0017 §3. The ADR-0081 cost allowance is unchanged and stays the spend guard.

## Context

The 2026-10-26 review (commit a3947503) found that a free user could send about one Coach message a day.

- The free Coach budget was 10,000 tokens a UTC day.
- The Coach system prompt was about 23,800 characters: the policy plus the full app capability catalog (`COACH_APP_GUIDE`, about 14,700 characters). It was sent on every provider call, again on every tool round.
- A simple turn measured about 9,000 input tokens on Gemini and 14,000 on Haiku.
- The route reserved only `min(budget, 1,200)` tokens. The first message passed, its real count was committed, and the second was refused.
- The refusal copy named tokens and "midnight UTC".

AI-06 found two related problems. There was no prompt caching. The shared policy told every provider to answer in an `{"answer": …}` JSON envelope, while the Anthropic adapter told Claude never to wrap the reply in JSON.

## Decision

1. **Coach is metered in messages.**
   - Free: 5 messages a UTC day. Paid: 50 (`coachDailyMessageLimit` in `packages/config/src/ai-tier.ts`).
   - A message and its token estimate are reserved together at admission (`ai_reserve_coach_message`) and settled once, on the admission day (`ai_settle_coach_message`).
   - A message is counted when a model reply is stored. A safety-screen or canned app-help reply that made no model call is stored without using a message.
   - It is returned when the provider call fails, when a later admission step (cost allowance, idempotency ledger) refuses, and on a replayed or conflicting key. The API keeps each held message per provider call, so a call is never counted or returned twice; the SQL also never counts without a reservation. A failed settle is retried once.
   - The counts live in new `ai_daily_token_ledger` columns: `messages_used`, `reserved_messages`, `coach_tokens_used` and `coach_reserved_tokens`. The table keeps its owner-only read policy. The RPCs are service-role only.
2. **Tokens become a hidden ceiling.** `coachDailyTokenBudget` is 320,000 free and 3,200,000 paid: five or fifty of the largest Coach turns seen in the eval suite (61,318 tokens with three tool calls, [AI unit economics](../AI_UNIT_ECONOMICS_2026-10-26.md)). Users never see it. Coach tokens now go to the Coach columns only. Before, Coach and recipes shared `tokens_used`, so five real Coach turns would have used up the recipe budget (`dailyTokenBudget`, 10k free). That column is now recipes only. Coach no longer calls `ai_reserve_tokens`, `ai_commit_tokens` or `ai_release_token_reservation`.
3. **The cost allowance stays the spend guard (ADR-0081).** It is checked after the message and token gates, so a day can end early on cost. That happens only for unusually large turns, or on the paid tier with Gemini (see Consequences).
4. **Copy.**
   - The API answers 429 `daily_budget_exhausted`, as before, with `resetAt` at the next UTC midnight of the limiter clock. Its message names messages, not tokens or UTC.
   - A new reply carries `usage: { dailyMessageLimit, messagesRemaining, resetsAt }`. Replays, local fallbacks and older servers omit it.
   - The app shows "3 Coach messages left today" above the composer once three or fewer are left, and "No Coach messages left today. More from 01:00." at zero. A refusal reads "You've reached today's Coach limit. More messages from 01:00." The time is the reset in the device's own time zone.
   - Settings › AI usage shows "2 / 5 messages" and "Resets daily at 01:00".
   - `GET /v1/ai/usage` adds `dailyMessageLimit`, `messagesUsed` and `messagesRemaining` and keeps the token fields for older app builds.
5. **Reset time.** Counts still renew at midnight UTC. The profile time zone is not yet reliable (REL-01 is being fixed in another session), so a local-midnight reset would let a wrong zone shift the day. The app shows the UTC reset in local time instead. A later change can switch the ledger day to the profile zone once REL-01 lands.
6. **Smaller prompt.**
   - `buildCoachSystemPolicy` builds one policy per turn: `COACH_FIXED_POLICY` (identity, behaviour, safety rules, catalog rules and a one-line index of every app area), then only the catalog entries matched to the last two user messages. Questions about the whole app still get the full catalog.
   - The same policy is used for every tool round of a turn.
   - The fixed part is 10,548 characters. A typical turn is 10,700 to 12,700 characters, 45 to 53 % of the old 23,787.
   - The 5,600-character `workouts` entry is split into six entries so a question attaches only the part it needs.
7. **Caching.** The Anthropic adapter sends the fixed policy as its own system block with `cache_control: { type: "ephemeral" }`. Tools and the fixed policy form the cached prefix; the catalog excerpt and the output rule follow it uncached. Gemini caches identical prefixes implicitly, and the fixed-first order serves it too.
8. **JSON envelope.** The shared policy no longer asks for the `{"answer": …}` envelope. Only the Gemini adapter adds it (`GEMINI_COACH_ANSWER_ENVELOPE_RULE`), because its JSON response mode needs it. Claude receives only its own "never wrap the reply in JSON" rule.

## Consequences

- A free user can send five real turns a day. A route test sends five 9,000-token Gemini turns and five 14,000-token Haiku turns, and refuses the sixth by message count. With the old 10,000-token budget the same test fails on the second turn.
- Estimated cost per typical turn after the prompt cut (about 6,000 tokens on Gemini, characters ÷ 4 for the prompt, not a provider measurement): about USD 0.006 in 2026 and 0.011 from 2027-01-01, at 0.0007 on Haiku.
  - **Free day:** 5 Gemini turns cost about USD 0.028 in 2026. In 2027 they reach the USD 0.05 daily allowance at about the fifth turn, which the last-call overshoot rule still admits. The USD 0.50 month then covers about 9 full Gemini days, or the whole month on Haiku.
  - **Paid day:** Coach runs on Haiku (`claude-haiku-5-5`), where 50 messages cost about USD 0.04, well under USD 0.15. Gemini serves Coach only as the fallback, for users whose saved consent predates the Anthropic disclosure or when no Anthropic key is configured. Only those users meet the cost allowance before 50 messages (about 27 Gemini turns in 2026, 13 in 2027).
- The message count is a ceiling, not a promise. When cost ends the day early, the app shows the same daily-limit copy with the same reset time.
- Cached Anthropic prompt tokens are still priced at the full input price in `ai-cost.ts`. That overstates cost, which is the safe direction.
- A message reserved by a request that crashes before settling stays reserved until the UTC day ends. It holds one message, like the ADR-0081 cost reservation.
- The settle retry is not idempotent. If the first settle commits but its response is lost, the retry adds the call's tokens twice, which is the conservative direction. On the paid tier, with more than one call in flight, it can also return another call's reservation, which may then go uncounted. This is rare. Keying settlement on the provider call id would remove it (follow-up). A settle that fails twice is not logged.
- `pnpm ai:cost-report` reads `coach_tokens_used` and adds the Coach share of `tokens_used` from days before this change. Use `--no-coach-ledger` on a database without this migration.
- Deploy the migration before the API, as for ADR-0081. Without it, Coach admission fails closed, and `/v1/ai/usage` reports no Coach use.
- A replay of an answered message is served before admission and costs nothing. A replay of a call still in progress is refused by the in-flight gate first (`concurrent_in_flight`), as before.
- Admission still runs before the safety screen, so a user who has used every message gets the limit copy, not a safety reply, for any text. This is unchanged from the token budget, but it now happens after five messages instead of one. Moving the deterministic screen before admission belongs with the `screenCoachInput` rewrite (follow-up).
- On the last allowed tool round the Anthropic adapter sends stub tool definitions, so that round misses the prompt cache (follow-up).
- Selection misses cost knowledge, not safety. A question that matches no entry still gets the catalog rules and the index, which tell Coach to say it cannot confirm exact steps rather than deny a feature. Slovak coverage is a small set of stems.
- The persisted `promptVersion` is `coach-system-v5-app-v6` (v5: the 2026-10-28 token reduction below) and the app knowledge version is `mizyun-app-v6`.
- Older app builds keep working. They ignore `usage` and the new usage fields, show their own daily-limit copy, and show the hidden token ceiling in Settings.

## Token reduction (2026-10-28)

Measured on Haiku 5.5 with the `run-ai-eval` Coach suite (8 cases, effort none). The baseline was commit 823d1e79; there were two runs after the change.

- Per typical turn, about 8,000 input tokens (tools plus the fixed policy) are read from the prompt cache, and about 2,400 are new. The new part is the per-user context JSON (about 2,200), the catalog excerpt and the question.
- **Replies.** The fixed policy now asks for brief replies:
  - lead with the answer and its numbers, then one concrete suggestion (the existing "at most one next action" rule still applies);
  - most replies under 100 words, with at most three bullets;
  - longer only for a weekly review, a routine review or edit, or when asked;
  - no restating the question or closing offers.
    The nutrition rule also asks, when a gap remains, for one or two foods that would close it. Output tokens on single-round turns fell from 2,070 to 970–1,070 across the six single-round model cases (48–53 %).
- **Context JSON.** The nutrition item no longer repeats today's meals and totals in a second `today` object, and meals no longer carry row ids. That is about 450 fewer uncached tokens per turn.
- **Tool rounds.** The orchestrator appends each round's tool evidence to the grounding, and the adapters also send it as the tool result. The Anthropic and Gemini adapters now leave the current round's evidence out of the grounding JSON. It is still sent once as the tool result, and earlier rounds' evidence stays in the grounding.
- **Exercise search.** `search_exercises` returns how-to steps only with `include_instructions: true`. The steps were about half of each result, and plans do not use them.
- **Result.** A three-round workout turn (search, propose, reply) went from about 46,000 to 37,000 input tokens. A two-round run took 22,000.
  - Judged Coach score: 89.4 on the baseline, 98.1, 96.2 and 96.9 after (the last with the final wording). The baseline lost points on a pace reading and on a workout without a plan card. Both of those vary between runs, so the honest conclusion is "no quality loss", not a gain.
  - Median latency: 2.4 s before, 1.6–1.9 s after.
  - The suite has no routine-review case, so the exception for routine reviews is not measured.
- **Estimated provider cost for a typical single-round turn on Haiku**, with cache reads at a tenth of the input price: about USD 0.00048 before and 0.00035 after (−27 %). The app's cost ledger prices cached tokens at the full input price, so it records about USD 0.0012 before and 0.0011 after.
- **Not done.**
  - Trimming the tool definitions (about 4,400 tokens, cached).
  - Pricing cache reads in the ledger.
  - Caching the conversation history. The per-question catalog excerpt sits before the messages, so the history cannot share a cached prefix.
