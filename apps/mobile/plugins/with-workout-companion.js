const fs = require("node:fs");
const path = require("node:path");
const { withDangerousMod, withXcodeProject } = require("expo/config-plugins");

const TARGET = "MizyunWorkoutWatchDev";
const BUNDLE = "com.mizyun.development.watchkitapp";
const SOURCES = ["CompanionState.swift", "MizyunWatchApp.swift"];

function installWatchTarget(project, version = "0.1.0", build = "1") {
  const objects = project.hash.project.objects;
  const existing = Object.entries(objects.PBXNativeTarget ?? {}).find(
    ([id, target]) =>
      !id.endsWith("_comment") && target.name?.replaceAll('"', "") === TARGET,
  );
  const phoneTarget = project.getFirstTarget();
  // node-xcode silently skips dependencies when these sections are absent.
  // A fresh Expo project may create them only later for its widget target.
  objects.PBXTargetDependency ??= {};
  objects.PBXContainerItemProxy ??= {};
  phoneTarget.firstTarget.dependencies ??= [];
  const target = existing
    ? { uuid: existing[0], pbxNativeTarget: existing[1] }
    : project.addTarget(TARGET, "watch2_app", TARGET, BUNDLE);
  // Repair an already generated embed-only target as well as a clean prebuild.
  if (
    !phoneTarget.firstTarget.dependencies.some(
      (dependency) =>
        objects.PBXTargetDependency[dependency.value]?.target === target.uuid,
    )
  ) {
    project.addTargetDependency(phoneTarget.uuid, [target.uuid]);
  }
  target.pbxNativeTarget.productType = '"com.apple.product-type.application"';
  const list =
    objects.XCConfigurationList[target.pbxNativeTarget.buildConfigurationList];
  const phoneList =
    objects.XCConfigurationList[phoneTarget.firstTarget.buildConfigurationList];
  const phoneSettings =
    objects.XCBuildConfiguration[phoneList.buildConfigurations[0].value]
      .buildSettings;
  for (const item of list.buildConfigurations) {
    const settings = objects.XCBuildConfiguration[item.value].buildSettings;
    Object.assign(settings, {
      INFOPLIST_FILE: `"${TARGET}/Info.plist"`,
      PRODUCT_BUNDLE_IDENTIFIER: `"${BUNDLE}"`,
      SDKROOT: "watchos",
      ALWAYS_SEARCH_USER_PATHS: "NO",
      SUPPORTED_PLATFORMS: '"watchos watchsimulator"',
      WATCHOS_DEPLOYMENT_TARGET: "10.0",
      TARGETED_DEVICE_FAMILY: "4",
      SWIFT_VERSION: "5.9",
      MARKETING_VERSION: `"${version}"`,
      CURRENT_PROJECT_VERSION: `"${build}"`,
      GENERATE_INFOPLIST_FILE: "NO",
      LD_RUNPATH_SEARCH_PATHS: '"$(inherited) @executable_path/Frameworks"',
    });
    // Reuse only the existing phone team's configuration; do not select or create credentials.
    if (phoneSettings.DEVELOPMENT_TEAM)
      settings.DEVELOPMENT_TEAM = phoneSettings.DEVELOPMENT_TEAM;
  }
  if (existing) return target.uuid;
  project.addBuildPhase([], "PBXSourcesBuildPhase", "Sources", target.uuid);
  project.addBuildPhase(
    [],
    "PBXFrameworksBuildPhase",
    "Frameworks",
    target.uuid,
  );
  project.addBuildPhase([], "PBXResourcesBuildPhase", "Resources", target.uuid);
  const group = project.addPbxGroup([], TARGET, '""');
  project.addToPbxGroup(
    group.uuid,
    project.getFirstProject().firstProject.mainGroup,
  );
  for (const source of SOURCES) {
    project.addSourceFile(
      `${TARGET}/Sources/${source}`,
      { target: target.uuid },
      group.uuid,
    );
  }
  return target.uuid;
}

module.exports = function withWorkoutCompanion(config) {
  if (
    config.ios?.bundleIdentifier !== "com.mizyun.development" ||
    config.android?.package !== "com.mizyun.dev"
  ) {
    throw new Error(
      "Workout companion is Dev-only; Production configuration must exclude this plugin.",
    );
  }
  config = withDangerousMod(config, [
    "ios",
    async (modConfig) => {
      const sourceRoot = path.resolve(
        modConfig.modRequest.projectRoot,
        "../watch-ios",
      );
      const destination = path.join(
        modConfig.modRequest.platformProjectRoot,
        TARGET,
      );
      fs.mkdirSync(path.join(destination, "Sources"), { recursive: true });
      for (const file of SOURCES)
        fs.copyFileSync(
          path.join(sourceRoot, "Sources", file),
          path.join(destination, "Sources", file),
        );
      fs.copyFileSync(
        path.join(sourceRoot, "Info.plist"),
        path.join(destination, "Info.plist"),
      );
      return modConfig;
    },
  ]);
  return withXcodeProject(config, (modConfig) => {
    installWatchTarget(
      modConfig.modResults,
      modConfig.version,
      modConfig.ios.buildNumber,
    );
    return modConfig;
  });
};
module.exports.installWatchTarget = installWatchTarget;
module.exports.watchTargetName = TARGET;
