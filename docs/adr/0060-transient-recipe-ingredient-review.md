# ADR 0060 — Transient recipe photos and owner-scoped ingredient recovery

- Date: 2026-10-13
- Status: accepted for REC-04 local implementation; native/live/release acceptance open
- Package: AI-RECIPES-001/#241, NUT-RECIPES-03/04/06

## Decision

Meals and Coach will share one reusable ingredient-review host in REC-05. REC-04 provides acquisition, a controlled editor and a controller without navigation or consumed-meal writes. A singleton native adapter owns positively attributed picker/manipulator outputs and reduced JPEG cache files. Decoded dimensions, actual bytes and server capabilities gate analysis. Library selection uses the system picker without broad photo access; camera permission is checked before and after selection. Native multipart descriptors have own enumerable URI/type/name/size fields because React Native FormData spreads file objects.

Raw photos/URIs are absent from recovery and exports. The controller persists only typed or explicitly confirmed ingredients, a photo-reselection flag and the caller-generated pending request UUID before dispatch. Recovery expires after 24 hours and is owner/schema/size validated. SecureStore-backed 512-unit chunks reuse the public storage adapter; a content-free generation/count cleanup journal repairs orphan chunks after interrupted writes. Failed persistence prevents analysis/confirmation. Unknown preparation state, catalog identity and quantity remain unknown; REC-05 must resolve unsupported IDs/states before strict suggestion admission.

Analysis is one deliberate attempt with no background upload/retry. Cancel, disposal, backgrounding, consent retirement, owner change and account deletion fence late responses before asynchronous cleanup. The Android system picker can temporarily background the app and is exempt while selection is in progress. AI retirement leaves manual review usable. Account erasure invalidates queued recovery writes and reports failed cleanup; mobile export combines the server envelope with this owner's bounded recovery under captured owner/token/generation fences.

## Consequences and limits

Photos are temporary device cache files during review, never retained meal attachments or pantry inventory. Observable failed cleanup blocks progression and can be retried. Startup discards stale managed cache bytes and returned Android pending results; recovery requires photo reselection. Files never returned by Expo after cancellation/crash cannot safely be attributed in its shared cache. No shared ImagePicker directory sweep is permitted. This native limitation and real permission/HEIC/orientation/multipart/cleanup behavior require both-platform acceptance before release.

No AI/provider/backend policy changes, permanent pantry database, quantity/freshness/allergen inference or intake mutation are introduced. REC-03 remains the server authorization/budget authority and defaults live recipes off.

## Sources

Checked exact [Expo 57 ImagePicker](https://docs.expo.dev/versions/v57.0.0/sdk/imagepicker/), [ImageManipulator](https://docs.expo.dev/versions/v57.0.0/sdk/imagemanipulator/), [FileSystem](https://docs.expo.dev/versions/v57.0.0/sdk/filesystem/), [SecureStore](https://docs.expo.dev/versions/v57.0.0/sdk/securestore/) and [React Native 0.86 AppState](https://reactnative.dev/docs/0.86/appstate). Installed SDK types confirm asynchronous File.copy; installed React Native FormData confirms descriptor spreading. No dependency upgrade is included.
