#!/usr/bin/env node
// @ts-check
import fs from "node:fs/promises";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { MlxClient } from "./lib/mlx-client.mjs";
import { TaskRunner } from "./lib/task-runner.mjs";

const execAsync = promisify(exec);

/**
 * Overnight Batch Supervisor & Watchdog
 * Takes a JSON manifest of tasks, takes pre-flight snapshots, runs Qwen on MLX,
 * verifies allowed files, and logs comprehensive verification evidence.
 */

async function git(cmd, repoRoot) {
  try {
    const { stdout } = await execAsync(`git ${cmd}`, { cwd: repoRoot });
    return stdout.trim();
  } catch (err) {
    return "";
  }
}

async function main() {
  const args = process.argv.slice(2);
  const repoRoot = process.cwd();

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(`
Mizyun Overnight Batch Runner & Watchdog
Usage:
  node scripts/worker/batch-runner.mjs <batch-manifest.json>

Options:
  --host <url>     MLX host (default: http://127.0.0.1:8080)
  --model <name>   MLX model (default: mlx-community/Qwen3.8-27B-8bit)
`);
    process.exit(0);
  }

  const manifestPath = path.resolve(repoRoot, args[0]);
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));

  const host = manifest.host || "http://127.0.0.1:8080";
  const model = manifest.model || "mlx-community/Qwen3.8-27B-8bit";
  const client = new MlxClient({ host, model });

  console.log("=================================================");
  console.log("🌙 STARTING OVERNIGHT BATCH RUNNER (MLX NATIVE)");
  console.log(`   Model: ${model}`);
  console.log(`   Host:  ${host}`);
  console.log(`   Tasks: ${manifest.tasks.length}`);
  console.log("=================================================\n");

  const isOnline = await client.ping();
  if (!isOnline) {
    console.error(`❌ Fatal: MLX server not reachable at ${host}.`);
    process.exit(1);
  }

  const runner = new TaskRunner({ client, repoRoot });
  const batchReport = {
    startedAt: new Date().toISOString(),
    completedAt: "",
    totalTasks: manifest.tasks.length,
    passedTasks: 0,
    failedTasks: 0,
    results: [],
  };

  for (let i = 0; i < manifest.tasks.length; i++) {
    const task = manifest.tasks[i];
    console.log(`\n-------------------------------------------------`);
    console.log(
      `[Task ${i + 1}/${manifest.tasks.length}] ${task.taskId}: ${task.objective}`,
    );
    console.log(`Allowed files: ${task.allowedFiles.join(", ")}`);
    console.log(`-------------------------------------------------`);

    // Pre-flight check: capture git status and diff before task execution
    const preStatus = await git("status --porcelain", repoRoot);
    const preDiff = await git("diff", repoRoot);

    const report = await runner.execute(task);

    // Post-flight watchdog verification:
    // 1. Check if any file outside allowedFiles was touched
    const postStatus = await git("status --porcelain", repoRoot);
    const postLines = postStatus.split("\n").filter(Boolean);
    const unauthorizedFiles = [];

    for (const line of postLines) {
      const filePath = line.slice(3).trim();
      const isAllowed = task.allowedFiles.some(
        (af) => filePath === af || filePath.endsWith(af),
      );
      const wasPreExisting = preStatus.includes(filePath);
      if (!isAllowed && !wasPreExisting) {
        unauthorizedFiles.push(filePath);
      }
    }

    if (unauthorizedFiles.length > 0) {
      console.error(
        `🚨 WATCHDOG BREACH: Task modified files outside allowlist:`,
        unauthorizedFiles,
      );
      report.status = "failed";
      report.unresolvedRisks.push(
        `Watchdog caught unauthorized writes: ${unauthorizedFiles.join(", ")}`,
      );
    }

    // Capture post diff for evidence
    const taskDiff = await git(
      `diff -- ${task.allowedFiles.join(" ")}`,
      repoRoot,
    );

    if (report.status === "success") {
      batchReport.passedTasks++;
      console.log(
        `✅ [Task ${task.taskId}] PASSED in ${(report.totalDurationMs / 1000).toFixed(1)}s`,
      );
    } else {
      batchReport.failedTasks++;
      console.error(
        `❌ [Task ${task.taskId}] FAILED (${report.unresolvedRisks.join("; ")})`,
      );
    }

    batchReport.results.push({
      taskId: task.taskId,
      objective: task.objective,
      status: report.status,
      filesChanged: report.filesChanged,
      unauthorizedFiles,
      durationSec: (report.totalDurationMs / 1000).toFixed(1),
      attempts: report.attempts,
      risks: report.unresolvedRisks,
      diffSnippet: taskDiff.slice(0, 1000),
    });
  }

  batchReport.completedAt = new Date().toISOString();

  // Save durable evidence
  const reportPath = path.resolve(
    repoRoot,
    `.agents/tasks/batch-report-latest.json`,
  );
  await fs.writeFile(reportPath, JSON.stringify(batchReport, null, 2), "utf8");

  console.log("\n=================================================");
  console.log("🏁 BATCH COMPLETE");
  console.log(
    `   Passed: ${batchReport.passedTasks}/${batchReport.totalTasks}`,
  );
  console.log(
    `   Failed: ${batchReport.failedTasks}/${batchReport.totalTasks}`,
  );
  console.log(`   Evidence Report: ${reportPath}`);
  console.log("=================================================\n");
}

main().catch((err) => {
  console.error("Fatal batch runner error:", err);
  process.exit(1);
});
