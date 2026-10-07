#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

class WorkflowError extends Error {}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundleId = "com.mizyun.development";
const defaultDevice = "F4939E5D-BA85-4479-AA1E-92B21441FB8C";
const endpoints = {
  EXPO_PUBLIC_API_URL: "https://mizyun-api-dev.phiskel.com",
  EXPO_PUBLIC_SUPABASE_URL: "https://mizyun-supabase-dev.phiskel.com",
  EXPO_PUBLIC_AUTH_REDIRECT_URI: "mizyun-dev://auth/callback",
};
const help = `Usage: pnpm mobile:simulator:ios <doctor|serve|launch> [options]
  --device UUID     Explicit iOS simulator (default: ${defaultDevice})
  --port NUMBER     Task-owned localhost Metro port (default: 8085)
  --app PATH        Cached Debug-iphonesimulator/MizyunDev.app (launch requires it)
  --install         Install/replace simulator app; save/close existing drafts first
  --relaunch        Terminate existing Dev process; use only after saving/closing drafts

doctor is read-only. serve owns a foreground Metro process; Ctrl-C stops that process.
launch checks Metro and the Dev simulator binary, boots/installs/launches the pinned device.
No erase, dotenv override, account provisioning, UI input or global process killing.
Read .agents/skills/test-ios-simulator/SKILL.md for the build and native test procedure.`;

export function parseArgs(args) {
  if (args.includes("--help") || args.includes("-h")) return { mode: "help" };
  const options = { mode: args[0], device: defaultDevice, port: 8085 };
  if (!["doctor", "serve", "launch"].includes(options.mode))
    throw new WorkflowError(help);
  for (let i = 1; i < args.length; i++) {
    const key = args[i];
    if (["--relaunch", "--install"].includes(key)) {
      options[key.slice(2)] = true;
      continue;
    }
    if (
      !["--device", "--port", "--app"].includes(key) ||
      !args[i + 1] ||
      args[i + 1].startsWith("--")
    )
      throw new WorkflowError(`Invalid option: ${key}`);
    options[key.slice(2)] = args[++i];
  }
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(options.device))
    throw new WorkflowError(
      "Use an exact simulator UUID, never a physical UDID or 'booted'.",
    );
  options.port = Number(options.port);
  if (
    !Number.isInteger(options.port) ||
    options.port < 1024 ||
    options.port > 65535
  )
    throw new WorkflowError(
      "Metro port must be an integer from 1024 to 65535.",
    );
  if ((options.relaunch || options.install) && options.mode !== "launch")
    throw new WorkflowError("--install/--relaunch apply only to launch.");
  if (options.mode === "launch" && !options.app)
    throw new WorkflowError(
      "launch requires --app pointing to a compatible cached Debug simulator binary; see the skill's build step.",
    );
  return options;
}

export function devEnvironment(root, inherited = process.env) {
  const dev = parseEnv(
    readFileSync(resolve(root, "apps/mobile/.env.dev"), "utf8"),
  );
  for (const [key, expected] of Object.entries(endpoints))
    if (dev[key] !== expected)
      throw new WorkflowError(
        `Refusing noncanonical Dev ${key}; fix the reviewed .env.dev, not .env.local.`,
      );
  if (!dev.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
    throw new WorkflowError("Missing Dev publishable key.");
  // Never let another build's public/variant overrides win, and never expose private dotenv values.
  const env = Object.fromEntries(
    Object.entries(inherited).filter(
      ([key]) => !key.startsWith("EXPO_PUBLIC_") && !key.startsWith("MIZYUN_"),
    ),
  );
  for (const [key, value] of Object.entries(dev))
    if (key.startsWith("EXPO_PUBLIC_")) env[key] = value;
  return { ...env, EXPO_NO_DOTENV: "1", MIZYUN_APP_VARIANT: "dev", CI: "0" };
}

async function freePort(port) {
  const server = createServer();
  await new Promise((accept, reject) => {
    server.once("error", () =>
      reject(
        new WorkflowError(
          `Port ${port} is occupied. Choose another task port; do not kill or reuse an unidentified server.`,
        ),
      ),
    );
    server.listen(port, "127.0.0.1", accept);
  });
  await new Promise((accept, reject) =>
    server.close((error) => (error ? reject(error) : accept())),
  );
}

async function serve(env, port, root) {
  const child = spawn(
    "pnpm",
    [
      "--filter",
      "@mizyun/mobile",
      "exec",
      "expo",
      "start",
      "--localhost",
      "--port",
      String(port),
    ],
    { cwd: root, env, stdio: "inherit" },
  );
  const forward = (signal) => child.kill(signal);
  const interrupt = () => forward("SIGINT");
  const terminate = () => forward("SIGTERM");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  try {
    await new Promise((accept, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) =>
        code === 0 || signal === "SIGINT" || signal === "SIGTERM"
          ? accept()
          : reject(new WorkflowError(`Task Metro exited (${code ?? signal}).`)),
      );
    });
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
  }
}

export async function run(args, dependencies = {}) {
  const options = parseArgs(args);
  const log = dependencies.log ?? console.log;
  if (options.mode === "help") {
    log(help);
    return;
  }
  const root = dependencies.root ?? repoRoot;
  const env = devEnvironment(root, dependencies.env ?? process.env);
  const exec =
    dependencies.exec ??
    ((command, values) =>
      execFileSync(command, values, {
        cwd: root,
        env,
        encoding: "utf8",
        timeout: 90000,
        stdio: ["ignore", "pipe", "pipe"],
      }));
  const inventory = JSON.parse(
    exec("xcrun", ["simctl", "list", "devices", "available", "--json"]),
  );
  const found = Object.entries(inventory.devices)
    .flatMap(([runtime, devices]) =>
      devices.map((device) => ({ ...device, runtime })),
    )
    .find(
      (device) =>
        device.udid === options.device &&
        device.isAvailable &&
        device.runtime.includes(".iOS-"),
    );
  if (!found)
    throw new WorkflowError(
      "Pinned iOS simulator is unavailable. Run xcrun simctl list devices available and explicitly choose its UUID.",
    );
  let app;
  let nativeExecutable;
  if (options.app) {
    app = resolve(options.app);
    const info = JSON.parse(
      exec("plutil", [
        "-convert",
        "json",
        "-o",
        "-",
        resolve(app, "Info.plist"),
      ]),
    );
    if (
      info.CFBundleIdentifier !== bundleId ||
      info.DTPlatformName !== "iphonesimulator" ||
      !info.CFBundleSupportedPlatforms?.includes("iPhoneSimulator") ||
      dirname(app).split("/").at(-1) !== "Debug-iphonesimulator"
    )
      throw new WorkflowError(
        "Refusing binary: require Dev bundle ID and a Debug-iphonesimulator artifact, not a physical/Production/Release app.",
      );
    try {
      exec("codesign", ["--verify", "--deep", "--strict", app]);
    } catch {
      throw new WorkflowError(
        "Simulator app signature is missing/invalid. Rebuild with ad-hoc signing from the skill; an unsigned app can render while SecureStore Keychain access fails.",
      );
    }
    nativeExecutable = info.CFBundleExecutable;
    if (
      !nativeExecutable ||
      nativeExecutable.includes("/") ||
      nativeExecutable.includes("..")
    )
      throw new WorkflowError("Invalid native executable name.");
    const manifest = JSON.parse(
      readFileSync(resolve(app, "EXConstants.bundle/app.config"), "utf8"),
    );
    const runtime = manifest.extra?.mizyunRuntimeEndpoints;
    if (
      manifest.ios?.bundleIdentifier !== bundleId ||
      runtime?.apiUrl !== endpoints.EXPO_PUBLIC_API_URL ||
      runtime?.supabaseUrl !== endpoints.EXPO_PUBLIC_SUPABASE_URL ||
      runtime?.authRedirectUri !== endpoints.EXPO_PUBLIC_AUTH_REDIRECT_URI
    )
      throw new WorkflowError(
        "Cached native Dev manifest is missing/stale/mismatched; rebuild through the skill before signing in.",
      );
    log(
      `Native binary: ${bundleId} ${info.CFBundleShortVersionString}(${info.CFBundleVersion}); record separately from Metro JavaScript source.`,
    );
  }
  log(
    `Simulator: ${found.name} ${found.udid}; initial state: ${found.state}; Metro: http://localhost:${options.port}`,
  );
  if (options.mode === "doctor" || options.mode === "serve") {
    await (dependencies.freePort ?? freePort)(options.port);
    log(
      "Canonical Dev public configuration verified; port free. Existing dotenv files untouched.",
    );
    if (options.mode === "serve")
      await (dependencies.serve ?? serve)(env, options.port, root);
    return;
  }
  const response = await (dependencies.fetch ?? fetch)(
    `http://localhost:${options.port}/status`,
    { signal: AbortSignal.timeout(3000) },
  );
  if (
    !response.ok ||
    (await response.text()).trim() !== "packager-status:running"
  )
    throw new WorkflowError(
      "Start this task's Metro with serve first; /status did not confirm a running packager.",
    );
  log(
    "Save/close any existing drafts before installation or --relaunch. No forced termination unless explicitly requested.",
  );
  if (found.state !== "Booted")
    exec("xcrun", ["simctl", "boot", options.device]);
  exec("xcrun", ["simctl", "bootstatus", options.device, "-b"]);
  if (options.install) {
    exec("xcrun", ["simctl", "install", options.device, app]);
  } else {
    let installed;
    try {
      installed = exec("xcrun", [
        "simctl",
        "get_app_container",
        options.device,
        bundleId,
        "app",
      ]).trim();
    } catch {
      throw new WorkflowError(
        "Dev app not installed. Save/close drafts, then launch with --install.",
      );
    }
    const digest = (path) =>
      createHash("sha256").update(readFileSync(path)).digest("hex");
    try {
      if (
        digest(resolve(installed, nativeExecutable)) !==
          digest(resolve(app, nativeExecutable)) ||
        digest(resolve(installed, "EXConstants.bundle/app.config")) !==
          digest(resolve(app, "EXConstants.bundle/app.config"))
      )
        throw new WorkflowError(
          "Installed native artifact differs from --app. Save/close drafts, then use --install.",
        );
    } catch (error) {
      if (error instanceof WorkflowError) throw error;
      throw new WorkflowError(
        "Cannot verify installed native artifact; explicitly install the reviewed --app after saving/closing drafts.",
      );
    }
  }
  // NSUserDefaults launch arguments scope the Debug script URL to this process, avoiding persistent defaults writes.
  const launch = [
    "simctl",
    "launch",
    ...(options.relaunch ? ["--terminate-running-process"] : []),
    options.device,
    bundleId,
    "-RCT_jsLocation",
    `localhost:${options.port}`,
  ];
  log(exec("xcrun", launch).trim());
  log(
    "Launch is setup evidence only. Use cua_repl to verify the native screen, fresh Dev sign-in and a synthetic authenticated feature result.",
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  run(process.argv.slice(2)).catch((error) => {
    // Child output may contain configuration or Auth data; keep errors bounded to our own actionable messages.
    process.exitCode = 1;
    console.error(
      error instanceof WorkflowError
        ? error.message
        : "Simulator helper failed. Check the requested UUID/artifact/port with doctor; inspect local tool logs privately. No credentials should enter evidence.",
    );
  });
}
