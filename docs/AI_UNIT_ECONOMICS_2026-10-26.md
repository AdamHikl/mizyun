# AI unit economics for Pro (#336) — 2026-10-26

Question: can a paying user cost more in AI than the subscription earns? Target from the go-to-market plan (Section 5.4): the worst-case user stays below **30 % of monthly net revenue**. Decision record: [ADR-0081](adr/0081-ai-cost-allowance.md). Price sources and dates: [research log](RESEARCH_LOG.md#ai-list-prices-and-unit-economics-for-pro-caps-336-adr-0081--2026-10-26).

## 1. Revenue

Net = price × (1 − 15 % Store fee) ÷ months. USD uses the ECB rate of 2026-10-26 (1 EUR = 1.1188 USD).

| Plan                       | Price     | Net per month       | 30 % of net             |
| -------------------------- | --------- | ------------------- | ----------------------- |
| Monthly                    | EUR 7.99  | EUR 6.79 (USD 7.60) | EUR 2.04 (**USD 2.28**) |
| Annual                     | EUR 49.99 | EUR 3.54 (USD 3.96) | EUR 1.06 (**USD 1.19**) |
| Founding year (first year) | EUR 34.99 | EUR 2.48 (USD 2.77) | EUR 0.74 (USD 0.83)     |

The annual plan sets the limit: **USD 1.19 per user per month**.

## 2. Prices (USD, checked 2026-10-26)

| Item                                                                                                           | Price                                                                    |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `claude-haiku-5-5` (Coach, typed meals, draft changes, Log activity fallback)                                  | $0.10 input / $0.50 output per MTok (prompts ≤ 100k tokens)              |
| `gemini-3.8-flash` / `gemini-3.6-flash` (photo drafts, stretch, recipes, cooking assistant, old-consent users) | $0.75 / $3.75 per MTok to 2026-12-31; **$1.50 / $7.50 from 2027-01-01**  |
| `gemini-3.1-flash-lite-image` (illustrations)                                                                  | $30 per MTok of image output; one 1K image is 1,120 tokens, about $0.034 |
| Anthropic web search                                                                                           | $0.01 per search; typed meals use up to 3                                |
| Gemini Google Search grounding                                                                                 | $0.014 per request after 5,000 free a month per project                  |
| Image input (Gemini 3)                                                                                         | 1,120 tokens per photo at default resolution                             |

Annual subscriptions bought now are mostly served in 2027, so the model prices Gemini at 2027 rates.

## 3. Formula

Per request: `cost = input_tokens × input_price + output_tokens × output_price + searches × search_fee`.

Request sizes are the largest seen in the Mizyun AI eval suite (`mizyun-ai-eval/runs/suite`), with output given 50 % headroom and photo features at their maximum of three photos. They are in `scripts/ai-cost-model.mjs`.

| Request (design size)                     | Input / output tokens       | 2026 USD | 2027 USD |
| ----------------------------------------- | --------------------------- | -------- | -------- |
| Coach turn, Haiku (largest, 3 tool calls) | 59,758 / 1,560              | 0.0068   | 0.0068   |
| Photo draft, 3 photos, Gemini             | 3,670 / 924                 | 0.0062   | 0.0124   |
| Typed meal with web search, Haiku         | 17,302 / 1,228 + 3 searches | 0.0323   | 0.0323   |
| Draft change (refine), Gemini             | 2,302 / 1,092               | 0.0058   | 0.0116   |
| Log activity, Haiku                       | 1,496 / 455                 | 0.0004   | 0.0004   |
| Evening stretch, Gemini                   | 2,475 / 537                 | 0.0039   | 0.0077   |
| Cooking assistant, Gemini                 | 731 / 2,319                 | 0.0092   | 0.0185   |
| Ingredient photos, 3 photos, Gemini       | 3,207 / 564                 | 0.0045   | 0.0090   |
| Meal illustration                         | 1 image                     | 0.0337   | 0.0337   |

A median request is much cheaper. A median Haiku Coach turn (14,036 / 804 tokens) costs $0.0018, and a one-photo Gemini draft (1,430 / 455) costs $0.0055 in 2027.

Worst case per month with count caps only: `30 × (Coach tokens × blended price + draft cap × most expensive draft + refines × refine cost) + illustrations × image cost`. The Coach blend uses a 6 % output share, rounded up from the largest observed share of 2.5 %. The Coach token figure is the daily budget plus one turn that overshoots it.

## 4. Results

### Before (caps until this change), 2027 prices

| Part                                                                 | Paid USD/month |
| -------------------------------------------------------------------- | -------------- |
| Coach, 100k tokens/day plus one overshoot turn, Haiku (Gemini: 9.00) | 0.60           |
| 100 drafts/day at the worst draft ($0.032)                           | 97.03          |
| Draft changes: only 3/min, so up to 4,320/day                        | 1,508.93       |
| Illustrations, 30/month (feature off)                                | 1.01           |
| **Total**                                                            | **≈ 1,608**    |

A free account could reach about $1,514 a month, almost all of it through draft changes.

### Count caps alone cannot meet the target

Over 30 days the worst case grows with every daily cap. One worst-case draft a day already costs $0.97 a month, and three photo drafts a day cost about $1.12. Even the lowered counts (15 drafts and 30 changes a day) still allow $26.64 a month. The fix is to cap what the calls cost, not how many there are.

### After: cost allowance (ADR-0081)

Every AI call reserves an estimate before it runs. Afterwards it is charged its estimated cost from the tokens the provider reported, the provider that answered and any searches. A call is admitted while the user's UTC day and calendar month are under the allowance.

| Tier | Daily allowance | Monthly allowance | Worst case per month                | Share of net revenue                          |
| ---- | --------------- | ----------------- | ----------------------------------- | --------------------------------------------- |
| Paid | $0.15           | $1.00             | $1.00 + $0.15 overshoot = **$1.15** | annual 29.0 %, monthly 15.1 % (founding 41 %) |
| Free | $0.05           | $0.50             | $0.50 + $0.15 = $0.65               | no revenue (acquisition cost)                 |

Overshoot: the last admitted call can finish above the allowance. At most two calls run at once per user: one in the shared AI in-flight slot (Coach, drafts, recipes) and one illustration. The largest are a Coach turn of 61,318 tokens priced on Gemini in 2027 ($0.114) and an illustration ($0.034). The daily allowance is never binding over a month ($0.15 × 30 > $1.00); it only spreads use.

Normal paid day (one Coach conversation of four median Haiku turns, three photo drafts) at 2027 prices: $0.028. Thirty such days cost $0.83, under the $1.00 allowance; a test checks this. In 2026 the same month costs about $0.42.

Count caps stay as burst limits, set at the coordinator's decision of 2026-10-26: paid 100k Coach tokens, **15 drafts** (was 100) and **30 draft changes** a day (was unlimited); free 10k, 5 and 10. Since 2026-10-27 ([ADR-0085](adr/0085-coach-message-allowance.md)) Coach is counted in messages instead: free 5 and paid 50 a day, under a hidden 320k/3.2M token ceiling; the cost allowance is unchanged.

## 5. Limits of the model

- The founding-year price (EUR 34.99) is not covered: its worst case is about 41 % of net. Holding 30 % for founders would need a $0.70 allowance, which squeezes a normal 2027 month.
- Estimates err high:
  - A call that fails after admission, including a lost response, is charged its reservation.
  - The 5,000 free Gemini grounding requests are ignored.
  - An Anthropic search request that errors is charged 3 searches when Anthropic reports no count.
- Gemini's 2027-01-01 price doubling is a dated risk. A normal paid month goes from about $0.42 at 2026 prices to $0.83 at 2027 prices. Heavy photo users then reach the $1.00 allowance about twice as fast. Revisit the allowance with the report's p95 before the change.
- Provider names are matched by substring. An unknown provider is priced as Gemini, and an on-device or rules result costs nothing.
- Prices change. Update `packages/config/src/ai-cost.ts`, `scripts/ai-cost-model.mjs` (a test keeps them equal), the research log and this document together.

## 6. Monthly report

`scripts/ai-usage-cost-report.mjs` outputs, per tier, median and p95 of tokens, drafts, draft changes, the USD charged in `ai_daily_cost_ledger`, and a token-based low/high estimate. The low estimate prices Coach on Haiku; the high estimate prices it on Gemini and every draft at the worst draft. The report covers the last 30 days (`--days 1-90`) and contains no data beyond user ids (`--per-user`). Every query runs in `BEGIN READ ONLY`.

```bash
pnpm ai:cost-report --verify-local
pnpm ai:cost-report --env local
pnpm ai:cost-report --env dev --json
pnpm ai:cost-report --env prod
```

- `--verify-local` applies the migration and synthetic rows inside one transaction, runs the report and rolls back.
- Dev and Production go over SSH to `mizyun-hetzner-ops` (`--ssh` overrides it). The query runs through `docker exec <container> psql` on `mizyun-dev-db` or `supabase-db`, the same path as `pnpm analytics`.
- Until migration `20261026150000` is deployed on a host, add `--no-cost-ledger`. The charged column is then empty and refines read 0.
- Run it monthly, and after any price or routing change. Compare p95 charged USD per paid user with the $1.19 annual-plan limit.
