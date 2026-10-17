const { withPodfileProperties } = require("expo/config-plugins");

// Expo SDK 57 ships precompiled iOS module frameworks built with Swift 6.3.1,
// which Xcode 27.1 (Swift 6.4) cannot import. The generated Podfile disables
// them when this Podfile property is "false", so Expo modules compile from
// source with the installed toolchain. Remove after upgrading to SDK 58.
module.exports = function withIosSourceBuiltExpoModules(config) {
  return withPodfileProperties(config, (podfileConfig) => {
    podfileConfig.modResults.EXPO_USE_PRECOMPILED_MODULES = "false";
    return podfileConfig;
  });
};
