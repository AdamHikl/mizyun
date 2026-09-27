const { withAndroidManifest } = require("expo/config-plugins");

const PROMOTED_PERMISSION = "android.permission.POST_PROMOTED_NOTIFICATIONS";

module.exports = function withAndroidWorkoutLiveUpdate(config) {
  return withAndroidManifest(config, (modConfig) => {
    const manifest = modConfig.modResults.manifest;
    manifest["uses-permission"] ??= [];
    if (
      !manifest["uses-permission"].some(
        (permission) => permission.$["android:name"] === PROMOTED_PERMISSION,
      )
    ) {
      manifest["uses-permission"].push({
        $: { "android:name": PROMOTED_PERMISSION },
      });
    }
    return modConfig;
  });
};
