# Founder testing mode

This is the standing operator policy for Mizyun until Adam changes it:

> Keep every implemented feature enabled in both the development app and the
> founder-production app. Use the founder-production app for personal testing.

This policy applies to the self-hosted founder environment only. It does not
authorize external users, a paid beta, or a release claim that the AI/provider
checklists are complete.

## Enabled configuration

Both API environments should use the following server-side settings:

```dotenv
AGENT_PROVIDER=mistral
VISION_PROVIDER=disabled
AI_EXTERNAL_ACCESS=true
MISTRAL_MODEL=mistral-medium-latest
MISTRAL_VISION_MODEL=mistral-medium-2508
```

`VISION_PROVIDER=disabled` is intentional: the production composition root
selects the real Mistral vision/nutrition-draft provider when
`MISTRAL_VISION_API_KEY` is present. The value must not be changed to `stub` in
production. The text and vision keys remain server-only and must never appear
in `EXPO_PUBLIC_*` mobile configuration.

The vision model is pinned to `mistral-medium-2508`, an official Mistral vision
model. The text model remains the existing `mistral-medium-latest` setting
until a separate model evaluation changes it.

## Development

Copy the ignored root environment from `.env.example`, then set the values
above and provide the development text and vision keys. Start the API with:

```bash
set -a
source .env
set +a
pnpm dev:api
```

Verify the non-secret provider state:

```bash
curl --fail --silent --show-error http://127.0.0.1:4000/v1/coach/status
```

## Founder production

The source of truth is `/etc/mizyun/production.env` on the Windows/WSL2
founder PC. Keep the keys in that file, set mode `0640`, and restart only the
API after changing provider settings:

```bash
sudo systemctl restart mizyun-api
systemctl is-active mizyun-api
curl --fail --silent --show-error https://mizyun-api.phiskel.com/v1/health
curl --fail --silent --show-error https://mizyun-api.phiskel.com/v1/coach/status
```

A code deployment still goes through `pnpm deploy:remote`; do not edit the
production checkout manually or run a database reset there. Make a backup
before any data-affecting maintenance.

## What “everything” does not mean

Only implemented, reviewable features are enabled. Features that do not yet
exist (for example HealthKit/Health Connect synchronization, billing, or
community sharing) cannot be enabled by configuration. Product analytics stays
local and consent-controlled; it must not be forced on for a user.

This mode is for Adam's own testing. It remains subject to the provider,
safety, privacy, deletion, and cost limitations in `docs/BEFORE_TESTING.md` and
does not make the app ready for other users.

## Turning a feature off

Change the relevant server setting in both environments, restart the API, and
record the change here. To disable external AI while preserving the rest of the
app, use:

```dotenv
AGENT_PROVIDER=disabled
AI_EXTERNAL_ACCESS=false
```

To disable nutrition/photo drafts only, remove
`MISTRAL_VISION_API_KEY` from the server environment (do not use a production
stub).
