#!/usr/bin/env bash
set -euo pipefail

MODEL="${1:-mlx-community/Qwen3.8-27B-8bit}"
PORT="${2:-8080}"
PYTHON="${MLX_PYTHON:-python3}"
MAX_TOKENS="${MLX_MAX_TOKENS:-4096}"
# Thinking enabled by default for local Qwen agent reasoning.
# Override with MLX_CHAT_TEMPLATE_ARGS='{"enable_thinking":false}' if needed.
DEFAULT_CHAT_TEMPLATE_ARGS='{"enable_thinking":true}'
CHAT_TEMPLATE_ARGS="${MLX_CHAT_TEMPLATE_ARGS:-$DEFAULT_CHAT_TEMPLATE_ARGS}"

echo "Starting MLX-LM server with model: $MODEL on port $PORT..."
echo "OpenCode connects directly to http://127.0.0.1:$PORT/v1 (no bridge)."
exec "$PYTHON" -m mlx_lm server --model "$MODEL" --port "$PORT" --host 127.0.0.1 \
  --max-tokens "$MAX_TOKENS" --chat-template-args "$CHAT_TEMPLATE_ARGS"
