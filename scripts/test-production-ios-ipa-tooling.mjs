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
  writeFileSync(join(testRepository, "apps/mobile/app.json"), "{}\n");

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
  CFBundleShortVersionString) printf 1.0.0 ;;
  CFBundleVersion) printf '%s' "$EXPECTED_BUILD_NUMBER" ;;
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
printf '%s\n' 'https://mizyun-api.phiskel.com' 'https://mizyun-supabase.phiskel.com' > "$destination/Payload/Mizyun.app/main.jsbundle"
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
  run("git", ["add", "scripts", "apps/mobile/app.json"]);
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

  const artifactRoot = join(testRepository, "apps/mobile/ios/build/app-store");
  const releases = readdirSync(artifactRoot).filter(
    (entry) => !entry.startsWith("."),
  );
  if (releases.length !== 1) {
    throw new Error(`Expected one published release, found ${releases.length}`);
  }
  const releasePath = join(artifactRoot, releases[0]);
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
