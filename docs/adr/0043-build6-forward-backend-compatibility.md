# ADR-0043: Build 6 compatibility during build 7 promotion

Status: accepted for implementation, 2026-10-04. Production evidence is recorded separately.

The backend is upgraded before all installed clients can update. Preserve existing unversioned routes, required response fields, action discriminators and defaults. Verify current handlers against pinned original build6 iOS/Android schemas with synthetic data. New fields remain additive; analytics reads/exports use their existing legacy projection unless a caller requests the richer catalog. Old workout set writes continue to default to normal.

An old app cannot see or edit advanced nutrient estimates. If an explicit base-macro change makes an omitted retained saturated-fat or sugar estimate impossible, clear only that dependent estimate to null (unknown). Preserve other nutrients and name-only edits. Explicit contradictory advanced edits still fail validation, and Pro/auth/RLS safeguards remain unchanged. No fabricated clamping or schema weakening.

Coach's trusted catalog identifies1.0.7/build7 and qualifies newer UI controls. Older clients retain Account-tab and manual-logging guidance; backend source does not establish installed-client capability.

Production backup must capture coherent previous code and schema before checkout/install. Backup recovery resumes that previous release; stop the exact API unit before in-place code/dependency/migration replacement. A db push attempt may commit a subset before failure: journal attempted versus complete, conservatively flag possible changes and never automatically revert forward migrations. Restore the dependent shared tunnel on success/rollback; extend only exact Production API stop and cloudflared start permissions, retaining role/host/port/path/lock guards.

Sources: [Supabase db push](https://supabase.com/docs/reference/cli/supabase-db-push), [Expo SDK57](https://docs.expo.dev/versions/v57.0.0/), [Android versioning](https://developer.android.com/studio/publish/versioning), accessed2026-10-04. Device, real database upgrade, signing and Store acceptance are distinct from synthetic wire compatibility.
