// @ts-check
/**
 * Lightweight native client for Ollama API (Zero external dependencies, Node 22 ESM)
 */

export class OllamaClient {
  /**
   * @param {Object} [options]
   * @param {string} [options.host] Base Ollama URL (default: http://127.0.0.1:11434)
   * @param {string} [options.model] Default model tag (default: qwen3.8:27b-q8_0)
   * @param {number} [options.timeoutMs] Request timeout in milliseconds
   */
  constructor(options = {}) {
    this.host = (
      options.host ||
      process.env.OLLAMA_HOST ||
      "http://127.0.0.1:11434"
    ).replace(/\/+$/, "");
    this.model =
      options.model || process.env.OLLAMA_MODEL || "qwen3.8:27b-q8_0";
    this.timeoutMs = options.timeoutMs || 300_000; // 5 min default for local generation
  }

  /**
   * Check if Ollama daemon is reachable
   * @returns {Promise<boolean>}
   */
  async ping() {
    try {
      const res = await fetch(`${this.host}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * List all locally available models
   * @returns {Promise<Array<{ name: string, size: number, modified_at: string }>>}
   */
  async listModels() {
    try {
      const res = await fetch(`${this.host}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        throw new Error(`Failed to list models: HTTP ${res.status}`);
      }
      const data = await res.json();
      return data.models || [];
    } catch (err) {
      throw new Error(
        `Ollama connection error (${this.host}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Check if a specific model tag exists locally
   * @param {string} [modelName]
   * @returns {Promise<boolean>}
   */
  async hasModel(modelName = this.model) {
    const models = await this.listModels();
    return models.some(
      (m) => m.name === modelName || m.name.startsWith(`${modelName}:`),
    );
  }

  /**
   * Send chat messages to Ollama
   * @param {Object} params
   * @param {Array<{ role: 'system' | 'user' | 'assistant', content: string }>} params.messages
   * @param {string} [params.model]
   * @param {'json' | object} [params.format]
   * @param {number} [params.temperature]
   * @param {number} [params.numCtx]
   * @returns {Promise<{ content: string, evalCount: number, durationMs: number }>}
   */
  async chat({
    messages,
    model = this.model,
    format,
    temperature = 0.2,
    numCtx = 32768,
  }) {
    const startTime = Date.now();
    const payload = {
      model,
      messages,
      stream: false,
      options: {
        temperature,
        num_ctx: numCtx,
      },
    };

    if (format) {
      payload.format = format;
    }

    let response;
    try {
      response = await fetch(`${this.host}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new Error(
        `Ollama request failed (${this.host}/api/chat): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Ollama returned HTTP ${response.status}: ${errText}`);
    }

    const data = await response.json();
    return {
      content: data.message?.content || "",
      evalCount: data.eval_count || 0,
      durationMs: Date.now() - startTime,
    };
  }
}

// Quick CLI smoke test if invoked directly
if (
  process.argv[1]?.endsWith("ollama-client.mjs") &&
  process.argv.includes("--ping")
) {
  const client = new OllamaClient();
  client
    .ping()
    .then(async (ok) => {
      if (!ok) {
        console.error(
          `❌ Ollama is NOT reachable at ${client.host}. Please start it with 'ollama serve' or open Ollama.app.`,
        );
        process.exit(1);
      }
      console.log(`✅ Ollama is online at ${client.host}`);
      const models = await client.listModels();
      console.log(`Found ${models.length} installed model(s):`);
      for (const m of models) {
        console.log(` - ${m.name} (${(m.size / 1e9).toFixed(1)} GB)`);
      }
      const hasTarget = await client.hasModel(client.model);
      console.log(
        `Target model '${client.model}' installed: ${hasTarget ? "YES" : "NO"}`,
      );
    })
    .catch((err) => {
      console.error("Ping check error:", err);
      process.exit(1);
    });
}
