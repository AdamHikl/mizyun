#!/usr/bin/env node
// Fail closed unless a merged Android manifest declares exactly the Health
// Connect permissions allowed for its variant. Play rejects unused health
// permissions, and the Production set must match the Play declaration text.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const require = createRequire(join(root, "apps/mobile/package.json"));
const {
  HEALTH_PERMISSION_PREFIX,
  allowedHealthPermissions,
} = require("./plugins/health-connect-permissions.js");

export const DEFAULT_MERGED_MANIFEST = join(
  root,
  "apps/mobile/android/app/build/intermediates/merged_manifests/release/processReleaseManifest/AndroidManifest.xml",
);
export const STORE_DISCLOSURES = join(
  root,
  "docs/STORE_LISTING_DISCLOSURES.md",
);

const attribute = (element, name) =>
  new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`).exec(element)?.[1];

// Merged manifests are flat XML, so scan elements after stripping comments.
export const declaredHealthPermissions = (manifestXml) => {
  const xml = manifestXml.replace(/<!--[\s\S]*?-->/g, "");
  const declared = new Set();
  for (const [element] of xml.matchAll(
    /<uses-permission(?:-sdk-23)?\b[^>]*>/g,
  )) {
    const name = attribute(element, "android:name");
    if (!name?.startsWith(HEALTH_PERMISSION_PREFIX)) continue;
    if (attribute(element, "tools:node") === "remove") continue;
    declared.add(name);
  }
  return [...declared].sort();
};

// Play item 6 in the Store disclosures lists the Production permission set.
export const storeDeclaredHealthPermissions = (markdown) => {
  const lines = markdown
    .split(/\r?\n/)
    .filter((line) =>
      /^\d+\. \*\*Health apps declaration and Health Connect permissions:\*\*/.test(
        line,
      ),
    );
  if (lines.length !== 1) {
    throw new Error(
      "Expected one Play 'Health apps declaration and Health Connect permissions' item in the Store disclosures.",
    );
  }
  return [
    ...new Set(
      [...lines[0].matchAll(/\b(?:READ|WRITE)_[A-Z_]+\b/g)].map(
        ([name]) => HEALTH_PERMISSION_PREFIX + name,
      ),
    ),
  ].sort();
};

const difference = (left, right) =>
  left.filter((item) => !right.includes(item));

export const healthPermissionErrors = (manifestXml, variant) => {
  const allowed = [...allowedHealthPermissions(variant)].sort();
  const declared = declaredHealthPermissions(manifestXml);
  const errors = [];
  const extra = difference(declared, allowed);
  const missing = difference(allowed, declared);
  if (extra.length) {
    errors.push(
      `unused Health Connect permissions declared: ${extra.join(", ")}`,
    );
  }
  if (missing.length) {
    errors.push(
      `allowlisted Health Connect permissions missing: ${missing.join(", ")}`,
    );
  }
  return errors;
};

export const storeDeclarationErrors = (markdown) => {
  const allowed = [...allowedHealthPermissions("production")].sort();
  const declared = storeDeclaredHealthPermissions(markdown);
  if (JSON.stringify(declared) === JSON.stringify(allowed)) return [];
  return [
    `Store disclosure lists ${declared.join(", ") || "none"}; Production allowlist is ${allowed.join(", ")}`,
  ];
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [variant, manifestPath = DEFAULT_MERGED_MANIFEST] =
    process.argv.slice(2);
  if (variant !== "dev" && variant !== "production") {
    console.error(
      "Usage: check-android-health-permissions.mjs <dev|production> [merged AndroidManifest.xml]",
    );
    process.exit(2);
  }
  const errors = [
    ...healthPermissionErrors(readFileSync(manifestPath, "utf8"), variant),
    ...(variant === "production"
      ? storeDeclarationErrors(readFileSync(STORE_DISCLOSURES, "utf8"))
      : []),
  ];
  if (errors.length) {
    for (const error of errors) console.error(`ERROR: ${error}`);
    console.error(`Manifest: ${manifestPath}`);
    process.exit(1);
  }
  console.log(
    `✓ ${variant} Health Connect permissions match the allowlist: ${allowedHealthPermissions(variant).join(", ")}`,
  );
}
