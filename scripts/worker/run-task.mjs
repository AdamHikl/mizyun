#!/usr/bin/env node
// @ts-check
import fs from "node:fs/promises";
import path from "node:path";
import { OllamaClient } from "./lib/ollama-client.mjs";
import { TaskRunner } from "./lib/task-runner.mjs";

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(`
Qwen Local Worker CLI Runner
Usage:
  node scripts/worker/run-task.mjs <path-to-task.json>
  node scripts/worker/run-task.mjs --check
  node scripts/worker/run-task.mjs --inline '<json-string>'

Options:
  --check               Check Ollama daemon connection and installed models
  --model <model-tag>   Override default model (qwen3.8:27b-q8_0)
  --host <url>          Override Ollama host (http://127.0.0.1:11434)
`);
    process.exit(0);
  }

  let host = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
  let model = process.env.OLLAMA_MODEL || "qwen3.8:27b-q8_0";

  const hostIdx = args.indexOf("--host");
  if (hostIdx !== -1 && args[hostIdx + 1]) {
    host = args[hostIdx + 1];
  }

  const modelIdx = args.indexOf("--model");
  if (modelIdx !== -1 && args[modelIdx + 1]) {
    model = args[modelIdx + 1];
  }

  const client = new OllamaClient({ host, model });

  if (args.includes("--check")) {
    console.log(`Pinging Ollama at ${host}...`);
    const isOnline = await client.ping();
    if (!isOnline) {
      console.error(
        `❌ Ollama is NOT online at ${host}. Please run 'ollama serve' or open Ollama.app.`,
      );
      process.exit(1);
    }
    console.log(`✅ Ollama is online!`);
    const models = await client.listModels();
    console.log(`Found ${models.length} model(s):`);
    for (const m of models) {
      console.log(`  - ${m.name} (${(m.size / 1e9).toFixed(1)} GB)`);
    }
    const hasTarget = await client.hasModel(model);
    console.log(
      `Target model '${model}': ${hasTarget ? "✅ INSTALLED" : "❌ NOT FOUND (run: ollama pull " + model + ")"}`,
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
    `🚀 Dispatching task '${taskPacket.taskId}' to local model '${model}'...`,
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
