# Mistral AI development testing

> Development-team workflow for the default-off Mizyun Coach. Use only synthetic records until the real-user policy, privacy, safety, and native release gates pass.

## Current proven state

As of 2026-07-23:

- the official server-side Mistral adapter passes fake-boundary tests;
- the API reports `mistral-medium-latest` ready when explicitly enabled;
- one direct live request passed with a fictional nutrition fixture;
- authenticated mobile/native AI acceptance has not run;
- persistent AI memory and photo-based nutrition AI are not implemented;
- external access still defaults to `false`.

The live fixture contained no real user record, account identifier, photo, or secret. Do not reinterpret this as approval for real-user traffic.

## Secret location

Store the development key only in the ignored repository-root `.env`:

```dotenv
AGENT_PROVIDER=mistral
MISTRAL_API_KEY=<development key>
MISTRAL_MODEL=mistral-medium-latest
MISTRAL_TIMEOUT_MS=30000
MISTRAL_MAX_OUTPUT_TOKENS=1200
AI_DAILY_USER_TOKEN_BUDGET=100000
AI_USER_REQUESTS_PER_MINUTE=6
AI_USER_MAX_CONCURRENT_REQUESTS=1
AI_EXTERNAL_ACCESS=true
```

The per-user request, concurrency, and daily-token maps are single-process
development safeguards. They are sufficient for one supervised local API during
physical-device acceptance, but they reset on restart and are not shared across
replicas. `AI-OPS-001` must add durable shared enforcement and replica-safe
message idempotency before external rollout.

Protect the file:

```bash
chmod 600 .env
```

Never put the key in:

- `.env.example`;
- `apps/mobile/.env.local`;
- an `EXPO_PUBLIC_*` variable;
- a command, screenshot, chat, log, fixture, or committed file.

The API does not automatically load the root `.env`. Load it into the current terminal before starting the API:

```bash
set -a
source .env
set +a
pnpm dev:api
```

## Configuration checkpoint

With the API running:

```bash
curl --fail --silent --show-error \
  http://127.0.0.1:4000/v1/coach/status
```

Expected shape:

```json
{
  "ready": true,
  "provider": "mistral",
  "model": "mistral-medium-latest",
  "externalAccess": true
}
```

This proves local configuration only. The status route does not contact Mistral or validate the key.

## Port 4000 is already in use

Symptom:

```text
listen EADDRINUSE: address already in use 127.0.0.1:4000
```

Find the exact listener:

```bash
lsof -nP -iTCP:4000 -sTCP:LISTEN
```

Inspect its PID before stopping anything:

```bash
ps -o pid,ppid,lstart,command -p <pid>
```

If and only if it is a stale Mizyun API process:

```bash
kill -TERM <pid>
```

Do not use a broad `pkill node`; other development tools may be running.

## Live synthetic testing

The versioned `coach-live-synthetic-v1` harness makes exactly two external,
billable requests: one grounded fictional-nutrition case and one missing-evidence
case. The normal `pnpm check` gate always skips both tests.

Before running it, confirm the development workspace has:

- a dedicated development key;
- a small workspace spend cap;
- the intended training/retention controls;
- no Labs model enabled;
- no real user data in the fixture;
- explicit approval for these two billable requests in the current session.

After that approval, load the ignored root environment and set the exact opt-in
sentinel only for this process:

```bash
set -a
source .env
set +a
MISTRAL_LIVE_SYNTHETIC_WORKSPACE=dedicated-capped-development \
MISTRAL_LIVE_SYNTHETIC_CONFIRM=AI-MOB-001-2026-07-23 \
  pnpm ai:live-synthetic
```

Expected output includes two passing cases and one `[live-synthetic]` metadata
line per case. Those lines contain only the case/dataset/prompt/model versions,
SDK version, finish reason, total tokens, and coarse latency bucket. They must
never contain prompts, answers, account identifiers, health values, request IDs,
or credentials.

The first proven live call predates this harness and invoked
`MistralAgentProvider` directly with a fictional confirmed record. It returned
schema-valid output, `stop`, 342 total tokens, and a 1–3 second latency bucket.
Do not repeat that ad hoc command. Live moderation and tool-call coverage are not
implemented by the current stateless snapshot and still block full AI-EVAL and
provider promotion. Timeout, abort, 429, malformed-output, and retry behavior
remain deterministic fake-boundary tests rather than deliberately failing live
calls.

## Physical-phone preflight

Before installing a development build:

1. Confirm whether the target is iPhone or Android.
2. Keep the Mistral key on the API host; the phone receives only the API URL.
3. Choose a trusted-LAN or hosted development endpoint. A physical phone cannot reach the Mac through `127.0.0.1`.
4. Configure mobile public URLs for that endpoint without copying server secrets.
5. Use a disposable synthetic account and synthetic records.
6. Exercise disabled/offline/retry behavior before enabling the live provider.
7. Stop the API and local Supabase when the run ends.

Local Supabase is not hardened for public exposure. Do not open its ports to the internet.

### Physical iPhone over a trusted LAN

This path is for a directly supervised synthetic development run, not TestFlight
or external distribution. The iPhone and Mac must share a private Wi-Fi network
without client isolation; disable a VPN if it prevents local routing.

First inspect the host and attached-device state without changing it:

```bash
xcodebuild -version
xcrun --sdk iphoneos --show-sdk-version
xcrun xctrace list devices
security find-identity -p codesigning -v
ipconfig getifaddr en0
lsof -nP -iTCP:4000 -sTCP:LISTEN
lsof -nP -iTCP:54321 -sTCP:LISTEN
```

Do not copy the phone UDID, signing identity, Apple account, or LAN IP into
committed evidence. On the phone/Mac, the developer must then:

1. connect the unlocked iPhone by USB and accept **Trust This Computer**;
2. enable **Settings → Privacy & Security → Developer Mode**, restart, and
   confirm the post-restart prompt if iOS requests it;
3. let Expo/Xcode use an Apple Personal or Developer Team for automatic signing;
4. accept the app's local-network permission prompt on first launch.

A Release bundle embeds `EXPO_PUBLIC_*` values at build time. Put only these
public values in the ignored `apps/mobile/.env.local`, replacing the placeholder
with the current Mac LAN IPv4 address and using the local publishable key:

```dotenv
EXPO_PUBLIC_API_URL=http://<mac-lan-ip>:4000
EXPO_PUBLIC_SUPABASE_URL=http://<mac-lan-ip>:54321
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<local publishable key>
```

Keep `MISTRAL_API_KEY`, `SUPABASE_SECRET_KEY`, and all server controls in the
ignored root `.env`. Temporarily start the API with `API_HOST=0.0.0.0` only while
on the trusted LAN; never add router forwarding or a public tunnel. Begin with
`AI_EXTERNAL_ACCESS=false`.

With the phone visible in `xcrun xctrace list devices`, build, sign, install, and
launch the standalone Release app without Metro:

```bash
pnpm --filter @mizyun/mobile exec expo run:ios \
  --configuration Release \
  --device "<physical iPhone name>" \
  --no-bundler
```

If automatic signing cannot resolve `com.mizyun.app`, open the generated
`apps/mobile/ios/Mizyun.xcworkspace`, select the Mizyun target, and choose the
correct Team under **Signing & Capabilities**. Do not silently commit a different
bundle identifier or durable edits to generated `apps/mobile/ios` output.

Run default-off/offline acceptance before enabling Mistral. Immediately before
any live Coach request, obtain fresh approval for the exact call count and
confirm synthetic-only data, the capped workspace, its retention/training
setting, and trusted-LAN state.

At the end, delete the disposable application records and Auth identity, set
`AI_EXTERNAL_ACCESS=false`, stop the API and Supabase, restore loopback public
URLs/API host, and remove the development-signed app if it should not remain on
the phone.

## Teardown

Stop the API with `Ctrl-C`, then:

```bash
pnpm db:stop
```

Set `AI_EXTERNAL_ACCESS=false` when live development testing is not actively in progress. Rotate the development key if it appears in chat, shell history, logs, screenshots, or source control.
