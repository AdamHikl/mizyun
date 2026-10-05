#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
production_env="$repo_root/apps/mobile/.env.production"
export_options="$repo_root/scripts/ios-export-options-production.plist"
apple_team_id="${MIZYUN_APPLE_TEAM_ID:-LQJNDVBL43}"
requested_sha=""
requested_build_number=""

usage() {
  cat <<'EOF'
Build and verify a fresh Production IPA from an exact pushed Git commit.

Usage:
  pnpm mobile:founder-production:ios:ipa --sha <full-sha> --build-number <number>

Example:
  pnpm mobile:founder-production:ios:ipa --sha 8e3853d87f8ac092af552fb3d49063d31caa63a3 --build-number 2

The command builds in a disposable detached worktree, runs a clean native
prebuild and pnpm check, creates a new archive, exports it for App Store Connect,
and verifies the IPA identity, signing, entitlements, endpoints, and checksum.

Output:
  apps/mobile/dist/releases/ios/app-store/packages/<version>-<build>-<sha>-<timestamp>/

This creates an IPA. It does not upload it or deploy the backend.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --sha)
      if [[ -n "$requested_sha" || $# -lt 2 ]]; then
        echo "--sha must be provided exactly once with a value." >&2
        exit 2
      fi
      requested_sha="$2"
      shift 2
      ;;
    --build-number)
      if [[ -n "$requested_build_number" || $# -lt 2 ]]; then
        echo "--build-number must be provided exactly once with a value." >&2
        exit 2
      fi
      requested_build_number="$2"
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ ! "$requested_sha" =~ ^[0-9a-fA-F]{40}$ ]]; then
  echo "--sha must be a full 40-character Git commit SHA." >&2
  exit 2
fi
if [[ ! "$requested_build_number" =~ ^[1-9][0-9]*$ ]]; then
  echo "--build-number must be a positive integer." >&2
  exit 2
fi

for required_command in diff git pnpm xcodebuild plutil codesign unzip shasum strings rg node; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    echo "Required command is unavailable: $required_command" >&2
    exit 2
  fi
done

if [[ ! -r "$production_env" ]]; then
  echo "Cannot read $production_env." >&2
  exit 2
fi
if [[ ! -r "$export_options" ]]; then
  echo "Cannot read $export_options." >&2
  exit 2
fi
if ! plutil -lint "$export_options" >/dev/null; then
  echo "Invalid App Store export options: $export_options" >&2
  exit 2
fi

source_sha="$(git -C "$repo_root" rev-parse --verify "${requested_sha}^{commit}")"
short_sha="$(git -C "$repo_root" rev-parse --short=8 "$source_sha")"
if ! git -C "$repo_root" show-ref --verify --quiet refs/remotes/origin/main; then
  echo "origin/main is unavailable. Fetch it before creating a release artifact." >&2
  exit 2
fi
if ! git -C "$repo_root" merge-base --is-ancestor "$source_sha" origin/main; then
  echo "Refusing to build $source_sha because it is not contained in origin/main." >&2
  exit 2
fi

for release_tool in scripts/build-production-ios-ipa.sh scripts/ios-export-options-production.plist; do
  if ! git -C "$repo_root" cat-file -e "$source_sha:$release_tool" 2>/dev/null; then
    echo "Release tool is not committed in candidate $source_sha: $release_tool" >&2
    exit 2
  fi
  if ! git -C "$repo_root" diff --quiet "$source_sha" -- "$release_tool"; then
    echo "Release tool differs from candidate $source_sha: $release_tool" >&2
    exit 2
  fi
done

expected_export_values=(
  "method:app-store-connect"
  "destination:export"
  "teamID:$apple_team_id"
  "signingStyle:automatic"
  "manageAppVersionAndBuildNumber:false"
)
for expected_export_value in "${expected_export_values[@]}"; do
  export_key="${expected_export_value%%:*}"
  expected_value="${expected_export_value#*:}"
  actual_value="$(plutil -extract "$export_key" raw "$export_options")"
  if [[ "$actual_value" != "$expected_value" ]]; then
    echo "Unexpected export option $export_key=$actual_value (expected $expected_value)." >&2
    exit 2
  fi
done

build_root="$(mktemp -d "${TMPDIR:-/tmp}/mizyun-ios-ipa.XXXXXX")"
worktree_dir="$build_root/repo"
archive_path="$build_root/Mizyun-${short_sha}.xcarchive"
export_path="$build_root/export"
verify_path="$build_root/verify"
build_log="$build_root/xcodebuild.log"
worktree_added=0
build_succeeded=0
publication_staging_dir=""
archive_staging_path=""

cleanup() {
  if [[ -f "$worktree_dir/apps/mobile/.env.production" ]]; then
    rm -f "$worktree_dir/apps/mobile/.env.production"
  fi
  if [[ "$worktree_added" == "1" ]]; then
    git -C "$repo_root" worktree remove --force "$worktree_dir" >/dev/null 2>&1 || true
  fi
  if [[ -d "$worktree_dir" ]]; then
    echo "WARNING: Disposable worktree cleanup was incomplete: $worktree_dir" >&2
  fi
  if [[ -n "$publication_staging_dir" && -d "$publication_staging_dir" ]]; then
    rm -rf "$publication_staging_dir"
  fi
  if [[ -n "$archive_staging_path" && -d "$archive_staging_path" ]]; then
    rm -rf "$archive_staging_path"
  fi
  if [[ "$build_succeeded" == "1" && "$build_root" == "${TMPDIR:-/tmp}"/mizyun-ios-ipa.* ]]; then
    rm -rf "$build_root"
  elif [[ "$build_succeeded" != "1" ]]; then
    echo "Failed-build diagnostics retained at: $build_root" >&2
  fi
}
trap cleanup EXIT

echo "Source commit: $source_sha"
echo "Creating disposable worktree..."
git -C "$repo_root" worktree add --detach "$worktree_dir" "$source_sha"
worktree_added=1

cp "$production_env" "$worktree_dir/apps/mobile/.env.production"
chmod 600 "$worktree_dir/apps/mobile/.env.production"

unset EXPO_PUBLIC_API_URL EXPO_PUBLIC_SUPABASE_URL
unset EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY EXPO_PUBLIC_AUTH_REDIRECT_URI
unset MIZYUN_APP_VARIANT MIZYUN_BUILD_PROFILE MIZYUN_IOS_BUILD_NUMBER
unset EAS_BUILD_PROFILE
set -a
# shellcheck disable=SC1090
source "$worktree_dir/apps/mobile/.env.production"
set +a

: "${EXPO_PUBLIC_API_URL:?missing production API URL}"
: "${EXPO_PUBLIC_SUPABASE_URL:?missing production Supabase URL}"
: "${EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY:?missing production Supabase publishable key}"
: "${EXPO_PUBLIC_AUTH_REDIRECT_URI:?missing production Auth redirect URI}"

if [[ "$EXPO_PUBLIC_API_URL" != "https://mizyun-api.phiskel.com" ]]; then
  echo "Refusing build with an unexpected Production API URL." >&2
  exit 2
fi
if [[ "$EXPO_PUBLIC_SUPABASE_URL" != "https://mizyun-supabase.phiskel.com" ]]; then
  echo "Refusing build with an unexpected Production Supabase URL." >&2
  exit 2
fi
if [[ "$EXPO_PUBLIC_AUTH_REDIRECT_URI" != "mizyun://auth/callback" ]]; then
  echo "Refusing build with an unexpected Production auth redirect URI." >&2
  exit 2
fi

export EXPO_NO_DOTENV=1
export MIZYUN_APP_VARIANT=production
export MIZYUN_BUILD_PROFILE=production
export MIZYUN_IOS_BUILD_NUMBER="$requested_build_number"
export MIZYUN_IOS_DISABLE_PUSH=0
export MIZYUN_ENABLE_APPLE_AUTH=1

cd "$worktree_dir"
echo "Installing exact locked dependencies..."
pnpm install --frozen-lockfile

echo "Generating fresh iOS and Android native projects for release checks..."
pnpm --filter @mizyun/mobile exec expo prebuild --clean

echo "Running the complete repository quality gate..."
pnpm check

workspace_path="$(find "$worktree_dir/apps/mobile/ios" -maxdepth 1 -name '*.xcworkspace' -print -quit)"
if [[ -z "$workspace_path" ]]; then
  echo "Generated Xcode workspace was not found." >&2
  exit 1
fi
scheme_name="$(basename "$workspace_path" .xcworkspace)"
project_file="$(find "$worktree_dir/apps/mobile/ios" -maxdepth 2 -name project.pbxproj -print -quit)"
if [[ -z "$project_file" ]] || ! rg -q 'PRODUCT_BUNDLE_IDENTIFIER = com\.mizyun\.app;' "$project_file"; then
  echo "Generated native project does not contain bundle ID com.mizyun.app." >&2
  exit 1
fi

echo "Archiving Production app..."
xcodebuild \
  -workspace "$workspace_path" \
  -scheme "$scheme_name" \
  -configuration Release \
  -destination "generic/platform=iOS" \
  -derivedDataPath "$build_root/DerivedData" \
  -archivePath "$archive_path" \
  -allowProvisioningUpdates \
  CODE_SIGN_STYLE=Automatic \
  DEVELOPMENT_TEAM="$apple_team_id" \
  archive | tee "$build_log"

if ! rg -q '\*\* ARCHIVE SUCCEEDED \*\*' "$build_log"; then
  echo "Xcode did not report a successful archive." >&2
  exit 1
fi

echo "Exporting App Store Connect IPA..."
mkdir -p "$export_path"
xcodebuild \
  -exportArchive \
  -archivePath "$archive_path" \
  -exportPath "$export_path" \
  -exportOptionsPlist "$export_options" \
  -allowProvisioningUpdates

ipa_count="$(find "$export_path" -maxdepth 1 -name '*.ipa' | wc -l | tr -d ' ')"
if [[ "$ipa_count" != "1" ]]; then
  echo "Expected exactly one exported IPA, found $ipa_count." >&2
  exit 1
fi
ipa_path="$(find "$export_path" -maxdepth 1 -name '*.ipa' -print -quit)"
distribution_summary="$export_path/DistributionSummary.plist"
if [[ ! -f "$distribution_summary" ]]; then
  echo "Xcode export did not produce DistributionSummary.plist." >&2
  exit 1
fi

distribution_evidence="$(
  plutil -convert json -o - "$distribution_summary" | node -e '
    const expectedTeamId = process.argv[1];
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (input += chunk));
    process.stdin.on("end", () => {
      const summary = JSON.parse(input);
      const ipaKeys = Object.keys(summary).filter((key) => key.endsWith(".ipa"));
      if (ipaKeys.length !== 1 || summary[ipaKeys[0]]?.length !== 1) {
        throw new Error("Distribution summary must contain exactly one IPA entry");
      }
      const item = summary[ipaKeys[0]][0];
      const certificate = item.certificate;
      if (item.team?.id !== expectedTeamId) {
        throw new Error("Distribution summary has an unexpected team");
      }
      if (!certificate?.type?.includes("Apple Distribution")) {
        throw new Error("Distribution summary is missing an Apple Distribution certificate");
      }
      if (!certificate.SHA1 || !certificate.dateExpires) {
        throw new Error("Distribution certificate fingerprint or expiry is missing");
      }
      const [day, month, year] = certificate.dateExpires.split("/").map(Number);
      const expiresAt = Date.UTC(year, month - 1, day + 1);
      if (!day || !month || !year || expiresAt <= Date.now()) {
        throw new Error("Distribution certificate is expired or has an invalid expiry");
      }
      process.stdout.write(JSON.stringify({
        type: certificate.type,
        sha1: certificate.SHA1,
        expires: certificate.dateExpires,
      }));
    });
  ' "$apple_team_id"
)"

mkdir -p "$verify_path"
unzip -q "$ipa_path" -d "$verify_path"
app_path="$(find "$verify_path/Payload" -maxdepth 1 -name '*.app' -type d -print -quit)"
if [[ -z "$app_path" ]]; then
  echo "Exported IPA does not contain an application payload." >&2
  exit 1
fi

info_plist="$app_path/Info.plist"
bundle_id="$(plutil -extract CFBundleIdentifier raw "$info_plist")"
version_number="$(plutil -extract CFBundleShortVersionString raw "$info_plist")"
build_number="$(plutil -extract CFBundleVersion raw "$info_plist")"
if [[ "$bundle_id" != "com.mizyun.app" ]]; then
  echo "Exported IPA has unexpected bundle ID: $bundle_id" >&2
  exit 1
fi
if [[ "$build_number" != "$requested_build_number" ]]; then
  echo "Exported IPA has build $build_number; expected $requested_build_number." >&2
  exit 1
fi

# HealthKit API references require both purpose strings at Store validation,
# including our read-only authorization call. Check the exported native plist.
for purpose_key in NSHealthShareUsageDescription NSHealthUpdateUsageDescription; do
  purpose_text="$(plutil -extract "$purpose_key" raw -expect string "$info_plist" 2>/dev/null)" || {
    echo "Exported IPA is missing a string $purpose_key purpose description." >&2
    exit 1
  }
  if [[ -z "${purpose_text//[[:space:]]/}" ]]; then
    echo "Exported IPA has a blank $purpose_key purpose description." >&2
    exit 1
  fi
done

verify_widget_plist_string() {
  local plist_path="$1" plist_key="$2" expected_value="$3" failure_message="$4"
  local actual_value
  actual_value="$(plutil -extract "$plist_key" raw -expect string "$plist_path" 2>/dev/null)" || {
    echo "Exported IPA $failure_message." >&2
    exit 1
  }
  if [[ "$actual_value" != "$expected_value" ]]; then
    echo "Exported IPA $failure_message." >&2
    exit 1
  fi
}

live_activity_support="$(plutil -extract NSSupportsLiveActivities raw -expect bool "$info_plist" 2>/dev/null)" || live_activity_support=""
if [[ "$live_activity_support" != "true" ]]; then
  echo "Exported IPA requires boolean NSSupportsLiveActivities=true." >&2
  exit 1
fi
production_app_group="group.com.mizyun.app"
verify_widget_plist_string "$info_plist" ExpoWidgetsAppGroupIdentifier "$production_app_group" "has an unexpected main app group identifier"

widget_path="$app_path/PlugIns/ExpoWidgetsTarget.appex"
widget_info_plist="$widget_path/Info.plist"
if [[ ! -d "$widget_path" ]]; then
  echo "Exported IPA is missing ExpoWidgetsTarget.appex." >&2
  exit 1
fi
if [[ ! -f "$widget_info_plist" ]]; then
  echo "Exported IPA Live Activity extension is missing its Info.plist." >&2
  exit 1
fi
verify_widget_plist_string "$widget_info_plist" CFBundleIdentifier "com.mizyun.app.ExpoWidgetsTarget" "has an unexpected Live Activity extension bundle identifier"
verify_widget_plist_string "$widget_info_plist" CFBundleShortVersionString "$version_number" "Live Activity extension version does not match the main app"
verify_widget_plist_string "$widget_info_plist" CFBundleVersion "$build_number" "Live Activity extension build does not match the main app"
verify_widget_plist_string "$widget_info_plist" NSExtension.NSExtensionPointIdentifier "com.apple.widgetkit-extension" "has an unexpected Live Activity extension point"
verify_widget_plist_string "$widget_info_plist" ExpoWidgetsAppGroupIdentifier "$production_app_group" "has an unexpected Live Activity extension app group identifier"
widget_executable="$(plutil -extract CFBundleExecutable raw -expect string "$widget_info_plist" 2>/dev/null)" || widget_executable=""
if [[ "$widget_executable" != "ExpoWidgetsTarget" || ! -f "$widget_path/$widget_executable" || ! -s "$widget_path/$widget_executable" || ! -x "$widget_path/$widget_executable" ]]; then
  echo "Exported IPA Live Activity extension is missing its expected executable." >&2
  exit 1
fi

codesign --verify --deep --strict "$app_path"
signing_details="$(codesign -dv --verbose=4 "$app_path" 2>&1)"
if ! grep -q "^TeamIdentifier=${apple_team_id}$" <<<"$signing_details"; then
  echo "Exported IPA is not signed by expected team $apple_team_id." >&2
  exit 1
fi

entitlements="$(codesign -d --entitlements - "$app_path" 2>&1)"
if ! grep -A2 '\[Key\] aps-environment' <<<"$entitlements" | grep -q '\[String\] production'; then
  echo "Exported IPA does not have the Production push entitlement." >&2
  exit 1
fi
if ! grep -A2 '\[Key\] get-task-allow' <<<"$entitlements" | grep -q '\[Bool\] false'; then
  echo "Exported IPA unexpectedly permits debugging." >&2
  exit 1
fi
if ! grep -A2 '\[Key\] application-identifier' <<<"$entitlements" | grep -q "\[String\] ${apple_team_id}\.com\.mizyun\.app"; then
  echo "Exported IPA has an unexpected application identifier entitlement." >&2
  exit 1
fi
if ! grep -A3 '\[Key\] com.apple.developer.applesignin' <<<"$entitlements" | grep -q '\[String\] Default'; then
  echo "Exported IPA is missing the expected Sign in with Apple entitlement." >&2
  exit 1
fi

# Check complete typed entitlement values; modern signatures may be DER-only.
verify_widget_signed_entitlements() {
  local signed_path="$1" signed_identifier="$2" signed_kind="$3" signed_label="$4"
  local signed_entitlements_path="$build_root/$signed_kind-entitlements.txt"
  codesign -d --entitlements "$signed_entitlements_path" "$signed_path" 2>/dev/null
  node - "$signed_entitlements_path" "$signed_identifier" "$apple_team_id" "$production_app_group" "$signed_label" <<'NODE'
const fs = require("node:fs");
const [path, identifier, team, group, label] = process.argv.slice(2);
const lines = fs.readFileSync(path, "utf8").split(/\r?\n/).filter((line) => line.trim());
if (lines.shift() !== "[Dict]") {
  throw new Error(`Exported IPA ${label} has unreadable signed entitlements`);
}
const entries = new Map();
let keyIndent;
let current;
for (const line of lines) {
  const key = /^(\s+)\[Key\] (.+)$/.exec(line);
  if (key && (keyIndent === undefined || key[1] === keyIndent)) {
    keyIndent ??= key[1];
    if (entries.has(key[2])) throw new Error(`Exported IPA ${label} has duplicate signed entitlement keys`);
    current = [];
    entries.set(key[2], current);
  } else if (current) {
    current.push(line.trim());
  } else {
    throw new Error(`Exported IPA ${label} has unreadable signed entitlements`);
  }
}
for (const [key, value, description] of [
  ["com.apple.security.application-groups", ["[Value]", "[Array]", `[String] ${group}`], "Production app group"],
  ["application-identifier", ["[Value]", `[String] ${team}.${identifier}`], "application-identifier"],
  ["get-task-allow", ["[Value]", "[Bool] false"], "get-task-allow"],
]) {
  if (JSON.stringify(entries.get(key)) !== JSON.stringify(value)) {
    throw new Error(`Exported IPA ${label} has unexpected signed ${description}`);
  }
}
NODE
}
verify_widget_signed_entitlements "$app_path" "com.mizyun.app" main "main app"

if ! codesign --verify --strict "$widget_path"; then
  echo "Exported IPA Live Activity extension signature verification failed." >&2
  exit 1
fi
widget_signing_details="$(codesign -dv --verbose=4 "$widget_path" 2>&1)"
if ! grep -q "^TeamIdentifier=${apple_team_id}$" <<<"$widget_signing_details"; then
  echo "Exported IPA Live Activity extension is not signed by expected team $apple_team_id." >&2
  exit 1
fi
verify_widget_signed_entitlements "$widget_path" "com.mizyun.app.ExpoWidgetsTarget" widget "Live Activity extension"

# expo-constants embeds the resolved public Expo config in this native resource.
# Validate configured endpoints, rather than rejecting dormant Dev guard literals.
node - "$app_path/EXConstants.bundle/app.config" "$version_number" "$build_number" <<'NODE'
const fs = require("node:fs");
const [configPath, version, build] = process.argv.slice(2);
let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, "utf8"));
} catch {
  throw new Error("Exported IPA is missing a readable Expo public app.config");
}
const expected = {
  "name": [config?.name, "Mizyun"],
  "slug": [config?.slug, "mizyun"],
  "scheme": [config?.scheme, "mizyun"],
  "ios.bundleIdentifier": [config?.ios?.bundleIdentifier, "com.mizyun.app"],
  "android.package": [config?.android?.package, "com.mizyun.app"],
  "version": [config?.version, version],
  "ios.buildNumber": [config?.ios?.buildNumber, build],
  "android.versionCode": [config?.android?.versionCode, Number(build)],
  "extra.mizyunVariant": [config?.extra?.mizyunVariant, "production"],
  "extra.mizyunProfile": [config?.extra?.mizyunProfile, "production"],
  "extra.mizyunReleaseEndpoints.apiUrl": [
    config?.extra?.mizyunReleaseEndpoints?.apiUrl,
    "https://mizyun-api.phiskel.com",
  ],
  "extra.mizyunReleaseEndpoints.supabaseUrl": [
    config?.extra?.mizyunReleaseEndpoints?.supabaseUrl,
    "https://mizyun-supabase.phiskel.com",
  ],
  "extra.mizyunReleaseEndpoints.authRedirectUri": [
    config?.extra?.mizyunReleaseEndpoints?.authRedirectUri,
    "mizyun://auth/callback",
  ],
};
if (version !== `1.0.${build}`) {
  throw new Error("Exported IPA has an inconsistent release version tuple");
}
for (const [field, [actual, required]] of Object.entries(expected)) {
  if (actual !== required) {
    // Never print arbitrary exported config values (which could contain secrets).
    throw new Error(`Exported IPA has unexpected Expo config ${field}`);
  }
}
NODE

bundle_path="$app_path/main.jsbundle"
if [[ ! -f "$bundle_path" ]]; then
  echo "Exported IPA is missing main.jsbundle." >&2
  exit 1
fi
bundle_strings="$(strings "$bundle_path")"
if ! grep -q 'https://mizyun-api\.phiskel\.com' <<<"$bundle_strings"; then
  echo "Production API URL was not found in the exported runtime bundle." >&2
  exit 1
fi
if ! grep -q 'https://mizyun-supabase\.phiskel\.com' <<<"$bundle_strings"; then
  echo "Production Supabase URL was not found in the exported runtime bundle." >&2
  exit 1
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
release_name="${version_number}-${build_number}-${source_sha}-${timestamp}"
artifact_root="$repo_root/apps/mobile/dist/releases/ios/app-store/packages"
artifact_dir="$artifact_root/$release_name"
archive_root="$repo_root/apps/mobile/dist/releases/ios/app-store/archives"
archive_artifact="$archive_root/Mizyun-${release_name}.xcarchive"
if [[ -e "$artifact_dir" ]]; then
  echo "Refusing to overwrite existing artifact directory: $artifact_dir" >&2
  exit 1
fi
if [[ -e "$archive_artifact" ]]; then
  echo "Refusing to overwrite existing archive: $archive_artifact" >&2
  exit 1
fi
mkdir -p "$artifact_root" "$archive_root"
publication_staging_dir="$artifact_root/.staging-$release_name"
if [[ -e "$publication_staging_dir" ]]; then
  echo "Refusing to reuse publication staging directory: $publication_staging_dir" >&2
  exit 1
fi
mkdir "$publication_staging_dir"
staged_ipa="$publication_staging_dir/Mizyun-${release_name}.ipa"
cp "$ipa_path" "$staged_ipa"
cp "$distribution_summary" "$publication_staging_dir/DistributionSummary.plist"
checksum="$(shasum -a 256 "$staged_ipa" | awk '{print $1}')"
export_options_checksum="$(shasum -a 256 "$export_options" | awk '{print $1}')"
tool_checksum="$(shasum -a 256 "$repo_root/scripts/build-production-ios-ipa.sh" | awk '{print $1}')"
xcode_version="$(xcodebuild -version | paste -sd ' ' -)"

node -e '
  const { writeFileSync } = require("node:fs");
  const [
    manifestPath, sourceCommit, bundleIdentifier, version, buildNumber,
    appleTeamId, xcodeVersion, exportOptionsSha256, buildToolSha256,
    ipaSha256, ipaFilename, distributionEvidence,
  ] = process.argv.slice(1);
  writeFileSync(manifestPath, JSON.stringify({
    sourceCommit,
    bundleIdentifier,
    version,
    buildNumber,
    appleTeamId,
    endpoints: ["https://mizyun-api.phiskel.com", "https://mizyun-supabase.phiskel.com"],
    entitlements: {
      applicationIdentifier: `${appleTeamId}.com.mizyun.app`,
      apsEnvironment: "production",
      appleSignIn: "Default",
      getTaskAllow: false,
    },
    distributionCertificate: JSON.parse(distributionEvidence),
    xcodeVersion,
    exportOptionsSha256,
    buildToolSha256,
    ipaSha256,
    ipaFilename,
  }, null, 2) + "\n");
' \
  "$publication_staging_dir/manifest.json" \
  "$source_sha" \
  "$bundle_id" \
  "$version_number" \
  "$build_number" \
  "$apple_team_id" \
  "$xcode_version" \
  "$export_options_checksum" \
  "$tool_checksum" \
  "$checksum" \
  "$(basename "$staged_ipa")" \
  "$distribution_evidence"

node -e 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))' "$publication_staging_dir/manifest.json"
archive_staging_path="$archive_root/.staging-Mizyun-${release_name}.xcarchive"
if [[ -e "$archive_staging_path" ]]; then
  echo "Refusing to reuse archive staging path: $archive_staging_path" >&2
  exit 1
fi
cp -R "$archive_path" "$archive_staging_path"
if ! diff -qr "$archive_path" "$archive_staging_path" >/dev/null; then
  echo "Copied Xcode archive does not match the verified source archive." >&2
  exit 1
fi
mv "$archive_staging_path" "$archive_artifact"
archive_staging_path=""
mv "$publication_staging_dir" "$artifact_dir"
publication_staging_dir=""
final_ipa="$artifact_dir/$(basename "$staged_ipa")"

build_succeeded=1

cat <<EOF

IPA READY
Source commit: $source_sha
Bundle ID: $bundle_id
Version: $version_number
Build: $build_number
IPA: $final_ipa
Manifest: $artifact_dir/manifest.json
Archive: $archive_artifact
SHA-256: $checksum

The IPA was created but was not uploaded to App Store Connect.
EOF
