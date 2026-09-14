# Local Qwen in OpenCode

> ⛔ **PAUSED (2026-09-14):** Local Qwen agent usage is paused indefinitely per user decision due to performance (too slow). Preserved for reference only; do not start the server or delegate tasks to it.

Use the existing MLX-LM installation for this single-user Mac worker. OpenCode
talks directly to its Chat Completions endpoint; no proxy is needed.

Coding agents should follow the bounded delegation and acceptance workflow in
[`../../.agents/guides/LOCAL_QWEN_OPENCODE_AGENT_GUIDE.md`](../../.agents/guides/LOCAL_QWEN_OPENCODE_AGENT_GUIDE.md).

## Start

From the repository root, keep the server running in one terminal:

```bash
bash scripts/worker/run-mlx-server.sh
```

In another terminal, from the repository root:

```bash
opencode
```

The project config selects `mlx/mlx-community/Qwen3.8-27B-8bit` by default.
Start a new OpenCode session after changing provider configuration. The server
uses `127.0.0.1:8080`; leave its terminal open. Initial model loading and prompt
processing can take time before the first token appears.

## Verify actual tools

With the server running:

```bash
python3 scripts/worker/smoke-opencode.py
```

This runs OpenCode in a disposable folder with only read/edit permissions,
checks completed read/write/read tool events, and verifies the exact random
value written to disk. It uses the local model and allows 300 seconds by
default (`OPENCODE_SMOKE_TIMEOUT` overrides this). A model listing or a plain
text response alone does not establish that agent tools work.

Verified on 2026-09-13 with OpenCode 1.18.30, MLX-LM 0.31.3, MLX 0.32.2,
and the exact requested model: completed read/write/read tools, correct random
file value, 122.1 seconds end to end. This includes OpenCode startup and model
prompt processing; it is not a tokens-per-second benchmark.

## Configuration and diagnosis

- `opencode.json` uses `@ai-sdk/openai-compatible`, which selects
  `/v1/chat/completions`. `@ai-sdk/openai` selects the Responses API instead.
- The old `proxy.py` and `mlx-opencode-bridge.py` are unused historical
  experiments. Do not start them: rewriting a Responses request URL does not
  translate the response protocol, and the bridge drops tool-call metadata.
- MLX-LM 0.31.3 already normalizes text content arrays and handles tool calls.
- The launcher enables thinking by default for local reasoning and sets the default
  output allowance to 4,096 tokens (override with `MLX_CHAT_TEMPLATE_ARGS='{"enable_thinking":false}'`).
  OpenCode declares a conservative 32,768-token context budget and a 4,096-token output budget.
  This is a local operating budget, not a claim about the model's maximum context or a hard server limit.
- Override the interpreter with `MLX_PYTHON`, default output with
  `MLX_MAX_TOKENS`, or template settings with `MLX_CHAT_TEMPLATE_ARGS`.
  Model and port remain optional positional arguments; a changed port/model
  must also be reflected in `opencode.json`.
- This setup is text-only. It does not establish image support, parallel-agent
  throughput, or reliable performance on arbitrary large coding tasks.
- The existing Ollama task runner and MCP worker are separate integrations.
  Changing OpenCode's provider does not migrate them to MLX-LM.

## Sources

Checked 2026-09-13: [OpenCode custom providers](https://opencode.ai/docs/providers/#custom-provider)
and [MLX-LM](https://github.com/ml-explore/mlx-lm).
