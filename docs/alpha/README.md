# ALPHA-001 validation hub

> Operational evidence for the founder week and 10–30-person design-partner alpha. Keep product status honest: setup and simulator acceptance do not count as elapsed founder days or participants.

## Current state

- Work package: `ALPHA-001`
- Status: active
- Founder days completed: 0 of 7
- Design partners completed: 0 of 10 minimum
- Native OBS consent/export acceptance: pending iOS and Android evidence in [`NATIVE_ACCEPTANCE.md`](./NATIVE_ACCEPTANCE.md)
- Open P0/P1 alpha defects: none known before the first ALPHA-001 run

## Files

| File                                                   | Purpose                                                                       |
| ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| [`FOUNDER_DOGFOOD.md`](./FOUNDER_DOGFOOD.md)           | Seven consecutive dated daily-loop checks without sensitive values            |
| [`DESIGN_PARTNER_GUIDE.md`](./DESIGN_PARTNER_GUIDE.md) | Recruitment, disclosure, tasks, interview, export, and cleanup workflow       |
| [`NATIVE_ACCEPTANCE.md`](./NATIVE_ACCEPTANCE.md)       | Standalone iOS/Android consent → events → restart → export → disable evidence |
| [`ISSUE_LOG.md`](./ISSUE_LOG.md)                       | P0–P3 friction/defect triage using synthetic reproduction data                |
| [`RESULTS.md`](./RESULTS.md)                           | Aggregate activation, friction, return-use, failures, and qualitative themes  |

Participant names, emails, account IDs, raw exports, health/fitness values, photographs, and interview recordings do not belong in this repository. Store recruitment/contact consent and raw feedback in an access-controlled company system with an appropriate retention policy.

## Entry workflow

1. Pass `pnpm check` and the two-platform native checklist.
2. Start the founder log on a day when the real daily loop can be used for seven consecutive calendar days.
3. Close every P0/P1 defect before recruiting design partners; record P2/P3 workarounds and impact.
4. Prepare TestFlight and Google Play internal/closed distribution with accurate privacy disclosures and feedback contacts. Simulator/emulator installs are not participant distribution.
5. Recruit target users using [`DESIGN_PARTNER_GUIDE.md`](./DESIGN_PARTNER_GUIDE.md), keeping the roster outside Git.
6. Accept only voluntary, identifier-free OBS exports. Rename them to random local filenames and keep them outside the repository.
7. Aggregate locally:

   ```bash
   pnpm alpha:analyze -- /private/path/export-a.json /private/path/export-b.json
   ```

8. Copy only aggregate counts/buckets and non-identifying themes into [`RESULTS.md`](./RESULTS.md).

## Completion gate

ALPHA-001 becomes `done` only when all are true:

- seven consecutive founder rows are dated and pass without unresolved P0/P1 data loss, privacy, or core-flow failures;
- at least 10 target design partners complete onboarding and a repeated-use test, with retained and churned feedback represented;
- activation, logging completion, time/tap buckets, return days, feature use, and failure reasons are aggregated without identifiers;
- every observed P0/P1 issue is closed and reverified on affected platforms;
- `status.md`, `backlog.md`, and `docs/BUSINESS_ALIGNMENT.md` cite the actual evidence rather than planned work.
