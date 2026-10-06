# ADR-0044: Bind mobile configuration to the installed application

Date: 2026-10-06
Status: Accepted for local implementation
Related: ADR-0004; #211

## Context

Expo SDK 57 Debug bundles read a virtual environment. Its dotenv merge can override an exported shell snapshot even when CLI dotenv loading is disabled. A Dev manifest can therefore describe Dev while the effective JavaScript clients use Production endpoints. Manifest checks alone do not establish the installed binary identity.

## Decision

For reviewed shell-based builds using `EXPO_NO_DOTENV=1`, resolve the Debug virtual environment to Expo's public shell snapshot. Preserve standard dotenv Debug behavior and Release Babel inlining. Serialize public values only; never add secret keys to the manifest.

Before constructing Auth or API clients, compare effective endpoints with a public manifest routing snapshot and the allowed origins/callback scheme. On native platforms, require the installed `expo-application` ID to match the platform manifest ID and declared variant. Missing, unknown or conflicting configured identities disable both clients. Production accepts its own identity and canonical hosts. Local Dev loopback endpoints remain supported. Web requires a usable manifest; Expo Go Dev requires its known native host ID and native store-client execution environment. Empty setup remains disabled.

Use the already present Expo Application 57.0.3 module as a direct dependency; this does not introduce a native module upgrade.

## Consequences and acceptance

A mismatched configuration cannot restore a session or refresh a token through a wrongly selected client. Independent non-author High review and actual installed Expo Debug/Release transform regressions are required. Simulator signed-in Dev behavior supplements these checks; physical standalone Dev/Production and release acceptance remain separate.

## Primary sources checked 2026-10-06

- [Expo environment variables](https://docs.expo.dev/guides/environment-variables/): public JavaScript variables and static property access.
- [Expo Metro customization](https://docs.expo.dev/guides/customizing-metro/): delegate ordinary resolution and scope custom resolution.
- [Expo Application SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/application/): installed application ID.
- Installed Expo 57.0.23 and React Native 0.86.3 source plus the real transform tests define the observed SDK behavior.
