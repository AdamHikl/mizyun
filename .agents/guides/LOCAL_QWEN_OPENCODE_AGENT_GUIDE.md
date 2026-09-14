# Agent guide: local Qwen through OpenCode

> ⛔ **PAUSED BY USER DECISION (2026-09-14):** Local Qwen execution is paused indefinitely because it is too slow. Do NOT use this workflow or start the local MLX server. Use Antigravity built-in subagents or direct coordinator execution.

Use this guide when delegating a bounded Mizyun coding task to the local
`mlx-community/Qwen3.8-27B-8bit` model through OpenCode. The local runtime is
MLX-LM. Do not start `scripts/worker/proxy.py` or
`scripts/worker/mlx-opencode-bridge.py`.

## Preconditions

1. Work from `/Users/adam/Documents/mizyun`.
2. Read the root `AGENTS.md`, inspect `git status --short`, and preserve all
   existing changes. The coordinating agent retains ownership of commits,
   pushes, deployments, credentials, remote configuration, and shared
   continuity documents.
3. Give Qwen one bounded task, normally no more than three related files. Do
   not delegate authentication, authorization, RLS, migrations, account
   deletion/export, AI admission or budgets, deployment, credentials, or
   destructive commands.
4. Identify the exact allowed files and a focused verification command before
   starting OpenCode.

## Start or confirm the MLX-LM server

Check the endpoint first:

```bash
curl --fail --silent --show-error http://127.0.0.1:8080/v1/models
```

The response must list `mlx-community/Qwen3.8-27B-8bit`. If port 8080 is not
available, start the server in a persistent terminal and leave it running:

```bash
bash scripts/worker/run-mlx-server.sh
```

The launcher defaults to a 4,096-token output budget and disables model
thinking for short tool tasks. Initial model loading and the first prompt can
take one to two minutes on this Mac. Do not interpret an initially quiet
terminal as failure while the server is still processing.

## Prove tool use before real work

After installing or changing OpenCode, MLX-LM, the model, or `opencode.json`,
run:

```bash
python3 scripts/worker/smoke-opencode.py
```

Accept the smoke test only when it prints `PASS`. This exercises OpenCode tool
calls in a disposable directory and verifies the exact value written to disk.
A successful `/v1/models` response or ordinary chat completion is insufficient
evidence that coding tools work.

## Prepare the task

Include all of the following in the prompt:

```text
Objective: <one concrete outcome>

Allowed files:
- <repo-relative path>
- <repo-relative path>

Required context:
- <relevant requirement, behavior, or code convention>
- Preserve all existing unrelated and uncommitted work.

Prohibited actions:
- Do not edit files outside Allowed files.
- Do not commit, push, deploy, change credentials, or change remote configuration.
- Do not run destructive commands.

Acceptance:
- <observable behavior>
- Run: <focused verification command>

Return:
- Files changed.
- Commands run and actual results.
- Assumptions, unresolved risks, and blockers.
```

For a source file longer than about 200 lines, provide the relevant function or
component slice instead of asking Qwen to rediscover the whole module. Keep the
objective small enough to complete in one run.

## Run the task

Interactive use:

```bash
opencode
```

The repository configuration selects
`mlx/mlx-community/Qwen3.8-27B-8bit`. Start a new OpenCode session after any
provider configuration change.

For a non-interactive bounded run, pass the complete task prompt to:

```bash
opencode run --model mlx/mlx-community/Qwen3.8-27B-8bit "<task prompt>"
```

Do not use `--auto`. Approve only the file access and focused checks already
authorized by the task packet. Keep the MLX-LM terminal open for the entire
run.

## Accept or reject the result

The coordinating agent must inspect the actual diff and verify that every
changed file was allowed. Qwen's final message is a report, not acceptance
evidence.

Accept only when:

- no file outside the allowlist changed;
- the implementation matches the stated acceptance behavior;
- the focused verification command passed with a fresh result;
- `git diff --check` passes; and
- no unresolved safety, architecture, or data-handling issue remains.

After accepting the bounded result, the coordinating agent runs the applicable
integration checks and, before committing Mizyun work, a fresh `pnpm check`.
Record timing and outcome in `docs/LOCAL_WORKER_BASELINE.md` when measuring the
worker.

## Retry and escalation

Allow at most two correction cycles. On failure, first reduce the task or add a
specific code slice and exact error output. Stop using Qwen for the task when:

- it edits outside the allowlist;
- the same failure remains after two attempts;
- the task expands beyond three related files;
- it requires a prohibited security, data, deployment, or credential change;
- the server repeatedly disconnects; or
- the result needs architectural judgment rather than a bounded implementation.

Return the partial diff and evidence to the coordinating agent. Do not erase
files or restore paths automatically because the working tree may contain work
from another session.

## Connection troubleshooting

- `Cannot connect to API`: verify port 8080 and keep
  `scripts/worker/run-mlx-server.sh` running in a persistent terminal.
- Requests go to `/v1/responses`: the project config is stale or not loaded.
  `opencode.json` must use `@ai-sdk/openai-compatible` and
  `http://127.0.0.1:8080/v1`.
- Tool calls are missing: start a new OpenCode session and rerun the smoke test.
  Do not insert either historical bridge.
- Output stops early: keep the task smaller; only then consider increasing
  `MLX_MAX_TOKENS` when starting the server.
- The model is slow: wait for current prompt processing to finish. Do not launch
  concurrent Qwen runs until concurrent-serving behavior has been measured.

The broader setup and version evidence are in
`docs/tutorials/LOCAL_QWEN_OPENCODE.md`.
