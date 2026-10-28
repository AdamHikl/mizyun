const { AndroidConfig } = require("expo/config-plugins");
const {
  HEALTH_CONNECT_PERMISSIONS,
  HEALTH_PERMISSION_PREFIX,
  allowedHealthPermissions,
} = require("./health-connect-permissions");

// The local health modules are autolinked into every variant, so their library
// manifests merge every Health Connect permission into each build. Emit
// tools:node="remove" for any permission the variant does not use. The Dev set
// lists every permission the modules declare, so Dev is left unchanged.
module.exports = function withAndroidHealthPermissions(config, { variant }) {
  const allowed = new Set(allowedHealthPermissions(variant));
  const blocked = HEALTH_CONNECT_PERMISSIONS.dev
    .map((name) => HEALTH_PERMISSION_PREFIX + name)
    .filter((permission) => !allowed.has(permission));
  if (blocked.length === 0) return config;
  return AndroidConfig.Permissions.withBlockedPermissions(config, blocked);
};
