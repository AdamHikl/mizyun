#!/usr/bin/env bash
#
# Build + install the iOS Release binary on the physical iPhone via
# Tailscale. Pre-requisites:
#
#   1. Tailscale installed and authenticated on the Mac
#      (so the iPhone joins the same tailnet).
#   2. The iPhone has Tailscale installed and signed in.
#   3. `pnpm db:start` running on the Mac so the API and Supabase
#      are reachable at 127.0.0.1.
#   4. The API is started with API_HOST=0.0.0.0 so the iPhone
#      can reach it on the Tailscale IP.
#
# Usage:
#   pnpm tsx scripts/build-iphone-tailscale.ts
#   # or
#   ./scripts/build-iphone-tailscale.sh
#
# The script:
#   1. Reads the Mac's Tailscale IPv4.
#   2. Sets the EXPO_PUBLIC_* env to the Tailscale URLs.
#   3. Exports a production bundle (offline, no Metro).
#   4. Builds the .ipa via `expo run:ios --configuration Release`
#      against the connected iPhone (must be on the tailnet).
#
# For the simulator (faster dev loop), use:
#   pnpm dev:mobile

set -euo pipefail

if ! command -v tailscale >/dev/null 2>&1; then
  echo "error: tailscale CLI not found. Install with: brew install --cask tailscale"
  exit 1
fi

TS_IP=$(tailscale ip -4 | head -1 | tr -d '[:space:]')
if [[ -z "$TS_IP" ]]; then
  echo "error: Tailscale is not authenticated. Run: tailscale up"
  exit 1
fi

echo "Using Tailscale IP: $TS_IP"

# Persist the tunnel URLs for the Expo dev build.
cat > apps/mobile/.env.local <<EOF
EXPO_PUBLIC_API_URL=http://${TS_IP}:4000
EXPO_PUBLIC_SUPABASE_URL=http://${TS_IP}:54321
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$(pnpm supabase status 2>/dev/null | sed -n 's/^.*"PUBLISHABLE_KEY": "\([^"]*\)".*/\1/p' | head -1)
EOF
echo "Wrote apps/mobile/.env.local with the Tailscale URLs."

# Build the .ipa for the connected iPhone. The phone is on the
# tailnet so it can reach the Mac's API at the Tailscale IP.
echo "Building the iOS Release binary..."
EXPO_PUBLIC_API_URL="http://${TS_IP}:4000" \
EXPO_PUBLIC_SUPABASE_URL="http://${TS_IP}:54321" \
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$(pnpm supabase status 2>/dev/null | sed -n 's/^.*"PUBLISHABLE_KEY": "\([^"]*\)".*/\1/p' | head -1) \
  npx expo run:ios --device "$(xcrun devicectl list devices 2>/dev/null | grep -i iphone | grep -v simulator | head -1 | awk -F'(' '{print $2}' | tr -d ')' || echo "iPhone 17 Pro")" --configuration Release

echo "iPhone install complete. The app is now pointed at:"
echo "  API:        http://${TS_IP}:4000"
echo "  Supabase:   http://${TS_IP}:54321"
echo "Open Mizyun on the phone; the Coach flow will reach the Mac via the tailnet."
