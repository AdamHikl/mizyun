const { withAppBuildGradle } = require("expo/config-plugins");

const RELEASE_SIGNING_CONFIG = `        release {
            def keystorePath = System.getenv("MIZYUN_RELEASE_KEYSTORE") ?: findProperty('MIZYUN_RELEASE_KEYSTORE')
            if (keystorePath && file(keystorePath).exists()) {
                storeFile file(keystorePath)
                storePassword System.getenv("MIZYUN_RELEASE_STORE_PASSWORD") ?: findProperty('MIZYUN_RELEASE_STORE_PASSWORD')
                keyAlias System.getenv("MIZYUN_RELEASE_KEY_ALIAS") ?: findProperty('MIZYUN_RELEASE_KEY_ALIAS')
                keyPassword System.getenv("MIZYUN_RELEASE_KEY_PASSWORD") ?: findProperty('MIZYUN_RELEASE_KEY_PASSWORD')
            } else {
                def allowDebug = (System.getenv("MIZYUN_ALLOW_DEBUG_KEYSTORE_IN_RELEASE") ?: findProperty('MIZYUN_ALLOW_DEBUG_KEYSTORE_IN_RELEASE') ?: "false").toBoolean()
                if (allowDebug) {
                    storeFile file('debug.keystore')
                    storePassword 'android'
                    keyAlias 'androiddebugkey'
                    keyPassword 'android'
                } else {
                    throw new GradleException("Production release build requires a valid release keystore via MIZYUN_RELEASE_KEYSTORE, or set MIZYUN_ALLOW_DEBUG_KEYSTORE_IN_RELEASE=true for local testing.")
                }
            }
        }`;

module.exports = function withAndroidReleaseSigning(config) {
  return withAppBuildGradle(config, (modConfig) => {
    let contents = modConfig.modResults.contents;
    if (!contents.includes("MIZYUN_RELEASE_KEYSTORE")) {
      contents = contents.replace(
        /(signingConfigs\s*\{[\s\S]*?debug\s*\{[\s\S]*?\})/,
        `$1\n${RELEASE_SIGNING_CONFIG}`,
      );
    }
    if (
      contents.includes("release {") &&
      !contents.includes("signingConfig signingConfigs.release")
    ) {
      contents = contents.replace(
        /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/,
        `$1signingConfig signingConfigs.release`,
      );
    }
    modConfig.modResults.contents = contents;
    return modConfig;
  });
};
