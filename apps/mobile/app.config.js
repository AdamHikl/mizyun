const baseConfig = require("./app.json");

const variants = {
  dev: {
    name: "Mizyun Dev",
    slug: "mizyun-dev",
    scheme: "mizyun-dev",
    iosBundleIdentifier: "com.mizyun.development",
    androidPackage: "com.mizyun.dev",
  },
  production: {
    name: "Mizyun",
    slug: "mizyun",
    scheme: "mizyun",
    iosBundleIdentifier: "com.mizyun.app",
    androidPackage: "com.mizyun.app",
  },
};

const easProfile = process.env.EAS_BUILD_PROFILE;
const buildProfile = process.env.MIZYUN_BUILD_PROFILE;
let variantName = process.env.MIZYUN_APP_VARIANT;

if (!variantName) {
  if (easProfile === "production" || buildProfile === "production") {
    variantName = "production";
  } else {
    variantName = "dev";
  }
}

const variant = variants[variantName];
if (!variant) {
  throw new Error(
    `Unknown MIZYUN_APP_VARIANT "${variantName}". Use "dev" or "production".`,
  );
}

const VALID_PROFILES = ["development", "preview", "production"];

if (buildProfile && !VALID_PROFILES.includes(buildProfile)) {
  throw new Error(
    `Unknown MIZYUN_BUILD_PROFILE "${buildProfile}". Expected "development", "preview", or "production".`,
  );
}

if (easProfile && !VALID_PROFILES.includes(easProfile)) {
  throw new Error(
    `Unknown EAS_BUILD_PROFILE "${easProfile}". Expected "development", "preview", or "production".`,
  );
}

// Cross-profile validation
const effectiveProfile =
  buildProfile ||
  easProfile ||
  (variantName === "production" ? "production" : "development");

if (!VALID_PROFILES.includes(effectiveProfile)) {
  throw new Error(
    `Unknown build profile "${effectiveProfile}". Expected "development", "preview", or "production".`,
  );
}

if (
  (effectiveProfile === "production" && variantName !== "production") ||
  ((effectiveProfile === "development" || effectiveProfile === "preview") &&
    variantName !== "dev")
) {
  throw new Error(
    `Build profile "${effectiveProfile}" is incompatible with MIZYUN_APP_VARIANT "${variantName}".`,
  );
}

if (easProfile && buildProfile && easProfile !== buildProfile) {
  throw new Error(
    `EAS profile "${easProfile}" conflicts with MIZYUN_BUILD_PROFILE "${buildProfile}".`,
  );
}

// Host & scheme guardrails
const apiUrl = process.env.EXPO_PUBLIC_API_URL;
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const authRedirectUri = process.env.EXPO_PUBLIC_AUTH_REDIRECT_URI;
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (effectiveProfile === "production" || effectiveProfile === "preview") {
  if (!apiUrl) {
    throw new Error(
      "Production profile requires EXPO_PUBLIC_API_URL to be defined.",
    );
  }
  if (!supabaseUrl) {
    throw new Error(
      "Production profile requires EXPO_PUBLIC_SUPABASE_URL to be defined.",
    );
  }
  if (!authRedirectUri) {
    throw new Error(
      "Production profile requires EXPO_PUBLIC_AUTH_REDIRECT_URI to be defined.",
    );
  }
}

const parseHostname = (urlString) => {
  try {
    return new URL(urlString).hostname;
  } catch {
    return null;
  }
};

if (apiUrl) {
  const host = parseHostname(apiUrl);
  if (!host) {
    throw new Error(`Invalid EXPO_PUBLIC_API_URL "${apiUrl}".`);
  }
  if (variantName === "production") {
    if (new URL(apiUrl).protocol !== "https:") {
      throw new Error(`Production API URL must use HTTPS: "${apiUrl}".`);
    }
    if (
      host === "mizyun-api-dev.phiskel.com" ||
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "10.0.2.2"
    ) {
      throw new Error(
        `Production variant cannot point to Dev or local API "${apiUrl}".`,
      );
    }
    if (host !== "mizyun-api.phiskel.com") {
      throw new Error(
        `Production variant cannot point to non-production API "${apiUrl}". Expected host "mizyun-api.phiskel.com".`,
      );
    }
  } else {
    if (host === "mizyun-api.phiskel.com") {
      throw new Error(
        `Dev variant cannot point to Production API "${apiUrl}".`,
      );
    }
    const allowedHosts = [
      "mizyun-api-dev.phiskel.com",
      "localhost",
      "127.0.0.1",
      "10.0.2.2",
    ];
    if (!allowedHosts.includes(host)) {
      throw new Error(
        `Dev variant cannot point to API host "${host}". Expected dev or local API host.`,
      );
    }
  }
}

if (supabaseUrl) {
  const host = parseHostname(supabaseUrl);
  if (!host) {
    throw new Error(`Invalid EXPO_PUBLIC_SUPABASE_URL "${supabaseUrl}".`);
  }
  if (variantName === "production") {
    if (new URL(supabaseUrl).protocol !== "https:") {
      throw new Error(
        `Production Supabase URL must use HTTPS: "${supabaseUrl}".`,
      );
    }
    if (
      host === "mizyun-supabase-dev.phiskel.com" ||
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "10.0.2.2"
    ) {
      throw new Error(
        `Production variant cannot point to Dev or local Supabase "${supabaseUrl}".`,
      );
    }
    if (host !== "mizyun-supabase.phiskel.com") {
      throw new Error(
        `Production variant cannot point to non-production Supabase "${supabaseUrl}". Expected host "mizyun-supabase.phiskel.com".`,
      );
    }
  } else {
    if (host === "mizyun-supabase.phiskel.com") {
      throw new Error(
        `Dev variant cannot point to Production Supabase "${supabaseUrl}".`,
      );
    }
    const allowedHosts = [
      "mizyun-supabase-dev.phiskel.com",
      "localhost",
      "127.0.0.1",
      "10.0.2.2",
    ];
    if (!allowedHosts.includes(host)) {
      throw new Error(
        `Dev variant cannot point to Supabase host "${host}". Expected dev or local Supabase host.`,
      );
    }
  }
}

if (authRedirectUri) {
  if (variantName === "production") {
    if (authRedirectUri.startsWith("mizyun-dev://")) {
      throw new Error(
        `Production variant cannot use dev redirect scheme "mizyun-dev://". Expected "mizyun://".`,
      );
    }
    if (!authRedirectUri.startsWith("mizyun://")) {
      throw new Error(
        `Production variant cannot use redirect scheme "${authRedirectUri}". Expected scheme "mizyun://".`,
      );
    }
    if (authRedirectUri !== "mizyun://auth/callback") {
      throw new Error(
        `Production variant requires redirect URI "mizyun://auth/callback".`,
      );
    }
  } else {
    if (
      authRedirectUri.startsWith("mizyun://") &&
      !authRedirectUri.startsWith("mizyun-dev://")
    ) {
      throw new Error(
        `Dev variant cannot use production redirect scheme "mizyun://". Expected "mizyun-dev://".`,
      );
    }
    if (!authRedirectUri.startsWith("mizyun-dev://")) {
      throw new Error(
        `Dev variant cannot use redirect scheme "${authRedirectUri}". Expected scheme "mizyun-dev://".`,
      );
    }
  }
}

if (
  (effectiveProfile === "production" || effectiveProfile === "preview") &&
  !publishableKey
) {
  throw new Error(
    `${effectiveProfile === "production" ? "Production" : "Preview"} profile requires EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY to be defined.`,
  );
}

const baseExpo = baseConfig.expo;
const baseIos = baseExpo.ios;
const baseAndroid = baseExpo.android;
const releaseVersionMatch = /^1\.0\.([1-9][0-9]*)$/.exec(
  baseExpo.version ?? "",
);
const effectiveIosBuildNumber =
  process.env.MIZYUN_IOS_BUILD_NUMBER || baseIos.buildNumber;

if (
  !releaseVersionMatch ||
  effectiveIosBuildNumber !== releaseVersionMatch[1] ||
  baseAndroid.versionCode !== Number(releaseVersionMatch[1])
) {
  throw new Error(
    `Release version tuple mismatch: expected version 1.0.N, ios.buildNumber N, and android.versionCode N; received version=${baseExpo.version}, ios.buildNumber=${effectiveIosBuildNumber}, android.versionCode=${baseAndroid.versionCode}.`,
  );
}

const disableIosPushNotifications = process.env.MIZYUN_IOS_DISABLE_PUSH === "1";
const enableIosAppleAuth = process.env.MIZYUN_ENABLE_APPLE_AUTH === "1";

const plugins = [
  ...(disableIosPushNotifications
    ? [
        ...baseExpo.plugins.filter((plugin) => {
          const pluginName = Array.isArray(plugin) ? plugin[0] : plugin;
          return pluginName !== "expo-notifications";
        }),
        "./plugins/without-ios-push-notifications",
      ]
    : baseExpo.plugins),
  ...(enableIosAppleAuth
    ? ["expo-apple-authentication"]
    : ["./plugins/without-ios-apple-auth"]),
  "./plugins/with-ios-scene-lifecycle",
  "./plugins/with-android-release-signing",
];

module.exports = {
  ...baseConfig,
  expo: {
    ...baseExpo,
    name: variant.name,
    slug: variant.slug,
    scheme: variant.scheme,
    extra: {
      ...baseExpo.extra,
      mizyunVariant: variantName,
      mizyunProfile: effectiveProfile,
      enableProgressPhotos: variantName === "dev",
    },
    ios: {
      ...baseIos,
      appleTeamId: "LQJNDVBL43",
      bundleIdentifier: variant.iosBundleIdentifier,
      usesAppleSignIn: enableIosAppleAuth,
      buildNumber: effectiveIosBuildNumber,
    },
    android: {
      ...baseAndroid,
      package: variant.androidPackage,
    },
    plugins,
  },
};
