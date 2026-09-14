---
name: qwen-task-dispatch
description: Dispatch bounded implementation tasks to the local Qwen worker via Ollama MCP or CLI runner, evaluate structured reports, handle bounded retries, and escalate to Astra when necessary.
---

# Qwen Task Dispatch Skill

> [!WARNING]
> **PAUSED BY USER DECISION (2026-09-14):** The local Qwen agent is paused indefinitely because it is too slow. Do NOT dispatch tasks using this skill or run local Qwen workers. Use Antigravity built-in subagents (`research`, `self`) or direct coordinator execution instead.

This skill guides the **Gemini 3.8 Flash Coordinator** in preparing, dispatching, and accepting work from the local **Qwen3.8:27b-q8_0** worker (currently PAUSED).

## When to Dispatch to Qwen

- Writing or updating isolated unit tests (`*.test.ts`).
- Implementing pure functions or utility methods in `packages/core`.
- Formatting, refactoring, or updating type definitions within explicit files.
- Updating documentation files (`docs/*.md`).
- Simple bug reproduction where a failing unit test can be isolated.

## When NOT to Dispatch to Qwen (Keep with Gemini or Escalate to Astra)

- **Do not dispatch** auth, session, or RLS changes (Escalate to Astra).
- **Do not dispatch** database schema migrations (Escalate to Astra).
- **Do not dispatch** deployment scripts or remote infrastructure (Coordinator only).
- **Do not dispatch** tasks touching more than 3 interdependent files (Decompose first).

---

## 1. Preparing the Task Packet

Construct a JSON packet strictly conforming to the Worker Contract:

```json
{
  "taskId": "task-YYYYMMDD-NN",
  "objective": "Add unit tests for meal macro aggregation logic",
  "allowedFiles": ["packages/core/src/nutrition/macro-calc.test.ts"],
  "prohibitedActions": [
    "do not edit packages/core/src/nutrition/macro-calc.ts",
    "do not commit or push to git"
  ],
  "verificationCommand": "pnpm --filter @mizyun/core test macro-calc.test.ts",
  "contextSnippet": "export interface MacroTotals { calories: number; protein: number; ... }"
}
```

### Critical Guidelines Learned from Field Testing:

1. **Targeted Context Snippets for Large Files (>200 lines)**:
   - Do NOT pass entire 1,000-line files to the local worker.
   - Always extract the relevant JSX/function slice (±30–50 lines) into `contextSnippet`.
   - The worker engine automatically leverages search/replace diff blocks, cutting output generation from ~3 minutes to ~10–20 seconds and avoiding token generation timeouts.
2. **Framework & Code Conventions**:
   - For React Native code, explicitly instruct the worker to use existing `StyleSheet.create` rules instead of creating inline style objects (`style={{ ... }}`).
3. **Focused Verification Commands**:
   - Keep the `verificationCommand` scoped to the affected package or test file (e.g. `pnpm --filter @mizyun/mobile typecheck && pnpm --filter @mizyun/mobile test <file>`). Full repository checks (`pnpm check`) are owned by the Gemini Coordinator during final integration.

---

## 2. Dispatching the Task

### Via MCP Tool (Inside Antigravity)

Call `qwen_run_task` with the parameters matching the task packet.

### Via Terminal CLI

Save task to `.agents/tasks/task-XYZ.json` and execute:

```bash
node scripts/worker/run-task.mjs .agents/tasks/task-XYZ.json
```

---

## 3. Evaluating Worker Reports

The worker returns a structured JSON report:

```json
{
  "status": "success | failed",
  "filesChanged": ["packages/core/src/nutrition/macro-calc.test.ts"],
  "commandsRun": [
    {
      "command": "pnpm --filter ...",
      "exitCode": 0,
      "summary": "3 tests passed"
    }
  ],
  "unresolvedRisks": [],
  "suggestedNextAction": "Run repository-wide pnpm check"
}
```

### Coordinator Decision Rules:

1. **If `status === "success"` and all tests pass**:
   - Inspect the diff (`git diff <allowedFiles>`).
   - Run repository integration check (`pnpm check`).
   - Log entry in `docs/LOCAL_WORKER_BASELINE.md`.
2. **If `status === "failed"` after 2 cycles**:
   - Do NOT loop indefinitely.
   - If the task failed due to ambiguity or complex logic, either break it down into smaller sub-tasks or escalate to Astra.
   - Revert any broken changes with `git checkout -- <allowedFiles>` if necessary.
