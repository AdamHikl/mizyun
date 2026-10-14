# Registration chart zero days — #240

## Scope and behavior

Exact baseline `0135228778059dc25c1a4925738f0b6934ed4f0c`, plus the selected source SQL and synthetic verifier overlays. All concurrent Community, startup cache, retained photos and prior consent-reminder work remain excluded from the isolated gate and preserved in the shared workspace.

The registration source must include each of30 UTC dates through the snapshot day, including zero-registration dates. Counts describe existing Auth accounts created on each day, including unconfirmed accounts and excluding deleted accounts. Consent-gated activity remains sparse/unobserved as before. Current-day counts are partial through collection time; no later day is inferred from an older snapshot. Existing freshness and per-environment failure suppression remain authoritative.

## Reproduced failure

The Production snapshot generated2026-10-12T15:59:25.333UTC was fresh, but registrations contained only9 dates and ended2026-10-06. The sparse GROUP BY returned no zero days. Read-only aggregate verification inspected no user identities. The new real PostgreSQL regression is run against a unique disposable scratch database on the verified local Docker Unix socket; never Hetzner, the Pi, local app Supabase or the real analytics warehouse.

## Verification and next action

Run focused dashboard tests, the guarded PostgreSQL17.6 verifier, independent final review and one settled isolated `pnpm check`. Apply by rerunning the guarded local real-data dashboard collector, then verify all30 registration dates, zero October7–12 values, a latest date equal to the snapshot date, and the actual saved Metabase registration card output. Record final results as a post-check receipt checked separately for document/format correctness. No Production deployment, native build or consent change is needed.

## Preserved dashboard authority and open gates

- **#186 analytics/#192 guards:** real Mac3034 initialized; synthetic3033 isolated. `pnpm analytics:dashboard` + private login. Exact delivery, consent/deny/revoke, automatic/Community capture and Store imports open; zero Prod opt-ins. Pi hosting superseded;8GB deferred until revenue. [Evidence](docs/DEVELOPER_ANALYTICS_DASHBOARD_2026-10-03.md).

The zero Production opt-in figure above is historical October3 evidence. Mac3034 is the real dashboard;3033 remains synthetic. Collection remains manually triggered; automatic collection is separate from #240. Prior delivery/consent/native/capture/Store and infrastructure acceptance gates remain open.

## Focused checks

The new calendar assertion failed against the old source at the30-day row-count boundary. After the fix: `pnpm analytics:dashboard:verify-db` passed64 real PostgreSQL17.6 assertions and `pnpm test:analytics-dashboard` passed69 tests. The local Docker target was verified as `desktop-linux` on the local Unix socket; the real `mizyun-analytics-live` resources and app Supabase were untouched by the verifier. The helper authored only synthetic verifier regressions; coordinator inspected the diff and executed all database checks. Independent High non-author review approved the frozen two-file diff with no blockers; reviewer independently passed syntax/diff checks and confirmed both hashes. Isolated full gate and live refresh/card-query acceptance remain next.

## Post-check acceptance receipt

Isolated `pnpm check`: PASS, input SHA256 `8f8f8b4c893f32f9fe224cda48a8997d71dfc606d127d9c7039a124ea4257a78`;2,157 mobile/980 API tests passed,15 credential-gated API tests across3 suites skipped. Both platform bundles and required gates passed. Independent High review approved; both source hashes still matched shared source and candidate after application.

Refreshed the real local dashboard with `pnpm analytics:dashboard`: Dev16:57:46.073UTC and Production16:57:47.785UTC on2026-10-12, both readerVisible true. Saved Metabase card41 in the Production30-day view now returns30 dates from September13 through October12, with zero on October7–12. The saved card originally returned only9 dates endingOctober6. Browser verification shows the zero points. The Production source remained `9b0c41acbb7e4ee70592cab40b6148fc76a393ed`; source queries remained read-only. No backend deployment, source data mutation, native build, commit or push.

[Summary](evidence/registration-zero-days-2026-10-12/verification-summary.json), [scope](evidence/registration-zero-days-2026-10-12/candidate-overlay.json), [source hashes](evidence/registration-zero-days-2026-10-12/source-hashes.json), [review](evidence/registration-zero-days-2026-10-12/review-summary.md), [SQL regression](evidence/registration-zero-days-2026-10-12/regression-after.log), [full gate](evidence/registration-zero-days-2026-10-12/full-check.log), [saved card](evidence/registration-zero-days-2026-10-12/live-card.json), [rendered dashboard](evidence/registration-zero-days-2026-10-12/dashboard-fixed.jpg). These are post-check records, checked separately for document/format correctness; they were not gate inputs.

#240 is complete for the local registration chart. Next: view/reload the current dashboard; rerun the collector when snapshot refresh is needed. Automatic source collection and broader#186/#192 acceptance remain separate.
