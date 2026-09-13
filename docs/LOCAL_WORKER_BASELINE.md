# Local Worker Baseline Metric Register

Track 10–20 representative development tasks across local (Qwen3.8 27B q8_0) and cloud (Gemini / Astra) executions. This baseline prevents "token reduction" from hiding increased coordination or retry overhead.

## Baseline Summary Metrics

| Metric                       | Target                      | Baseline (Tasks 1–20) | Post-Rollout | Notes                                       |
| :--------------------------- | :-------------------------- | :-------------------- | :----------- | :------------------------------------------ |
| **Local Task %**             | $\ge 60\%$ of routine edits | TBD                   | TBD          | Proportion of bounded tasks routed to Qwen  |
| **First-Pass Pass Rate**     | $\ge 70\%$                  | TBD                   | TBD          | Tasks passing verification on attempt 1     |
| **Retry Rate**               | $\le 25\%$                  | TBD                   | TBD          | Tasks requiring attempt 2 (self-correction) |
| **Astra Escalation Rate**    | $\le 15\%$                  | TBD                   | TBD          | Tasks requiring tier-1 escalation           |
| **Coordination Overhead**    | $< 3\text{ min}$            | TBD                   | TBD          | Gemini packet prep & result integration     |
| **Est. Cloud Token Savings** | $\ge 50\%$                  | TBD                   | TBD          | Compared to full cloud execution            |

---

## Task Log (10–20 Representative Tasks)

| # | Task ID & Summary | Scope / Module | Assigned Model | Retries (0-2) | Verification Command | Final Status | Cloud Tokens / Cost | Wall-Clock Time | Escalated? (Reason) |
| 1 | `task-smoke-001`: Implement exported addNumbers math helper | `scripts/worker/test-fixtures` | `qwen3.8:27b-q8_0` | 0 | `node -e "import(...)"` | `ACCEPTED` | 0 (local) | 38.7s | None |
| 2 | `task-ui-overflow-001`: Fix exercise name & stats overflow in workout history card | `apps/mobile` | `qwen3.8:27b-q8_0` | 0 | `pnpm --filter @mizyun/mobile typecheck && pnpm --filter @mizyun/mobile test ...` | `ACCEPTED` | 0 (local) | 177.0s | None |
| 3 | `task-auth-loading-001`: Prevent profileLoading from blocking app on cold start | `apps/mobile` | `qwen3.8:27b-q8_0` | 0 | `pnpm --filter @mizyun/mobile typecheck && pnpm --filter @mizyun/mobile test` | `ACCEPTED` | 0 (local) | 142.3s | None |
| 4 | | | | | | | | | |
| 5 | | | | | | | | | |
| 6 | | | | | | | | | |
| 7 | | | | | | | | | |
| 8 | | | | | | | | | |
| 9 | | | | | | | | | |
| 10 | | | | | | | | | |
| 11 | | | | | | | | | |
| 12 | | | | | | | | | |
| 13 | | | | | | | | | |
| 14 | | | | | | | | | |
| 15 | | | | | | | | | |
| 16 | | | | | | | | | |
| 17 | | | | | | | | | |
| 18 | | | | | | | | | |
| 19 | | | | | | | | | |
| 20 | | | | | | | | | |

---

## Log Entry Schema

When logging a completed task in this register:

- **Task ID & Summary**: Short slug and 1-sentence goal.
- **Scope / Module**: Target package (e.g. `packages/core`, `apps/api`, docs).
- **Assigned Model**: `qwen3.8:27b-q8_0` (local) vs `gemini-3.8-flash` (cloud coordinator) vs `astra` (architect/reviewer).
- **Retries**: 0 = passed first try; 1 = passed after 1 self-correction; 2 = hit retry limit.
- **Verification Command**: Exact test or check run.
- **Final Status**: `ACCEPTED` | `REVERTED` | `ESCALATED`.
- **Cloud Tokens / Cost**: Approximate input/output tokens used by coordinator or reviewer.
- **Wall-Clock Time**: From dispatch to verification acceptance.
- **Escalated?**: `None` or rationale (e.g. "Auth RLS boundary", "2 test failures").
