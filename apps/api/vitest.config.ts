import { defineConfig } from "vitest/config";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Vitest configuration for the API. Loads `apps/api/.env.test` (gitignored)
 * into `process.env` so the opt-in e2e suite can drive the local Supabase
 * stack without leaking keys on the command line. The dotenv loader is
 * idempotent and a no-op when the file does not exist (CI without
 * local Supabase).
 *
 * The env keys mirror what `pnpm db:status` exposes:
 *   - SUPABASE_URL:  http://127.0.0.1:54321
 *   - SUPABASE_ANON_KEY: <publishable anon key>
 *   - SUPABASE_MAILPIT_URL: http://127.0.0.1:54324
 */
const envTestPath = resolve(__dirname, ".env.test");
if (existsSync(envTestPath)) {
  const text = readFileSync(envTestPath, "utf8");
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

export default defineConfig({
  test: {
    root: resolve(__dirname, "../.."),
    include: ["apps/api/src/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
    env: {
      // Mirror the keys that `.env.test` exposes under the AUTH_E2E_*
      // names so the existing `describe.skipIf(...)` guards still work.
      AUTH_E2E_URL: process.env.SUPABASE_URL ?? "",
      AUTH_E2E_ANON: process.env.SUPABASE_ANON_KEY ?? "",
      AUTH_E2E_PUBLISHABLE: process.env.SUPABASE_PUBLISHABLE_KEY ?? "",
      AUTH_E2E_MAILPIT: process.env.SUPABASE_MAILPIT_URL ?? "",
      AUTH_E2E_SERVICE: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    },
  },
});
