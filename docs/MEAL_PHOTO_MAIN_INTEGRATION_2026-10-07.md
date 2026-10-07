# Meal-photo main integration — 2026-10-07

Issue [#218](https://github.com/AdamHikl/mizyun/issues/218). User authorized merging the isolated photo branch into main and reinstalling Mizyun Dev on the physical iPhone. Main baseline `2c61518c29621ff3ca5c2ef8645afce01e95c740`; feature tip `a64a15898c43ece0c2e551086f040c645e2b5baa`. The prior Community installation replaced the photo-enabled app with a main-based bundle without retention/thumbnail code.

## Integration

Merge conflicts preserve both Health export provenance/session hooks and photo ownership/generation/retry logic. Running modules are part of the incoming branch; Home shortcuts and native Health modules remain intact. The private-photo ADR uses0049 to preserve the active Community ADR0048. Existing Community working-tree changes remain separately owned and uncommitted.

Independent High non-author review found photo purge false/rejection was discarded by Promise.allSettled. Both storage-failure regressions failed before repair; cleanup now settles unrelated work then surfaces failure through the existing local-only retry flow. The account completion message reports local data cleanup rather than naming only Health exports. Focused settings cleanup/UI tests:21PASS.

## Verification and installation

Independent High final review is clear. Fresh focused suites passed: mobile442/API131/adapter36/contracts32/config1. The full `pnpm check` passed input SHA-256 `2e5d1fa971ae6f3fed79c30aa5467f09932d6790469a2f830e1c13c4fc136935`: mobile1664/API880, with15 existing credential-gated API skips and3 config fixture skips. Real iOS and Android exports, types, format/navigation and operational safeguard gates passed. Existing documented SQL/public Dev proof remains historical; no fresh database/native acceptance is claimed. Main integration and standalone iPhone installation are next. No provider calls, remote database operations, backend deployment or Production/Store action is authorized by this package.

## Remaining acceptance

After installation, log a new meal with Keep photo with meal enabled, reopen the card and verify thumbnail/preview/removal. Existing meals created by the replaced build may have no retained image. Exact physical offline/restart/account-switch/multi-photo/accessibility/Android acceptance remains open under218; installation is separate evidence.
