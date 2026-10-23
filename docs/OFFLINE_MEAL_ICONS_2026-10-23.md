# Offline meal icons — 2026-10-23

## Report and cause

Adam reported on the Dev iPhone (build `20806d8d`) that in airplane mode meal photos showed but the bundled meal icons did not.

The icons are Pro display, gated by a fresh server capability with a 30-second lease (ADR-0053). `useMealVisualCapability` treated any failed check, including "no network", exactly like a denial, and also cleared the remembered confirmation. Device photos show because ADR-0079 renders them from the phone without the network or a Pro check. The behaviour predates the offline cache work (#327/#329), which did not touch this hook.

## Change

Adam's decision on 2026-10-23 is recorded as the [ADR-0053 amendment](adr/0053-automatic-meal-illustrations.md#amendment--offline-display-of-bundled-icons-2026-10-23).

- `meal-visuals-offline-grant.ts` keeps the last server confirmation time per account in SecureStore (`mizyun.meal-visuals.last-grant.<userId>`). Writes are throttled to once an hour, and the record is valid for 48 hours. Future, unreadable and other-account values are ignored.
- `meal-visual-capability.ts`: when the check times out or returns a transport failure (`network_error`), the lease is renewed if a confirmation from the last 48 hours exists. Any server answer still closes the lease. A denial (`mealVisuals: false`, 401/402/403, expired session) also deletes the saved confirmation. Server errors (for example 503) close the lease but keep the confirmation.
- Account deletion removes the record (`account-data-management.ts`). Sign-out keeps it, because it is scoped by account id.

## Review

An independent Opus review found 1 blocker and 2 should-fix items. The blocker and the first should-fix are repaired; the captive-portal item is documented as a decision.

- **Blocker:** after about an hour offline, the sign-in token refresh fails inside `getSession()` and throws (supabase `AuthRetryableFetchError`, wrapped as `IdentityError`). No `network_error` reached the hook, so the grace did not apply. The hook now treats that thrown error, and transport `TypeError`s, as unreachable.
- **Should-fix:** grace display returned `true` from `refresh()` and gated server-backed visuals. Now:
  - `refresh()` is true only for a server confirmation, so photo backup on save still needs one;
  - the hook exposes `offline`;
  - `MealVisual` shows only the bundled icon under the grace (no signed photo read, no generation);
  - the edit screen does not use the grace.
- **Nit:** a cold offline launch shows icons at once from the device record. A server answer counter stops a slower device read from reopening a lease a server answer closed.
- **Decision:** a captive portal (non-JSON reply, `parse_error`) counts as a server answer. This is stated in the ADR.

## Verification

- New tests cover:
  - offline after a confirmation;
  - cold offline launch, immediate and after the timeout;
  - expired, future, unreadable and other-account records;
  - denial and 401/403 ending offline display, and a 503 keeping the record;
  - the `offline` flag and `refresh()` false under grace;
  - an Auth refresh failure treated as unreachable;
  - the server-answer race;
  - `MealVisual` showing only the bundled icon offline.
- The Auth-refresh and race regressions fail without their repairs.
- The two existing timeout tests now model a device with no earlier confirmation.
- A bounded re-review confirmed the repairs. It found that the meal list passes `editable`, so the icons-only branch now applies to editable rows too; the test uses an editable row with a server photo.
- Full gate: `pnpm check` PASS (EXIT 0) for input SHA-256 `313be7d75b926af583865c181fac062989f6de164728e3b25d493d4462e90251` on `5523388e` plus this diff: mobile 3723 tests, API 1377 passed / 15 skipped (e2e). status.md and this line are post-check records.

## Open

- Not committed, deployed or installed.
- Device check: open Meals online once, then turn on airplane mode. Icons should stay on Meals, including after a force-quit and relaunch. A downgraded test account should lose its icons as soon as it is online.
