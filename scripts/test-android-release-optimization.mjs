#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const require = createRequire(join(repositoryRoot, "apps/mobile/package.json"));
const withOptimization = require("./plugins/with-android-release-optimization.js");
const withSigning = require("./plugins/with-android-release-signing.js");
const { AndroidConfig } = require("expo/config-plugins");
const template = join(
  dirname(require.resolve("expo/package.json")),
  "template.tgz",
);
const readTemplate = (path) => {
  const result = spawnSync(
    "tar",
    ["-xOzf", template, `package/android/${path}`],
    {
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};
const baseline = readTemplate("app/build.gradle");
const baselineProperties = AndroidConfig.Properties.parsePropertiesFile(
  readTemplate("gradle.properties"),
);
const keys = [
  "android.enableMinifyInReleaseBuilds",
  "android.enableShrinkResourcesInReleaseBuilds",
];

const runMod = async (plugin, mod, modResults) => {
  const config = plugin({
    name: "Release optimization fixture",
    slug: "fixture",
  });
  return (
    await config.mods.android[mod]({
      modResults: structuredClone(modResults),
      modRequest: { nextMod: async (value) => value },
    })
  ).modResults;
};
const optimize = (contents, language = "groovy") =>
  runMod(withOptimization, "appBuildGradle", { contents, language });
const properties = (entries) =>
  runMod(withOptimization, "gradleProperties", entries);

// The unmodified installed SDK template reproduces the release configuration
// behind Play's warning: both properties are absent and the default disables
// optimization. These checks make SDK template changes visible to this gate.
assert.match(baseline, /android\.enableMinifyInReleaseBuilds'\) \?: false/);
assert.match(
  baseline,
  /android\.enableShrinkResourcesInReleaseBuilds'\) \?: 'false'/,
);
assert.match(baseline, /getDefaultProguardFile\("proguard-android\.txt"\)/);
assert.equal(
  baselineProperties.some((entry) => keys.includes(entry.key)),
  false,
);

const output = await optimize(baseline);
assert.match(
  output.contents,
  /getDefaultProguardFile\("proguard-android-optimize\.txt"\)/,
);
assert.equal(
  output.contents,
  baseline.replace(
    'getDefaultProguardFile("proguard-android.txt")',
    'getDefaultProguardFile("proguard-android-optimize.txt")',
  ),
  "Only the release default ProGuard file should change; debug/signing/consumer rules must remain intact",
);
assert.equal((await optimize(output.contents)).contents, output.contents);
assert.deepEqual(
  Object.keys(
    withOptimization({ name: "fixture", slug: "fixture" }).mods.android,
  ).sort(),
  ["appBuildGradle", "gradleProperties"],
  "Optimization must not register a mod that edits custom/consumer ProGuard rules",
);

const optimizedProperties = await properties(baselineProperties);
for (const key of keys) {
  assert.deepEqual(
    optimizedProperties.filter((entry) => entry.key === key),
    [{ type: "property", key, value: "true" }],
  );
}
assert.deepEqual(await properties(optimizedProperties), optimizedProperties);
assert.deepEqual(
  optimizedProperties.filter((entry) => !keys.includes(entry.key)),
  baselineProperties,
);
assert.deepEqual(
  await properties([
    ...baselineProperties,
    ...keys.flatMap((key) => [
      { type: "property", key, value: "false" },
      { type: "property", key, value: "false" },
    ]),
  ]),
  optimizedProperties,
);

const signed = await runMod(withSigning, "appBuildGradle", {
  contents: baseline,
  language: "groovy",
});
const signedOptimized = await optimize(signed.contents);
assert.equal(
  signedOptimized.contents,
  signed.contents.replace(
    'getDefaultProguardFile("proguard-android.txt")',
    'getDefaultProguardFile("proguard-android-optimize.txt")',
  ),
);
assert.equal(
  (await runMod(withSigning, "appBuildGradle", output)).contents,
  signedOptimized.contents,
  "Signing and optimization must compose in either order",
);

const custom = baseline.replace(
  '"proguard-rules.pro"',
  '"proguard-rules.pro", "additional-keep-rules.pro"',
);
assert.match(
  (await optimize(custom)).contents,
  /"proguard-rules\.pro", "additional-keep-rules\.pro"/,
);
assert.equal(
  (await optimize(baseline.replaceAll("\n", "\r\n"))).contents,
  output.contents.replaceAll("\n", "\r\n"),
);
for (const unsupported of [
  baseline.replace(
    "minifyEnabled enableMinifyInReleaseBuilds",
    "minifyEnabled false",
  ),
  baseline.replace(
    "shrinkResources enableShrinkResources.toBoolean()",
    "shrinkResources false",
  ),
  baseline.replace(
    "minifyEnabled enableMinifyInReleaseBuilds",
    "minifyEnabled enableMinifyInReleaseBuilds\n            minifyEnabled false",
  ),
  baseline.replace(
    "shrinkResources enableShrinkResources.toBoolean()",
    "shrinkResources enableShrinkResources.toBoolean()\n            shrinkResources false",
  ),
  baseline.replace(
    "def enableMinifyInReleaseBuilds = (findProperty('android.enableMinifyInReleaseBuilds') ?: false).toBoolean()",
    "// findProperty('android.enableMinifyInReleaseBuilds')\ndef enableMinifyInReleaseBuilds = false",
  ),
  baseline.replace(
    "def enableShrinkResources = findProperty('android.enableShrinkResourcesInReleaseBuilds') ?: 'false'",
    "// findProperty('android.enableShrinkResourcesInReleaseBuilds')\n            def enableShrinkResources = 'false'",
  ),
  baseline.replace(
    "def enableMinifyInReleaseBuilds = (findProperty('android.enableMinifyInReleaseBuilds') ?: false).toBoolean()",
    "/* def enableMinifyInReleaseBuilds = (findProperty('android.enableMinifyInReleaseBuilds') ?: false).toBoolean() */\ndef enableMinifyInReleaseBuilds = false",
  ),
  baseline.replace(
    "minifyEnabled enableMinifyInReleaseBuilds",
    "enableMinifyInReleaseBuilds = false\n            minifyEnabled enableMinifyInReleaseBuilds",
  ),
  baseline.replace(
    "shrinkResources enableShrinkResources.toBoolean()",
    "enableShrinkResources = 'false'\n            shrinkResources enableShrinkResources.toBoolean()",
  ),
  baseline.replace("proguard-android.txt", "unknown-default.txt"),
  baseline.replace("        release {", "        customRelease {"),
  baseline + baseline,
]) {
  await assert.rejects(
    optimize(unsupported),
    /Unsupported Android release optimization template/,
  );
}
await assert.rejects(
  optimize(baseline, "kotlin"),
  /Unsupported Android release optimization template/,
);
console.log(
  "Android release optimization: installed Expo template, release-only changes, properties, idempotence, signing composition, preserved custom rules and unsupported templates PASS",
);
