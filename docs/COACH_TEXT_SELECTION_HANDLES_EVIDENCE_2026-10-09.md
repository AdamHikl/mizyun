# Coach iOS selection handles — 2026-10-09

Tracking [#208](https://github.com/AdamHikl/mizyun/issues/208). Baseline `0d9da8a46197f20b12f00d643851a84866368998`; user reports a Copy-only menu on iPhone and requests adjustable selection like the supplied ChatGPT example.

## Cause and change

React Native0.86.3 Fabric selectable Text implements whole-block Copy, with no selection range or handles. The prior implementation therefore passed its prop tests without fulfilling the iOS interaction. Coach headings, prose, bold spans and list text now use read-only multiline TextInput on iOS, backed by UITextView. No editing, controlled selection/value, fixed height or internal scrolling; existing formatting, proposal cleanup/actions and block layout are retained. Android/web keep selectable Text. Selection remains per existing block, including separate list markers, as scoped by #208. See [dated research](RESEARCH_LOG.md#2026-10-09--208-ios-coach-selection-handles).

## Verification scope

- Historical/new reply regressions failed before implementation (2 failed/25 passed), then passed. Extended coverage exercises both iOS read-only attributed surfaces and Android selectable Text, preserving all eight heading/prose/list roots and inline bold content.
- Independent GPT-6.1 Sol/High read-only native-source diagnosis and actual-diff review: no actionable findings. Coordinator reviewed actual diff.
- Shared-tree mobile typecheck reached unrelated in-progress meal-illustration API/contract errors; no Coach error reported. Concurrent meal/cache/illustration changes are preserved and excluded from the isolated candidate.
- Simulator doctor verified iPhone17Pro `F4939E5D-BA85-4479-AA1E-92B21441FB8C`, booted, free8085; cached Debug1.0.9(9) identity passed but native-input checksums failed for app config/version and an Android Health module. No reuse, install, native launch, provider call or simulator setting change occurred.
- Focused/full check outcome, source hashes and logs: [verification receipt](evidence/coach-selection-2026-10-09/verification-summary.json). Fresh isolated full gate passed (stable input `af71fdbf66b1db70a743a04372bd3f0d9250082ecb02e026ab1abcf4c4af46a2`): mobile1933/API946, both exports and remaining gates;15 credential-gated API and3 existing configuration skips. All110 Coach tests passed in the isolated candidate. Post-gate edits only record outcomes; tested Coach hashes match the shared workspace. No native acceptance is claimed.

## Next acceptance

Install this client candidate and test old/new replies: long-press a word, drag both handles across plain/bold spans, Copy and paste exactly the selected substring. Check headings/lists, long replies, keyboard absence, scroll/selection interaction, light/dark, large text and VoiceOver; verify Android controls remain usable. #208 stays open pending these installed-device exits. No commit, push, Dev backend deploy or Production release is part of this change.
