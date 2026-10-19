# Log activity: AI drafts from descriptions (#299)

Date: 2026-10-19 (Claude Code). Baseline `6da9b8d8a02b630bd339ad68f7b8147d27bda1cd`; committed and pushed as `631b3c54af819616fe103b77ae6426596c48eb18` on main. Decision: [ADR-0073](adr/0073-ai-activity-description-drafts.md).

## Requested behaviour

Adam: "when I said I did yardwork or boxing, it didn't know … we need to use AI for this." Approved design:

- Users with current AI consent and confirmed adult eligibility get an AI draft from `POST /v1/activity-drafts/text`.
- Everyone else, and every AI failure, empty draft or rejected text, uses the on-device parser.
- The draft uses the shared daily AI draft budget.

## Verification

- **Focused tests:**
  - API activity-drafts route: 21
  - Mobile log-activity: 68
  - agent-runtime activity-draft: 20
  - Gemini activity-draft: 6
  - Anthropic vision: 55
  - `tsc` is clean in contracts, agent-runtime, both providers, API and mobile.
- **`pnpm check`:** PASS on the settled tree. Input SHA-256 `4e6e6975…`. Mobile 3277, API 1216 passed / 15 skipped (provider-gated), core 788, agent-runtime 115, Gemini 139, Anthropic 116.
- **Reviews:**
  - Independent Opus review: no blockers. Should-fix items were resolved: Gemini output cap, `null` enum member removed, mobile catch and empty-draft fallback, refusal returns 422, an on-screen AI note, and test gaps.
  - Bounded fix review: no blockers; its 3 nits were applied.
  - Inherited meal-route limiter mismatch: #301.
- **Dev deploy:** `pnpm deploy:dev 631b3c54…` re-ran the gate (PASS, input `372cad90…`), reconciled migrations (none new) and restarted `mizyun-api-dev`. Hetzner Dev runs `631b3c54`. Public `/v1/health` 200 at 2026-10-19T08:58:36Z.
- **Live route check (public Dev):** unauthenticated `POST /v1/activity-drafts/text` → 401 `AUTHENTICATION_REQUIRED`. An unknown sibling path → 404, so the route is registered and requires sign-in.
- **Live provider check (Dev host):**
  - Ran via `mizyun-hetzner-ops` with `systemd-run` as `mizyun-dev-api`, using `EnvironmentFile=/etc/mizyun/dev.env` and the deployed checkout. It built `GeminiVisionProvider` the way `app.ts` does. No files were written; the Dev checkout was clean (0 changes) before and after.
  - Config: `AGENT_PROVIDER=gemini`, AI external access on, `gemini-3.8-flash`, thinking budget 0. Local date/time sent: 2026-10-19 10:30. Every response was `STOP` with valid JSON.

| Description                                                     | Draft                                                        | Tokens | Latency |
| --------------------------------------------------------------- | ------------------------------------------------------------ | ------ | ------- |
| did yardwork for 2 hours this morning                           | Yardwork, 7200 s, 2026-10-19, no start time                  | 720    | 1.9 s   |
| boxing 45 min yesterday at 6pm, mostly sparring                 | Boxing, 2700 s, 2026-10-18 18:00, note "Mostly sparring"     | 700    | 2.1 s   |
| I just finished a 5k run on the treadmill in 28 minutes         | Running, 1680 s, 5 km, 2026-10-19 10:02, endedNow, treadmill | 848    | 2.8 s   |
| played tennis with friends last Saturday for an hour and a half | Tennis, 5400 s, 2026-10-17, note "With friends"              | 829    | 3.0 s   |

These 4 calls went straight to the provider. They did not pass through the route, so they used no user's draft budget (about 3.1k tokens on the shared Gemini project). Real usage is about 700–850 tokens per draft; the route commits the reported count, and the 600 estimate applies only when none is reported.

## Open

- No synthetic account was created, so the signed-in route path (consent → provider → budget commit) has been verified only by tests, not live.
- Release Dev build of `0e76d0cf` (contains `631b3c54`) installed and launched on iPhone `00008140-001114501A86801C` (`com.mizyun.development`, team LQJNDVBL43) at 2026-10-19T09:09:54Z via `pnpm mobile:install:ios:dev`. Install and launch only. Next: Adam's device check. In Workouts → Log activity, type "did yardwork for 2 hours this morning" and tap **Fill in from description**. Expected: Activity "Yardwork", 120 minutes, today; the status line says "Filled in activity, duration, date…"; and the note under the button says the description is sent to the AI provider.
- #300 consent and Settings copy (Adam's decision). #301 meal route limiter.
