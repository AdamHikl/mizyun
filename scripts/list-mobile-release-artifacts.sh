#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
artifact_root="$repo_root/apps/mobile/dist/releases"

echo "Mizyun preserved mobile release artifacts"
echo "$artifact_root"

if [[ ! -d "$artifact_root" ]]; then
  echo "No preserved release artifacts found."
  exit 0
fi

{
  find "$artifact_root/android" -type f \
    \( -name '*.aab' -o -name '*.apk' \) -print 2>/dev/null || true
  find "$artifact_root/ios/app-store/archives" -mindepth 1 -maxdepth 1 \
    -name '*.xcarchive' -print 2>/dev/null || true
  find "$artifact_root/ios/app-store/packages" -mindepth 1 -maxdepth 1 \
    -type d -print 2>/dev/null || true
} | LC_ALL=C sort
