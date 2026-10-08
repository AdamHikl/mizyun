import { formatConfigIssue, loadServerConfig } from "@mizyun/config";

import { buildApp } from "./app.js";
import {
  captureRunningRelease,
  createReleaseReadiness,
  registerReleaseReadiness,
} from "./release-readiness.js";

const runningRelease = captureRunningRelease();

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
registerReleaseReadiness(
  app,
  createReleaseReadiness(runningRelease, configResult.value.supabaseConfig),
);

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
