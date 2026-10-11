const {
  AndroidConfig,
  withAndroidManifest,
  withAppBuildGradle,
  withGradleProperties,
} = require("expo/config-plugins");

const START = "    // @mizyun/android-window-support:begin";
const END = "    // @mizyun/android-window-support:end";
const MATERIAL_CONSTRAINT = [
  START,
  "    constraints {",
  '        implementation("com.google.android.material:material") {',
  '            version { strictly("1.14.0") }',
  '            because("Preserve legacy system bars while using API 35 edge-to-edge guards")',
  "        }",
  "    }",
  END,
];

// Retain offsets so validation ignores commented template examples without
// rewriting any unrelated Groovy content or quoted dependency coordinates.
const withoutComments = (contents) =>
  contents.replace(
    /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g,
    (match, quoted) => quoted ?? match.replace(/[^\r\n]/g, " "),
  );

const unsupported = () => {
  throw new Error(
    "Unsupported Android window support template. Review the Expo app dependencies before applying the Material migration.",
  );
};

module.exports = function withAndroidWindowSupport(config) {
  config = withGradleProperties(config, (modConfig) => {
    modConfig.modResults = modConfig.modResults.filter(
      (entry) => entry.type !== "property" || entry.key !== "edgeToEdgeEnabled",
    );
    modConfig.modResults.push({
      type: "property",
      key: "edgeToEdgeEnabled",
      value: "true",
    });
    return modConfig;
  });
  config = withAndroidManifest(config, (modConfig) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(
      modConfig.modResults,
    );
    delete activity.$["android:screenOrientation"];
    activity.$["android:resizeableActivity"] = "true";
    return modConfig;
  });

  return withAppBuildGradle(config, (modConfig) => {
    if (modConfig.modResults.language !== "groovy") unsupported();
    let contents = modConfig.modResults.contents;
    const newline = contents.includes("\r\n") ? "\r\n" : "\n";
    const block = MATERIAL_CONSTRAINT.join(newline) + newline;
    const startCount = contents.split(START).length - 1;
    const endCount = contents.split(END).length - 1;
    if (startCount || endCount) {
      // An edited/stale constraint must be reviewed instead of overwritten.
      if (startCount !== 1 || endCount !== 1 || !contents.includes(block)) {
        unsupported();
      }
      contents = contents.replace(block, "");
    }

    const active = withoutComments(contents);
    const openings = [...active.matchAll(/^dependencies \{\r?\n/gm)];
    const anchors = [
      ...active.matchAll(
        /^    implementation\("com\.facebook\.react:react-android"\)[ \t]*\r?$/gm,
      ),
    ];
    if (
      openings.length !== 1 ||
      anchors.length !== 1 ||
      anchors[0].index < openings[0].index ||
      active.includes("com.google.android.material:material")
    ) {
      unsupported();
    }
    const insertion = openings[0].index + openings[0][0].length;
    // Validate the RN anchor belongs to this block, ignoring braces in strings.
    const tokens =
      active
        .slice(insertion)
        .match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[{}]/g) ?? [];
    let depth = 1;
    let closingOffset = insertion;
    for (const token of tokens) {
      const offset = active.indexOf(token, closingOffset);
      closingOffset = offset + token.length;
      if (token === "{") depth += 1;
      if (token === "}") depth -= 1;
      if (depth === 0) break;
    }
    if (depth !== 0 || anchors[0].index >= closingOffset) unsupported();
    modConfig.modResults.contents =
      contents.slice(0, insertion) + block + contents.slice(insertion);
    return modConfig;
  });
};
