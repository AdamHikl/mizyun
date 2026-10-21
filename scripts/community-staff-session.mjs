#!/usr/bin/env node

/**
 * Operator helper: obtain an MFA (aal2) Supabase session for a Community
 * moderation staff account and hand it to scripts/community-moderation.mjs.
 *
 * Interactive only. Email, password and the TOTP code are typed on the TTY
 * (password hidden); they are never accepted from argv or environment
 * variables. Tokens reach only the child process environment, except with
 * --print-export, where the operator asked for them on stdout.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import readline from "node:readline";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");

export const ENVIRONMENTS = {
  production: {
    envFile: "apps/mobile/.env.production",
    supabaseUrl: "https://mizyun-supabase.phiskel.com",
    apiUrl: "https://mizyun-api.phiskel.com",
  },
  dev: {
    envFile: "apps/mobile/.env.dev",
    supabaseUrl: "https://mizyun-supabase-dev.phiskel.com",
    apiUrl: "https://mizyun-api-dev.phiskel.com",
  },
};

export const FACTOR_FRIENDLY_NAME = "Mizyun moderator";
const TOTP_ISSUER = "Mizyun";
const MAX_CODE_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 20_000;

export class SessionError extends Error {}

const USAGE = `Usage: node scripts/community-staff-session.mjs --env <production|dev> [--print-export] [-- <moderation CLI args>]

Signs a moderator in with email + password + authenticator code (aal2), then
runs scripts/community-moderation.mjs with the session token in the child's
environment only. Default moderation args: --queue.

  --env <production|dev>   Required target environment.
  --print-export           Print export lines for: eval "$(node ... --print-export)"
                           (the only mode that prints the token; goes to stdout).
  --help, -h               This text.

Email, password and codes are typed when prompted; they are never accepted as
arguments or environment variables.
`;

const SENSITIVE_FLAG = /pass|pwd|code|otp|token|secret|email|totp|key/i;

export function parseSessionArgs(argv) {
  const options = {
    env: null,
    printExport: false,
    help: false,
    passthrough: [],
  };
  const separator = argv.indexOf("--");
  const own = separator === -1 ? argv : argv.slice(0, separator);
  options.passthrough = separator === -1 ? [] : argv.slice(separator + 1);

  for (let i = 0; i < own.length; i++) {
    const arg = own[i];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--print-export") options.printExport = true;
    else if (arg === "--env") options.env = own[++i];
    else if (arg.startsWith("--env=")) options.env = arg.slice(6);
    else if (SENSITIVE_FLAG.test(arg))
      throw new SessionError(
        "Credentials, codes and tokens are never accepted as arguments; you will be prompted on the terminal.",
      );
    else throw new SessionError(`Unknown option: ${terminalText(arg)}`);
  }
  if (options.help) return options;
  if (!options.env) throw new SessionError("--env production|dev is required.");
  if (!Object.hasOwn(ENVIRONMENTS, options.env))
    throw new SessionError("--env must be production or dev.");
  for (const arg of options.passthrough) {
    if (/^--(api-url|env)(=|$)/.test(arg))
      throw new SessionError(
        "Do not pass --api-url or --env after --; this helper fixes the target and token destination.",
      );
  }
  if (options.passthrough.length === 0) options.passthrough = ["--queue"];
  return options;
}

const CONTROL_CHARS = new RegExp(
  "[\\u0000-\\u001f\\u007f-\\u009f\\u2028-\\u202e\\u2066-\\u2069]",
  "g",
);
const escapedCodePoint = (c) =>
  `\\u${c.codePointAt(0).toString(16).padStart(4, "0")}`;
export function terminalText(value) {
  return String(value).replace(CONTROL_CHARS, escapedCodePoint);
}

export function assertHttps(rawUrl, label) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SessionError(`${label} is not a valid URL.`);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new SessionError(
      `${label} must be an HTTPS URL without credentials, query or fragment.`,
    );
  return url.href.replace(/\/$/, "");
}

export function parseEnvFile(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match =
      /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || match[1].startsWith("#")) continue;
    let value = match[2];
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

/** Public mobile configuration only (publishable key, never service keys). */
export function resolveEnvironment(
  env,
  { readFile = (p) => readFileSync(p, "utf8"), rootDir = REPO_ROOT } = {},
) {
  const target = ENVIRONMENTS[env];
  let values;
  try {
    values = parseEnvFile(readFile(join(rootDir, target.envFile)));
  } catch {
    throw new SessionError(`Cannot read ${target.envFile}.`);
  }
  const supabaseUrl = assertHttps(
    values.EXPO_PUBLIC_SUPABASE_URL ?? "",
    "EXPO_PUBLIC_SUPABASE_URL",
  );
  // Credentials go only to the pinned origin, whatever the env file says.
  if (supabaseUrl !== assertHttps(target.supabaseUrl, "Supabase URL"))
    throw new SessionError(
      `EXPO_PUBLIC_SUPABASE_URL in ${target.envFile} is not the expected ${env} Supabase origin.`,
    );
  const publishableKey = values.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!publishableKey)
    throw new SessionError(
      `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY missing in ${target.envFile}.`,
    );
  return {
    supabaseUrl,
    publishableKey,
    apiUrl: assertHttps(target.apiUrl, "API URL"),
  };
}

export function decodeJwtClaims(token) {
  try {
    const payload = token.split(".")[1];
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

const shellQuote = (value) => `'${String(value).replaceAll("'", `'\\''`)}'`;

export function createTtyPrompter(
  stdin,
  stderr,
  { createInterface = readline.createInterface, onInterrupt } = {},
) {
  if (!stdin.isTTY || !stderr.isTTY)
    throw new SessionError(
      "This helper needs an interactive terminal (stdin and stderr must be a TTY).",
    );
  let muted = false;
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (!muted) stderr.write(chunk, encoding);
      callback();
    },
  });
  const rl = createInterface({
    input: stdin,
    output,
    terminal: true,
    historySize: 0, // Up-arrow must never recall the hidden password or code.
  });
  rl.on("SIGINT", () => {
    rl.close();
    onInterrupt?.();
    stderr.write("\nAborted.\n");
    process.exit(130);
  });
  const ask = (question, hidden) =>
    new Promise((resolvePromise, reject) => {
      const onClose = () => reject(new SessionError("Input closed."));
      rl.once("close", onClose);
      stderr.write(question);
      muted = hidden;
      rl.question("", (answer) => {
        muted = false;
        rl.off("close", onClose);
        if (hidden) stderr.write("\n");
        resolvePromise(answer);
      });
    });
  return {
    ask: (q) => ask(q, false),
    askHidden: (q) => ask(q, true),
    close: () => rl.close(),
  };
}

export async function run(argv, deps = {}) {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const spawn = deps.spawn ?? spawnSync;
  // All human-facing text goes to stderr so --print-export stdout stays clean.
  const say = (text = "") => stderr.write(`${text}\n`);
  const secrets = new Set();
  const redact = (text) => {
    let out = terminalText(text).replace(
      /eyJ[\w-]+\.[\w-]+\.[\w-]*/g,
      "[redacted]",
    );
    for (const secret of secrets)
      if (secret) out = out.replaceAll(secret, "[redacted]");
    return out.slice(0, 300);
  };

  let prompter;
  let secretOnScreen = false;
  const clearSecret = () => {
    if (!secretOnScreen) return;
    secretOnScreen = false;
    if (stderr.isTTY && deps.clearScreen !== false) {
      stderr.write("\x1b[2J\x1b[3J\x1b[H");
      say("Enrollment secret cleared from the screen.");
    }
  };
  try {
    const options = parseSessionArgs(argv);
    if (options.help) {
      stderr.write(USAGE);
      return 0;
    }
    if (options.printExport && stdout.isTTY)
      throw new SessionError(
        'Refusing to print the token to a terminal. Use: eval "$(node scripts/community-staff-session.mjs --env <env> --print-export)"',
      );
    const config = resolveEnvironment(options.env, deps.config);
    prompter =
      deps.prompter ??
      createTtyPrompter(deps.stdin ?? process.stdin, stderr, {
        onInterrupt: clearSecret,
      });

    const call = async (method, path, { body, token } = {}) => {
      const headers = {
        apikey: config.publishableKey,
        "Content-Type": "application/json",
      };
      if (token) headers.Authorization = `Bearer ${token}`;
      let response;
      try {
        response = await fetchImpl(`${config.supabaseUrl}/auth/v1${path}`, {
          method,
          headers,
          redirect: "error", // never re-send credentials across a redirect
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch {
        throw new SessionError(
          `Network error contacting ${new URL(config.supabaseUrl).host}.`,
        );
      }
      const text = await response.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      if (!response.ok) {
        const detail =
          data?.msg ||
          data?.message ||
          data?.error_description ||
          data?.error ||
          "";
        const error = new SessionError(
          `Auth request failed (HTTP ${response.status}${data?.error_code ? `, ${data.error_code}` : ""})${detail ? `: ${redact(detail)}` : "."}`,
        );
        error.status = response.status;
        error.code = data?.error_code;
        throw error;
      }
      return data;
    };

    say(
      `Mizyun moderator session (${options.env}). Credentials are typed here only.`,
    );
    const email = (await prompter.ask("Email: ")).trim();
    const password = await prompter.askHidden("Password (hidden): ");
    if (!email || !password)
      throw new SessionError("Email and password are required.");
    secrets.add(password);

    let signIn;
    try {
      signIn = await call("POST", "/token?grant_type=password", {
        body: { email, password },
      });
    } catch (err) {
      if (err.code === "email_not_confirmed")
        throw new SessionError(
          "Sign-in failed: this account's email address is not confirmed.",
        );
      if (err.status === 400 || err.status === 401)
        throw new SessionError("Sign-in failed: check the email and password.");
      throw err;
    }
    let token = signIn?.access_token;
    if (!token) throw new SessionError("Sign-in returned no session.");
    secrets.add(token);
    secrets.add(signIn.refresh_token);

    const user = await call("GET", "/user", { token });
    const totpFactors = (user?.factors ?? []).filter(
      (f) => f.factor_type === "totp",
    );
    let factor = totpFactors.find((f) => f.status === "verified");

    if (!factor) {
      for (const stale of totpFactors.filter((f) => f.status !== "verified")) {
        const answer = (
          await prompter.ask(
            `An unverified authenticator "${terminalText(stale.friendly_name ?? "unnamed")}" exists. Remove it and enroll a new one? [y/N] `,
          )
        )
          .trim()
          .toLowerCase();
        if (answer !== "y" && answer !== "yes")
          throw new SessionError("Aborted: unverified authenticator kept.");
        await call("DELETE", `/factors/${encodeURIComponent(stale.id)}`, {
          token,
        });
      }
      const enrolled = await call("POST", "/factors", {
        token,
        body: {
          factor_type: "totp",
          friendly_name: FACTOR_FRIENDLY_NAME,
          issuer: TOTP_ISSUER,
        },
      });
      const uri = enrolled?.totp?.uri;
      const secret = enrolled?.totp?.secret;
      if (!enrolled?.id || !uri || !secret)
        throw new SessionError("Enrollment returned no authenticator details.");
      say();
      say("=== Enroll your authenticator app now ===");
      say("WARNING: the URI and secret below are shown ONCE and let anyone");
      say("generate your moderator codes. Do not copy them into notes, chats,");
      say("issues or screenshots. Add them to your authenticator app, then");
      say("this screen is cleared after you confirm.");
      say();
      say(`otpauth URI: ${uri}`);
      say(`Secret:      ${secret}`);
      say();
      secretOnScreen = true;
      factor = { id: enrolled.id, justEnrolled: true };
    } else {
      say(
        `Using verified authenticator "${terminalText(factor.friendly_name ?? "unnamed")}".`,
      );
    }

    let aal2Token = null;
    let attempts = 0;
    let malformed = 0;
    while (attempts < MAX_CODE_ATTEMPTS && !aal2Token) {
      const code = (
        await prompter.askHidden("6-digit authenticator code: ")
      ).replace(/\s+/g, "");
      if (!/^\d{6}$/.test(code)) {
        say("The code must be exactly 6 digits.");
        // Typos do not burn a verification attempt, but cannot loop forever.
        if (++malformed >= 2 * MAX_CODE_ATTEMPTS) break;
        continue;
      }
      attempts++;
      secrets.add(code);
      const challenge = await call(
        "POST",
        `/factors/${encodeURIComponent(factor.id)}/challenge`,
        { token, body: {} },
      );
      try {
        const verified = await call(
          "POST",
          `/factors/${encodeURIComponent(factor.id)}/verify`,
          { token, body: { challenge_id: challenge?.id, code } },
        );
        if (decodeJwtClaims(verified?.access_token).aal !== "aal2")
          throw new SessionError("Verification did not yield an aal2 session.");
        aal2Token = verified.access_token;
        secrets.add(aal2Token);
      } catch (err) {
        if (err.status === 400 || err.status === 422) {
          say(
            attempts < MAX_CODE_ATTEMPTS
              ? "Wrong or expired code. Wait for the next code and try again."
              : "Wrong or expired code.",
          );
          continue;
        }
        throw err;
      }
    }
    if (!aal2Token)
      throw new SessionError("Could not verify an authenticator code.");

    clearSecret();
    say("MFA verified (aal2).");
    prompter.close?.();
    prompter = null;

    if (options.printExport) {
      say(
        "Printing the session token to stdout as requested. Treat it as a password.",
      );
      stdout.write(
        `export COMMUNITY_STAFF_ACCESS_TOKEN=${shellQuote(aal2Token)}\nexport API_URL=${shellQuote(config.apiUrl)}\n`,
      );
      return 0;
    }

    const childEnv = {
      ...(deps.env ?? process.env),
      COMMUNITY_STAFF_ACCESS_TOKEN: aal2Token,
      API_URL: config.apiUrl,
    };
    const result = spawn(
      process.execPath,
      [
        join(deps.scriptDir ?? SCRIPT_DIR, "community-moderation.mjs"),
        "--env",
        options.env,
        ...options.passthrough,
      ],
      { stdio: "inherit", env: childEnv },
    );
    if (result?.error)
      throw new SessionError("Could not start the moderation CLI.");
    return result?.status ?? 1;
  } catch (err) {
    clearSecret(); // before the message, so the error stays visible
    if (err instanceof SessionError)
      stderr.write(`Error: ${redact(err.message)}\n`);
    else stderr.write("Error: unexpected failure.\n");
    if (
      err instanceof SessionError &&
      /^(--env|Credentials|Unknown option)/.test(err.message)
    )
      stderr.write(USAGE);
    return 1;
  } finally {
    clearSecret();
    prompter?.close?.();
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  run(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
