#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = process.env.MIZYUN_REPO_ROOT || resolve(__dirname, "..");
const appConfigPath = resolve(repoRoot, "apps/mobile/app.config.js");
const easJsonPath = resolve(repoRoot, "apps/mobile/eas.json");
const require = createRequire(import.meta.url);

console.log("=== Mizyun Build Matrix & Native Identity Verification ===");

// 1. Validate eas.json profiles
console.log("\n1. Validating eas.json profiles...");
const easJson = JSON.parse(readFileSync(easJsonPath, "utf-8"));
const easProfiles = easJson.build ?? {};

const requiredProfiles = ["development", "preview", "production"];
for (const p of requiredProfiles) {
  if (!easProfiles[p]) {
    throw new Error(`eas.json is missing required profile "${p}"`);
  }
}

// Development profile assertions
if (
  easProfiles.development.env?.MIZYUN_APP_VARIANT !== "dev" ||
  easProfiles.development.env?.MIZYUN_BUILD_PROFILE !== "development" ||
  easProfiles.development.env?.EXPO_PUBLIC_API_URL !==
    "https://mizyun-api-dev.phiskel.com"
) {
  throw new Error(
    "eas.json development profile has incorrect env configuration",
  );
}

// Preview profile assertions
if (
  easProfiles.preview.env?.MIZYUN_APP_VARIANT !== "dev" ||
  easProfiles.preview.env?.MIZYUN_BUILD_PROFILE !== "preview" ||
  easProfiles.preview.env?.EXPO_PUBLIC_API_URL !==
    "https://mizyun-api-dev.phiskel.com"
) {
  throw new Error("eas.json preview profile has incorrect env configuration");
}

// Production profile assertions
if (
  easProfiles.production.env?.MIZYUN_APP_VARIANT !== "production" ||
  easProfiles.production.env?.MIZYUN_BUILD_PROFILE !== "production" ||
  easProfiles.production.env?.EXPO_PUBLIC_API_URL !==
    "https://mizyun-api.phiskel.com"
) {
  throw new Error(
    "eas.json production profile has incorrect env configuration",
  );
}
console.log("✓ eas.json profiles correctly configured and isolated");

// 2. Evaluate app.config.js across matrix
console.log(
  "\n2. Evaluating app.config.js across matrix in clean processes...",
);

const evalConfig = (env) => {
  const code = `const cfg = require(${JSON.stringify(appConfigPath)}); console.log(JSON.stringify(cfg));`;
  const cleanEnv = {
    PATH: process.env.PATH,
    NODE_PATH: process.env.NODE_PATH,
    ...env,
  };
  const stdout = execFileSync("node", ["-e", code], {
    env: cleanEnv,
    cwd: resolve(repoRoot, "apps/mobile"),
    encoding: "utf-8",
  });
  return JSON.parse(stdout);
};

const evalConfigExpectingError = (env, expectedSnippet) => {
  const code = `require(${JSON.stringify(appConfigPath)});`;
  const cleanEnv = {
    PATH: process.env.PATH,
    NODE_PATH: process.env.NODE_PATH,
    ...env,
  };
  try {
    execFileSync("node", ["-e", code], {
      env: cleanEnv,
      cwd: resolve(repoRoot, "apps/mobile"),
      encoding: "utf-8",
      stdio: "pipe",
    });
    throw new Error(
      `Expected failure for env ${JSON.stringify(env)}, but succeeded.`,
    );
  } catch (err) {
    if (!err.stderr || !err.stderr.includes(expectedSnippet)) {
      throw new Error(
        `Expected error containing "${expectedSnippet}", but got: ${err.stderr || err.message}`,
      );
    }
  }
};

// Test Development Profile
const devConfig = evalConfig({
  MIZYUN_APP_VARIANT: "dev",
  MIZYUN_BUILD_PROFILE: "development",
  EXPO_PUBLIC_API_URL: "https://mizyun-api-dev.phiskel.com",
  EXPO_PUBLIC_SUPABASE_URL: "https://mizyun-supabase-dev.phiskel.com",
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-dev-publishable-key",
  EXPO_PUBLIC_AUTH_REDIRECT_URI: "mizyun-dev://auth/callback",
});
if (
  devConfig.expo.ios.bundleIdentifier !== "com.mizyun.development" ||
  devConfig.expo.android.package !== "com.mizyun.dev" ||
  devConfig.expo.name !== "Mizyun Dev" ||
  devConfig.expo.scheme !== "mizyun-dev" ||
  devConfig.expo.extra.enableMealPhotos !== true
) {
  throw new Error(
    `Development profile evaluated to unexpected identity: ${JSON.stringify(devConfig.expo)}`,
  );
}
console.log(
  "✓ Development profile evaluated correctly: com.mizyun.development / Mizyun Dev",
);

// Test Preview Profile
const previewConfig = evalConfig({
  MIZYUN_APP_VARIANT: "dev",
  MIZYUN_BUILD_PROFILE: "preview",
  EXPO_PUBLIC_API_URL: "https://mizyun-api-dev.phiskel.com",
  EXPO_PUBLIC_SUPABASE_URL: "https://mizyun-supabase-dev.phiskel.com",
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-preview-publishable-key",
  EXPO_PUBLIC_AUTH_REDIRECT_URI: "mizyun-dev://auth/callback",
});
if (
  previewConfig.expo.ios.bundleIdentifier !== "com.mizyun.development" ||
  previewConfig.expo.android.package !== "com.mizyun.dev" ||
  previewConfig.expo.name !== "Mizyun Dev" ||
  previewConfig.expo.extra.mizyunProfile !== "preview"
) {
  throw new Error(
    `Preview profile evaluated to unexpected identity: ${JSON.stringify(previewConfig.expo)}`,
  );
}
console.log(
  "✓ Preview profile evaluated correctly: com.mizyun.development / standalone Dev",
);

// Test Production Profile
const prodConfig = evalConfig({
  MIZYUN_APP_VARIANT: "production",
  MIZYUN_BUILD_PROFILE: "production",
  EXPO_PUBLIC_API_URL: "https://mizyun-api.phiskel.com",
  EXPO_PUBLIC_SUPABASE_URL: "https://mizyun-supabase.phiskel.com",
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-production-publishable-key",
  EXPO_PUBLIC_AUTH_REDIRECT_URI: "mizyun://auth/callback",
});
if (
  prodConfig.expo.ios.bundleIdentifier !== "com.mizyun.app" ||
  prodConfig.expo.android.package !== "com.mizyun.app" ||
  prodConfig.expo.name !== "Mizyun" ||
  prodConfig.expo.scheme !== "mizyun" ||
  prodConfig.expo.extra.mizyunVariant !== "production" ||
  prodConfig.expo.extra.enableMealPhotos !== false
) {
  throw new Error(
    `Production profile evaluated to unexpected identity: ${JSON.stringify(prodConfig.expo)}`,
  );
}
const releaseVersionMatch = /^1\.0\.([1-9][0-9]*)$/.exec(
  prodConfig.expo.version,
);
if (
  !releaseVersionMatch ||
  prodConfig.expo.ios.buildNumber !== releaseVersionMatch[1] ||
  prodConfig.expo.android.versionCode !== Number(releaseVersionMatch[1])
) {
  throw new Error(
    `Production release version tuple is not synchronized: ${JSON.stringify({
      version: prodConfig.expo.version,
      iosBuildNumber: prodConfig.expo.ios.buildNumber,
      androidVersionCode: prodConfig.expo.android.versionCode,
    })}`,
  );
}
console.log(
  `✓ Production profile evaluated correctly: com.mizyun.app / Mizyun ${prodConfig.expo.version} (${releaseVersionMatch[1]})`,
);

// HealthKit-linked binaries require both purpose strings even for read-only steps.
for (const [profileName, config] of [
  ["development", devConfig],
  ["preview", previewConfig],
  ["production", prodConfig],
]) {
  for (const key of [
    "NSHealthShareUsageDescription",
    "NSHealthUpdateUsageDescription",
  ]) {
    const description = config.expo.ios.infoPlist?.[key];
    if (typeof description !== "string" || description.trim().length === 0) {
      throw new Error(
        `${profileName} profile is missing HealthKit purpose string ${key}`,
      );
    }
  }
}
console.log(
  "✓ All iOS profiles include HealthKit read and update purpose strings",
);

const hasPlugin = (config, pluginName) =>
  config.expo.plugins.some((plugin) =>
    Array.isArray(plugin) ? plugin[0] === pluginName : plugin === pluginName,
  );
for (const [profileName, config] of [
  ["development", devConfig],
  ["preview", previewConfig],
  ["production", prodConfig],
]) {
  if (!hasPlugin(config, "expo-widgets")) {
    throw new Error(
      `${profileName} profile is missing the expo-widgets Live Activity config plugin`,
    );
  }
  if (!hasPlugin(config, "./plugins/with-android-workout-live-update")) {
    throw new Error(
      `${profileName} profile is missing the Android workout Live Update permission plugin`,
    );
  }
  const widgets = config.expo.plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === "expo-widgets",
  );
  if (
    widgets?.[1]?.bundleIdentifier !==
      `${config.expo.ios.bundleIdentifier}.ExpoWidgetsTarget` ||
    widgets?.[1]?.groupIdentifier !==
      `group.${config.expo.ios.bundleIdentifier}` ||
    widgets?.[1]?.enablePushNotifications !== false
  ) {
    throw new Error(
      `${profileName} profile has incorrect widget extension identity or local-update configuration`,
    );
  }
}
const mobilePackagePath = resolve(repoRoot, "apps/mobile/package.json");
if (existsSync(mobilePackagePath)) {
  const mobilePackage = JSON.parse(readFileSync(mobilePackagePath, "utf-8"));
  if (!mobilePackage.dependencies?.["expo-widgets"]?.startsWith("~57.")) {
    throw new Error(
      "Mobile must pin the Expo SDK 57 expo-widgets dependency for iOS Live Activities",
    );
  }
}
console.log(
  "✓ All profiles enable workout Live Activity/Live Update plugins with isolated widget identities",
);

// Metro checks .ts before .tsx, so a generic .ts adapter can shadow .ios.tsx.
const mobileRequire = createRequire(mobilePackagePath);
const metroRequire = createRequire(mobileRequire.resolve("expo/metro-config"));
const metroResolve = metroRequire("metro-resolver").resolve;
const sourceExts = mobileRequire("expo/metro-config").getDefaultConfig(
  resolve(repoRoot, "apps/mobile"),
).resolver.sourceExts;
const workoutDir = resolve(repoRoot, "apps/mobile/src/features/workouts");
const resolutionContext = {
  originModulePath: resolve(workoutDir, "workout-notification.ts"),
  assetExts: new Set(),
  sourceExts,
  preferNativePlatform: true,
  getPackageForModule: () => null,
  fileSystemLookup: (path) => {
    if (!existsSync(path)) return { exists: false };
    const stats = statSync(path);
    return {
      exists: true,
      type: stats.isFile() ? "f" : "d",
      realPath: path,
    };
  },
};
for (const [platform, expected] of [
  ["ios", "workout-live-activity.ios.tsx"],
  ["android", "workout-live-activity.tsx"],
]) {
  const resolved = metroResolve(
    resolutionContext,
    "./workout-live-activity",
    platform,
  );
  if (resolved.filePath !== resolve(workoutDir, expected)) {
    throw new Error(
      `Metro resolved ${platform} workout Live Activity to ${resolved.filePath}; expected ${expected}`,
    );
  }
}
console.log(
  "✓ Metro selects the native iOS Live Activity and Android no-op adapter",
);

evalConfigExpectingError(
  {
    MIZYUN_APP_VARIANT: "production",
    MIZYUN_BUILD_PROFILE: "production",
    MIZYUN_IOS_BUILD_NUMBER: String(Number(releaseVersionMatch[1]) + 1),
    EXPO_PUBLIC_API_URL: "https://mizyun-api.phiskel.com",
    EXPO_PUBLIC_SUPABASE_URL: "https://mizyun-supabase.phiskel.com",
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-production-publishable-key",
    EXPO_PUBLIC_AUTH_REDIRECT_URI: "mizyun://auth/callback",
  },
  "Release version tuple mismatch",
);
console.log("✓ Mismatched Production version/build tuple rejected");

// 3. Test Hostile / Conflicting Ambient Environments
console.log(
  "\n3. Testing rejection of hostile/conflicting ambient environments...",
);

evalConfigExpectingError(
  {
    MIZYUN_APP_VARIANT: "dev",
    EXPO_PUBLIC_API_URL: "https://mizyun-api.phiskel.com",
  },
  "Dev variant cannot point to Production API",
);
console.log("✓ Conflicting Dev -> Prod API rejected");

evalConfigExpectingError(
  {
    MIZYUN_APP_VARIANT: "dev",
    EXPO_PUBLIC_SUPABASE_URL: "https://mizyun-supabase.phiskel.com",
  },
  "Dev variant cannot point to Production Supabase",
);
console.log("✓ Conflicting Dev -> Prod Supabase rejected");

evalConfigExpectingError(
  {
    MIZYUN_APP_VARIANT: "dev",
    EXPO_PUBLIC_AUTH_REDIRECT_URI: "mizyun://auth/callback",
  },
  "Dev variant cannot use production redirect scheme",
);
console.log("✓ Conflicting Dev -> Prod redirect scheme rejected");

evalConfigExpectingError(
  {
    MIZYUN_APP_VARIANT: "production",
    EXPO_PUBLIC_API_URL: "https://mizyun-api-dev.phiskel.com",
    EXPO_PUBLIC_SUPABASE_URL: "https://mizyun-supabase.phiskel.com",
    EXPO_PUBLIC_AUTH_REDIRECT_URI: "mizyun://auth/callback",
  },
  "Production variant cannot point to Dev or local API",
);
console.log("✓ Conflicting Production -> Dev API rejected");

evalConfigExpectingError(
  {
    MIZYUN_APP_VARIANT: "production",
    EXPO_PUBLIC_API_URL: "https://mizyun-api.phiskel.com",
    EXPO_PUBLIC_SUPABASE_URL: "https://mizyun-supabase.phiskel.com",
    EXPO_PUBLIC_AUTH_REDIRECT_URI: "mizyun-dev://auth/callback",
  },
  "Production variant cannot use dev redirect scheme",
);
console.log("✓ Conflicting Production -> Dev redirect scheme rejected");

evalConfigExpectingError(
  {
    EAS_BUILD_PROFILE: "production",
    MIZYUN_APP_VARIANT: "dev",
  },
  'Build profile "production" is incompatible with MIZYUN_APP_VARIANT "dev"',
);
console.log("✓ Incompatible EAS production profile with dev variant rejected");

evalConfigExpectingError(
  {
    EAS_BUILD_PROFILE: "development",
    MIZYUN_APP_VARIANT: "production",
  },
  'Build profile "development" is incompatible with MIZYUN_APP_VARIANT "production"',
);
console.log(
  "✓ Incompatible EAS development profile with production variant rejected",
);

evalConfigExpectingError(
  {
    MIZYUN_BUILD_PROFILE: "unknown",
    MIZYUN_APP_VARIANT: "production",
  },
  'Unknown MIZYUN_BUILD_PROFILE "unknown"',
);
console.log("✓ Unknown MIZYUN_BUILD_PROFILE rejected");

evalConfigExpectingError(
  {
    EAS_BUILD_PROFILE: "unknown",
    MIZYUN_APP_VARIANT: "dev",
  },
  'Unknown EAS_BUILD_PROFILE "unknown"',
);
console.log("✓ Unknown EAS_BUILD_PROFILE rejected");

evalConfigExpectingError(
  {
    MIZYUN_BUILD_PROFILE: "production",
    MIZYUN_APP_VARIANT: "production",
    // Missing EXPO_PUBLIC_API_URL
    EXPO_PUBLIC_SUPABASE_URL: "https://mizyun-supabase.phiskel.com",
    EXPO_PUBLIC_AUTH_REDIRECT_URI: "mizyun://auth/callback",
  },
  "Production profile requires EXPO_PUBLIC_API_URL",
);
console.log("✓ Production profile missing API URL rejected");

evalConfigExpectingError(
  {
    MIZYUN_BUILD_PROFILE: "production",
    MIZYUN_APP_VARIANT: "production",
    EXPO_PUBLIC_API_URL: "https://mizyun-api.phiskel.com",
    // Missing EXPO_PUBLIC_SUPABASE_URL
    EXPO_PUBLIC_AUTH_REDIRECT_URI: "mizyun://auth/callback",
  },
  "Production profile requires EXPO_PUBLIC_SUPABASE_URL",
);
console.log("✓ Production profile missing Supabase URL rejected");

evalConfigExpectingError(
  {
    MIZYUN_BUILD_PROFILE: "production",
    MIZYUN_APP_VARIANT: "production",
    EXPO_PUBLIC_API_URL: "https://mizyun-api.phiskel.com",
    EXPO_PUBLIC_SUPABASE_URL: "https://mizyun-supabase.phiskel.com",
    // Missing EXPO_PUBLIC_AUTH_REDIRECT_URI
  },
  "Production profile requires EXPO_PUBLIC_AUTH_REDIRECT_URI",
);
console.log("✓ Production profile missing Auth redirect URI rejected");

evalConfigExpectingError(
  {
    MIZYUN_APP_VARIANT: "dev",
    EXPO_PUBLIC_API_URL: "https://evil.com/api",
  },
  "Dev variant cannot point to API host",
);
console.log("✓ Foreign API URL in Dev rejected");

evalConfigExpectingError(
  {
    MIZYUN_APP_VARIANT: "production",
    MIZYUN_BUILD_PROFILE: "production",
    EXPO_PUBLIC_API_URL: "https://evil.com/api",
    EXPO_PUBLIC_SUPABASE_URL: "https://mizyun-supabase.phiskel.com",
    EXPO_PUBLIC_AUTH_REDIRECT_URI: "mizyun://auth/callback",
  },
  "Production variant cannot point to non-production API",
);
console.log("✓ Foreign API URL in Production rejected");

evalConfigExpectingError(
  {
    MIZYUN_APP_VARIANT: "dev",
    EXPO_PUBLIC_AUTH_REDIRECT_URI: "evil://auth/callback",
  },
  "Dev variant cannot use redirect scheme",
);
console.log("✓ Foreign redirect scheme in Dev rejected");

evalConfigExpectingError(
  {
    MIZYUN_APP_VARIANT: "production",
    MIZYUN_BUILD_PROFILE: "production",
    EXPO_PUBLIC_API_URL: "https://mizyun-api.phiskel.com",
    EXPO_PUBLIC_SUPABASE_URL: "https://mizyun-supabase.phiskel.com",
    EXPO_PUBLIC_AUTH_REDIRECT_URI: "evil://auth/callback",
  },
  "Production variant cannot use redirect scheme",
);
console.log("✓ Foreign redirect scheme in Production rejected");

// 4. Validate native directory guardrails in scripts
console.log("\n4. Verifying native directory guardrails in founder scripts...");
const devScript = readFileSync(
  resolve(repoRoot, "scripts/mobile-founder-dev-ios.sh"),
  "utf-8",
);
const prodScript = readFileSync(
  resolve(repoRoot, "scripts/mobile-founder-production-ios.sh"),
  "utf-8",
);
const productionIpaScriptPath = resolve(
  repoRoot,
  "scripts/build-production-ios-ipa.sh",
);
const productionIpaScript = readFileSync(productionIpaScriptPath, "utf-8");
const androidScript = readFileSync(
  resolve(repoRoot, "scripts/mobile-founder-production-android.sh"),
  "utf-8",
);
const devAndroidScript = readFileSync(
  resolve(repoRoot, "scripts/mobile-founder-dev-android.sh"),
  "utf-8",
);

if (
  !devScript.includes("com.mizyun.development") ||
  !devScript.includes("PRODUCT_BUNDLE_IDENTIFIER") ||
  !devScript.includes('-z "$current_bundle_id"')
) {
  throw new Error(
    "scripts/mobile-founder-dev-ios.sh is missing fail-closed bundle ID mismatch guard",
  );
}
if (
  !prodScript.includes("com.mizyun.app") ||
  !prodScript.includes("PRODUCT_BUNDLE_IDENTIFIER") ||
  !prodScript.includes('-z "$current_bundle_id"')
) {
  throw new Error(
    "scripts/mobile-founder-production-ios.sh is missing fail-closed bundle ID mismatch guard",
  );
}
const rootPackage = JSON.parse(
  readFileSync(resolve(repoRoot, "package.json"), "utf-8"),
);
if (
  rootPackage.scripts?.["mobile:founder-production:ios:ipa"] !==
  "bash scripts/build-production-ios-ipa.sh"
) {
  throw new Error("Production IPA package command is missing or misrouted");
}
const productionIpaHelp = execFileSync(
  "bash",
  [productionIpaScriptPath, "--help"],
  { encoding: "utf-8" },
);
if (
  !productionIpaHelp.includes("--sha <full-sha>") ||
  !productionIpaHelp.includes("--build-number <number>")
) {
  throw new Error(
    "Production IPA command does not document its required inputs",
  );
}
for (const requiredGuard of [
  "merge-base --is-ancestor",
  "worktree add --detach",
  "expo prebuild --clean",
  "pnpm check",
  "codesign --verify --deep --strict",
  "aps-environment",
  "get-task-allow",
  "https://mizyun-api.phiskel.com",
  "https://mizyun-supabase.phiskel.com",
  "manifest.json",
]) {
  if (!productionIpaScript.includes(requiredGuard)) {
    throw new Error(
      `Production IPA script is missing required guard: ${requiredGuard}`,
    );
  }
}
if (
  !androidScript.includes("com.mizyun.app") ||
  !androidScript.includes("applicationId") ||
  !androidScript.includes('-z "$current_app_id"')
) {
  throw new Error(
    "scripts/mobile-founder-production-android.sh is missing fail-closed applicationId mismatch guard",
  );
}
if (
  !devAndroidScript.includes("com.mizyun.dev") ||
  !devAndroidScript.includes("applicationId") ||
  !devAndroidScript.includes('-z "$current_app_id"')
) {
  throw new Error(
    "scripts/mobile-founder-dev-android.sh is missing fail-closed applicationId mismatch guard",
  );
}

// Verify fail-closed release signing configuration via config plugin fixture
const pluginPath = resolve(
  repoRoot,
  "apps/mobile/plugins/with-android-release-signing.js",
);
const withAndroidReleaseSigning = require(pluginPath);
const fixtureConfig = withAndroidReleaseSigning({});
const gradleMod = fixtureConfig?.mods?.android?.appBuildGradle;
if (typeof gradleMod !== "function") {
  throw new Error(
    "apps/mobile/plugins/with-android-release-signing.js did not register appBuildGradle mod",
  );
}

const standardGradleFixture = `
signingConfigs {
    debug {
        storeFile file('debug.keystore')
    }
}
buildTypes {
    release {
        signingConfig signingConfigs.debug
    }
}
`;

const modResult = await gradleMod({
  modResults: { contents: standardGradleFixture },
});
const transformedGradle = modResult?.modResults?.contents || "";
if (
  !transformedGradle.includes("signingConfig signingConfigs.release") ||
  !transformedGradle.includes("MIZYUN_RELEASE_KEYSTORE") ||
  !transformedGradle.includes("GradleException")
) {
  throw new Error(
    "withAndroidReleaseSigning plugin failed to inject fail-closed release signing configuration into fixture",
  );
}

// If generated build.gradle is present on disk (ambient developer machine), verify it as well
const gradlePath = resolve(repoRoot, "apps/mobile/android/app/build.gradle");
if (existsSync(gradlePath)) {
  const gradleScript = readFileSync(gradlePath, "utf-8");
  if (
    !gradleScript.includes("signingConfig signingConfigs.release") ||
    !gradleScript.includes("MIZYUN_RELEASE_KEYSTORE") ||
    !gradleScript.includes("GradleException")
  ) {
    throw new Error(
      "apps/mobile/android/app/build.gradle is missing fail-closed release signing configuration",
    );
  }
}

console.log(
  "✓ Fail-closed native directory mismatch guards and release signing verified in founder scripts",
);

console.log(
  "\nAll build matrix, native identity, and environment isolation checks PASSED!",
);
