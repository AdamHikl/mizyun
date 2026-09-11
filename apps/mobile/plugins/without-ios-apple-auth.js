const { withEntitlementsPlist } = require("expo/config-plugins");

module.exports = function withoutIosAppleAuth(config) {
  return withEntitlementsPlist(config, (entitlementsConfig) => {
    delete entitlementsConfig.modResults["com.apple.developer.applesignin"];
    return entitlementsConfig;
  });
};
