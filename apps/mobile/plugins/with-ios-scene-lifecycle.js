const { withAppDelegate, withInfoPlist } = require("expo/config-plugins");

const sceneManifest = {
  UIApplicationSupportsMultipleScenes: false,
  UISceneConfigurations: {
    UIWindowSceneSessionRoleApplication: [
      {
        UISceneConfigurationName: "Default Configuration",
        UISceneDelegateClassName: "EXExpoAppSceneDelegate",
      },
    ],
  },
};

module.exports = function withIosSceneLifecycle(config) {
  config = withInfoPlist(config, (infoConfig) => {
    infoConfig.modResults.UIApplicationSceneManifest = sceneManifest;
    return infoConfig;
  });

  return withAppDelegate(config, (appDelegateConfig) => {
    if (appDelegateConfig.modResults.language !== "swift") {
      throw new Error(
        "The iOS scene lifecycle plugin requires a Swift AppDelegate.",
      );
    }

    let contents = appDelegateConfig.modResults.contents;
    const legacyClass = "class AppDelegate: ExpoAppDelegate {";
    const sceneClass =
      "class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {";

    if (contents.includes(legacyClass)) {
      contents = contents.replace(legacyClass, sceneClass);
    } else if (!contents.includes(sceneClass)) {
      throw new Error(
        "Could not add ExpoReactNativeFactoryProvider to AppDelegate.",
      );
    }

    const legacyWindowStartup = `#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

`;

    if (contents.includes(legacyWindowStartup)) {
      contents = contents.replace(legacyWindowStartup, "");
    } else if (contents.includes("factory.startReactNative(")) {
      throw new Error(
        "Could not move React Native startup to ExpoAppSceneDelegate.",
      );
    }

    appDelegateConfig.modResults.contents = contents;
    return appDelegateConfig;
  });
};
