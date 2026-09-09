#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
keystore_path="${1:-$repo_root/mizyun-release.keystore}"
alias_name="mizyun"

if [[ -f "$keystore_path" ]]; then
  echo "Keystore already exists at: $keystore_path"
  echo "Refusing to overwrite existing keystore."
  exit 1
fi

echo "=== Mizyun Android Release Keystore Generator ==="
echo "Generating production release keystore at: $keystore_path"

keytool -genkeypair \
  -v \
  -keystore "$keystore_path" \
  -alias "$alias_name" \
  -keyalg RSA \
  -keysize 4096 \
  -validity 10000

chmod 600 "$keystore_path"

echo ""
echo "✓ Release keystore generated successfully at: $keystore_path"
echo "Permissions set to 0600 (owner-only)."
echo ""
echo "To build a signed Google Play release bundle (.aab):"
echo "  export MIZYUN_RELEASE_KEYSTORE=\"$keystore_path\""
echo "  export MIZYUN_RELEASE_KEY_ALIAS=\"$alias_name\""
echo "  export MIZYUN_RELEASE_STORE_PASSWORD=\"<your-keystore-password>\""
echo "  export MIZYUN_RELEASE_KEY_PASSWORD=\"<your-key-password>\""
echo "  pnpm mobile:founder-production:android:bundleRelease"
echo ""
echo "IMPORTANT: Back up this keystore file and passwords safely! Google Play requires this key for all future updates."
