import { formatConfigIssue, loadServerConfig } from "@mizyun/config";

import { buildApp } from "./app.js";

const configResult = loadServerConfig();
if (!configResult.ok) {
  for (const issue of configResult.error) {
    // eslint-disable-next-line no-console
    console.error(`[config] ${formatConfigIssue(issue)}`);
  }
  process.exit(1);
}
const { host, port } = configResult.value;

const app = buildApp();

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  process.exit(0);
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
