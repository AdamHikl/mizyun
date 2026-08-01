const { withEntitlementsPlist } = require("expo/config-plugins");

module.exports = function withoutIosPushNotifications(config) {
  return withEntitlementsPlist(config, (entitlementsConfig) => {
    delete entitlementsConfig.modResults["aps-environment"];
    return entitlementsConfig;
  });
};
