# Quality gates

> Definition of done and release evidence. These gates supplement `AGENTS.md`; they do not weaken its architecture or safety rules.

## Every implementation segment

- [ ] The work maps to a goal, requirement ID, plan phase, and backlog item.
- [ ] Current official documentation was reviewed for each affected platform/service and logged in `docs/RESEARCH_LOG.md`.
- [ ] Durable architecture choices were recorded in a new or superseding ADR.
- [ ] Domain behavior is separated from transport, SDK, storage, and presentation code.
- [ ] Inputs and outputs are validated at trust boundaries.
- [ ] Loading, empty, error, retry, and disabled states are handled where applicable.
- [ ] Unit tests cover business rules and important failures.
- [ ] Integration/contract tests cover new adapter or transport behavior.
- [ ] Sensitive values are absent from source, fixtures, logs, screenshots, and mobile bundles.
- [ ] Documentation and `status.md` reflect the resulting state.
- [ ] `pnpm check` passes before commit.

## Data and API changes

- [ ] Migration is forward-only, reproducible, and reviewed for locking/data-loss risk.
- [ ] New user-owned tables include ownership, RLS, policies, and appropriate ownership indexes.
- [ ] User-owned foreign keys cannot create cross-owner relationships.
- [ ] Two-user isolation tests cover select, insert, update, delete, and relevant RPC/storage actions.
- [ ] API ownership comes from the verified principal, not request payloads.
- [ ] Contracts have stable schemas and normalized error codes.
- [ ] Retry behavior cannot create silent duplicates or partial authority.

## Mobile changes

- [ ] Exact Expo SDK documentation and affected native-platform guidance were checked.
- [ ] iOS and Android behavior is considered, including permissions and denial/revocation.
- [ ] Workspace-source imports pass the real Metro bundle smoke test.
- [ ] No server secret appears in `EXPO_PUBLIC_` configuration.
- [ ] Accessibility labels/roles, dynamic text, contrast, focus, and tap sizes are reviewed.
- [ ] Keyboard, safe-area, small-screen, dark/light mode, and network-failure behavior are reviewed.
- [ ] Platform-specific APIs remain behind adapters.

## Calculation changes

- [ ] Formula and version are explicit and covered by reference examples.
- [ ] Canonical units and rounding boundaries are documented.
- [ ] Missing, extreme, and contradictory inputs fail safely.
- [ ] Display explains inputs, assumptions, range, and uncertainty.
- [ ] AI cannot override or silently alter deterministic output.

## Media changes

- [ ] Bucket is private and paths are owned/scoped by authenticated user ID.
- [ ] MIME type, size, dimensions, and decode failures are validated server-side or by trusted storage policy.
- [ ] Signed access expires and cross-user signing fails.
- [ ] Delete removes metadata/object or records a recoverable cleanup job.
- [ ] Provider sharing and retention are explicit.
- [ ] Test fixtures contain no real health/body images without documented consent.

## AI and memory changes

- [ ] Applicable `docs/BEFORE_TESTING.md` items are complete.
- [ ] Provider/model version, retention terms, region, cost, and limits were reviewed.
- [ ] Structured outputs are schema-validated and unsafe output has a fallback.
- [ ] Timeouts, bounded retries, rate limits, and per-user budgets exist.
- [ ] Prompt injection is tested through user input, image text, memory, and tool output.
- [ ] Tool authorization is enforced independently of the model.
- [ ] AI-derived data is labeled as draft/inference with provenance and confidence.
- [ ] Memories can be reviewed, corrected, expired, and deleted.
- [ ] Evaluation thresholds and known limitations are documented before release.

## Pre-merge gate

Required automated evidence:

```bash
pnpm check
```

As the repository grows, `pnpm check` should remain the fast local gate. Longer RLS, database, device, and end-to-end suites may run separately but must be required in CI before merging affected changes.

## Beta release gate

- [ ] All MVP requirement IDs have test or acceptance evidence.
- [ ] No open P0 or P1 defect remains.
- [ ] Cross-user database and storage suites pass.
- [ ] Account export and deletion complete within the documented behavior.
- [ ] AI release checklist passes for every enabled AI feature.
- [ ] iOS simulator/device and Android emulator/device matrices pass.
- [ ] Crash/error reporting excludes sensitive payloads and has been tested.
- [ ] Privacy policy, terms, consent, data-sharing, and retention screens match actual behavior.
- [ ] Backup/restore or migration recovery has been exercised.
- [ ] Rollout monitoring and rollback criteria are documented.

## Severity definitions

- **P0:** cross-user exposure, secret exposure, destructive data loss, unsafe medical/fitness behavior with credible harm, authentication bypass, or release-blocking outage.
- **P1:** core workflow unavailable/corrupt, unrecoverable logging loss, materially wrong calculation, inaccessible primary flow, or privacy control failure.
- **P2:** significant degraded behavior with a workaround or non-core feature failure.
- **P3:** minor defect, polish, or low-impact enhancement.
