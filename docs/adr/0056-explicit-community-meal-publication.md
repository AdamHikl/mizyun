# ADR 0056: Explicit Community meal publication

Date: 2026-10-12

Status: Accepted for implementation at Adam's request; native and release acceptance remain separate.

## Context

Community currently publishes workouts. Adam requested meal sharing throughout Community and deferred iOS simulator testing. Meals contain sensitive nutrition, notes and private media. A second social system would duplicate audience and lifecycle safeguards.

## Decision

Extend shared activities with an explicit meal kind and an allowlisted meal snapshot. The author selects a saved, confirmed, owned meal, reviews its name and day, and may separately include calories, protein, carbohydrates and fat. Nutrition starts off. Photos, notes, arbitrary food details, provider metadata and Coach context are excluded. Private source identifiers are available only to the author for management.

Meal cards use the existing feed, profiles, detail routes, comments, encouragements, reporting, block/mute, expiry, withdrawal, export and deletion controls. No new audience or automatic sharing is introduced. Existing workout responses remain compatible. Changes to the shared source name/day/nutrition, unconfirmation and deletion revoke publication; a fresh preview and explicit action are required to publish again. Version and generation checks prevent stale previews/retries from resurrecting an old snapshot.

This supersedes the workout-only projection and nutrition exclusion in [ADR-0030](0030-explicit-community-publication.md) and the [Community contract](../COMMUNITY_PRODUCT_CONTRACT.md) only for the explicitly chosen meal fields. Existing admission, operator, legal, native, privacy and Production gates remain in force. Meal publication itself is a separate consent choice; the existing enrollment receipt does not authorize it.

## Verification

Contract/API/adapter tests must cover confirmed ownership, projection minimization, optional nutrition, stale previews, retry/version fencing, source revocation and mixed reads. Real local SQL must cover recipient isolation and lifecycle behavior. An independent High reviewer audits the settled migration and privacy diff. The full repository gate remains required. Simulator/device journeys remain unrun until the later session requested by Adam.

## Sources checked

- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [PostgreSQL CREATE FUNCTION](https://www.postgresql.org/docs/current/sql-createfunction.html)
- [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/)
- [React Native AppState](https://reactnative.dev/docs/appstate)

Accessed 2026-10-12; [research log](../RESEARCH_LOG.md) records implementation consequences.
