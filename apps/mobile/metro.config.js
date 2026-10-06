const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// SDK 57's Debug virtual env merges dotenv after the shell snapshot, even when
// CLI dotenv loading is disabled. Founder scripts export their reviewed file
// with EXPO_NO_DOTENV=1; use Expo's serialized public shell environment in that
// case. Normal Debug dotenv/HMR and Release Babel inlining remain unchanged.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (process.env.EXPO_NO_DOTENV === "1" && moduleName === "expo/virtual/env") {
    return {
      type: "sourceFile",
      filePath: require.resolve("./tooling/public-shell-env.js"),
    };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
