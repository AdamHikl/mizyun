#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixtureRoot = mkdtempSync(join(tmpdir(), "mizyun-ipa-tool-test-"));
const mockBin = join(fixtureRoot, "bin");
const testRepository = join(fixtureRoot, "repo");
const commandLog = join(fixtureRoot, "commands.log");

const writeExecutable = (name, contents) => {
  const path = join(mockBin, name);
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
};

const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    cwd: testRepository,
    encoding: "utf8",
    ...options,
  });

const expectFailure = (args, expectedMessage, env) => {
  const result = spawnSync(
    "bash",
    ["scripts/build-production-ios-ipa.sh", ...args],
    {
      cwd: testRepository,
      encoding: "utf8",
      env,
    },
  );
  if (result.status === 0) {
    throw new Error(`Expected failure for ${args.join(" ")}`);
  }
  const output = `${result.stdout}\n${result.stderr}`;
  if (!output.includes(expectedMessage)) {
    throw new Error(
      `Expected failure containing "${expectedMessage}", got:\n${output}`,
    );
  }
};

try {
  mkdirSync(mockBin, { recursive: true });
  mkdirSync(join(testRepository, "scripts"), { recursive: true });
  mkdirSync(join(testRepository, "apps/mobile"), { recursive: true });
  cpSync(
    join(repositoryRoot, "scripts/build-production-ios-ipa.sh"),
    join(testRepository, "scripts/build-production-ios-ipa.sh"),
  );
  cpSync(
    join(repositoryRoot, "scripts/ios-export-options-production.plist"),
    join(testRepository, "scripts/ios-export-options-production.plist"),
  );
  for (const configFile of ["app.json", "app.config.js"]) {
    cpSync(
      join(repositoryRoot, "apps/mobile", configFile),
      join(testRepository, "apps/mobile", configFile),
    );
  }
  // Freeze synthetic artifact identity independently of future store increments.
  const fixtureConfigPath = join(testRepository, "apps/mobile/app.json");
  const fixtureConfig = JSON.parse(readFileSync(fixtureConfigPath, "utf8"));
  fixtureConfig.expo.version = "1.0.7";
  fixtureConfig.expo.ios.buildNumber = "7";
  fixtureConfig.expo.android.versionCode = 7;
  writeFileSync(fixtureConfigPath, JSON.stringify(fixtureConfig));

  writeExecutable(
    "pnpm",
    `#!/usr/bin/env bash
set -eu
echo "pnpm $*" >> "$MOCK_COMMAND_LOG"
if [[ "$*" == *"expo prebuild --clean"* ]]; then
  mkdir -p apps/mobile/ios/Mizyun.xcworkspace apps/mobile/ios/Mizyun.xcodeproj
  printf '%s\n' 'PRODUCT_BUNDLE_IDENTIFIER = com.mizyun.app;' > apps/mobile/ios/Mizyun.xcodeproj/project.pbxproj
fi
`,
  );
  writeExecutable(
    "xcodebuild",
    `#!/usr/bin/env bash
set -eu
echo "xcodebuild $*" >> "$MOCK_COMMAND_LOG"
if [[ "\${1:-}" == "-version" ]]; then
  printf '%s\n' 'Xcode 26.0' 'Build version TEST'
  exit 0
fi
archive_path=""
export_path=""
previous=""
for argument in "$@"; do
  if [[ "$previous" == "-archivePath" ]]; then archive_path="$argument"; fi
  if [[ "$previous" == "-exportPath" ]]; then export_path="$argument"; fi
  previous="$argument"
done
if [[ "$*" == *" -exportArchive "* || "\${1:-}" == "-exportArchive" ]]; then
  mkdir -p "$export_path"
  printf 'fake ipa' > "$export_path/Mizyun.ipa"
  printf 'fake summary' > "$export_path/DistributionSummary.plist"
  printf '%s\n' '** EXPORT SUCCEEDED **'
else
  mkdir -p "$archive_path"
  printf '%s\n' '** ARCHIVE SUCCEEDED **'
fi
`,
  );
  writeExecutable(
    "plutil",
    `#!/usr/bin/env bash
set -eu
if [[ "\${1:-}" == "-lint" ]]; then exit 0; fi
if [[ "\${1:-}" == "-convert" ]]; then
  if [[ "\${MOCK_BAD_SUMMARY:-0}" == "1" ]]; then
    printf '%s' '{"Mizyun.ipa":[{"team":{"id":"WRONG"},"certificate":{"type":"Development","SHA1":"BAD","dateExpires":"01/01/2000"}}]}'
  else
    printf '%s' '{"Mizyun.ipa":[{"team":{"id":"LQJNDVBL43"},"certificate":{"type":"Cloud Managed Apple Distribution","SHA1":"TESTSHA1","dateExpires":"14/09/2099"}}]}'
  fi
  exit 0
fi
key="\${2:-}"
case "$key" in
  method) printf app-store-connect ;;
  destination) printf export ;;
  teamID) printf LQJNDVBL43 ;;
  signingStyle) printf automatic ;;
  manageAppVersionAndBuildNumber) printf false ;;
  CFBundleIdentifier) printf com.mizyun.app ;;
  CFBundleShortVersionString) printf '1.0.%s' "$EXPECTED_BUILD_NUMBER" ;;
  CFBundleVersion) printf '%s' "$EXPECTED_BUILD_NUMBER" ;;
  NSHealthShareUsageDescription|NSHealthUpdateUsageDescription)
    if [[ "\${MOCK_PURPOSE_KEY:-}" == "$key" ]]; then
      case "\${MOCK_PURPOSE_FAILURE:-}" in
        missing) exit 1 ;;
        wrong-type)
          if [[ "$*" == *"-expect string"* ]]; then exit 1; fi
          printf true; exit 0
          ;;
        blank) printf ' \\n\\t'; exit 0 ;;
      esac
    fi
    printf 'Mizyun reads steps only when enabled and does not save Apple Health data.'
    ;;
  *) exit 1 ;;
esac
`,
  );
  writeExecutable(
    "unzip",
    `#!/usr/bin/env bash
set -eu
destination=""
previous=""
for argument in "$@"; do
  if [[ "$previous" == "-d" ]]; then destination="$argument"; fi
  previous="$argument"
done
mkdir -p "$destination/Payload/Mizyun.app"
printf 'fake plist' > "$destination/Payload/Mizyun.app/Info.plist"
printf '%s\n' 'https://mizyun-api.phiskel.com' 'https://mizyun-supabase.phiskel.com' 'https://mizyun-api-dev.phiskel.com' 'https://mizyun-supabase-dev.phiskel.com' > "$destination/Payload/Mizyun.app/main.jsbundle"
node - "$destination" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const appPath = path.join(process.argv[2], "Payload/Mizyun.app");
const config = require(path.join(process.cwd(), "apps/mobile/app.config.js")).expo;
const configDir = path.join(appPath, "EXConstants.bundle");
fs.mkdirSync(configDir);
const configPath = path.join(configDir, "app.config");
if (process.env.MOCK_CONFIG_FAILURE === "missing") process.exit(0);
if (process.env.MOCK_CONFIG_FAILURE === "malformed") {
  fs.writeFileSync(configPath, "{truncated");
  process.exit(0);
}
if (process.env.MOCK_CONFIG_FIELD) {
  const segments = process.env.MOCK_CONFIG_FIELD.split(".");
  const field = segments.pop();
  const parent = segments.reduce((object, segment) => object[segment], config);
  parent[field] = process.env.MOCK_CONFIG_VALUE || "incorrect-exported-value";
}
if (process.env.MOCK_CONFIG_FAILURE === "missing-endpoints") {
  delete config.extra.mizyunReleaseEndpoints;
}
if (JSON.stringify(config.extra.mizyunReleaseEndpoints ?? {}).includes("test-publishable-key")) {
  throw new Error("Release endpoint metadata contains a credential");
}
fs.writeFileSync(configPath, JSON.stringify(config));
if (process.env.MOCK_MISSING_RUNTIME_ENDPOINT) {
  const contents = fs.readFileSync(path.join(appPath, "main.jsbundle"), "utf8");
  fs.writeFileSync(path.join(appPath, "main.jsbundle"), contents.replace(process.env.MOCK_MISSING_RUNTIME_ENDPOINT, ""));
}
NODE
`,
  );
  writeExecutable(
    "codesign",
    `#!/usr/bin/env bash
set -eu
if [[ "\${1:-}" == "--verify" ]]; then exit 0; fi
if [[ "\${1:-}" == "-dv" ]]; then
  printf '%s\n' 'Identifier=com.mizyun.app' 'TeamIdentifier=LQJNDVBL43' >&2
  exit 0
fi
cat >&2 <<'EOF'
[Dict]
  [Key] application-identifier
  [Value]
    [String] LQJNDVBL43.com.mizyun.app
  [Key] aps-environment
  [Value]
    [String] production
  [Key] com.apple.developer.applesignin
  [Value]
    [Array]
      [String] Default
  [Key] get-task-allow
  [Value]
    [Bool] false
EOF
`,
  );
  writeExecutable(
    "date",
    `#!/usr/bin/env bash
printf '%s\n' 20260914T150000Z
`,
  );

  run("git", ["init", "-b", "main"]);
  run("git", ["config", "user.email", "test@example.invalid"]);
  run("git", ["config", "user.name", "IPA Tool Test"]);
  run("git", [
    "add",
    "scripts",
    "apps/mobile/app.json",
    "apps/mobile/app.config.js",
  ]);
  run("git", ["commit", "-m", "add ipa tooling"]);
  const candidateSha = run("git", ["rev-parse", "HEAD"]).trim();
  run("git", ["update-ref", "refs/remotes/origin/main", candidateSha]);

  writeFileSync(
    join(testRepository, "apps/mobile/.env.production"),
    [
      "EXPO_PUBLIC_API_URL=https://mizyun-api.phiskel.com",
      "EXPO_PUBLIC_SUPABASE_URL=https://mizyun-supabase.phiskel.com",
      "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=test-publishable-key",
      "EXPO_PUBLIC_AUTH_REDIRECT_URI=mizyun://auth/callback",
      "",
    ].join("\n"),
  );
  writeFileSync(join(testRepository, "unrelated.txt"), "preserve me\n");

  const testEnvironment = {
    ...process.env,
    PATH: `${mockBin}:${process.env.PATH}`,
    MOCK_COMMAND_LOG: commandLog,
    EXPECTED_BUILD_NUMBER: "7",
  };

  expectFailure(["--unknown"], "Unknown argument", testEnvironment);
  expectFailure(
    ["--sha", candidateSha.slice(0, 8), "--build-number", "7"],
    "full 40-character",
    testEnvironment,
  );

  run(
    "bash",
    [
      "scripts/build-production-ios-ipa.sh",
      "--sha",
      candidateSha,
      "--build-number",
      "7",
    ],
    { env: testEnvironment },
  );

  const artifactRoot = join(
    testRepository,
    "apps/mobile/dist/releases/ios/app-store/packages",
  );
  const releases = readdirSync(artifactRoot).filter(
    (entry) => !entry.startsWith("."),
  );
  if (releases.length !== 1) {
    throw new Error(`Expected one published release, found ${releases.length}`);
  }
  const releasePath = join(artifactRoot, releases[0]);
  const archiveRoot = join(
    testRepository,
    "apps/mobile/dist/releases/ios/app-store/archives",
  );
  const archives = readdirSync(archiveRoot).filter((entry) =>
    entry.endsWith(".xcarchive"),
  );
  if (archives.length !== 1) {
    throw new Error(`Expected one preserved archive, found ${archives.length}`);
  }
  const manifest = JSON.parse(
    readFileSync(join(releasePath, "manifest.json"), "utf8"),
  );
  if (
    manifest.sourceCommit !== candidateSha ||
    manifest.buildNumber !== "7" ||
    manifest.distributionCertificate?.type !==
      "Cloud Managed Apple Distribution"
  ) {
    throw new Error("Published release manifest has incorrect provenance");
  }
  if (
    readFileSync(join(testRepository, "unrelated.txt"), "utf8") !==
    "preserve me\n"
  ) {
    throw new Error("Unrelated dirty working-tree content was modified");
  }

  const commands = readFileSync(commandLog, "utf8");
  const expectedOrder = [
    "pnpm install --frozen-lockfile",
    "expo prebuild --clean",
    "pnpm check",
    "xcodebuild -workspace",
    "xcodebuild -exportArchive",
  ];
  let lastIndex = -1;
  for (const expectedCommand of expectedOrder) {
    const index = commands.indexOf(expectedCommand);
    if (index <= lastIndex) {
      throw new Error(`Command missing or out of order: ${expectedCommand}`);
    }
    lastIndex = index;
  }

  expectFailure(
    ["--sha", candidateSha, "--build-number", "7"],
    "Refusing to overwrite existing artifact directory",
    testEnvironment,
  );

  const releaseArgs = ["--sha", candidateSha, "--build-number", "7"];
  for (const key of [
    "NSHealthShareUsageDescription",
    "NSHealthUpdateUsageDescription",
  ]) {
    for (const failure of ["missing", "wrong-type", "blank"]) {
      expectFailure(
        releaseArgs,
        failure === "blank"
          ? `blank ${key} purpose description`
          : `missing a string ${key} purpose description`,
        {
          ...testEnvironment,
          MOCK_PURPOSE_KEY: key,
          MOCK_PURPOSE_FAILURE: failure,
        },
      );
    }
  }
  for (const field of [
    "name",
    "slug",
    "scheme",
    "ios.bundleIdentifier",
    "android.package",
    "version",
    "ios.buildNumber",
    "android.versionCode",
    "extra.mizyunVariant",
    "extra.mizyunProfile",
    "extra.mizyunReleaseEndpoints.apiUrl",
    "extra.mizyunReleaseEndpoints.supabaseUrl",
    "extra.mizyunReleaseEndpoints.authRedirectUri",
  ]) {
    expectFailure(releaseArgs, `unexpected Expo config ${field}`, {
      ...testEnvironment,
      MOCK_CONFIG_FIELD: field,
      MOCK_CONFIG_VALUE:
        {
          "extra.mizyunVariant": "dev",
          "extra.mizyunProfile": "preview",
          "extra.mizyunReleaseEndpoints.apiUrl":
            "https://mizyun-api-dev.phiskel.com",
          "extra.mizyunReleaseEndpoints.supabaseUrl":
            "https://mizyun-supabase-dev.phiskel.com",
          "extra.mizyunReleaseEndpoints.authRedirectUri":
            "mizyun-dev://auth/callback",
        }[field] || "incorrect-exported-value",
    });
  }
  for (const failure of ["missing", "malformed"]) {
    expectFailure(releaseArgs, "missing a readable Expo public app.config", {
      ...testEnvironment,
      MOCK_CONFIG_FAILURE: failure,
    });
  }
  expectFailure(
    releaseArgs,
    "unexpected Expo config extra.mizyunReleaseEndpoints.apiUrl",
    {
      ...testEnvironment,
      MOCK_CONFIG_FAILURE: "missing-endpoints",
    },
  );
  for (const [endpoint, label] of [
    ["https://mizyun-api.phiskel.com", "API"],
    ["https://mizyun-supabase.phiskel.com", "Supabase"],
  ]) {
    expectFailure(releaseArgs, `Production ${label} URL was not found`, {
      ...testEnvironment,
      MOCK_MISSING_RUNTIME_ENDPOINT: endpoint,
    });
  }

  const badSummaryEnvironment = {
    ...testEnvironment,
    EXPECTED_BUILD_NUMBER: "8",
    MOCK_BAD_SUMMARY: "1",
  };
  expectFailure(
    ["--sha", candidateSha, "--build-number", "8"],
    "Distribution summary has an unexpected team",
    badSummaryEnvironment,
  );
  if (
    readdirSync(artifactRoot).some(
      (entry) => !entry.startsWith(".") && entry.includes("-8-"),
    )
  ) {
    throw new Error("Failed validation published a partial release directory");
  }

  writeFileSync(
    join(testRepository, "scripts/build-production-ios-ipa.sh"),
    `${readFileSync(join(testRepository, "scripts/build-production-ios-ipa.sh"), "utf8")}\n`,
  );
  expectFailure(
    ["--sha", candidateSha, "--build-number", "9"],
    "Release tool differs from candidate",
    { ...testEnvironment, EXPECTED_BUILD_NUMBER: "9" },
  );

  console.log("Production IPA tooling behavioral tests passed.");
} finally {
  if (existsSync(fixtureRoot)) {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}
