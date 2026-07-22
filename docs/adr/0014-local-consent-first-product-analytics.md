# ADR 0014: Local, consent-first product analytics boundary

- Status: accepted
- Date: 2026-07-22

## Context

OBS-001 must measure activation, logging friction, failures, return use, and coarse feature adoption before the founder/design-partner alpha. Mizyun handles fitness, nutrition, body, and photo data, while OBS-01 prohibits those payloads and identifiers from analytics. Selecting a network analytics vendor before fixing the event contract would let SDK defaults, automatic context, and processor identifiers shape the privacy boundary.

## Decision

Introduce `@mizyun/observability` as a provider-neutral package containing a closed versioned event union, exact persisted-event parser, consent/event-store ports, non-throwing client, and coarse measurement buckets.

For schema version 1:

1. Consent is `unknown`, `granted`, or `denied`; unknown and denied record nothing. Consent is requested without blocking onboarding and can be changed from Account. Denial clears prior local events.
2. The Expo adapter stores the consent preference and at most 500 valid events for 30 days in separate app-private document files. Events contain timestamps but no account/device identifier. Keeping consent in the app container means uninstalling the app resets the choice instead of relying on an iOS Keychain value that may survive reinstallation.
3. There is no analytics processor, SDK, automatic network transmission, or background upload. The only egress is a user-initiated JSON export through the native share sheet.
4. Every event and property is enumerated in `docs/OBSERVABILITY.md`. The runtime parser rejects unknown names, values, or extra properties, including a tampered local file.
5. Analytics operations return safe no-op/empty results on failure. Core flows never await successful analytics recording before saving or navigating.
6. Duration, taps, and retry counts are bucketed. Failures use enumerated stage/reason values; exception text and API bodies are excluded.
7. Sign-out fire-and-forgets denial/clearing before ending the auth session, preventing a later account on the same device from inheriting analytics state without allowing analytics failure to block sign-out.

## Rejected alternatives

- A vendor SDK now: rejected because automatic identifiers/context, processor terms, network failure behavior, deletion, and store disclosures have not been evaluated.
- Server-side events keyed by the authenticated user: rejected because it creates a directly linked behavioral profile when alpha validation can use voluntary local exports.
- Storing pre-consent events for later release: rejected because collection would occur before the user's choice.
- Arbitrary `track(name, properties)` dictionaries: rejected because code review and TypeScript could not prove that sensitive fields are impossible.

## Consequences

- The founder can evaluate small-alpha activation, logging buckets, return days, failures, and feature adoption from voluntary exports without operating an analytics backend.
- Onboarding completion is measurable only for users who grant consent before completing onboarding; refusal remains a valid unmeasured state.
- Exports are intentionally unlinked. Cross-device/user cohort and server-side dashboards are deferred.
- Adding a processor, identifier, SDK, automatic upload, new event/property, or longer retention is a new privacy/architecture decision requiring research, catalog/disclosure updates, and tests.
- Apple App Privacy and Google Play Data safety answers remain a release-time review of actual shipped behavior; this ADR does not declare legal or store compliance.
