import { buildApp } from "./app.js";

const host = process.env.API_HOST ?? "127.0.0.1";
const parsedPort = Number.parseInt(process.env.API_PORT ?? "4000", 10);
const port = Number.isSafeInteger(parsedPort) ? parsedPort : 4000;

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
