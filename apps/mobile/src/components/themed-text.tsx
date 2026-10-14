import {
  Platform,
  StyleSheet,
  Text,
  useWindowDimensions,
  type TextProps,
} from "react-native";

import { Fonts, ThemeColor } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

/**
 * Type scale modelled on the iOS default text styles. Prefer the semantic
 * names (`largeTitle`, `headline`, `footnote`…); the older names remain for
 * existing screens and map onto the same scale.
 */
export type ThemedTextProps = TextProps & {
  type?:
    | "default"
    | "largeTitle"
    | "title"
    | "subtitle"
    | "title3"
    | "headline"
    | "small"
    | "smallBold"
    | "footnote"
    | "caption"
    | "link"
    | "linkPrimary"
    | "code";
  themeColor?: ThemeColor;
};

export function ThemedText({
  style,
  type = "default",
  themeColor,
  ...rest
}: ThemedTextProps) {
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();

  return (
    <Text
      // A live Dynamic Type change can retain Fabric's previous paragraph
      // measurement. Recreate only the native text, keeping parent state and
      // native font scaling intact. Ordinary renders keep the same identity.
      key={fontScale}
      style={[
        { color: theme[themeColor ?? "text"] },
        styles[type],
        type === "linkPrimary" && { color: theme.primary },
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  /** Body. */
  default: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "400",
  },
  largeTitle: {
    fontSize: 34,
    lineHeight: 41,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  /** Display numerals and hero values. */
  title: {
    fontSize: 40,
    lineHeight: 46,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  /** Screen and sheet titles (iOS Title 1). */
  subtitle: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "700",
  },
  title3: {
    fontSize: 20,
    lineHeight: 25,
    fontWeight: "600",
  },
  headline: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "600",
  },
  /** Supporting text (iOS Subheadline). */
  small: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "400",
  },
  smallBold: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600",
  },
  footnote: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "400",
  },
  caption: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "500",
  },
  link: {
    lineHeight: 30,
    fontSize: 15,
  },
  linkPrimary: {
    lineHeight: 30,
    fontSize: 15,
    fontWeight: "600",
  },
  code: {
    fontFamily: Fonts.mono,
    fontWeight: Platform.select({ android: "700" }) ?? "500",
    fontSize: 12,
  },
});
