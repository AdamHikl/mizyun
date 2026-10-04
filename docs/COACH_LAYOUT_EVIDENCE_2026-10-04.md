# Coach reading space (#204) — 2026-10-04

Scope: Coach presentation, COACH-01/COACH-06 and Phase3 mobile UI. [Issue #204](https://github.com/AdamHikl/mizyun/issues/204); [dated platform research](RESEARCH_LOG.md#coach-conversation-density-204-2026-10-04).

## Result and source boundary

- Combined existing32/44 Coach heading and thread selector in one identity area with directly accessible advisory/new/delete controls. Screens below360points or above1.3font scale stack controls. The title displays one line normally/two when stacked; its full text is available through accessibilityValue and the existing thread sheet.
- Repeated purpose copy now belongs to the scrollable empty conversation introduction. Existing advisory warning, consent, loading/provider-off/read-failure/retry and proposal confirmation remain.
- Transcript outer inset24→16points; bubble inner inset24→12. Body text gains40points of width; numbered content gains42including marker-gap reduction8→6. These are source geometry differences, not device measurements.
- Body typography stays15/22, now consistent across plain/bold nested spans. Bold uses theme foreground. Structural Markdown gap6→4, message gap16→8, bubble vertical padding16→12. Shared header, native tabs, bottom inset and multiline composer are preserved.
- Header, photo/send and advisory-close controls have44-point minima. Composer padding6→4limits growth from larger targets.
- At ordinary text size with a two-line old description and single-line thread title, source geometry estimates header156→76points and composer50→54, yielding approximately76points more transcript height. Narrow/large-text headers stack and reclaim less. Native rendering must confirm actual sizes.

Read-only UI and IA agents independently inspected screenshot/current code, proposed the hierarchy/spacing, and reviewed the actual presentation delta. Final review resolved a stale-modal test interaction, hint-independent full title, bounded title growth and narrow-width stacking; no remaining source-level findings. Their review did not render the native app.

Baseline HEAD `f08aff45e7a481a785e8e930752ad08595cdd3fd`; pre-existing #200 recovery changes in the Coach screen/tests/data were preserved. Task-only screen delta: `/private/tmp/mizyun-coach-density-only.diff`; pre-edit snapshots: `/private/tmp/mizyun-coach-density-screen-baseline.tsx` and `/private/tmp/mizyun-coach-density-test-baseline.tsx`. Other concurrent Meals/shared-header/Coach-feature/cache/settings/workout changes belong to their own sessions.

## Automatic verification

- Fresh `pnpm --filter @mizyun/mobile test src/features/coach`:8files/103tests PASS, including2semantic hierarchy checks. Log `/private/tmp/mizyun-coach-density-focused-final.log`.
- Fresh `pnpm --filter @mizyun/mobile typecheck`: PASS, `/private/tmp/mizyun-coach-density-typecheck-final.log`.
- Shared `pnpm check` passed navigation/importer and stopped at formatting in concurrently edited `packages/agent-runtime/src/index.test.ts`; later checks in that run are unrun. Log `/private/tmp/mizyun-coach-density-check.log`.
- Fresh isolated `pnpm check` PASS(exit0), `/private/tmp/mizyun-coach-density-isolated-check.log`: navigation116/mobile1388/API837(15existing credential-gated skips), contracts203/core373/server-adapter154, formatting/all typechecks/dualHermes/configured safeguards. Config retains3existing bundle-path skips. Candidate `/private/tmp/mizyun-coach-density-204` overlays the exact3Coach screen/test/data files on HEAD, including the pre-existing #200 screen recovery prerequisite. Workspace package links resolve to the isolated candidate; external installed dependencies are reused. This does not accept unrelated concurrent runtime changes.

No task commit/push, Dev deployment, native installation, provider/database acceptance or Production/Store action.

## Exact remaining installed-device checks

On the next verified standalone Dev candidate, record iOS/Android results for:

1. Long numbered response, mixed bold/plain paragraphs and scrolling top/bottom; verify readable line spacing and full last message above composer/tabs.
   2.320/360/393-point widths, a120-character thread title, large accessibility text, light/dark themes, keyboard open/closed, one/multiline drafts.
2. Thread switch/new/delete/last-thread empty state, advisory open/close, photo, send/retry and existing error/consent/proposal flows.
3. VoiceOver/TalkBack reads full selected title without hints, expanded info state and control labels; all controls remain reachable.
4. Preserve #200 foreground/token refresh/pending-send recovery behavior on the combined candidate.

Status: implemented; native visual/device acceptance pending. All3candidate SHA256 hashes match the shared source, `/private/tmp/mizyun-coach-density-source-hashes.json`. No runtime changes followed the passing gate.
