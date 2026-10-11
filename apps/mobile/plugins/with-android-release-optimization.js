const {
  withAppBuildGradle,
  withGradleProperties,
} = require("expo/config-plugins");

const RELEASE_PROPERTIES = [
  "android.enableMinifyInReleaseBuilds",
  "android.enableShrinkResourcesInReleaseBuilds",
];

// Ignore comment-only template markers while retaining quoted Groovy strings.
// Preserve offsets/newlines so all edits still use the untouched original text.
const withoutComments = (contents) =>
  contents.replace(
    /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g,
    (match, quoted) => quoted ?? match.replace(/[^\r\n]/g, " "),
  );

const uniqueExpectedLine = (contents, assignmentPattern, expectedPattern) => {
  const assignments = [...contents.matchAll(assignmentPattern)];
  return assignments.length === 1 && expectedPattern.test(assignments[0][0]);
};

module.exports = function withAndroidReleaseOptimization(config) {
  config = withGradleProperties(config, (modConfig) => {
    // These properties are consumed only by the template's release build type.
    // Replace stale values and duplicates without changing unrelated properties.
    modConfig.modResults = modConfig.modResults.filter(
      (entry) =>
        entry.type !== "property" || !RELEASE_PROPERTIES.includes(entry.key),
    );
    for (const key of RELEASE_PROPERTIES) {
      modConfig.modResults.push({ type: "property", key, value: "true" });
    }
    return modConfig;
  });

  return withAppBuildGradle(config, (modConfig) => {
    const unsupported = () => {
      throw new Error(
        "Unsupported Android release optimization template. Review the Expo release build type before enabling R8.",
      );
    };
    if (modConfig.modResults.language !== "groovy") unsupported();
    const contents = modConfig.modResults.contents;
    const activeContents = withoutComments(contents);
    const releasePattern =
      /(^    buildTypes \{\r?\n[\s\S]*?^        release \{\r?\n)([\s\S]*?)(^        \}\r?\n    \})/gm;
    const releases = [...activeContents.matchAll(releasePattern)];
    if (releases.length !== 1) unsupported();
    const release = releases[0][2];
    if (
      !uniqueExpectedLine(
        release,
        /^[ \t]*minifyEnabled\b[^\r\n]*$/gm,
        /^[ \t]*minifyEnabled enableMinifyInReleaseBuilds[ \t]*$/,
      ) ||
      !uniqueExpectedLine(
        release,
        /^[ \t]*shrinkResources\b[^\r\n]*$/gm,
        /^[ \t]*shrinkResources enableShrinkResources\.toBoolean\(\)[ \t]*$/,
      ) ||
      !uniqueExpectedLine(
        activeContents,
        /^[ \t]*(?:def[ \t]+)?enableMinifyInReleaseBuilds[ \t]*=[^\r\n]*$/gm,
        /^[ \t]*def enableMinifyInReleaseBuilds = \(findProperty\('android\.enableMinifyInReleaseBuilds'\) \?: false\)\.toBoolean\(\)[ \t]*$/,
      ) ||
      !uniqueExpectedLine(
        activeContents,
        /^[ \t]*(?:def[ \t]+)?enableShrinkResources[ \t]*=[^\r\n]*$/gm,
        /^[ \t]*def enableShrinkResources = findProperty\('android\.enableShrinkResourcesInReleaseBuilds'\) \?: 'false'[ \t]*$/,
      )
    ) {
      unsupported();
    }
    const defaultRulesPattern =
      /getDefaultProguardFile\((["'])proguard-android(?:-optimize)?\.txt\1\)/g;
    if ([...release.matchAll(defaultRulesPattern)].length !== 1) unsupported();
    // Keep every custom/consumer rule. The old default disables optimization.
    const match = releases[0];
    const defaultRule = [...release.matchAll(defaultRulesPattern)][0];
    const replacementStart = match.index + match[1].length + defaultRule.index;
    modConfig.modResults.contents =
      contents.slice(0, replacementStart) +
      'getDefaultProguardFile("proguard-android-optimize.txt")' +
      contents.slice(replacementStart + defaultRule[0].length);
    return modConfig;
  });
};
