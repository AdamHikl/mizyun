# Mizyun mobile design system

Adopted 2026-10-14 (Adam: "calm iOS-native" direction, large-title tab headers, foundation first then Home/Meals). The aim is an app that looks designed rather than assembled: one visual language, fewer words, clear hierarchy.

## Principles

1. **Grouped surfaces.** Pages use the grouped `background`; content sits on raised `backgroundElement` cards (white in light mode). Do not draw borders around cards; separation comes from the surface colour.
2. **One primary action per screen.** Use `Button variant="primary"` once; supporting actions use `tinted`, `secondary` or `plain`.
3. **Icons, not glyphs.** Use `Icon`/`IconBadge` (SF Symbols on iOS, Material Symbols on Android). Never use emoji or text glyphs (`→`, `›`, `＋`, `✨`) as icons or affordances; navigation rows get the list chevron.
4. **Few words.** A title says what it is; a subtitle only when it adds information the title cannot. Move explanations into an info row, a `Collapsible`, or Settings. No ALL-CAPS labels.
5. **Semantic colour only.** Use theme tokens (`primary`, `success`, `warning`, `danger`, `info`, `protein`, `carbs`, `fat`, `textSecondary`, `textTertiary`, `separator`…). No hex literals in feature code; never compare colours to detect the scheme.
6. **Accessible by default.** Minimum touch target 44pt (48 for icon buttons), text scales with Dynamic Type, rows wrap instead of truncating, every pressable has a role and label.

## Tokens (`@/constants/theme`)

| Token            | Use                                                                                                                                                                                                                                                                                                        |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Colors[scheme]` | `text`, `textSecondary`, `textTertiary`, `background` (page), `backgroundElement` (card), `backgroundSelected` (pressed/fills), `border` (inputs), `separator` (hairlines), `primary`/`primaryLight`/`onPrimary`, `success`/`warning`/`danger`/`info` + `*Light` fills, `protein`/`carbs`/`fat`, `overlay` |
| `Spacing`        | 2/4/8/16/24/32/64                                                                                                                                                                                                                                                                                          |
| `PageGutter`     | 20pt horizontal page inset                                                                                                                                                                                                                                                                                 |
| `Radius`         | `sm` 8, `md` 12 (buttons/inputs), `lg` 16 (cards), `xl` 22 (sheets), `pill`                                                                                                                                                                                                                                |
| `MinTouchTarget` | 44                                                                                                                                                                                                                                                                                                         |

## Type (`ThemedText type=`)

`largeTitle` 34 (tab titles) · `subtitle` 28 (screen/sheet titles) · `title` 40 (hero numerals) · `title3` 20 (section headers) · `headline` 17 semibold · `default` 17 body · `small` 15 · `smallBold` 15 semibold · `footnote` 13 · `caption` 12.

## Components (`@/components/ui`)

- `Button` — `primary | tinted | secondary | plain | destructive`, `size="small"` pill, `icon`, `loading`, `block`.
- `IconButton` — 36pt circle in a 48pt target.
- `Card` — raised surface, 16 radius, 16 padding.
- `ListGroup` + `ListRow` — inset grouped list with hairline separators; rows take `icon`, `iconTone`, `title`, `subtitle`, `value`, `trailing`, chevron when pressable.
- `SectionHeader` — `title3` header with optional trailing action (e.g. `Button variant="plain" size="small"`).
- `Notice` — inline info/warning/danger/success message with optional action.
- `EmptyState` — icon, title, message, one action.
- `Icon`, `IconBadge`, `IconNames` — the icon vocabulary; add new names to `IconNames`.
- `TabHeader title="…"` — every tab: large title left, settings button right; tab-specific icon actions via `actions`.

## Screen layout

```
TabHeader (title, actions)          ← fixed, feathered
ScrollView  paddingHorizontal 20, gap 24 between sections
  hero Card (the one number that matters)
  ListGroup (primary actions / navigation)
  SectionHeader + Card/ListGroup …
```

Pushed screens use the native stack header (back + title). Do not repeat the title in the content.
