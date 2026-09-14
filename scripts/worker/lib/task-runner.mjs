// @ts-check
import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { OllamaClient } from "./ollama-client.mjs";

const execAsync = promisify(exec);

/**
 * @typedef {Object} TaskPacket
 * @property {string} taskId Unique task identifier
 * @property {string} objective Actionable, single-goal objective
 * @property {string[]} allowedFiles List of repository-relative paths permitted to be modified
 * @property {string[]} [prohibitedActions] Actions explicitly disallowed
 * @property {string} [verificationCommand] Command to verify correctness (e.g. vitest test)
 * @property {string} [contextSnippet] Minimal code context, types, or instructions
 * @property {string} [model] Ollama model override
 */

/**
 * @typedef {Object} CommandRunResult
 * @property {string} command
 * @property {number} exitCode
 * @property {string} summary
 * @property {string} [stdout]
 * @property {string} [stderr]
 */

/**
 * @typedef {Object} WorkerReport
 * @property {'success' | 'failed'} status
 * @property {string} taskId
 * @property {string[]} filesChanged
 * @property {CommandRunResult[]} commandsRun
 * @property {string[]} unresolvedRisks
 * @property {string} suggestedNextAction
 * @property {number} attempts
 * @property {number} totalDurationMs
 */

export class TaskRunner {
  /**
   * @param {Object} [options]
   * @param {string} [options.repoRoot] Root path of workspace
   * @param {OllamaClient} [options.client]
   */
  constructor(options = {}) {
    this.repoRoot = path.resolve(options.repoRoot || process.cwd());
    this.client = options.client || new OllamaClient();
  }

  /**
   * Validate that a target path is strictly within the allowedFiles whitelist and repo root
   * @param {string} relPath
   * @param {string[]} allowedFiles
   */
  validatePath(relPath, allowedFiles) {
    const normalized = path.normalize(relPath).replace(/^[./]+/, "");
    let matchedAf = allowedFiles.find(
      (af) => path.normalize(af).replace(/^[./]+/, "") === normalized,
    );
    if (!matchedAf) {
      // Allow matching if model omitted package root (e.g. "src/..." matching "apps/mobile/src/...")
      matchedAf = allowedFiles.find((af) => {
        const normAf = path.normalize(af).replace(/^[./]+/, "");
        return normAf.endsWith(`/${normalized}`) || normAf === normalized;
      });
    }
    if (!matchedAf) {
      throw new Error(
        `Security violation: Model attempted to modify '${relPath}', which is not in allowedFiles whitelist: ${JSON.stringify(allowedFiles)}`,
      );
    }

    const targetRel = path.normalize(matchedAf).replace(/^[./]+/, "");
    const absPath = path.resolve(this.repoRoot, targetRel);
    if (!absPath.startsWith(this.repoRoot + path.sep)) {
      throw new Error(
        `Security violation: Path traversal detected: '${relPath}'`,
      );
    }
    return absPath;
  }

  /**
   * Run verification command in the repo directory
   * @param {string} command
   * @param {number} [timeoutMs]
   * @returns {Promise<CommandRunResult>}
   */
  async runVerification(command, timeoutMs = 60_000) {
    // Prohibit destructive / unsafe operations
    const forbidden = [
      /git\s+push/i,
      /git\s+commit/i,
      /deploy/i,
      /db:reset/i,
      /rm\s+-rf\s+\//i,
    ];
    for (const pattern of forbidden) {
      if (pattern.test(command)) {
        throw new Error(
          `Security violation: Command matches prohibited pattern (${pattern}): ${command}`,
        );
      }
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: this.repoRoot,
        timeout: timeoutMs,
        env: { ...process.env, CI: "true", FORCE_COLOR: "0" },
      });
      return {
        command,
        exitCode: 0,
        summary: "Command executed successfully",
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      };
    } catch (err) {
      const execErr = /** @type {any} */ (err);
      return {
        command,
        exitCode: execErr.code ?? 1,
        summary: execErr.message || "Command failed",
        stdout: (execErr.stdout || "").trim(),
        stderr: (execErr.stderr || "").trim(),
      };
    }
  }

  /**
   * Main entrypoint to execute a task packet with bounded retries (max 2 cycles)
   * @param {TaskPacket} packet
   * @returns {Promise<WorkerReport>}
   */
  async execute(packet) {
    const startTime = Date.now();
    const {
      taskId,
      objective,
      allowedFiles,
      referenceFiles = [],
      prohibitedActions = [],
      verificationCommand,
      contextSnippet = "",
      model,
      think,
    } = packet;

    if (
      !taskId ||
      !objective ||
      !Array.isArray(allowedFiles) ||
      allowedFiles.length === 0
    ) {
      throw new Error(
        "Invalid task packet: 'taskId', 'objective', and non-empty 'allowedFiles' array are required.",
      );
    }

    // Backup current contents of allowed files in case of failure/rollback
    const backups = new Map();
    for (const rel of allowedFiles) {
      const abs = path.resolve(this.repoRoot, rel);
      try {
        const content = await fs.readFile(abs, "utf8");
        backups.set(rel, content);
      } catch {
        backups.set(rel, null); // New file that didn't exist before
      }
    }

    /** @type {CommandRunResult[]} */
    const commandsRun = [];
    /** @type {string[]} */
    const filesChanged = [];
    const maxAttempts = 2; // Bounded retry: 1 initial + 1 correction cycle
    let attempt = 0;
    let success = false;
    let lastErrorSnippet = "";

    const systemPrompt = `You are an expert TypeScript / Node.js software engineer working as an implementation worker in the Mizyun repository.

Mizyun Monorepo Navigation:
- packages/core: pure domain calculations (energy, macros, weight velocity, profile rules). No dependencies on databases or frameworks.
- packages/contracts: shared versioned Zod schemas and wire types (packages/contracts/src/index.ts).
- apps/mobile: React Native Expo mobile app (apps/mobile/src/features/...).
- apps/api: Fastify backend API composition root (apps/api/src/modules/...).
- docs/: Repository architecture and standards (docs/START_HERE.md, docs/feature-map.json, status.md, GitHub Issues, docs/QUALITY_GATES.md).

Capabilities:
1. Inspect any file or document in the repository (read-only):
   If you need to read a documentation file (.md), type definition, or neighboring code before deciding how to implement, reply with:
   {"action": "read_file", "path": "docs/START_HERE.md"}
   or
   {"action": "read_file", "path": "packages/contracts/src/index.ts"}
   The system will return the file contents to you.
2. Produce code changes:
   When you are ready to implement the changes, reply with:
   {
     "edits": [
       {
         "path": "apps/mobile/src/path/to/file.tsx",
         "search": "<exact verbatim code snippet to be replaced>",
         "replace": "<replacement code snippet>"
       }
     ],
     "explanation": "<brief summary of changes made>"
   }

Rules:
1. You may read any repository file or markdown document to navigate context.
2. You may ONLY modify files explicitly listed in Allowed Files.
3. For existing files, specify exact verbatim search/replace blocks.
4. Output valid JSON only.`;

    // Read existing file contents or relevant snippets to include in prompt
    let filesContext = "";
    for (const rel of allowedFiles) {
      const existing = backups.get(rel);
      if (existing === null) {
        filesContext += `\n--- File: ${rel} (New file to be created) ---\n`;
      } else if (
        (existing.length > 5_000 || existing.split("\n").length > 150) &&
        contextSnippet
      ) {
        // For larger files, avoid blowing up the context window if contextSnippet is already focused
        filesContext += `\n--- File: ${rel} (${existing.split("\n").length} lines) ---\n(Target sections provided in Additional Context below)\n`;
      } else {
        filesContext += `\n--- File: ${rel} ---\n${existing}\n`;
      }
    }

    // Read reference files if provided
    let referenceContext = "";
    for (const rel of referenceFiles) {
      const abs = path.resolve(this.repoRoot, rel);
      try {
        const content = await fs.readFile(abs, "utf8");
        const maxChars = 8_000;
        const snippet =
          content.length > maxChars
            ? content.slice(0, maxChars) + "\n... [truncated remainder]"
            : content;
        referenceContext += `\n--- Reference Document (Read-Only): ${rel} ---\n${snippet}\n`;
      } catch (err) {
        referenceContext += `\n--- Reference Document (Read-Only): ${rel} (Could not read: ${err.message}) ---\n`;
      }
    }

    while (attempt < maxAttempts && !success) {
      attempt++;

      const userPrompt =
        attempt === 1
          ? `Task ID: ${taskId}
Objective: ${objective}
Allowed Files (Writeable): ${JSON.stringify(allowedFiles)}
Prohibited Actions: ${JSON.stringify(prohibitedActions)}
${referenceContext ? `\nReference Context / Documentation:\n${referenceContext}\n` : ""}${contextSnippet ? `\nAdditional Context / Focus Area:\n${contextSnippet}\n` : ""}
Files Information:
${filesContext}

You may inspect any other documentation (.md) or code file using {"action": "read_file", "path": "..."} before making edits, or output your final search/replace edits in valid JSON.`
          : `Task ID: ${taskId}
Your previous edit failed verification.
Verification Command: ${verificationCommand}
Error output:
${lastErrorSnippet}

Please fix the error and output updated search/replace edits in valid JSON.`;

      let messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ];

      let parsed = null;
      let readTurns = 0;
      const maxReadTurns = 6;

      while (readTurns < maxReadTurns) {
        const response = await this.client.chat({
          model: model || this.client.model,
          messages,
          format: "json",
          temperature: 0.1,
          think: think !== undefined ? think : this.client.think,
        });

        if (response.thinking) {
          const firstLine = response.thinking.split("\n")[0].trim();
          console.log(
            `   💭 Thinking (${response.thinking.split("\n").length} lines): ${firstLine.slice(0, 120)}...`,
          );
        }

        // Parse JSON (resilient to markdown fences or surrounding commentary)
        let stepJson;
        try {
          const raw = response.content.trim();
          const fenceMatch = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
          const cleaned = fenceMatch ? fenceMatch[1].trim() : raw;
          try {
            stepJson = JSON.parse(cleaned);
          } catch {
            // If still failing, attempt to extract first outermost JSON object
            const objMatch = cleaned.match(/\{[\s\S]*\}/);
            if (!objMatch) throw new Error("No JSON object found in response");
            stepJson = JSON.parse(objMatch[0]);
          }
        } catch (err) {
          throw new Error(
            `Model did not return valid JSON: ${response.content.slice(0, 300)}...`,
          );
        }

        // Dynamic read_file action: allows model to inspect any file in the workspace
        if (stepJson.action === "read_file" && stepJson.path) {
          readTurns++;
          const targetRel = stepJson.path.replace(/^[./]+/, "");
          const abs = path.resolve(this.repoRoot, targetRel);
          messages.push({ role: "assistant", content: response.content });

          if (
            !abs.startsWith(this.repoRoot + path.sep) &&
            abs !== this.repoRoot
          ) {
            messages.push({
              role: "user",
              content: `Error: Path traversal blocked for '${stepJson.path}'. Path must be inside the repository.`,
            });
            continue;
          }

          try {
            const content = await fs.readFile(abs, "utf8");
            const maxChars = 10_000;
            const snippet =
              content.length > maxChars
                ? content.slice(0, maxChars) + "\n... [truncated remainder]"
                : content;
            console.log(
              `   📖 Worker inspected '${stepJson.path}' (${content.split("\n").length} lines)`,
            );
            messages.push({
              role: "user",
              content: `File content of '${stepJson.path}':\n\n${snippet}\n\nYou may read another file using {"action": "read_file", "path": "..."} or provide your final edits using {"edits": [...]}.`,
            });
          } catch (readErr) {
            messages.push({
              role: "user",
              content: `Error reading file '${stepJson.path}': ${readErr.message}`,
            });
          }
          continue;
        }

        // Output contains edits
        parsed = stepJson;
        break;
      }

      if (!parsed || !parsed.edits || !Array.isArray(parsed.edits)) {
        throw new Error(
          `Model response missing 'edits' array: ${JSON.stringify(parsed)}`,
        );
      }

      // Apply edits
      for (const edit of parsed.edits) {
        const absPath = this.validatePath(edit.path, allowedFiles);
        await fs.mkdir(path.dirname(absPath), { recursive: true });

        if (edit.search !== undefined && edit.replace !== undefined) {
          const currentContent = await fs.readFile(absPath, "utf8");
          if (!currentContent.includes(edit.search)) {
            // Try normalized line endings
            const normalizedCurrent = currentContent.replace(/\r\n/g, "\n");
            const normalizedSearch = edit.search.replace(/\r\n/g, "\n");
            if (!normalizedCurrent.includes(normalizedSearch)) {
              throw new Error(
                `Search block not found in '${edit.path}':\n${edit.search.slice(0, 200)}...`,
              );
            }
            const updated = normalizedCurrent.replace(
              normalizedSearch,
              edit.replace,
            );
            await fs.writeFile(absPath, updated, "utf8");
          } else {
            const updated = currentContent.replace(edit.search, edit.replace);
            await fs.writeFile(absPath, updated, "utf8");
          }
        } else if (edit.content !== undefined) {
          await fs.writeFile(absPath, edit.content, "utf8");
        } else {
          throw new Error(
            `Edit item missing 'search'/'replace' or 'content': ${JSON.stringify(edit)}`,
          );
        }

        if (!filesChanged.includes(edit.path)) {
          filesChanged.push(edit.path);
        }
      }

      // If no verification command provided, treat writing as success
      if (!verificationCommand) {
        success = true;
        break;
      }

      // Run verification
      const verifyResult = await this.runVerification(verificationCommand);
      commandsRun.push(verifyResult);

      if (verifyResult.exitCode === 0) {
        success = true;
      } else {
        lastErrorSnippet = [verifyResult.stdout, verifyResult.stderr]
          .filter(Boolean)
          .join("\n")
          .slice(-1500); // Last 1500 chars of failure log
      }
    }

    const totalDurationMs = Date.now() - startTime;

    if (!success) {
      return {
        status: "failed",
        taskId,
        filesChanged,
        commandsRun,
        unresolvedRisks: [
          `Verification command failed after ${attempt} attempt(s): ${verificationCommand}`,
        ],
        suggestedNextAction:
          "Review test error snippet, simplify task boundaries, or escalate to Astra",
        attempts: attempt,
        totalDurationMs,
      };
    }

    return {
      status: "success",
      taskId,
      filesChanged,
      commandsRun,
      unresolvedRisks: [],
      suggestedNextAction:
        "Proceed to repository-wide integration check (pnpm check) and baseline logging",
      attempts: attempt,
      totalDurationMs,
    };
  }
}
