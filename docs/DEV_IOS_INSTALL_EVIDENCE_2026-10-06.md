# Dev iPhone installation — 2026-10-06

User requested installation of the latest Dev app on the physical iPhone after the usability commit was pushed.

- Source: `f40e8941afc5307efce6d5c5909c0146ed1f3dda`; native project regenerated from this candidate. Only pre-existing Build9 release evidence/status edits were dirty; no source changes. Pre/post hashes of1039 tracked source/config files match.
- Command: `pnpm mobile:install:ios:dev --device 00008140-001114501A86801C --clean` — exit0. Log: `/private/tmp/mizyun-iphone-dev-install-2026-10-06.log`.
- Device: Adam's paired iPhone16Pro, UDID `00008140-001114501A86801C`.
- Artifact: `apps/mobile/ios/build/Build/Products/Release-iphoneos/MizyunDev.app`; standalone Release, team `LQJNDVBL43`, `com.mizyun.development`,1.0.9(9). Installed at `2026-10-06T16:10:41Z`.
- Embedded `EXConstants.bundle/app.config` matches Dev API `https://mizyun-api-dev.phiskel.com`, Supabase `https://mizyun-supabase-dev.phiskel.com`, callback `mizyun-dev://auth/callback`, and native bundle ID.
- `MizyunDev` SHA256: `90b89401099ccef084d8280d9958c82e2f4987e762b7eb5189a39c699ffcb53f`. Embedded `main.jsbundle` SHA256: `5b5d9c7cb9a1bec37ab7f46cb2384e7e64371a664815c53e08be46a68cfe5d25`.
- Strict/deep signature verification passed in normal macOS trust context; sandbox-only lookup initially returned CSSMERR_TP_NOT_TRUSTED. Signed Apple sign-in entitlement verification passed.
- Installer reported positive launch; independent `devicectl device info apps --bundle-id com.mizyun.development` confirmed1.0.9(9). Independent process inventory confirmed main app PID9234 and widget PID9226 in the newly installed bundle container. Installer PID parsing did not recognize the newer launch output; process inventory supplies positive evidence.
- No Metro listener on8081. No backend deployment, Production app installation, Store upload or release.

Separate High read-only preflight review found no blocker and recommended clean regeneration of stale1.0.7 native metadata. EXApplication57.0.3 was already present natively; no new native version was introduced.

The immediately preceding canonical full gate passed on the source candidate: input SHA256 `fae6cad1da54b9f05f4caa6442a5d702139189b70b6b5b94309fa2560bc66898`, mobile1476 tests passed, API852 passed/15 existing credential-gated E2E skips. It was not rerun for this installation; tracked source remained unchanged. [Usability evidence](USABILITY_FOLLOWUP_EVIDENCE_2026-10-06.md) records simulator journeys and outstanding acceptance.

Installation/launch does not accept signed-in physical-device feature, maximum-font, keyboard, VoiceOver or Android journeys. Next: test those journeys on this installed candidate (#210/#213). Earlier Adam-accepted build6 signed-in meal/workout/Coach/background journeys remain historical, documented in [October4 delivery evidence](DEV_DELIVERY_EVIDENCE_2026-10-04.md); they do not accept this build9 candidate. Existing backend authority and broader release gates remain unchanged.
