// @ts-check
/**
 * Lightweight native client for MLX-LM HTTP Server (OpenAI-compatible Chat Completions, zero dependencies, Node 22 ESM)
 */

export class MlxClient {
  /**
   * @param {Object} [options]
   * @param {string} [options.host] Base MLX server URL (default: http://127.0.0.1:8080)
   * @param {string} [options.model] Default model tag (default: mlx-community/Qwen3.8-27B-8bit)
   * @param {number} [options.timeoutMs] Request timeout in milliseconds
   */
  constructor(options = {}) {
    this.host = (
      options.host ||
      process.env.MLX_HOST ||
      "http://127.0.0.1:8080"
    ).replace(/\/+$/, "");
    this.model =
      options.model ||
      process.env.MLX_MODEL ||
      "mlx-community/Qwen3.8-27B-8bit";
    this.timeoutMs = options.timeoutMs || 300_000;
  }

  /**
   * Check if MLX server is reachable
   * @returns {Promise<boolean>}
   */
  async ping() {
    try {
      const res = await fetch(`${this.host}/v1/models`, {
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * List all locally available models in MLX
   * @returns {Promise<Array<{ name: string }>>}
   */
  async listModels() {
    try {
      const res = await fetch(`${this.host}/v1/models`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        throw new Error(`Failed to list models: HTTP ${res.status}`);
      }
      const data = await res.json();
      return (data.data || []).map((/** @type {{ id: string }} */ m) => ({
        name: m.id,
      }));
    } catch (err) {
      throw new Error(
        `MLX server connection error (${this.host}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Check if the target model is loaded in MLX
   * @param {string} [modelName]
   * @returns {Promise<boolean>}
   */
  async hasModel(modelName = this.model) {
    const models = await this.listModels();
    return models.some((m) => m.name === modelName);
  }

  /**
   * Send chat messages to MLX-LM via /v1/chat/completions
   * @param {Object} params
   * @param {Array<{ role: 'system' | 'user' | 'assistant', content: string }>} params.messages
   * @param {string} [params.model]
   * @param {number} [params.temperature]
   * @param {number} [params.maxTokens]
   * @returns {Promise<{ content: string, thinking?: string, evalCount?: number, durationMs: number }>}
   */
  async chat({
    messages,
    model = this.model,
    temperature = 0.1,
    maxTokens = 4096,
  }) {
    const startTime = Date.now();
    const payload = {
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    };

    let response;
    try {
      response = await fetch(`${this.host}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new Error(
        `MLX request failed (${this.host}/v1/chat/completions): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`MLX returned HTTP ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    const message = choice?.message || {};

    let content = message.content || "";
    let thinking = message.reasoning || "";

    // If model outputs <think>...</think> in content, split it
    if (!thinking && content.includes("<think>")) {
      const match = content.match(/<think>([\s\S]*?)<\/think>/);
      if (match) {
        thinking = match[1].trim();
        content = content.replace(/<think>[\s\S]*?<\/think>/, "").trim();
      }
    }

    return {
      content: content.trim(),
      thinking,
      evalCount: data.usage?.completion_tokens || 0,
      durationMs: Date.now() - startTime,
    };
  }
}
