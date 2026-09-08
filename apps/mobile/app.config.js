const baseConfig = require("./app.json");

const variants = {
  dev: {
    name: "Mizyun Dev",
    slug: "mizyun-dev",
    scheme: "mizyun-dev",
    iosBundleIdentifier: "com.mizyun.dev",
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

// Cross-profile validation
const effectiveProfile =
  buildProfile ||
  easProfile ||
  (variantName === "production" ? "production" : "development");

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

if (apiUrl) {
  if (
    variantName === "dev" &&
    /mizyun-api\.phiskel\.com(?::|\/|$)/.test(apiUrl)
  ) {
    throw new Error(`Dev variant cannot point to Production API "${apiUrl}".`);
  }
  if (
    variantName === "production" &&
    (/mizyun-api-dev\.phiskel\.com/.test(apiUrl) ||
      /localhost|127\.0\.0\.1|10\.0\.2\.2/.test(apiUrl))
  ) {
    throw new Error(
      `Production variant cannot point to Dev or local API "${apiUrl}".`,
    );
  }
}

if (supabaseUrl) {
  if (
    variantName === "dev" &&
    /mizyun-supabase\.phiskel\.com(?::|\/|$)/.test(supabaseUrl)
  ) {
    throw new Error(
      `Dev variant cannot point to Production Supabase "${supabaseUrl}".`,
    );
  }
  if (
    variantName === "production" &&
    (/mizyun-supabase-dev\.phiskel\.com/.test(supabaseUrl) ||
      /localhost|127\.0\.0\.1|10\.0\.2\.2/.test(supabaseUrl))
  ) {
    throw new Error(
      `Production variant cannot point to Dev or local Supabase "${supabaseUrl}".`,
    );
  }
}

if (authRedirectUri) {
  if (
    variantName === "dev" &&
    authRedirectUri.startsWith("mizyun://") &&
    !authRedirectUri.startsWith("mizyun-dev://")
  ) {
    throw new Error(
      `Dev variant cannot use production redirect scheme "mizyun://". Expected "mizyun-dev://".`,
    );
  }
  if (
    variantName === "production" &&
    authRedirectUri.startsWith("mizyun-dev://")
  ) {
    throw new Error(
      `Production variant cannot use dev redirect scheme "mizyun-dev://". Expected "mizyun://".`,
    );
  }
}

const baseExpo = baseConfig.expo;
const baseIos = baseExpo.ios;
const baseAndroid = baseExpo.android;
const disableIosPushNotifications =
  variantName === "dev" || process.env.MIZYUN_IOS_DISABLE_PUSH === "1";
const plugins = disableIosPushNotifications
  ? [
      ...baseExpo.plugins.filter((plugin) => {
        const pluginName = Array.isArray(plugin) ? plugin[0] : plugin;
        return pluginName !== "expo-notifications";
      }),
      "./plugins/without-ios-push-notifications",
    ]
  : baseExpo.plugins;

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
    },
    ios: {
      ...baseIos,
      bundleIdentifier: variant.iosBundleIdentifier,
    },
    android: {
      ...baseAndroid,
      package: variant.androidPackage,
    },
    plugins,
  },
};
