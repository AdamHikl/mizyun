# Store billing (#332, GTM-01) — handoff 2026-10-26

Decision: [ADR-0080](adr/0080-store-billing-revenuecat-entitlements.md). Research: `docs/RESEARCH_LOG.md` 2026-10-26. Baseline `a3947503f61c2aa50db492489cbcb426e86d8791`; the commit on branch `claude/gtm-01-store-billing-668be5` holds the change. Not deployed and not a release.

## Implemented (source, automatically verified)

- **Server**: `apps/api/src/modules/billing` holds the signed RevenueCat webhook, idempotent through the `billing_webhook_events` ledger. The webhook re-reads the subscriber over REST and the server decides. It also adds `GET /v1/billing/entitlement` and `POST /v1/billing/entitlement/sync`. Vendor code lives in `packages/adapters/revenuecat-server`; the pure rule is `packages/core/src/billing.ts`; the flag is `packages/config/src/billing.ts`.
- **Database**: migration `20261026140000_store_billing_entitlements.sql`.
  - It adds `subscription_entitlements` (owner select RLS, PK `user_id`, service-role writes, cascade, export).
  - `billing_apply_entitlement` / `billing_recompute_plan_tier` are SECURITY DEFINER, service role only. They take the profile lock, write only newer snapshots, and set paid for an active subscription or Beta Pro. They clear paid only when a subscription that granted it ends.
  - The Beta Pro rejection trigger keeps an active subscription paid.
- **Contracts**: `packages/contracts/src/billing.ts`. Account export gains `subscriptionEntitlements` (`docs/ACCOUNT_EXPORT_INVENTORY.md` 2.12).
- **Mobile**: Account → AI coach → Mizyun Pro plan (`apps/mobile/src/features/billing`).
  - Order on screen: current plan, Store prices (yearly default), renewal disclosure, Subscribe/Start free trial, Restore purchases, Manage or cancel subscription, Terms and Privacy.
  - `react-native-purchases` 10.12.2 is configured only on this screen, with the Supabase user id.
  - The public SDK key comes from the server; the bundle holds no secret.
  - The deletion card warns that deleting the account does not cancel the Store subscription.
- **Flags**:
  - `BILLING_ENABLED`: on in Dev unless `false`, off elsewhere unless `true`.
  - Billing also needs `REVENUECAT_SECRET_API_KEY` and `REVENUECAT_WEBHOOK_SIGNING_SECRET`.
  - Optional: `REVENUECAT_WEBHOOK_AUTHORIZATION`, `REVENUECAT_IOS_PUBLIC_KEY`, `REVENUECAT_ANDROID_PUBLIC_KEY`, `REVENUECAT_ENTITLEMENT_ID` (default `pro`), `REVENUECAT_OFFERING_ID`.
  - `BILLING_ALLOW_SANDBOX` defaults to true in Dev, false elsewhere.

## Evidence (2026-10-26, this worktree)

- **Focused vitest**:
  - api billing: 27. The failure tests were mutation-checked: disabling the signature or replay check fails 7 tests.
  - api account: 87. Core billing: 26. Config billing: 4.
  - RevenueCat adapter: 80. Contracts: 423. Supabase-server: 331.
  - Mobile billing + settings: 277.
  - Typecheck is clean for every touched package.
- **pgTAP**: `0053_store_billing_entitlements.test.sql` 56/56 ok, plus the related suites 0002/0003/0004/0007/0017/0034/0039/0040 all ok.
  - They ran on the shared local Supabase DB inside one transaction that applied the migration and then rolled back. `db:reset` was not run because the stack is shared with other sessions.
  - `pnpm db:verify` (reset + lint + all suites) is still open on a disposable DB.
- **Review**: independent Opus review found no blocker. Its should-fix items were resolved as follows:
  - manual paid grants are preserved;
  - an unknown environment now fails closed;
  - the Beta Pro trigger takes the profile lock;
  - the sync budget is global;
  - identity parsing is lenient.
  - The time-based sweep is deferred to #338, a Production gate. The bounded re-review of the fixes found no new issue; its two nits were also applied: restore copy that offers a re-check, and per-element transfer id parsing.
- `pnpm check` PASS on this worktree before commit (3,753 mobile tests, 1,404 API tests passed and 15 skipped, every other step passed; input SHA-256 `cdc0a75d…`). Only `status.md` and this file changed afterwards (evidence text). Format and navigation checks were rerun on them.

## Remaining gates

1. **Adam, console setup (not done):**
   - App Store Connect: subscription group and products, EUR 7.99/month, EUR 49.99/year, founding EUR 34.99 year offer, 14-day trial; Paid Applications agreement, banking and tax.
   - Play Console: subscription, base plans and offers, payments profile, service account for RevenueCat.
   - RevenueCat: project, iOS and Android apps, entitlement `pro`, offerings, restore behavior "Transfer".
   - Webhook URL `https://mizyun-api-dev.phiskel.com/v1/billing/revenuecat/webhook` with signing secret.
   - Dev server environment: secret key, signing secret and public keys.
2. **Dev deployment** of the commit (`pnpm deploy:dev <sha>`, applies the migration), then the RevenueCat dashboard "send test event" returns 200.
3. **Device sandbox acceptance** on iPhone (StoreKit sandbox / TestFlight) and Android (licence tester): buy, Pro appears after sync, restore on a second install, cancel through the manage link, expiry or refund clears Pro, and a second account stays free. This needs a native build because of the new native module.
4. **Before Production purchases:**
   - #338 lapsed-row sweep and #337 RevenueCat customer erasure.
   - Store privacy labels and policy (`docs/STORE_LISTING_DISCLOSURES.md` Section 6).
   - Confirm the Play Billing Library version in the built AAB is 8 or later.
   - Unit-economics guard #336.
   - `BILLING_ENABLED=true` in Production by explicit decision.
