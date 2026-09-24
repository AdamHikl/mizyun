#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
default_keystore="/Users/adam/Backups/mizyun/keys/mizyun-google-play-upload.jks"
keystore="${MIZYUN_RELEASE_KEYSTORE:-$default_keystore}"
aab_path="${1:-$repo_root/apps/mobile/android/app/build/outputs/bundle/release/app-release.aab}"
metadata_path="$aab_path.build.json"
expected_sha1="A3:37:60:CF:83:BB:54:87:FC:71:F0:38:D4:6B:97:21:CA:A0:70:4D"
keychain_service="${MIZYUN_RELEASE_KEYCHAIN_SERVICE:-com.mizyun.google-play.upload-key}"
keychain_account="${MIZYUN_RELEASE_KEYCHAIN_ACCOUNT:-adam}"

echo "=== Mizyun Google Play Android App Bundle Signer ==="

# Locate Java tools
if [[ -z "${JAVA_HOME:-}" ]]; then
  if [[ -x "/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/java" ]]; then
    JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
  elif [[ -x "$HOME/.gradle/jdks/eclipse_adoptium-17-aarch64-os_x.2/jdk-17.0.19+10/Contents/Home/bin/java" ]]; then
    JAVA_HOME="$HOME/.gradle/jdks/eclipse_adoptium-17-aarch64-os_x.2/jdk-17.0.19+10/Contents/Home"
  elif [[ -x /opt/homebrew/opt/openjdk@17/bin/java ]]; then
    JAVA_HOME=/opt/homebrew/opt/openjdk@17
  fi
fi

if [[ -n "${JAVA_HOME:-}" && -d "$JAVA_HOME/bin" ]]; then
  export PATH="$JAVA_HOME/bin:$PATH"
fi

for cmd in keytool jarsigner node shasum zip; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: Required tool '$cmd' is not available in PATH." >&2
    exit 1
  fi
done

if [[ ! -f "$keystore" ]]; then
  echo "ERROR: Release keystore not found at: $keystore" >&2
  exit 1
fi

if [[ ! -f "$aab_path" ]]; then
  echo "ERROR: Target App Bundle not found at: $aab_path" >&2
  echo "Please compile the bundle first via: pnpm mobile:founder-production:android:bundleRelease" >&2
  exit 1
fi
if [[ ! -f "$metadata_path" ]]; then
  echo "ERROR: Build provenance is missing: $metadata_path" >&2
  echo "Rebuild with: pnpm mobile:founder-production:android:bundleRelease" >&2
  exit 1
fi

artifact_root="$repo_root/apps/mobile/dist/releases/android/google-play"
aab_directory="$(cd "$(dirname "$aab_path")" && pwd -P)"
case "$aab_directory/$(basename "$aab_path")" in
  "$artifact_root"/*)
    echo "ERROR: Refusing to modify a preserved release artifact. Sign the generated Gradle output instead." >&2
    exit 1
    ;;
esac

metadata_values="$(node -e '
  const { readFileSync } = require("node:fs");
  const metadata = JSON.parse(readFileSync(process.argv[1], "utf8"));
  const values = [metadata.sourceCommit, metadata.bundleIdentifier, metadata.version, metadata.versionCode, metadata.inputSha256];
  if (values.some((value) => value === undefined || value === null)) process.exit(2);
  process.stdout.write(values.join("\t"));
' "$metadata_path")" || {
  echo "ERROR: Invalid build provenance: $metadata_path" >&2
  exit 1
}
IFS=$'\t' read -r source_sha bundle_identifier version_name version_code input_sha256 <<<"$metadata_values"
if [[ ! "$source_sha" =~ ^[0-9a-f]{40}$ || "$bundle_identifier" != "com.mizyun.app" || ! "$version_name" =~ ^1\.0\.[1-9][0-9]*$ || ! "$version_code" =~ ^[1-9][0-9]*$ ]]; then
  echo "ERROR: Build provenance contains an invalid Production identity or version." >&2
  exit 1
fi
if [[ "${version_name##*.}" != "$version_code" ]]; then
  echo "ERROR: Build provenance contains a mismatched release version tuple." >&2
  exit 1
fi
actual_input_sha256="$(shasum -a 256 "$aab_path" | awk '{print $1}')"
if [[ "$actual_input_sha256" != "$input_sha256" ]]; then
  echo "ERROR: App Bundle does not match its build provenance checksum." >&2
  exit 1
fi

# Password retrieval
store_pass="${MIZYUN_RELEASE_STORE_PASSWORD:-}"
if [[ -z "$store_pass" ]] && command -v security >/dev/null 2>&1; then
  store_pass="$(security find-generic-password -a "$keychain_account" -s "$keychain_service" -w 2>/dev/null || true)"
  if [[ -n "$store_pass" ]]; then
    echo "Loaded the Google Play upload-key password from macOS Keychain."
  fi
fi
if [[ -z "$store_pass" ]]; then
  echo -n "Enter password for keystore [$keystore]: " >&2
  read -s -r store_pass
  echo "" >&2
fi

if [[ -z "$store_pass" ]]; then
  echo "ERROR: Password cannot be empty." >&2
  exit 1
fi

# Verify password and extract alias / fingerprint
echo "Inspecting keystore certificates..."
keystore_info="$(keytool -list -v -keystore "$keystore" -storepass "$store_pass" 2>&1)" || {
  echo "ERROR: Failed to open keystore with provided password." >&2
  exit 1
}

# Find alias
alias_name="${MIZYUN_RELEASE_KEY_ALIAS:-}"
if [[ -z "$alias_name" ]]; then
  alias_name="$(echo "$keystore_info" | grep -i "Alias name:" | head -n 1 | awk -F': ' '{print $2}' | tr -d '\r' | xargs)"
fi

if [[ -z "$alias_name" ]]; then
  echo "ERROR: Could not detect key alias from keystore." >&2
  exit 1
fi

echo "Detected Key Alias: $alias_name"

# Check certificate fingerprint
actual_sha1="$(echo "$keystore_info" | grep -i "SHA1:" | head -n 1 | awk '{print $2}' | tr -d '\r' | xargs)"
echo "Keystore Certificate SHA1: $actual_sha1"

if [[ "$actual_sha1" != "$expected_sha1" ]]; then
  echo "ERROR: Keystore SHA1 ($actual_sha1) does not match expected Google Play SHA1 ($expected_sha1)." >&2
  exit 1
fi

key_pass="${MIZYUN_RELEASE_KEY_PASSWORD:-$store_pass}"

# Sign a staged copy so generated and preserved inputs are never modified.
echo "Preparing App Bundle signature..."
mkdir -p "$artifact_root"
artifact_path="$artifact_root/Mizyun-${version_name}-code${version_code}-${source_sha}.aab"
staged_path="$artifact_root/.staging-$(basename "$artifact_path").$$"
if [[ -e "$staged_path" ]]; then
  echo "ERROR: Refusing to reuse staging path: $staged_path" >&2
  exit 1
fi
cp -p "$aab_path" "$staged_path"
cleanup_staged_bundle() {
  if [[ -n "${staged_path:-}" && -f "$staged_path" ]]; then
    rm -f "$staged_path"
  fi
}
trap cleanup_staged_bundle EXIT
# Remove old signatures (e.g. debug key) if present
zip -d "$staged_path" "META-INF/*.SF" "META-INF/*.RSA" "META-INF/*.DSA" "META-INF/*.EC" "META-INF/MANIFEST.MF" >/dev/null 2>&1 || true

echo "Signing App Bundle with jarsigner..."
jarsigner \
  -keystore "$keystore" \
  -storepass "$store_pass" \
  -keypass "$key_pass" \
  -digestalg SHA-256 \
  -sigalg SHA256withRSA \
  "$staged_path" \
  "$alias_name" >/dev/null

echo "Verifying signature on signed bundle..."
jarsigner -verify "$staged_path" >/dev/null
bundle_cert="$(keytool -printcert -jarfile "$staged_path")"
signed_sha1="$(echo "$bundle_cert" | grep -i "SHA1:" | head -n 1 | awk '{print $2}' | tr -d '\r' | xargs)"

echo ""
echo "============================================================"
echo "Bundle verification result:"
echo "Signed Certificate SHA1: $signed_sha1"
if [[ "$signed_sha1" == "$expected_sha1" ]]; then
  echo "✓ Fingerprint MATCHES Google Play upload certificate!"
else
  echo "ERROR: Signed bundle fingerprint does not match the required Google Play upload certificate." >&2
  exit 1
fi

sha256_hash="$(shasum -a 256 "$staged_path" | awk '{print $1}')"
file_size="$(wc -c < "$staged_path" | tr -d ' ')"
if [[ -e "$artifact_path" ]]; then
  existing_hash="$(shasum -a 256 "$artifact_path" | awk '{print $1}')"
  if [[ "$existing_hash" != "$sha256_hash" ]]; then
    echo "ERROR: Refusing to overwrite a different release artifact: $artifact_path" >&2
    exit 1
  fi
  rm -f "$staged_path"
else
  mv "$staged_path" "$artifact_path"
fi
staged_path=""

echo "Unsigned build input: $aab_path"
echo "Preserved release artifact: $artifact_path"
echo "Size: $file_size bytes"
echo "SHA-256: $sha256_hash"
echo "============================================================"
echo "✓ Ready for upload to Google Play Console!"
