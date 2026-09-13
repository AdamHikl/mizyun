#!/usr/bin/env node
// @ts-check
import fs from "node:fs/promises";
import path from "node:path";
import { OllamaClient } from "./lib/ollama-client.mjs";
import { MlxClient } from "./lib/mlx-client.mjs";
import { TaskRunner } from "./lib/task-runner.mjs";

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(`
Qwen Local Worker CLI Runner (MLX & Ollama)
Usage:
  node scripts/worker/run-task.mjs <path-to-task.json>
  node scripts/worker/run-task.mjs --check
  node scripts/worker/run-task.mjs --inline '<json-string>'

Options:
  --check               Check model server connection and loaded models
  --mlx                 Use native Apple Silicon MLX-LM server (default if on port 8080)
  --ollama              Use Ollama daemon
  --model <model-tag>   Override default model
  --host <url>          Override server host
  --think <level>       Set thinking level (low, medium, high)
`);
    process.exit(0);
  }

  // Detect runtime: default to MLX if --mlx passed or port 8080 or OLLAMA not explicitly forced
  const useOllama = args.includes("--ollama") && !args.includes("--mlx");

  let host = useOllama
    ? process.env.OLLAMA_HOST || "http://127.0.0.1:11434"
    : process.env.MLX_HOST || "http://127.0.0.1:8080";
  let model = useOllama
    ? process.env.OLLAMA_MODEL || "qwen3.8:27b-q8_0"
    : process.env.MLX_MODEL || "mlx-community/Qwen3.8-27B-8bit";
  let think = process.env.OLLAMA_THINK || "medium";

  const hostIdx = args.indexOf("--host");
  if (hostIdx !== -1 && args[hostIdx + 1]) {
    host = args[hostIdx + 1];
  }

  const modelIdx = args.indexOf("--model");
  if (modelIdx !== -1 && args[modelIdx + 1]) {
    model = args[modelIdx + 1];
  }

  const thinkIdx = args.indexOf("--think");
  if (thinkIdx !== -1 && args[thinkIdx + 1]) {
    think = args[thinkIdx + 1];
  }

  /** @type {any} */
  const client = useOllama
    ? new OllamaClient({ host, model, think })
    : new MlxClient({ host, model });

  const runtimeName = useOllama ? "Ollama" : "MLX-LM (Native Apple Silicon)";

  if (args.includes("--check")) {
    console.log(`Pinging ${runtimeName} at ${host}...`);
    const isOnline = await client.ping();
    if (!isOnline) {
      console.error(`❌ ${runtimeName} is NOT online at ${host}.`);
      process.exit(1);
    }
    console.log(`✅ ${runtimeName} is online!`);
    const models = await client.listModels();
    console.log(`Found ${models.length} model(s):`);
    for (const m of models) {
      console.log(`  - ${m.name}`);
    }
    const hasTarget = await client.hasModel(model);
    console.log(
      `Target model '${model}': ${hasTarget ? "✅ LOADED" : "❌ NOT LOADED"}`,
    );
    process.exit(hasTarget ? 0 : 2);
  }

  let taskJsonStr = "";
  const inlineIdx = args.indexOf("--inline");
  if (inlineIdx !== -1 && args[inlineIdx + 1]) {
    taskJsonStr = args[inlineIdx + 1];
  } else {
    const filePath = args.find((a) => !a.startsWith("--"));
    if (!filePath) {
      console.error("Error: No task file provided.");
      process.exit(1);
    }
    taskJsonStr = await fs.readFile(
      path.resolve(process.cwd(), filePath),
      "utf8",
    );
  }

  const taskPacket = JSON.parse(taskJsonStr);
  if (model) taskPacket.model = model;

  console.log(
    `🚀 Dispatching task '${taskPacket.taskId}' via ${runtimeName} to '${model}'...`,
  );
  console.log(`   Objective: ${taskPacket.objective}`);
  console.log(`   Allowed files: ${taskPacket.allowedFiles.join(", ")}`);

  const runner = new TaskRunner({ client });
  const report = await runner.execute(taskPacket);

  console.log("\n--- Worker Report ---");
  console.log(JSON.stringify(report, null, 2));

  if (report.status === "success") {
    console.log(
      `\n✅ Task completed successfully in ${(report.totalDurationMs / 1000).toFixed(1)}s (Attempts: ${report.attempts})`,
    );
    process.exit(0);
  } else {
    console.error(
      `\n❌ Task failed verification in ${(report.totalDurationMs / 1000).toFixed(1)}s`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal runner error:", err);
  process.exit(1);
});
