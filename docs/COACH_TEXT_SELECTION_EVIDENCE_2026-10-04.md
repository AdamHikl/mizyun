# Coach reply text selection — 2026-10-04

Work item: [#208](https://github.com/AdamHikl/mizyun/issues/208). Baseline HEAD `f08aff45e7a481a785e8e930752ad08595cdd3fd` on `codex/recurring-meals`, with preserved pre-existing mobile/API/tooling/document changes. No commit, deployment or native installation was performed for this package.

## Outcome

Native `selectable` is enabled on assistant reply headings, paragraphs, bold-containing paragraphs, list content and list markers in `apps/mobile/src/features/coach/coach-setup-screen.tsx`. Nested formatting, displayed proposal cleanup and layout are retained. Text selection follows the existing separate blocks; it cannot span sibling paragraph/list Text roots.

## Verification

- Regression first: both saved-history/new-reply cases failed with `selectable` undefined; existing 23 cases passed. After implementation, `pnpm --filter @mizyun/mobile test src/features/coach/coach-setup-screen.test.tsx` passed all 25 tests. Tests execute the bubble and formatter rather than asserting shallow component props, preserve displayed text/bold and cover heading/plain/bold/list/code-like output.
- Helper `coach_selection_review` (GPT-6.1 Sol, Medium) inspected rendering/test boundaries and reviewed final owned changes read-only; no actionable findings. Coordinator owns all writes. Existing dirty changes in these files remain outside this package.
- Final focused check: `pnpm --filter @mizyun/mobile test src/features/coach` passed 8 files / 106 tests. Fresh `pnpm check` passed on the stable combined workspace with input SHA-256 `7e0c6fcbc28514a51fce3fca7772cfeedf531e863eb91ec172ef62c0e2fbf1b2`. The sandbox attempt could not start (`spawnSync ps EPERM`); approved retry exited 0 and the runner confirmed unchanged inputs. Mobile bundle/type/format checks passed, including all 1,409 mobile tests. This verifies the disclosed combined local candidate, not a clean commit or any deployed artifact. `git diff --check` passed.
- Official sources/implementation consequence: [research entry](RESEARCH_LOG.md#2026-10-04--coach-reply-text-selection).

## Remaining acceptance

On the installed exact iPhone and Android candidate, open an old conversation and obtain a new reply; long-press each prose/heading/list type, adjust handles, Copy and paste into another field. Verify scrolling, keyboard open/closed, long replies, themes and large text. Mock tests only prove native prop wiring. Device acceptance and release remain open; no live provider calls were made in this session.

## Candidate source hashes

- `apps/mobile/src/features/coach/coach-setup-screen.tsx`: SHA-256 `4de1707ca198468d153155b820063a8ff74bb769bf7bc81cd5fe1adcb72a2529`.
- `apps/mobile/src/features/coach/coach-setup-screen.test.tsx`: SHA-256 `535e50a8ea163b789b5d9ba2a8a7c7994121f7aeeb58dddc9cfd1db50c8afaa2`.
