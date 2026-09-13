#!/usr/bin/env node
// @ts-check
import readline from "node:readline";
import { OllamaClient } from "./lib/ollama-client.mjs";
import { TaskRunner } from "./lib/task-runner.mjs";

const client = new OllamaClient();
const runner = new TaskRunner({ client });

/**
 * Log diagnostic message to stderr (so stdout remains strictly valid JSON-RPC)
 * @param {string} msg
 */
function debug(msg) {
  process.stderr.write(`[qwen-mcp-server] ${msg}\n`);
}

/**
 * Send JSON-RPC response to stdout
 * @param {any} message
 */
function sendResponse(message) {
  const json = JSON.stringify(message);
  process.stdout.write(json + "\n");
}

/**
 * Handle incoming JSON-RPC request
 * @param {any} req
 */
async function handleRequest(req) {
  const { id, method, params } = req;

  // Notifications (no id)
  if (id === undefined || id === null) {
    if (method === "notifications/initialized") {
      debug("Client notified initialization complete.");
    }
    return;
  }

  switch (method) {
    case "initialize": {
      sendResponse({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: "qwen-worker",
            version: "1.0.0",
          },
        },
      });
      break;
    }

    case "ping": {
      sendResponse({
        jsonrpc: "2.0",
        id,
        result: {},
      });
      break;
    }

    case "tools/list": {
      sendResponse({
        jsonrpc: "2.0",
        id,
        result: {
          tools: [
            {
              name: "qwen_run_task",
              description:
                "Dispatch a bounded implementation task to the local Qwen worker (qwen3.8:27b-q8_0 via Ollama). Strictly enforces allowedFiles whitelist, bounded retries (max 2), and returns a structured worker report.",
              inputSchema: {
                type: "object",
                properties: {
                  taskId: {
                    type: "string",
                    description:
                      "Unique task identifier (e.g. task-20260913-01)",
                  },
                  objective: {
                    type: "string",
                    description: "Single-goal actionable objective",
                  },
                  allowedFiles: {
                    type: "array",
                    items: { type: "string" },
                    description:
                      "Whitelisted repository-relative file paths permitted to be modified or created",
                  },
                  prohibitedActions: {
                    type: "array",
                    items: { type: "string" },
                    description:
                      'Explicitly forbidden actions (e.g. "do not commit", "do not touch migration files")',
                  },
                  verificationCommand: {
                    type: "string",
                    description:
                      "Command to verify code (e.g. pnpm --filter @mizyun/core test aggregate.test.ts)",
                  },
                  contextSnippet: {
                    type: "string",
                    description:
                      "Relevant code snippets, types, or background instructions",
                  },
                },
                required: ["taskId", "objective", "allowedFiles"],
              },
            },
            {
              name: "qwen_check_status",
              description:
                "Check if Ollama daemon is reachable, inspect loaded models, and verify target model availability.",
              inputSchema: {
                type: "object",
                properties: {},
              },
            },
          ],
        },
      });
      break;
    }

    case "tools/call": {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};

      try {
        if (toolName === "qwen_check_status") {
          const isOnline = await client.ping();
          if (!isOnline) {
            sendResponse({
              jsonrpc: "2.0",
              id,
              result: {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(
                      {
                        online: false,
                        host: client.host,
                        message: `Ollama is not reachable at ${client.host}. Please start it with 'ollama serve' or launch Ollama.app.`,
                      },
                      null,
                      2,
                    ),
                  },
                ],
              },
            });
            return;
          }

          const models = await client.listModels();
          const hasTarget = await client.hasModel(client.model);
          sendResponse({
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      online: true,
                      host: client.host,
                      targetModel: client.model,
                      targetModelInstalled: hasTarget,
                      installedModels: models.map((m) => ({
                        name: m.name,
                        sizeGB: (m.size / 1e9).toFixed(1),
                      })),
                    },
                    null,
                    2,
                  ),
                },
              ],
            },
          });
          return;
        }

        if (toolName === "qwen_run_task") {
          debug(`Executing task: ${toolArgs.taskId} (${toolArgs.objective})`);
          const report = await runner.execute(toolArgs);
          sendResponse({
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(report, null, 2),
                },
              ],
            },
          });
          return;
        }

        // Unknown tool
        sendResponse({
          jsonrpc: "2.0",
          id,
          error: {
            code: -32601,
            message: `Unknown tool name: ${toolName}`,
          },
        });
      } catch (err) {
        debug(`Error calling tool ${toolName}: ${err}`);
        sendResponse({
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    status: "failed",
                    error: err instanceof Error ? err.message : String(err),
                  },
                  null,
                  2,
                ),
              },
            ],
            isError: true,
          },
        });
      }
      break;
    }

    default: {
      sendResponse({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32601,
          message: `Method not found: ${method}`,
        },
      });
      break;
    }
  }
}

// Start stdio reader
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const req = JSON.parse(trimmed);
    handleRequest(req).catch((err) => {
      debug(`Unhandled request error: ${err}`);
    });
  } catch (err) {
    debug(`JSON parse error on stdin: ${trimmed}`);
  }
});

debug("Qwen Worker MCP server running on stdio");
