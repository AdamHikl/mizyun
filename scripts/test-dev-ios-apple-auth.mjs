import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  cpSync,
  chmodSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const root = mkdtempSync(join(tmpdir(), "mizyun-dev-apple-"));
try {
  const repo = join(root, "repo");
  const bin = join(root, "bin");
  for (const dir of [
    bin,
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
    `const fs=require('node:fs');const args=process.argv.slice(2);const i=args.indexOf('--json-output');if(i>=0)fs.writeFileSync(args[i+1],JSON.stringify({result:{devices:[{identifier:'fixture',hardwareProperties:{udid:'fixture'},deviceProperties:{name:'Fixture iPhone'}}]}}));`,
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
  };
  const plist = join(repo, "apps/mobile/ios/MizyunDev/MizyunDev.entitlements");
  const runInstaller = () =>
    execFileSync(
      "bash",
      [
        join(repo, "scripts/mobile-device-install.sh"),
        "ios",
        "dev",
        "--device",
        "fixture",
        "--dry-run",
      ],
      { env, encoding: "utf8" },
    );
  writeFileSync(plist, "{}");
  assert.match(runInstaller(), /Dev native Apple sign-in capability missing/);
  writeFileSync(
    plist,
    JSON.stringify({ "com.apple.developer.applesignin": ["Default"] }),
  );
  assert.doesNotMatch(runInstaller(), /expo prebuild --clean/);
  writeFileSync(plist, "malformed");
  assert.match(runInstaller(), /Dev native Apple sign-in capability missing/);
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
    "PASS: same-bundle missing/present/malformed capability and signed capability boundaries (7 checks)",
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
