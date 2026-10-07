import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createServer } from "node:net";
import { test } from "node:test";
import { devEnvironment, parseArgs, run } from "./ios-simulator-dev.mjs";

const device = "F4939E5D-BA85-4479-AA1E-92B21441FB8C";
function fixture(t) {
  const root = mkdtempSync(resolve(tmpdir(), "mizyun-simulator-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(resolve(root, "apps/mobile"), { recursive: true });
  const dotenv = `EXPO_PUBLIC_API_URL=https://mizyun-api-dev.phiskel.com\nEXPO_PUBLIC_SUPABASE_URL=https://mizyun-supabase-dev.phiskel.com\nEXPO_PUBLIC_AUTH_REDIRECT_URI=mizyun-dev://auth/callback\nEXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=synthetic-public-key\nPRIVATE_TEST_VALUE=never-export\n`;
  writeFileSync(resolve(root, "apps/mobile/.env.dev"), dotenv);
  writeFileSync(
    resolve(root, "apps/mobile/.env.local"),
    "EXPO_PUBLIC_API_URL=https://mizyun-api.phiskel.com\n",
  );
  const app = resolve(root, "Debug-iphonesimulator/MizyunDev.app");
  const installed = resolve(root, "installed/MizyunDev.app");
  const info = {
    CFBundleIdentifier: "com.mizyun.development",
    CFBundleExecutable: "MizyunDev",
    DTPlatformName: "iphonesimulator",
    CFBundleSupportedPlatforms: ["iPhoneSimulator"],
    CFBundleShortVersionString: "1.0.9",
    CFBundleVersion: "9",
  };
  const manifest = {
    ios: { bundleIdentifier: info.CFBundleIdentifier },
    extra: {
      mizyunRuntimeEndpoints: {
        apiUrl: "https://mizyun-api-dev.phiskel.com",
        supabaseUrl: "https://mizyun-supabase-dev.phiskel.com",
        authRedirectUri: "mizyun-dev://auth/callback",
      },
    },
  };
  for (const path of [app, installed]) {
    mkdirSync(resolve(path, "EXConstants.bundle"), { recursive: true });
    writeFileSync(resolve(path, "MizyunDev"), "synthetic-native-binary");
    writeFileSync(resolve(path, "Info.plist"), JSON.stringify(info));
    writeFileSync(
      resolve(path, "EXConstants.bundle/app.config"),
      JSON.stringify(manifest),
    );
  }
  const calls = [],
    logs = [];
  const dependencies = {
    root,
    env: {},
    log: (message) => logs.push(message),
    freePort: async () => {},
    fetch: async () => ({
      ok: true,
      text: async () => "packager-status:running",
    }),
    exec: (command, args) => {
      calls.push([command, ...args]);
      if (command === "plutil") return JSON.stringify(info);
      if (args[1] === "list")
        return JSON.stringify({
          devices: {
            "com.apple.CoreSimulator.SimRuntime.iOS-26-5": [
              {
                udid: device,
                isAvailable: true,
                state: "Booted",
                name: "Synthetic simulator",
              },
            ],
          },
        });
      if (args[1] === "get_app_container") return installed;
      if (args[1] === "launch") return "com.mizyun.development: 12345";
      return "";
    },
  };
  return {
    root,
    app,
    installed,
    info,
    manifest,
    dotenv,
    calls,
    logs,
    dependencies,
  };
}

test("rejects physical/broad targets, invalid ports, missing artifacts and unknown options", () => {
  for (const args of [
    ["doctor", "--device", "booted"],
    ["doctor", "--device", "00008140-001114501A86801C"],
    ["doctor", "--port", "0"],
    ["launch"],
    ["doctor", "--install"],
    ["doctor", "--production"],
    ["doctor", "--app"],
  ])
    assert.throws(() => parseArgs(args));
});

test("Dev file beats inherited and local Production configuration without leaking private dotenv values", (t) => {
  const f = fixture(t);
  const env = devEnvironment(f.root, {
    PATH: "/synthetic",
    EXPO_PUBLIC_API_URL: "https://mizyun-api.phiskel.com",
    MIZYUN_APP_VARIANT: "production",
    EXPO_PUBLIC_OTHER_ACCOUNT: "remove",
    MIZYUN_ENABLE_APPLE_AUTH: "0",
  });
  assert.equal(env.EXPO_PUBLIC_API_URL, "https://mizyun-api-dev.phiskel.com");
  assert.equal(env.MIZYUN_APP_VARIANT, "dev");
  assert.equal(env.EXPO_NO_DOTENV, "1");
  assert.equal(env.CI, "0");
  assert.equal(env.PATH, "/synthetic");
  assert.equal(env.PRIVATE_TEST_VALUE, undefined);
  assert.equal(env.EXPO_PUBLIC_OTHER_ACCOUNT, undefined);
  assert.equal(env.MIZYUN_ENABLE_APPLE_AUTH, undefined);
});

test("mismatched Dev routing fails before any native command", async (t) => {
  const f = fixture(t);
  writeFileSync(
    resolve(f.root, "apps/mobile/.env.dev"),
    f.dotenv.replace(
      "https://mizyun-api-dev.phiskel.com",
      "https://mizyun-api.phiskel.com",
    ),
  );
  await assert.rejects(run(["doctor"], f.dependencies), /noncanonical/);
  assert.deepEqual(f.calls, []);
});

test("doctor only reads simulator/native config and emits no keys", async (t) => {
  const f = fixture(t);
  await run(["doctor", "--app", f.app], f.dependencies);
  assert.deepEqual(
    f.calls.map((call) => call.slice(0, 3)),
    [
      ["xcrun", "simctl", "list"],
      ["plutil", "-convert", "json"],
      ["codesign", "--verify", "--deep"],
    ],
  );
  assert.ok(!f.logs.join("\n").includes("synthetic-public-key"));
});

test("unavailable or non-iOS UUID never boots or installs", async (t) => {
  const f = fixture(t);
  f.dependencies.exec = () =>
    JSON.stringify({
      devices: {
        "com.apple.CoreSimulator.SimRuntime.tvOS-26-5": [
          { udid: device, isAvailable: true, state: "Shutdown" },
        ],
      },
    });
  await assert.rejects(run(["doctor"], f.dependencies), /unavailable/);
});

test("actual occupied port refuses serve before spawning any process", async (t) => {
  const f = fixture(t);
  const listener = createServer();
  await new Promise((accept) => listener.listen(0, "127.0.0.1", accept));
  t.after(() => new Promise((accept) => listener.close(accept)));
  delete f.dependencies.freePort;
  f.dependencies.serve = () => assert.fail("must not spawn Metro");
  await assert.rejects(
    run(["serve", "--port", String(listener.address().port)], f.dependencies),
    /occupied/,
  );
});

test("refuses physical, Production or non-Debug binary before lifecycle mutations", async (t) => {
  for (const invalid of [
    { DTPlatformName: "iphoneos" },
    { CFBundleIdentifier: "com.mizyun.app" },
    { CFBundleSupportedPlatforms: ["iPhoneOS"] },
  ]) {
    const f = fixture(t);
    Object.assign(f.info, invalid);
    await assert.rejects(
      run(["launch", "--app", f.app, "--install"], f.dependencies),
      /Refusing binary/,
    );
    assert.ok(
      !f.calls.some((call) => ["boot", "install", "launch"].includes(call[2])),
    );
  }
});

test("stale native public manifest fails before Metro check or installation", async (t) => {
  const f = fixture(t);
  f.manifest.extra.mizyunRuntimeEndpoints.supabaseUrl =
    "https://mizyun-supabase.phiskel.com";
  writeFileSync(
    resolve(f.app, "EXConstants.bundle/app.config"),
    JSON.stringify(f.manifest),
  );
  f.dependencies.fetch = () => assert.fail("must not contact Metro");
  await assert.rejects(
    run(["launch", "--app", f.app, "--install"], f.dependencies),
    /stale/,
  );
});

test("Metro must be running before boot/install/launch", async (t) => {
  const f = fixture(t);
  f.dependencies.fetch = async () => ({
    ok: true,
    text: async () => "another server",
  });
  await assert.rejects(
    run(["launch", "--app", f.app, "--install"], f.dependencies),
    /Start this task/,
  );
  assert.ok(
    !f.calls.some((call) =>
      ["boot", "bootstatus", "install", "launch"].includes(call[2]),
    ),
  );
});

test("warm launch reuses matching artifact and scopes script URL to launch arguments", async (t) => {
  const f = fixture(t);
  await run(["launch", "--app", f.app], f.dependencies);
  assert.ok(
    !f.calls.some(
      (call) =>
        call[2] === "install" ||
        call.includes("defaults") ||
        call.includes("--terminate-running-process"),
    ),
  );
  assert.deepEqual(f.calls.at(-1), [
    "xcrun",
    "simctl",
    "launch",
    device,
    "com.mizyun.development",
    "-RCT_jsLocation",
    "localhost:8085",
  ]);
});

test("stale installed artifact is never silently replaced", async (t) => {
  const f = fixture(t);
  writeFileSync(resolve(f.installed, "MizyunDev"), "old-native-binary");
  await assert.rejects(
    run(["launch", "--app", f.app], f.dependencies),
    /differs/,
  );
  assert.ok(!f.calls.some((call) => ["install", "launch"].includes(call[2])));
});

test("install/relaunch are explicit and target only the pinned Dev simulator", async (t) => {
  const f = fixture(t);
  await run(
    ["launch", "--app", f.app, "--install", "--relaunch", "--port", "8087"],
    f.dependencies,
  );
  assert.deepEqual(f.calls.at(-2), [
    "xcrun",
    "simctl",
    "install",
    device,
    f.app,
  ]);
  assert.deepEqual(f.calls.at(-1), [
    "xcrun",
    "simctl",
    "launch",
    "--terminate-running-process",
    device,
    "com.mizyun.development",
    "-RCT_jsLocation",
    "localhost:8087",
  ]);
  assert.ok(
    !f.calls.some(
      (call) =>
        call.includes("erase") ||
        call.includes("kill") ||
        call.includes("com.mizyun.app"),
    ),
  );
});

test("unsigned app is refused before Metro/lifecycle actions", async (t) => {
  const f = fixture(t);
  const exec = f.dependencies.exec;
  f.dependencies.exec = (command, args) => {
    if (command === "codesign") throw new Error("synthetic unsigned artifact");
    return exec(command, args);
  };
  f.dependencies.fetch = () => assert.fail("must not contact Metro");
  await assert.rejects(
    run(["launch", "--app", f.app, "--install"], f.dependencies),
    /signature/,
  );
  assert.ok(
    !f.calls.some((call) => ["boot", "install", "launch"].includes(call[2])),
  );
});
