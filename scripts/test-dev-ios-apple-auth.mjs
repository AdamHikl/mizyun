import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  cpSync,
  chmodSync,
  rmSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const root = mkdtempSync(join(tmpdir(), "mizyun-dev-apple-"));
try {
  const repo = join(root, "repo");
  const bin = join(root, "bin");
  const temp = join(root, "device temp");
  const deviceLog = join(root, "device-paths.jsonl");
  for (const dir of [
    bin,
    temp,
    join(repo, "scripts"),
    join(repo, "apps/mobile/ios/MizyunDev.xcodeproj"),
    join(repo, "apps/mobile/ios/MizyunDev.xcworkspace"),
    join(repo, "apps/mobile/ios/MizyunDev"),
  ])
    mkdirSync(dir, { recursive: true });
  for (const name of ["mobile-device-install.sh", "verify-ios-apple-auth.mjs"])
    cpSync(resolve("scripts", name), join(repo, "scripts", name));
  writeFileSync(
    join(repo, "apps/mobile/.env.dev"),
    "EXPO_PUBLIC_API_URL=https://mizyun-api-dev.phiskel.com\nEXPO_PUBLIC_SUPABASE_URL=https://mizyun-supabase-dev.phiskel.com\nEXPO_PUBLIC_AUTH_REDIRECT_URI=mizyun-dev://auth/callback\n",
  );
  writeFileSync(
    join(repo, "apps/mobile/ios/MizyunDev.xcodeproj/project.pbxproj"),
    "PRODUCT_BUNDLE_IDENTIFIER = com.mizyun.development;\n",
  );
  const executable = (name, body) => {
    const path = join(bin, name);
    writeFileSync(path, `#!/usr/bin/env node\n${body}`);
    chmodSync(path, 0o755);
  };
  executable(
    "xcrun",
    `const fs=require('node:fs');const args=process.argv.slice(2);const i=args.indexOf('--json-output');
if(args.join(' ')!=='devicectl list devices --json-output '+args[i+1]||i<0)throw new Error('Only device discovery is permitted in this fixture');
const file=args[i+1];fs.appendFileSync(process.env.TEST_DEVICE_LOG,JSON.stringify(file)+'\\n');
fs.writeFileSync(file,JSON.stringify({result:{devices:[{identifier:'fixture',hardwareProperties:{udid:'fixture'},deviceProperties:{name:'Fixture iPhone'}}]}}));
if(process.env.TEST_INSTALLER_SIGNAL)process.kill(process.ppid,process.env.TEST_INSTALLER_SIGNAL);
if(process.env.TEST_DEVICE_BARRIER){const timer=setInterval(()=>{if(fs.existsSync(process.env.TEST_DEVICE_BARRIER)){clearInterval(timer);}},10);setTimeout(()=>{clearInterval(timer);process.exit(1);},5000).unref();}`,
  );
  executable(
    "plutil",
    `const fs=require('node:fs'); const args=process.argv.slice(2);const value=fs.readFileSync(args.at(-1)==='-'?0:args.at(-1),'utf8');if(value==='malformed')process.exit(1);process.stdout.write(value);`,
  );
  executable(
    "codesign",
    `process.stdout.write(process.env.TEST_SIGNATURE||'');`,
  );
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    MIZYUN_ENABLE_APPLE_AUTH: "1",
    TMPDIR: temp,
    TEST_DEVICE_LOG: deviceLog,
  };
  const plist = join(repo, "apps/mobile/ios/MizyunDev/MizyunDev.entitlements");
  const installerArgs = (device = "fixture") => [
    join(repo, "scripts/mobile-device-install.sh"),
    "ios",
    "dev",
    "--device",
    device,
    "--dry-run",
  ];
  const runInstaller = () =>
    execFileSync("bash", installerArgs(), { env, encoding: "utf8" });
  const devicePaths = () =>
    readFileSync(deviceLog, "utf8").trim().split("\n").map(JSON.parse);
  const assertCleaned = () => {
    for (const path of devicePaths()) assert.equal(existsSync(path), false);
    assert.deepEqual(readdirSync(temp), []);
  };
  writeFileSync(plist, "{}");
  assert.match(runInstaller(), /Dev native Apple sign-in capability missing/);
  assertCleaned();
  writeFileSync(
    plist,
    JSON.stringify({ "com.apple.developer.applesignin": ["Default"] }),
  );
  assert.doesNotMatch(runInstaller(), /expo prebuild --clean/);
  assertCleaned();
  writeFileSync(plist, "malformed");
  assert.match(runInstaller(), /Dev native Apple sign-in capability missing/);
  assertCleaned();

  const denied = spawnSync("bash", installerArgs("unlisted-device"), {
    env,
    encoding: "utf8",
  });
  assert.equal(denied.status, 1);
  assert.match(denied.stderr, /not found or not connected/);
  assertCleaned();

  for (const [signal, status] of [
    ["SIGHUP", 129],
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ]) {
    const interrupted = spawnSync("bash", installerArgs(), {
      env: { ...env, TEST_INSTALLER_SIGNAL: signal },
      encoding: "utf8",
      timeout: 10000,
    });
    assert.equal(interrupted.status, status, interrupted.stderr);
    assertCleaned();
  }

  writeFileSync(
    plist,
    JSON.stringify({ "com.apple.developer.applesignin": ["Default"] }),
  );
  const barrier = join(root, "release-device-discovery");
  const beforeConcurrent = devicePaths().length;
  const concurrentInstaller = () =>
    new Promise((resolveResult, reject) => {
      const child = spawn("bash", installerArgs(), {
        env: { ...env, TEST_DEVICE_BARRIER: barrier },
        timeout: 10000,
      });
      let output = "";
      child.stdout.on("data", (data) => (output += data));
      child.stderr.on("data", (data) => (output += data));
      child.once("error", reject);
      child.once("close", (status) => resolveResult({ status, output }));
    });
  const concurrent = Promise.all([
    concurrentInstaller(),
    concurrentInstaller(),
  ]);
  try {
    const deadline = Date.now() + 4000;
    while (devicePaths().length < beforeConcurrent + 2 && Date.now() < deadline)
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    const livePaths = devicePaths().slice(beforeConcurrent);
    assert.equal(livePaths.length, 2, "Both discovery processes must overlap");
    assert.equal(new Set(livePaths).size, 2, "Concurrent paths must be unique");
    for (const path of livePaths) {
      assert.equal(existsSync(path), true);
      assert.equal(path.startsWith(`${temp}/mizyun-devicectl.`), true);
    }
  } finally {
    writeFileSync(barrier, "release");
    for (const result of await concurrent) {
      assert.equal(result.status, 0, result.output);
      assert.match(result.output, /Preflight completed successfully/);
    }
  }
  assertCleaned();
  assert.equal(new Set(devicePaths()).size, devicePaths().length);
  const guard = join(repo, "scripts/verify-ios-apple-auth.mjs");
  const signed = (signature) =>
    spawnSync(process.execPath, [guard, "--signed", "fixture.app"], {
      env: { ...env, TEST_SIGNATURE: signature },
    });
  assert.equal(signed("[Dict]\n").status, 1);
  const valid =
    "[Dict]\n\t[Key] com.apple.developer.applesignin\n\t[Value]\n\t\t[Array]\n\t\t\t[String] Default\n";
  assert.equal(signed(valid).status, 0);
  assert.equal(signed(valid.replace("[Array]", "[String]")).status, 1);
  assert.equal(signed(valid.replace("Default", "Other")).status, 1);
  console.log(
    "PASS: Apple capability boundaries (7 checks); concurrent unique discovery paths; success, denied-device and HUP/INT/TERM cleanup",
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
