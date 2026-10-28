# ADR-0081 — AI cost allowance per user

- Status: accepted for Dev implementation, 2026-10-26 (#336). Production release needs the migration and a separate release decision.
- Amends: ADR-0017 §3 (per-tier caps) and the AI-OPS-001 limiter; ADR-0077/0078 routing is unchanged.

## Context

Pro will cost EUR 7.99 a month or EUR 49.99 a year, net of a 15 % Store fee (go-to-market plan 2026-10-26, Section 5.4). Issue #336 asks that a paying user cannot cost more in AI than 30 % of that. The annual plan gives about USD 1.19 a month.

[AI unit economics](../AI_UNIT_ECONOMICS_2026-10-26.md) shows two problems with the old caps.

- They allowed about USD 1,600 a month for one account, almost all through meal draft changes. Those were limited only to 3 a minute.
- No daily count cap can meet the target with a usable allowance. One search-backed typed meal a day for 30 days already costs USD 0.97. Request costs vary about 80-fold between features, and the Gemini price doubles on 2027-01-01.

The coordinating session chose a per-call cost ledger on 2026-10-26 over lower count caps alone.

## Decision

1. **Cost allowance.**
   - Every AI call reserves an estimate before the provider runs and settles an estimated cost afterwards.
   - The cost is priced from the tokens the provider reported, the provider that answered (Haiku or Gemini, with the Gemini price by date) and web-search fees: `packages/config/src/ai-cost.ts`.
   - Amounts are integer micro-USD in `ai_daily_cost_ledger`, one row per user and UTC day, written only through the service-role RPCs `ai_reserve_cost` and `ai_settle_cost`.
   - A call is admitted while the user's day and calendar month are under the tier's allowance:
     - paid: $0.15 a day and $1.00 a month;
     - free: $0.05 a day and $0.50 a month.
   - The last admitted call may overshoot.
   - A call that fails after admission is charged its reservation: a lost or failed response has an unknown cost, not a zero one. Calls refused by a later limiter step are charged nothing.
   - A call without a reported token count is charged its reservation. The token-ledger fallbacks of the routes never price a call.
   - Cost bookkeeping never blocks finalization. A failed settle is dropped, and slot release and token commit still run. A failed reserve releases the slots already taken and fails the call.
   - A recipe request reserves cost only for a new attempt, so a retried request id first gets the recipe ledger's answer.
2. **Coverage.** The allowance is charged in the shared limiter (`apps/api/src/modules/coach/limits.ts`), which covers:
   - Coach chat;
   - Coach meal logging and Coach photos;
   - typed, photo and label drafts and draft changes;
   - Log activity;
   - evening stretch.

   The recipe service (ideas, ingredient photos, cooking assistant) and meal illustrations reserve and settle through the same ledger. An illustration is charged on a new claim; cached and limited claims cost nothing.

3. **Draft changes** keep their place outside the daily draft count. They now have their own durable daily count, `ai_daily_draft_ledger.refines_used` through `ai_charge_refine`. It is charged at admission and never refunded: paid 30, free 10.
4. **Count caps stay as burst limits.**
   - The paid photo/draft cap drops from 100 to 15 a day, and the in-memory food-draft limiter takes its defaults from the tier caps.
   - Coach tokens stay at 100k paid and 10k free; a Haiku Coach month at that cap is about USD 0.60.
   - Superseded for Coach by [ADR-0085](0085-coach-message-allowance.md) (2026-10-27): Coach is metered in messages (free 5, paid 50 a day) under a hidden 320k/3.2M token ceiling.
   - Daily-limit messages read the caps instead of hard-coded numbers.
5. **Denials.**
   - The API answers 429 `RATE_LIMITED` with `reason: daily_budget_exhausted` and a `resetAt`: next UTC midnight for the day, the first of the next month for the month.
   - The copy names the renewal ("You've used this month's AI allowance. It renews on 1 November.").
   - Recipe routes use the new codes `RECIPE_LIMIT_COST_DAY` and `RECIPE_LIMIT_COST_MONTH`. Older app builds show their generic recipe error for these codes.
6. **Search fees.**
   - Search-backed typed meals report `webSearches` on the draft (`VisionDraftCandidate`): Anthropic's reported count (3 when absent), or 1 for a Gemini grounded pass.
   - This applies whenever the search request completed, including when its findings go unused.
   - Gemini adds the search pass's tokens to `tokensUsed`, as Anthropic already did.
7. **Report.** `pnpm ai:cost-report` prints median and p95 per tier for the last 30 days, read-only, with user ids only. It reads the charged USD from the ledger and gives a token-based estimate for older days.
8. **Overrides.**
   - `AI_USER_TIER_OVERRIDE` still selects the tier.
   - `AI_DAILY_USER_TOKEN_BUDGET` and the other `coachControls` knobs still drive the in-memory limiter, which also accepts cost overrides in tests.
   - `AI_PAID_DAILY_COST_MICROS` and `AI_PAID_MONTHLY_COST_MICROS` override the paid allowance (1,000 to 10,000,000 micro-USD). They apply to every ledger user, including recipes and illustrations. The free tier has no override.

## Consequences

- At 2027 prices the worst-case paid month is $1.15: 29 % of annual-plan net and 15 % of monthly-plan net. The founding-year price is not covered (about 41 %).
- A normal paid day (one Coach conversation and three photo drafts) fits 30 times into the monthly allowance at 2027 prices. Heavy users meet the allowance before the old caps.
- Free accounts can now cost at most about $0.65 a month, down from about $1,500.
- The API needs migration `20261026150000_ai_cost_allowance.sql`. Without it the limiter's RPCs fail, so AI routes fail closed: deploy the migration first, as promotion already does.
- Pending reservations live in process memory between admission and settlement within one request. A crash leaves a reservation that blocks only the rest of that UTC day, and month sums ignore earlier days' reservations.
- Costs are estimates. Calls that fail before dispatch inside a route (for example a malformed upload) are also charged their reservation. That is conservative, and bounded by the per-minute limits.
- Prices must be updated in `ai-cost.ts` and `scripts/ai-cost-model.mjs` together; a test keeps the two equal.
- **Dated risk: 2027-01-01.** Gemini 3.8/3.6 Flash list prices double that day. The estimate switches automatically, so photo and recipe calls then use about twice as much allowance. The 2027 numbers above already include this.
- **Defect fixed (#336).** Meal draft changes were exempt from the daily draft count and limited only per minute: about 4,300 provider calls a day per account, up to about $1,500 a month. The new `refines_used` column and `ai_charge_refine` close it durably; a pgTAP test and a limiter test check that a change over the cap is refused.
