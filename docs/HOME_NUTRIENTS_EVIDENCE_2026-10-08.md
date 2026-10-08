# Home more nutrients — 2026-10-08

Work item [#227](https://github.com/AdamHikl/mizyun/issues/227), requested while discussing #178. Baseline `9e7fc4b13b54b4d0818c3b259bfef55321795f1f`; local source package, no deployment or installation. #178 remains open for its recorded physical acceptance.

## Behavior

Home Today’s Nutrition has a collapsed More nutrients button below the macros. It expands in place with fibre, saturated fat, total sugars, sodium and dietary cholesterol from the existing local-day summary. Meals navigation remains a separate sibling control; account/token/day/offset changes remount the card and reset expansion.

Complete saved totals include explicit zero. Partial totals say recorded and give known meal coverage; missing coverage remains unavailable, not fabricated zero. Empty, unavailable, revalidating and failed summaries have explicit neutral states. The existing server Pro summary stripping and bounded60-second summary cache remain unchanged; this UI introduces no meal/target writes or additional network requests.

General adult WHO references show fibre at least25g, sodium below2000mg and saturated fat at most10% of the existing calorie target, calculated in core at9kcal/g. They are labelled general references rather than personal targets. No universal total-sugar or cholesterol limit is invented; total and free sugars remain distinct. [Dated primary sources](RESEARCH_LOG.md#2026-10-08--home-daily-additional-nutrient-references-227).

## Verification

- Focused Home/cache suites:122 tests across5files passed after final changes. Core reference suite:6passed; mobile typecheck passed.
- Independent non-author High review: no remaining actionable finding. Two review concerns resolved by preserving the existing read/cache path and withholding invented meal counts for legacy summaries lacking coverage.
- Full isolated `pnpm check`:PASS (exit0), input SHA-256 `3944ba04dc238fd64b3e11d8c8c0877be35b84ea7a6a4dbc00f7f1db34abcc27`; mobile1859/API937(+15credential-gated skips)/core416/config81(+3existing purity skips). Both Hermes exports, navigation, formatting, typechecks and all safeguards passed. [Exact overlay hashes and scope](evidence/home-nutrients-2026-10-08/verification-summary.json); all7source hashes still match the shared workspace. Task-only candidate excludes concurrent meal-photo, workout, Community and analytics changes. Initial archive setup lacked Git metadata, so discovery stopped; pinned local metadata was added before the passing full run.

- Fictional sample totals used throughout fixtures/preview. Source-derived web layout inspected at390px in dark/light and26px enlarged text: no horizontal overflow. [Preview](evidence/home-nutrients-2026-10-08/web-layout-preview.jpg) uses native-control/text shims; it is not a simulator or device acceptance result.

## Next exact action

Integrate the verified source package, then install an exact standalone Dev candidate and accept expand/collapse, all five saved values, reference units, partial/unknown/zero, account/day rollover, Free/downgrade behavior, Meals navigation, large text, VoiceOver/TalkBack and light/dark appearance. Native/device acceptance remains open. No commit, push, deployment, installation, live-provider call, Store upload or Production release by this package.
