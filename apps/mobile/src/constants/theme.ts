/**
 * Mizyun design tokens. Calm, iOS-native grouped style: a quiet grouped
 * background, raised surfaces for content, one green accent and semantic
 * colours for status and macros. Prefer these tokens (and the primitives in
 * `@/components/ui`) over literal colours, sizes and radii in feature code.
 */

import "@/global.css";

import { Platform } from "react-native";

export const Colors = {
  light: {
    text: "#111827",
    textSecondary: "#5B6472",
    textTertiary: "#8B93A1",
    /** Grouped page background behind cards. */
    background: "#F2F4F3",
    /** Raised content surface (cards, grouped rows, sheets). */
    backgroundElement: "#FFFFFF",
    /** Pressed/selected surface and quiet fills such as inputs and chips. */
    backgroundSelected: "#E8ECEA",
    border: "#D5DBD8",
    separator: "#E3E7E5",
    primary: "#0A8F63",
    primaryLight: "#DDF3EA",
    onPrimary: "#FFFFFF",
    success: "#16A34A",
    successLight: "#DCFCE7",
    warning: "#B45309",
    warningLight: "#FEF3C7",
    danger: "#DC2626",
    dangerLight: "#FEE2E2",
    info: "#2563EB",
    infoLight: "#DBEAFE",
    protein: "#0A8F63",
    carbs: "#D97706",
    fat: "#7C3AED",
    overlay: "rgba(17, 24, 39, 0.4)",
  },
  dark: {
    text: "#F3F4F6",
    textSecondary: "#A3ABB8",
    textTertiary: "#6E7683",
    background: "#0B0D0F",
    backgroundElement: "#181B1F",
    backgroundSelected: "#252A2F",
    border: "#30363C",
    separator: "#262B30",
    primary: "#2BC48A",
    primaryLight: "#0F3A2B",
    onPrimary: "#04140D",
    success: "#4ADE80",
    successLight: "#12301E",
    warning: "#FBBF24",
    warningLight: "#3A2A0A",
    danger: "#F87171",
    dangerLight: "#3B1515",
    info: "#60A5FA",
    infoLight: "#14243F",
    protein: "#2BC48A",
    carbs: "#FBBF24",
    fat: "#A78BFA",
    overlay: "rgba(0, 0, 0, 0.6)",
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;
export type ThemeColors = { readonly [K in ThemeColor]: string };

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: "system-ui",
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: "ui-serif",
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: "ui-rounded",
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: "ui-monospace",
  },
  default: {
    sans: "normal",
    serif: "serif",
    rounded: "normal",
    mono: "monospace",
  },
  web: {
    sans: "var(--font-display)",
    serif: "var(--font-serif)",
    rounded: "var(--font-rounded)",
    mono: "var(--font-mono)",
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

/** Horizontal page gutter shared by tab headers and scrolling content. */
export const PageGutter = 20;

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  pill: 999,
} as const;

/** Minimum interactive size (Apple HIG 44pt, Material 48dp). */
export const MinTouchTarget = 44;

export const BottomTabInset = Platform.select({ ios: 90, android: 110 }) ?? 0;
export const MaxContentWidth = 800;
