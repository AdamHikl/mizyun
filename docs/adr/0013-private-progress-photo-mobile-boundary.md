# ADR 0013: Private progress-photo mobile boundary

- Status: accepted
- Date: 2026-07-21

## Context

Progress photos are sensitive, device-originated files. Camera and library assets can contain large dimensions and metadata, including location-bearing EXIF. The API already issues user-scoped one-time upload URLs and exposes short-lived signed downloads, but the mobile client still needs a clear consent, preparation, recovery, and deletion boundary.

Expo ImagePicker can launch the camera or system library and recover an interrupted Android picker result. Expo ImageManipulator can render a new image before upload. The upload itself must remain compatible with the provider-issued signed URL rather than proxying sensitive bytes through the API process.

## Decision

- The progress-photo screen requires an explicit, per-upload consent acknowledgement before opening either picker.
- The picker requests no EXIF data. Every selected asset is rendered to a new JPEG, capped at a 2,048-pixel longest edge and encoded at 0.85 quality before validation and upload. The re-encode prevents source metadata from being carried into the authoritative upload.
- The client validates the normalized byte count and dimensions, requests a server-created upload ticket, then sends the JPEG directly to the one-time signed Storage URL.
- If the direct transfer fails after metadata creation, the client performs best-effort asset deletion so a broken timeline entry is not retained.
- Android pending picker results are recovered after process interruption. Recovery failures are visible to the user and ignored after the screen unmounts.
- Timeline images use short-lived signed URLs. Comparison remains explicitly a visual reference, and deletion requires destructive confirmation that states the bytes are permanently removed.
- The Expo ImagePicker and ImageManipulator packages are pinned to exactly `57.0.2`. Compatible semver ranges are insufficient for this native boundary because `57.0.5` produced a launch-time symbol mismatch against the installed ExpoModulesCore `57.0.3`.

## Consequences

- Original camera/library files remain untouched on the device; only a bounded, metadata-stripped derivative is uploaded.
- Re-encoding adds local CPU work and can slightly change image quality, but reduces payload size and privacy exposure.
- The app does not request microphone access for camera capture.
- Native dependency upgrades at this boundary require a regenerated CocoaPods graph plus a Release simulator launch, not only TypeScript tests or a Metro export.
- A hard process termination between ticket creation and client cleanup can still leave metadata without bytes. An explicit server-side upload-finalization state remains a future hardening option if alpha evidence warrants it.
- Native camera, library, interruption recovery, signed transfer, and deletion still require authenticated device acceptance on both platforms; web interaction and bundle export are implementation evidence, not substitutes.
