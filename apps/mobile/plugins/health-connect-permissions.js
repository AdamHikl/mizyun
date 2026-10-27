// Health Connect permissions each Android variant may declare in its merged
// manifest. Play requires every declared health permission to be used and
// listed in the Health Connect declaration, so Production keeps only the
// permissions reachable from Production JS (Steps and Import runs). Keep the
// Production set equal to docs/STORE_LISTING_DISCLOSURES.md (Play item 6).
const HEALTH_PERMISSION_PREFIX = "android.permission.health.";

const HEALTH_CONNECT_PERMISSIONS = {
  dev: [
    "READ_STEPS",
    "READ_WEIGHT",
    "READ_EXERCISE",
    "READ_DISTANCE",
    "WRITE_NUTRITION",
    "WRITE_EXERCISE",
  ],
  production: ["READ_STEPS", "READ_EXERCISE", "READ_DISTANCE"],
};

const allowedHealthPermissions = (variant) => {
  const allowed = HEALTH_CONNECT_PERMISSIONS[variant];
  if (!allowed) {
    throw new Error(
      `Unknown Health Connect permission variant "${variant}". Use "dev" or "production".`,
    );
  }
  return allowed.map((name) => HEALTH_PERMISSION_PREFIX + name);
};

module.exports = {
  HEALTH_PERMISSION_PREFIX,
  HEALTH_CONNECT_PERMISSIONS,
  allowedHealthPermissions,
};
