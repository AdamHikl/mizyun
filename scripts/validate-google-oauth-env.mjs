#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const CALLBACKS = {
  dev: "https://mizyun-supabase-dev.phiskel.com/auth/v1/callback",
  production: "https://mizyun-supabase.phiskel.com/auth/v1/callback",
};

export function validateGoogleOAuthConfig(environment, values) {
  const expectedCallback = CALLBACKS[environment];
  if (!expectedCallback) {
    throw new Error(`Unknown environment: ${environment}`);
  }

  const enabled = values.GOTRUE_EXTERNAL_GOOGLE_ENABLED?.trim() || "false";
  if (enabled !== "true" && enabled !== "false") {
    throw new Error("GOTRUE_EXTERNAL_GOOGLE_ENABLED must be true or false");
  }
  if (enabled === "false") return { enabled: false };

  for (const key of [
    "GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID",
    "GOTRUE_EXTERNAL_GOOGLE_SECRET",
    "GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI",
  ]) {
    if (!values[key]?.trim()) {
      throw new Error(`${key} is required when Google OAuth is enabled`);
    }
  }

  if (values.GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI !== expectedCallback) {
    throw new Error(
      `Google OAuth callback must match the ${environment} Supabase callback`,
    );
  }

  return { enabled: true, redirectUri: expectedCallback };
}

function parseEnvFile(contents) {
  const values = {};
  for (const line of contents.split(/\r?\n/u)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/u);
    if (!match) continue;
    let value = match[2];
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function parseArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || !value) {
      throw new Error(
        "Usage: validate-google-oauth-env.mjs --environment <dev|production> --env-file <path>",
      );
    }
    result[name.slice(2)] = value;
  }
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const values = parseEnvFile(readFileSync(args["env-file"], "utf8"));
    const result = validateGoogleOAuthConfig(args.environment, values);
    process.stdout.write(
      `Google OAuth configuration is valid for ${args.environment} (${result.enabled ? "enabled" : "disabled"}).\n`,
    );
  } catch (error) {
    process.stderr.write(
      `Google OAuth configuration rejected: ${error.message}\n`,
    );
    process.exitCode = 1;
  }
}
