# ADR-0049 — Private meal thumbnails on Dev

Status: Accepted for Dev implementation, 2026-10-06. Production release not authorized.

## Context

Users can scan a meal photo and confirm a meal, but the analysis bytes are transient and saved cards show only text. The user authorized a compact retained image to help recognize meals. Retention is explicit and separate from AI analysis; it must not require another model call.

## Decision

Keep at most one optional compressed JPEG for a confirmed meal, longest edge640px and maximum256KiB. The phone creates an app-owned reduced copy and the server decodes/reencodes trusted pixels to strip metadata. Full-resolution originals remain outside retained meal storage.

Show a56–64point thumbnail in the saved card and a larger preview with a separate removal action. Keep text accessible and preserve meals without a photo. Users choose which source photo belongs to each meal when multi-photo analysis returns separate drafts.

The confirmed meal remains authoritative if photo upload fails. Persist a user-scoped local retry with a stable operation identity and remove only app-owned reduced copies. Requests/rendered photos must be scoped to account/session generation. Initially use cachePolicy none for remote thumbnails and previews.

Use typed owner-validated association to existing private-media assets. Mutations must enforce server processing and Dev-only activation independently of caller input; do not trust arbitrary food-entry details or claimed JPEG dimensions. Photo/meal/account deletion, abandoned uploads and late uploads require durable recoverable cleanup. Existing account exports include retained private-media assets through expiring download links. Signed links are never durable identifiers.

The Dev manifest exposes enableMealPhotos only for the Dev variant. Backend activation is explicit and fail-closed outside the verified Dev environment. This decision supersedes transient-only meal-photo retention for explicitly opted-in Dev records; photo-derived nutrition still requires user confirmation and existing AI consent/admission.

## Consequences

Photos remain sensitive despite reduced detail. Storage and backup use grows with photographed meals; measure actual compression distributions before capacity claims. Retained photo attachment does not imply exact nutrition, publication, or permission to send it again to a model. Existing photos cannot be recovered from earlier transient scans. Copies/recurrences must not silently imply a newly photographed meal.

## Sources and acceptance

[Research log](../RESEARCH_LOG.md), [evidence](../MEAL_PHOTOS_DEV_EVIDENCE_2026-10-06.md), [issue#218](https://github.com/AdamHikl/mizyun/issues/218). Required: independent sensitive review, focused failure/isolation regressions, forward migration/RLS tests, full repository gate, exact Dev route verification and native journeys. Source/tests/install are separate evidence tiers.
