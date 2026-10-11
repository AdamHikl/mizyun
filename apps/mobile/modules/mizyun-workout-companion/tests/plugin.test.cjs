const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { spawnSync } = require("node:child_process");
const plugin = require("../../../plugins/with-workout-companion.js");
const xcodePath = require.resolve("xcode", {
  paths: [require.resolve("expo/config-plugins")],
});
const xcode = require(xcodePath);
const root = path.resolve(__dirname, "../../../../..");

test("Dev target has actual Swift sources, watch SDK and embedding; idempotent", () => {
  const input = fs.readFileSync(
    path.join(
      root,
      "apps/watch-ios/MizyunWorkoutWatchDev.xcodeproj/project.pbxproj",
    ),
    "utf8",
  );
  const project = xcode.project("unused.pbxproj");
  project.parseSync = () => {};
  const parser = require(
    path.join(path.dirname(xcodePath), "lib/parser/pbxproj.js"),
  );
  project.hash = parser.parse(input);
  project.getFirstTarget().firstTarget.name = '"MizyunDev"';
  const id = plugin.installWatchTarget(project, "1.0.9", "9");
  assert.equal(plugin.installWatchTarget(project, "1.0.9", "9"), id);
  assert.equal(plugin.installWatchTarget(project, "1.0.10", "10"), id);
  const objects = project.hash.project.objects;
  const target = objects.PBXNativeTarget[id];
  const phone = project.getFirstTarget().firstTarget;
  const watchDependencies = phone.dependencies.filter(
    (dependency) =>
      objects.PBXTargetDependency?.[dependency.value]?.target === id,
  );
  assert.equal(
    watchDependencies.length,
    1,
    "the phone must build its embedded watch product",
  );
  const watchDependency =
    objects.PBXTargetDependency[watchDependencies[0].value];
  assert.equal(
    objects.PBXContainerItemProxy[watchDependency.targetProxy]
      .remoteGlobalIDString,
    id,
  );
  const configurations =
    objects.XCConfigurationList[target.buildConfigurationList]
      .buildConfigurations;
  for (const config of configurations) {
    const settings = objects.XCBuildConfiguration[config.value].buildSettings;
    assert.equal(settings.SDKROOT, "watchos");
    assert.equal(
      settings.PRODUCT_BUNDLE_IDENTIFIER,
      '"com.mizyun.development.watchkitapp"',
    );
    assert.equal(settings.CURRENT_PROJECT_VERSION, '"10"');
  }
  const sources = target.buildPhases
    .map((phase) => objects.PBXSourcesBuildPhase[phase.value])
    .find(Boolean);
  assert.equal(sources.files.length, 2);
  const embed = Object.entries(objects.PBXCopyFilesBuildPhase).find(
    ([key, phase]) =>
      !key.endsWith("_comment") && phase.name === '"Embed Watch Content"',
  );
  assert.ok(embed);
  assert.equal(embed[1].dstPath, '"$(CONTENTS_FOLDER_PATH)/Watch"');
  assert.equal(embed[1].files.length, 1);
  const group = Object.values(objects.PBXGroup).find(
    (value) => value.name === plugin.watchTargetName,
  );
  assert.equal(group.path, '""');
  const output = project.writeSync();
  const reread = parser.parse(output);
  assert.ok(reread.project.objects.PBXNativeTarget[id]);
});

test("repairs an existing embed-only watch target without changing widget dependencies", () => {
  const project = xcode.project("unused.pbxproj");
  const parser = require(
    path.join(path.dirname(xcodePath), "lib/parser/pbxproj.js"),
  );
  project.hash = parser.parse(
    fs.readFileSync(
      path.join(
        root,
        "apps/watch-ios/MizyunWorkoutWatchDev.xcodeproj/project.pbxproj",
      ),
      "utf8",
    ),
  );
  const phone = project.getFirstTarget();
  phone.firstTarget.name = '"MizyunDev"';
  const watchId = plugin.installWatchTarget(project, "1.0.10", "10");
  const objects = project.hash.project.objects;
  // Reproduce the failed graph: an embedded watch product exists, while
  // only the subsequently generated widget has a build dependency.
  objects.PBXTargetDependency ??= {};
  objects.PBXContainerItemProxy ??= {};
  const widget = project.addTarget("SyntheticWidgets", "app_extension");
  phone.firstTarget.dependencies = phone.firstTarget.dependencies.filter(
    (dependency) => {
      const record = objects.PBXTargetDependency[dependency.value];
      if (record?.target !== watchId) return true;
      delete objects.PBXContainerItemProxy[record.targetProxy];
      delete objects.PBXContainerItemProxy[`${record.targetProxy}_comment`];
      delete objects.PBXTargetDependency[dependency.value];
      delete objects.PBXTargetDependency[`${dependency.value}_comment`];
      return false;
    },
  );
  const widgetEdge = phone.firstTarget.dependencies.find(
    (dependency) =>
      objects.PBXTargetDependency[dependency.value].target === widget.uuid,
  );
  assert.ok(widgetEdge);
  const originalWidgetRecord = structuredClone(
    objects.PBXTargetDependency[widgetEdge.value],
  );
  assert.equal(plugin.installWatchTarget(project, "1.0.10", "10"), watchId);
  assert.equal(plugin.installWatchTarget(project, "1.0.10", "10"), watchId);
  assert.deepEqual(
    objects.PBXTargetDependency[widgetEdge.value],
    originalWidgetRecord,
  );
  const dependencies = phone.firstTarget.dependencies.map(
    (dependency) => objects.PBXTargetDependency[dependency.value].target,
  );
  assert.deepEqual(dependencies.sort(), [watchId, widget.uuid].sort());
  const reread = parser.parse(project.writeSync()).project.objects;
  assert.deepEqual(
    reread.PBXNativeTarget[phone.uuid].dependencies
      .map((dependency) => reread.PBXTargetDependency[dependency.value].target)
      .sort(),
    [watchId, widget.uuid].sort(),
  );
});

test("Production plugin is rejected before generating a target", () => {
  assert.throws(
    () =>
      plugin({
        ios: { bundleIdentifier: "com.mizyun.app" },
        android: { package: "com.mizyun.app" },
      }),
    /Dev-only/,
  );
});

test("Build tooling rejects actual Production environment selections", () => {
  for (const vars of [
    { MIZYUN_APP_VARIANT: "production" },
    { MIZYUN_BUILD_PROFILE: "production" },
    { MIZYUN_BUILD_PROFILE: "preview" },
  ]) {
    const result = spawnSync(
      "bash",
      [path.join(root, "scripts/build-workout-companions.sh"), "invalid"],
      {
        env: {
          ...process.env,
          MIZYUN_APP_VARIANT: "dev",
          MIZYUN_BUILD_PROFILE: "development",
          ...vars,
        },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Production is excluded/);
  }
});
