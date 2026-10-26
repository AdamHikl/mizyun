import type { Ref } from "react";
import { Image, Text, View, type ImageSourcePropType } from "react-native";
import type { ShareCardContent } from "@mizyun/core";

/** Logical card size; the exported image is 1080 × 1350 px (4:5). */
export const SHARE_CARD_WIDTH = 360;
export const SHARE_CARD_HEIGHT = 450;
export const SHARE_CARD_EXPORT_WIDTH_PX = 1080;
export const SHARE_CARD_EXPORT_HEIGHT_PX = 1350;

export type ShareCardScheme = "light" | "dark";

/**
 * Fixed card colours, independent of the app theme so the shared image
 * looks the same wherever it is posted. Contrast ≥ 4.5:1 for all text.
 */
export const SHARE_CARD_PALETTES = {
  light: {
    background: "#F2F4F3",
    surface: "#FFFFFF",
    text: "#111827",
    textSecondary: "#5B6472",
    accent: "#0A7A55",
    accentSoft: "#DDF3EA",
    track: "#E3E7E5",
  },
  dark: {
    background: "#0B0D0F",
    surface: "#181B1F",
    text: "#F3F4F6",
    textSecondary: "#A3ABB8",
    accent: "#2BC48A",
    accentSoft: "#0F3A2B",
    track: "#262B30",
  },
} as const;

// Fixed artwork: system text size must not reflow or clip the exported
// image. The whole card is one accessible image with a spoken label.

export interface ShareCardViewProps {
  readonly content: ShareCardContent;
  readonly scheme: ShareCardScheme;
  /** Rendered width in points; everything scales from {@link SHARE_CARD_WIDTH}. */
  readonly width?: number;
  readonly mark: ImageSourcePropType;
  readonly ref?: Ref<View>;
}

/**
 * The share card image (ADR-0082). Renders only `ShareCardContent`, which
 * core builds from an allowlist, so it has no access to anything else.
 */
export function ShareCardView({
  content,
  scheme,
  width = SHARE_CARD_WIDTH,
  mark,
  ref,
}: ShareCardViewProps) {
  const c = SHARE_CARD_PALETTES[scheme];
  const s = width / SHARE_CARD_WIDTH;
  const px = (value: number) => Math.round(value * s * 10) / 10;
  return (
    <View
      ref={ref}
      // Android drops plain views from the native tree unless told not to,
      // and view-shot cannot capture a view that does not exist.
      collapsable={false}
      accessible
      accessibilityRole="image"
      accessibilityLabel={content.accessibilityLabel}
      testID="share-card"
      style={{
        width,
        height: px(SHARE_CARD_HEIGHT),
        backgroundColor: c.background,
        padding: px(20),
        gap: px(14),
        overflow: "hidden",
      }}
    >
      <View style={{ gap: px(2) }}>
        <Text
          allowFontScaling={false}
          numberOfLines={1}
          style={{ color: c.accent, fontSize: px(13), fontWeight: "700" }}
        >
          {content.dateLabel}
        </Text>
        <Text
          allowFontScaling={false}
          numberOfLines={1}
          style={{ color: c.text, fontSize: px(26), fontWeight: "800" }}
        >
          {content.title}
        </Text>
        {content.gymName ? (
          <Text
            allowFontScaling={false}
            numberOfLines={1}
            style={{
              color: c.textSecondary,
              fontSize: px(15),
              fontWeight: "600",
            }}
          >
            {content.gymName}
          </Text>
        ) : null}
      </View>

      <View style={{ flexDirection: "row", gap: px(8) }}>
        {content.stats.map((stat) => (
          <View
            key={stat.label}
            style={{
              flex: 1,
              backgroundColor: c.surface,
              borderRadius: px(12),
              paddingVertical: px(10),
              paddingHorizontal: px(8),
              gap: px(2),
            }}
          >
            <Text
              allowFontScaling={false}
              numberOfLines={1}
              style={{
                color: c.textSecondary,
                fontSize: px(11),
                fontWeight: "600",
              }}
            >
              {stat.label}
            </Text>
            <Text
              allowFontScaling={false}
              numberOfLines={1}
              adjustsFontSizeToFit
              style={{ color: c.text, fontSize: px(20), fontWeight: "800" }}
            >
              {stat.value}
            </Text>
          </View>
        ))}
      </View>

      <View
        style={{
          flex: 1,
          backgroundColor: c.surface,
          borderRadius: px(12),
          padding: px(12),
          gap: px(8),
        }}
      >
        {content.rows.map((row, index) => (
          <View
            key={`${index}-${row.label}`}
            style={{ flexDirection: "row", alignItems: "center", gap: px(8) }}
          >
            <Text
              allowFontScaling={false}
              numberOfLines={1}
              style={{
                color: row.highlight ? c.accent : c.text,
                fontSize: px(14),
                fontWeight: "700",
                ...(row.fraction === null ? { flex: 1 } : { width: px(44) }),
              }}
            >
              {row.label}
            </Text>
            {row.fraction !== null ? (
              <View
                style={{
                  flex: 1,
                  height: px(12),
                  borderRadius: px(6),
                  backgroundColor: c.track,
                  overflow: "hidden",
                }}
              >
                <View
                  style={{
                    width: `${Math.max(8, row.fraction * 100)}%`,
                    height: "100%",
                    borderRadius: px(6),
                    backgroundColor: c.accent,
                  }}
                />
              </View>
            ) : null}
            <Text
              allowFontScaling={false}
              numberOfLines={1}
              style={{
                color: row.highlight ? c.accent : c.textSecondary,
                fontSize: px(13),
                fontWeight: "600",
                textAlign: "right",
                fontVariant: ["tabular-nums"],
              }}
            >
              {row.value}
            </Text>
          </View>
        ))}
        {content.moreRows > 0 ? (
          <Text
            allowFontScaling={false}
            style={{ color: c.textSecondary, fontSize: px(12) }}
          >
            +{content.moreRows} more
          </Text>
        ) : null}
      </View>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: px(8),
        }}
      >
        <Text
          allowFontScaling={false}
          numberOfLines={1}
          style={{
            color: c.textSecondary,
            fontSize: px(13),
            fontWeight: "600",
            flexShrink: 1,
          }}
        >
          {content.handle ?? ""}
        </Text>
        <View
          style={{ flexDirection: "row", alignItems: "center", gap: px(6) }}
        >
          <Image
            source={mark}
            accessibilityIgnoresInvertColors
            style={{ width: px(18), height: px(18), borderRadius: px(4) }}
          />
          <Text
            allowFontScaling={false}
            style={{ color: c.text, fontSize: px(13), fontWeight: "800" }}
          >
            Mizyun
          </Text>
        </View>
      </View>
    </View>
  );
}
