#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const require = createRequire(join(root, "apps/mobile/package.json"));
const withWindowSupport = require("./plugins/with-android-window-support.js");
const { AndroidConfig } = require("expo/config-plugins");
const expoRequire = createRequire(require.resolve("expo/config-plugins"));
const { parseStringPromise } = expoRequire("xml2js");
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
const runMod = async (mod, modResults) => {
  const config = withWindowSupport({
    name: "Android window fixture",
    slug: "fixture",
    orientation: "portrait",
    ios: { supportsTablet: false },
  });
  assert.equal(config.orientation, "portrait");
  assert.deepEqual(config.ios, { supportsTablet: false });
  assert.deepEqual(Object.keys(config.mods), ["android"]);
  assert.deepEqual(Object.keys(config.mods.android).sort(), [
    "appBuildGradle",
    "gradleProperties",
    "manifest",
  ]);
  return (
    await config.mods.android[mod]({
      modResults: structuredClone(modResults),
      modRequest: { nextMod: async (value) => value },
    })
  ).modResults;
};
const baselineManifest = await parseStringPromise(
  readTemplate("app/src/main/AndroidManifest.xml"),
);
const main = AndroidConfig.Manifest.getMainActivityOrThrow(baselineManifest);
// Apply Expo's actual orientation transform to reproduce root portrait config.
const {
  AndroidConfig: { Orientation },
} = require("expo/config-plugins");
Orientation.setAndroidOrientation(
  { orientation: "portrait" },
  baselineManifest,
);
assert.equal(main.$["android:screenOrientation"], "portrait");
main.$["android:resizeableActivity"] = "false";
main.$["android:configChanges"] =
  "keyboard|keyboardHidden|orientation|screenSize";
baselineManifest.manifest.application[0].activity.push({
  $: {
    "android:name": ".OtherActivity",
    "android:screenOrientation": "landscape",
    "android:resizeableActivity": "false",
  },
});
const expectedManifest = structuredClone(baselineManifest);
const expectedMain =
  AndroidConfig.Manifest.getMainActivityOrThrow(expectedManifest);
delete expectedMain.$["android:screenOrientation"];
expectedMain.$["android:resizeableActivity"] = "true";
const migratedManifest = await runMod("manifest", baselineManifest);
assert.deepEqual(
  migratedManifest,
  expectedManifest,
  "Only main activity orientation/resizing may change",
);
assert.deepEqual(await runMod("manifest", migratedManifest), migratedManifest);
await assert.rejects(
  runMod("manifest", { manifest: { application: [{ activity: [] }] } }),
  /MainActivity/,
);

const baselineProperties = AndroidConfig.Properties.parsePropertiesFile(
  readTemplate("gradle.properties"),
);
assert.deepEqual(
  baselineProperties.filter((entry) => entry.key === "edgeToEdgeEnabled"),
  [{ type: "property", key: "edgeToEdgeEnabled", value: "true" }],
);
const expectedProperties = [
  ...baselineProperties.filter((entry) => entry.key !== "edgeToEdgeEnabled"),
  { type: "property", key: "edgeToEdgeEnabled", value: "true" },
];
const migratedProperties = await runMod("gradleProperties", baselineProperties);
assert.deepEqual(migratedProperties, expectedProperties);
assert.deepEqual(
  await runMod("gradleProperties", migratedProperties),
  migratedProperties,
);
assert.deepEqual(
  await runMod("gradleProperties", [
    ...baselineProperties,
    { type: "property", key: "edgeToEdgeEnabled", value: "false" },
    { type: "property", key: "edgeToEdgeEnabled", value: "false" },
  ]),
  expectedProperties,
);
// Verify the actual installed native consumer, beyond a property-only fixture.
const reactRequire = createRequire(
  require.resolve("react-native/package.json"),
);
const gradlePluginRoot = dirname(
  reactRequire.resolve("@react-native/gradle-plugin/package.json"),
);
const nativeUtils = join(
  gradlePluginRoot,
  "react-native-gradle-plugin/src/main/kotlin/com/facebook/react",
);
assert.match(
  readFileSync(join(nativeUtils, "utils/PropertyUtils.kt"), "utf8"),
  /EDGE_TO_EDGE_ENABLED = "edgeToEdgeEnabled"/,
);
assert.match(
  readFileSync(join(nativeUtils, "utils/ProjectUtils.kt"), "utf8"),
  /Project\.isEdgeToEdgeEnabled[\s\S]*?project\.property\(EDGE_TO_EDGE_ENABLED\)\.toString\(\)\.toBoolean\(\)/,
);
assert.match(
  readFileSync(join(nativeUtils, "tasks/GenerateEntryPointTask.kt"), "utf8"),
  /BuildConfig\.IS_EDGE_TO_EDGE_ENABLED\) \{\s*WindowUtilKt\.setEdgeToEdgeFeatureFlagOn\(\)/,
);

const baselineGradle = readTemplate("app/build.gradle");
assert.doesNotMatch(baselineGradle, /com\.google\.android\.material:material/);
const migrate = (contents, language = "groovy") =>
  runMod("appBuildGradle", { contents, language });
const migrated = (await migrate(baselineGradle)).contents;
assert.match(
  migrated,
  /implementation\("com\.google\.android\.material:material"\)/,
);
assert.match(migrated, /version \{ strictly\("1\.14\.0"\) \}/);
const addedBlock = migrated.slice(
  migrated.indexOf("    // @mizyun/android-window-support:begin"),
  migrated.indexOf("    // @mizyun/android-window-support:end") +
    "    // @mizyun/android-window-support:end".length +
    1,
);
assert.equal(
  migrated.replace(addedBlock, ""),
  baselineGradle,
  "Only the dependency constraint may change",
);
assert.equal((await migrate(migrated)).contents, migrated);
assert.equal(
  (await migrate(baselineGradle.replaceAll("\n", "\r\n"))).contents,
  migrated.replaceAll("\n", "\r\n"),
);
const commented =
  baselineGradle +
  '\n// dependencies {\n// implementation("com.google.android.material:material:0.1")\n';
assert.equal(
  (await migrate(commented)).contents,
  migrated + commented.slice(baselineGradle.length),
);
for (const input of [
  baselineGradle.replace("dependencies {", "otherDependencies {"),
  baselineGradle.replace(
    'implementation("com.facebook.react:react-android")',
    'implementation("unknown:template")',
  ),
  baselineGradle + baselineGradle,
  baselineGradle.replace(
    "dependencies {",
    'dependencies {\n    implementation("com.google.android.material:material:1.13.0")',
  ),
  migrated.replace('strictly("1.14.0")', 'strictly("1.13.0")'),
  migrated.replace("@mizyun/android-window-support:end", "unrecognized:end"),
  baselineGradle.replace(
    '    implementation("com.facebook.react:react-android")',
    '}\n    implementation("com.facebook.react:react-android")',
  ),
]) {
  await assert.rejects(
    migrate(input),
    /Unsupported Android window support template/,
  );
}
await assert.rejects(
  migrate(baselineGradle, "kotlin"),
  /Unsupported Android window support template/,
);
console.log(
  "Android window support: installed Expo manifest/Gradle fixtures, Android-only unrestricted main activity, resizing, preserved unrelated content, Material 1.14.0 constraint, idempotence and unsupported templates PASS",
);
