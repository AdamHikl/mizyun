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
AI_EXTERNAL_ACCESS=true
```

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

Before a live request, confirm the development workspace has:

- a dedicated development key;
- a small workspace spend cap;
- the intended training/retention controls;
- no Labs model enabled;
- no real user data in the fixture.

The first proven live call invoked `MistralAgentProvider` directly with a fictional confirmed record and recorded only the answer plus bounded provider metadata. It returned schema-valid output, `stop`, 342 total tokens, and a 1–3 second latency bucket.

Do not repeat ad hoc provider commands as the evaluation strategy. The next implementation task is an opt-in, versioned live-synthetic harness covering grounding, missing data, safety, moderation, and provider failures.

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

## Teardown

Stop the API with `Ctrl-C`, then:

```bash
pnpm db:stop
```

Set `AI_EXTERNAL_ACCESS=false` when live development testing is not actively in progress. Rotate the development key if it appears in chat, shell history, logs, screenshots, or source control.
