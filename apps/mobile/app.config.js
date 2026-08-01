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

const variantName = process.env.MIZYUN_APP_VARIANT ?? "dev";
const variant = variants[variantName];

if (!variant) {
  throw new Error(
    `Unknown MIZYUN_APP_VARIANT "${variantName}". Use "dev" or "production".`,
  );
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
