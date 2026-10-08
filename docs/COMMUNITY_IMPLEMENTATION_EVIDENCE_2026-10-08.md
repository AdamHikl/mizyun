# Remaining Community implementation evidence — 2026-10-08

Baseline: `5925b31da5ef08fe0f784f23bb7309f46bb0e95c`. Live open GitHub inventory retrieved on 2026-10-08: 22 numbered COMM issues; COMM-02/#141 closed. All feature packages inspected have concrete implementations. Prior source/device/deployment claims remain dated historical evidence.

## Owned changes

- Content-free SQL capture across withdrawal/account-erasure/block/sanction/relationship/source/artifact/member/preference/reaction reductions, service-only pending/ACK, and owner/generation-scoped offline replay. New migration `20261008120000`, new pgTAP suite0038 and synthetic no-network positive replay runner.
- Dedicated public-recipient encrypted append sink, chained journal, fsync-before-ACK and retry deduplication; bounded strict trusted-checkpoint reader and integration with existing Dev quarantine runner. Service RPC rejects redirects.
- Invitation fallback builder/parser and isolated client-only page prepared for the separate website route; existing shared mobile invitation behavior stays in place until hosted acceptance.
- Draft standards corrected, no accepted terms version silently changed; dated primary sources/ADR0052, executable closure materials and exact per-issue human/engineering matrix.

## Delegation and review

GPT-6.1 Sol/High helpers performed source gap audit/fallback authoring, SQL capture/replay/test authoring and closure-material preparation. A non-author High helper reviewed migration/ledger/recovery boundaries. Coordinator inspected actual source and fixed nullable-generation interface, comment mention ownership, generation wildcard and missing narrowing capture findings. Final independent sensitive review and subsequent fixture-delta review approved with no actionable finding. Review qualifies this as bounded local quarantined recovery, not complete independent reconciliation. Helpers ran no tests before final phase.

## Final verification

All tests began only after implementation and helper writes settled, as requested.

- New ledger + affected worker: **17 Node tests PASS**; strict reader: **7 Python tests PASS**; existing quarantine runner: **19 Python tests PASS**.
- Invitation builder/parser and executed fallback page: **36 tests PASS**. Entire Community mobile feature suite: **512 tests across 46 files PASS**.
- Real `age` public-recipient Node encryption → pinned Python journal/decryption roundtrip: **PASS**, synthetic event/key only; temporary key/ciphertext removed afterward.
- Schema-only disposable local database: **1,049 SQL assertions / 39 files PASS**, including new suite0038 **40 assertions**; **19 reported concurrency cases PASS** plus capacity checks. [Exact migration/test hashes and summary](evidence/community-remaining-2026-10-08/local-db-summary.json). Initial fixture failures were corrected: schema-only copies omit migration seed rows; authenticated JWT state needed service reset; searchable opt-out needed an actual initial true state. No real user data copied. Scratch removed.
- Positive replay in inspected local network-none/tmpfs/no-ports/no-host-mount disposable: **18 events PASS**, repeat applied count zero, wrong ownership/older-generation protection, null-generation rejection, conflicting payload rejection, opt-outs/member departures/cutoffs and closed controls verified. [Redacted proof](evidence/community-remaining-2026-10-08/positive-replay-summary.json). Resources removed; physical byte erasure, report/audit erasure and completeness remain explicitly uncertified.
- Serialized `pnpm check`: **PASS** on isolated baseline-plus-owned-overlay checkout `/private/tmp/mizyun-comm-final-20261008`, input SHA-256 `601d2e98ab793141a3d3cd830d441b98724c61b2bb8c2cf6624ba7d3ae350ab7`; **1,811 mobile / 937 API PASS**, **15 credential-gated API E2E skips**, **3 existing config bundle-path skips**; dual native bundle exports and remaining gates passed. Final settled fixture/harness/document candidate also **PASS**, input SHA-256 `b0fde386e3d6cb86c3fbfccd08c6fcd8dc3cdbaaf1a942f2e5d487d30f7cc5a3`. [Final gate receipt and exact candidate file hashes](evidence/community-remaining-2026-10-08/final-check-summary.json). Outcome-only evidence updates are formatted after recording this receipt.

The shared checkout has concurrent meal/reminder/analytics/workout/photo/Community-UI/docs edits; those are preserved and excluded from isolated task acceptance. Shared status/research candidate overlays contain only this session's section over the baseline. SQL proof uses current local schema and discloses the exact superset in its hash summary; it does not certify unrelated implementation or remote isolation. The older local SQL verifier retains its inherited Docker context handling; the new positive replay harness pins the local socket and verifies disposable identity. [Owned implementation hashes](evidence/community-remaining-2026-10-08/source-manifest.json).

## Remaining gates and exact next action

[All 28 GitHub issue bodies updated and verified](evidence/community-remaining-2026-10-08/issue-update-receipt.json), preserving existing content/status: 22 numbered COMM issues, five related fixes and parent #137. Each has specific founder and engineering closure requirements. No issue is closed solely from this source package. No commit/push/deployment/install, provider enablement, full archive transfer, website/Store mutation, broader admission or Production release. Provision independently durable encrypted ledger storage/coverage after operator acceptance and complete exact-candidate Dev/two-account/native/Storage/operator/legal/pilot gates. [Per-issue closure actions](COMMUNITY_REMAINING_ISSUES_2026-10-08.md) name precisely what Adam supplies and what engineering still proves.

The asynchronous capture/sink is deliberately incomplete proof of post-disaster erasures: unexported transactions can be lost with primary storage; remaining consent/preference reductions and older archives need full reconciliation before reopening. The bounded replay always leaves traffic closed, completeness uncertified and physical Storage erasure unverified. Fsync is destination durability evidence only. Real independent-destination replication/checkpoint custody/retention and archive-to-cutover completeness require acceptance.
