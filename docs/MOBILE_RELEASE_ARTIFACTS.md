# Mobile release artifacts

Preserved Android and iOS release deliverables live under one ignored local directory:

```text
apps/mobile/dist/releases/
├── android/
│   ├── google-play/       # signed AAB upload candidates
│   └── device/            # standalone APK install candidates
└── ios/
    └── app-store/
        ├── archives/      # retained .xcarchive bundles
        └── packages/      # verified IPA release directories and manifests
```

Run `pnpm mobile:release-artifacts:list` from the repository root to print the inventory.

The Production Android bundle build requires a clean commit and writes checksum-bound provenance beside its generated AAB. The signing script signs a staged copy, fails closed on any certificate or provenance mismatch, and atomically preserves the verified AAB in `android/google-play/`. The Production iOS IPA script publishes each verified IPA, checksum evidence, and manifest under `ios/app-store/packages/`, and retains the matching Xcode archive with its dSYMs under `ios/app-store/archives/`.

Directories under `apps/mobile/android/app/build/` and `apps/mobile/ios/build/` remain disposable native build outputs. They are not the canonical artifact library. Artifact names must describe their embedded version and build number; renaming an old binary does not make it a new release.

Xcode Organizer may retain its own system-managed archive copies under `~/Library/Developer/Xcode/Archives`. Keep those in place for Organizer history; the copies under this library are the easy-to-find project inventory.
