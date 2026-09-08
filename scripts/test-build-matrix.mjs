#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const appConfigPath = resolve(repoRoot, "apps/mobile/app.config.js");
const easJsonPath = resolve(repoRoot, "apps/mobile/eas.json");

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
  EXPO_PUBLIC_AUTH_REDIRECT_URI: "mizyun-dev://auth/callback",
});
if (
  devConfig.expo.ios.bundleIdentifier !== "com.mizyun.dev" ||
  devConfig.expo.android.package !== "com.mizyun.dev" ||
  devConfig.expo.name !== "Mizyun Dev" ||
  devConfig.expo.scheme !== "mizyun-dev"
) {
  throw new Error(
    `Development profile evaluated to unexpected identity: ${JSON.stringify(devConfig.expo)}`,
  );
}
console.log(
  "✓ Development profile evaluated correctly: com.mizyun.dev / Mizyun Dev",
);

// Test Preview Profile
const previewConfig = evalConfig({
  MIZYUN_APP_VARIANT: "dev",
  MIZYUN_BUILD_PROFILE: "preview",
  EXPO_PUBLIC_API_URL: "https://mizyun-api-dev.phiskel.com",
  EXPO_PUBLIC_SUPABASE_URL: "https://mizyun-supabase-dev.phiskel.com",
  EXPO_PUBLIC_AUTH_REDIRECT_URI: "mizyun-dev://auth/callback",
});
if (
  previewConfig.expo.ios.bundleIdentifier !== "com.mizyun.dev" ||
  previewConfig.expo.android.package !== "com.mizyun.dev" ||
  previewConfig.expo.name !== "Mizyun Dev" ||
  previewConfig.expo.extra.mizyunProfile !== "preview"
) {
  throw new Error(
    `Preview profile evaluated to unexpected identity: ${JSON.stringify(previewConfig.expo)}`,
  );
}
console.log(
  "✓ Preview profile evaluated correctly: com.mizyun.dev / standalone Dev",
);

// Test Production Profile
const prodConfig = evalConfig({
  MIZYUN_APP_VARIANT: "production",
  MIZYUN_BUILD_PROFILE: "production",
  EXPO_PUBLIC_API_URL: "https://mizyun-api.phiskel.com",
  EXPO_PUBLIC_SUPABASE_URL: "https://mizyun-supabase.phiskel.com",
  EXPO_PUBLIC_AUTH_REDIRECT_URI: "mizyun://auth/callback",
});
if (
  prodConfig.expo.ios.bundleIdentifier !== "com.mizyun.app" ||
  prodConfig.expo.android.package !== "com.mizyun.app" ||
  prodConfig.expo.name !== "Mizyun" ||
  prodConfig.expo.scheme !== "mizyun" ||
  prodConfig.expo.extra.mizyunVariant !== "production"
) {
  throw new Error(
    `Production profile evaluated to unexpected identity: ${JSON.stringify(prodConfig.expo)}`,
  );
}
console.log(
  "✓ Production profile evaluated correctly: com.mizyun.app / Mizyun",
);

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
  },
  "Production variant cannot point to Dev or local API",
);
console.log("✓ Conflicting Production -> Dev API rejected");

evalConfigExpectingError(
  {
    MIZYUN_APP_VARIANT: "production",
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
const androidScript = readFileSync(
  resolve(repoRoot, "scripts/mobile-founder-production-android.sh"),
  "utf-8",
);

if (
  !devScript.includes("com.mizyun.dev") ||
  !devScript.includes("PRODUCT_BUNDLE_IDENTIFIER")
) {
  throw new Error(
    "scripts/mobile-founder-dev-ios.sh is missing bundle ID mismatch guard",
  );
}
if (
  !prodScript.includes("com.mizyun.app") ||
  !prodScript.includes("PRODUCT_BUNDLE_IDENTIFIER")
) {
  throw new Error(
    "scripts/mobile-founder-production-ios.sh is missing bundle ID mismatch guard",
  );
}
if (
  !androidScript.includes("com.mizyun.app") ||
  !androidScript.includes("applicationId")
) {
  throw new Error(
    "scripts/mobile-founder-production-android.sh is missing applicationId mismatch guard",
  );
}
console.log("✓ Native directory mismatch guards verified in founder scripts");

console.log(
  "\nAll build matrix, native identity, and environment isolation checks PASSED!",
);
