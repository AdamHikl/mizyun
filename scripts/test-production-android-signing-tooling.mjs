#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixtureRoot = mkdtempSync(join(tmpdir(), "mizyun-aab-signing-test-"));
const expectedSha1 =
  "A3:37:60:CF:83:BB:54:87:FC:71:F0:38:D4:6B:97:21:CA:A0:70:4D";

const hash = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

const writeExecutable = (directory, name, contents) => {
  const path = join(directory, name);
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
};

const createCase = (name, sourceCommit = "a".repeat(40)) => {
  const root = join(fixtureRoot, name);
  const bin = join(root, "bin");
  const scripts = join(root, "scripts");
  const output = join(
    root,
    "apps/mobile/android/app/build/outputs/bundle/release",
  );
  mkdirSync(bin, { recursive: true });
  mkdirSync(scripts, { recursive: true });
  mkdirSync(output, { recursive: true });
  copyFileSync(
    join(repositoryRoot, "scripts/sign-production-android-bundle.sh"),
    join(scripts, "sign-production-android-bundle.sh"),
  );
  const aab = join(output, "app-release.aab");
  const keystore = join(root, "upload.jks");
  writeFileSync(aab, "unsigned bundle\n");
  writeFileSync(keystore, "test keystore\n");
  writeFileSync(
    `${aab}.build.json`,
    JSON.stringify(
      {
        sourceCommit,
        bundleIdentifier: "com.mizyun.app",
        version: "1.0.6",
        versionCode: 6,
        inputSha256: hash(aab),
      },
      null,
      2,
    ) + "\n",
  );
  writeExecutable(
    bin,
    "keytool",
    `#!/usr/bin/env bash
if [[ "$*" == *"-printcert"* ]]; then
  printf ' SHA1: %s\n' "\${MOCK_SIGNED_SHA1:-${expectedSha1}}"
else
  printf 'Alias name: mizyun-upload\n SHA1: %s\n' '${expectedSha1}'
fi
`,
  );
  writeExecutable(
    bin,
    "jarsigner",
    `#!/usr/bin/env bash
if [[ "\${1:-}" == "-verify" ]]; then exit 0; fi
for argument in "$@"; do
  if [[ -f "$argument" && "$argument" == *'.staging-'* ]]; then
    printf '%s\n' "\${MOCK_SIGNATURE_TEXT:-signed}" >> "$argument"
    exit 0
  fi
done
exit 1
`,
  );
  writeExecutable(bin, "zip", "#!/usr/bin/env bash\nexit 0\n");
  return { root, bin, aab, keystore, sourceCommit };
};

const runSigner = (testCase, extraEnv = {}) =>
  spawnSync(
    "bash",
    ["scripts/sign-production-android-bundle.sh", testCase.aab],
    {
      cwd: testCase.root,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${testCase.bin}:${process.env.PATH}`,
        JAVA_HOME: testCase.root,
        MIZYUN_RELEASE_KEYSTORE: testCase.keystore,
        MIZYUN_RELEASE_STORE_PASSWORD: "test-password",
        ...extraEnv,
      },
    },
  );

try {
  const success = createCase("success");
  const sourceHash = hash(success.aab);
  const result = runSigner(success);
  if (result.status !== 0) {
    throw new Error(
      `Expected successful signing:\n${result.stdout}\n${result.stderr}`,
    );
  }
  const artifact = join(
    success.root,
    "apps/mobile/dist/releases/android/google-play",
    `Mizyun-1.0.6-code6-${success.sourceCommit}.aab`,
  );
  if (!existsSync(artifact) || hash(success.aab) !== sourceHash) {
    throw new Error(
      "Signer did not publish atomically while preserving its input",
    );
  }

  const wrongCertificate = createCase("wrong-certificate", "b".repeat(40));
  const wrongResult = runSigner(wrongCertificate, {
    MOCK_SIGNED_SHA1:
      "00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00",
  });

  const runGit = (cwd, args) => {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(`git ${args.join(" ")} failed:\n${result.stderr}`);
    }
  };
  if (
    wrongResult.status === 0 ||
    !`${wrongResult.stdout}\n${wrongResult.stderr}`.includes(
      "does not match the required Google Play upload certificate",
    )
  ) {
    throw new Error("Post-sign certificate mismatch did not fail closed");
  }

  const stale = createCase("stale-checksum", "c".repeat(40));
  writeFileSync(stale.aab, "changed after build\n");
  const staleResult = runSigner(stale);
  if (
    staleResult.status === 0 ||
    !`${staleResult.stdout}\n${staleResult.stderr}`.includes(
      "does not match its build provenance checksum",
    )
  ) {
    throw new Error("Stale App Bundle was not rejected");
  }

  const collision = createCase("collision", "d".repeat(40));
  const first = runSigner(collision);
  const second = runSigner(collision, { MOCK_SIGNATURE_TEXT: "different" });
  if (
    first.status !== 0 ||
    second.status === 0 ||
    !`${second.stdout}\n${second.stderr}`.includes(
      "Refusing to overwrite a different release artifact",
    )
  ) {
    throw new Error("Conflicting artifact publication was not rejected");
  }

  const preserved = createCase("preserved-input", "e".repeat(40));
  const preservedRoot = join(
    preserved.root,
    "apps/mobile/dist/releases/android/google-play",
  );
  mkdirSync(preservedRoot, { recursive: true });
  const preservedAab = join(preservedRoot, basename(preserved.aab));
  copyFileSync(preserved.aab, preservedAab);
  copyFileSync(`${preserved.aab}.build.json`, `${preservedAab}.build.json`);
  preserved.aab = preservedAab;
  const preservedHash = hash(preservedAab);
  const preservedResult = runSigner(preserved);
  if (
    preservedResult.status === 0 ||
    hash(preservedAab) !== preservedHash ||
    !`${preservedResult.stdout}\n${preservedResult.stderr}`.includes(
      "Refusing to modify a preserved release artifact",
    )
  ) {
    throw new Error("Preserved artifact input was not safely rejected");
  }

  const staleNativeRoot = join(fixtureRoot, "stale-native-version");
  const staleNativeScript = join(staleNativeRoot, "scripts");
  const staleNativeMobile = join(staleNativeRoot, "apps/mobile");
  const staleNativeAndroid = join(staleNativeMobile, "android/app");
  mkdirSync(staleNativeScript, { recursive: true });
  mkdirSync(staleNativeAndroid, { recursive: true });
  copyFileSync(
    join(repositoryRoot, "scripts/mobile-founder-production-android.sh"),
    join(staleNativeScript, "mobile-founder-production-android.sh"),
  );
  writeFileSync(
    join(staleNativeMobile, ".env.production"),
    [
      "EXPO_PUBLIC_API_URL=https://mizyun-api.phiskel.com",
      "EXPO_PUBLIC_SUPABASE_URL=https://mizyun-supabase.phiskel.com",
      "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=test-key",
      "EXPO_PUBLIC_AUTH_REDIRECT_URI=mizyun://auth/callback",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(staleNativeMobile, "app.json"),
    JSON.stringify({
      expo: {
        version: "1.0.6",
        android: { package: "com.mizyun.app", versionCode: 6 },
      },
    }),
  );
  writeFileSync(
    join(staleNativeAndroid, "build.gradle"),
    `android {
  defaultConfig {
    applicationId 'com.mizyun.app'
    versionCode 5
    versionName "1.0.5"
  }
}
`,
  );
  const gradleMarker = join(staleNativeRoot, "gradle-ran");
  writeExecutable(
    join(staleNativeMobile, "android"),
    "gradlew",
    `#!/usr/bin/env bash
touch '${gradleMarker}'
`,
  );
  runGit(staleNativeRoot, ["init", "-b", "main"]);
  runGit(staleNativeRoot, ["config", "user.email", "test@example.invalid"]);
  runGit(staleNativeRoot, ["config", "user.name", "Android Tool Test"]);
  runGit(staleNativeRoot, ["add", "."]);
  runGit(staleNativeRoot, ["commit", "-m", "fixture"]);
  const staleNativeResult = spawnSync(
    "bash",
    ["scripts/mobile-founder-production-android.sh", "bundleRelease"],
    { cwd: staleNativeRoot, encoding: "utf8", env: process.env },
  );
  if (
    staleNativeResult.status === 0 ||
    existsSync(gradleMarker) ||
    !`${staleNativeResult.stdout}\n${staleNativeResult.stderr}`.includes(
      "Native Android version tuple is 1.0.5/5; expected 1.0.6/6",
    )
  ) {
    throw new Error(
      `Stale generated native Android version was not rejected (status=${staleNativeResult.status}, gradleRan=${existsSync(gradleMarker)}):\n${staleNativeResult.stdout}\n${staleNativeResult.stderr}`,
    );
  }

  console.log("Production Android signing tooling behavioral tests passed.");
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}
