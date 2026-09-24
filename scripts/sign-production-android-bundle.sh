#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
default_keystore="/Users/adam/Backups/mizyun/keys/mizyun-google-play-upload.jks"
keystore="${MIZYUN_RELEASE_KEYSTORE:-$default_keystore}"
aab_path="${1:-$repo_root/apps/mobile/android/app/build/outputs/bundle/release/app-release.aab}"
expected_sha1="A3:37:60:CF:83:BB:54:87:FC:71:F0:38:D4:6B:97:21:CA:A0:70:4D"

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

for cmd in keytool jarsigner zip; do
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

# Password retrieval
store_pass="${MIZYUN_RELEASE_STORE_PASSWORD:-}"
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
  echo "WARNING: Keystore SHA1 ($actual_sha1) does not match expected Google Play SHA1 ($expected_sha1)." >&2
  echo -n "Continue signing anyway? [y/N]: " >&2
  read -r confirm
  if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
    echo "Aborted." >&2
    exit 1
  fi
fi

key_pass="${MIZYUN_RELEASE_KEY_PASSWORD:-$store_pass}"

# Resign bundle
echo "Preparing App Bundle signature..."
# Remove old signatures (e.g. debug key) if present
zip -d "$aab_path" "META-INF/*.SF" "META-INF/*.RSA" "META-INF/*.DSA" "META-INF/*.EC" "META-INF/MANIFEST.MF" >/dev/null 2>&1 || true

echo "Signing App Bundle with jarsigner..."
jarsigner \
  -keystore "$keystore" \
  -storepass "$store_pass" \
  -keypass "$key_pass" \
  -digestalg SHA-256 \
  -sigalg SHA256withRSA \
  "$aab_path" \
  "$alias_name" >/dev/null

echo "Verifying signature on signed bundle..."
bundle_cert="$(keytool -printcert -jarfile "$aab_path")"
signed_sha1="$(echo "$bundle_cert" | grep -i "SHA1:" | head -n 1 | awk '{print $2}' | tr -d '\r' | xargs)"

echo ""
echo "============================================================"
echo "Bundle verification result:"
echo "Signed Certificate SHA1: $signed_sha1"
if [[ "$signed_sha1" == "$expected_sha1" ]]; then
  echo "✓ Fingerprint MATCHES Google Play upload certificate!"
else
  echo "⚠ Fingerprint: $signed_sha1"
fi

sha256_hash="$(shasum -a 256 "$aab_path" | awk '{print $1}')"
file_size="$(wc -c < "$aab_path" | tr -d ' ')"

echo "Artifact: $aab_path"
echo "Size: $file_size bytes"
echo "SHA-256: $sha256_hash"
echo "============================================================"
echo "✓ Ready for upload to Google Play Console!"
