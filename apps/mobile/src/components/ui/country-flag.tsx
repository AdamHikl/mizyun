import { Image } from "expo-image";
import { useState } from "react";
import {
  Platform,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from "react-native";
import { getEmojiFlag } from "@/lib/country-data";

export interface CountryFlagProps {
  readonly code?: string | null;
  readonly size?: number;
  readonly style?: StyleProp<ViewStyle>;
}

export function CountryFlag({ code, size = 20, style }: CountryFlagProps) {
  const [imageFailed, setImageFailed] = useState(false);

  if (!code || !/^[A-Za-z]{2}$/.test(code.trim())) {
    return (
      <View style={[styles.container, { width: size, height: size }, style]}>
        <Text
          style={{ fontSize: size * 0.85, lineHeight: size }}
          accessibilityLabel="Global standard"
        >
          🌐
        </Text>
      </View>
    );
  }

  const cleanCode = code.trim().toUpperCase();
  const emoji = getEmojiFlag(cleanCode);

  // On iOS and Web, Apple Color Emoji / system fonts natively render flags crisply with zero asset load.
  // On Android, many system fonts omit flag emoji glyphs, rendering ugly two-letter boxes ([U][S]).
  // We use FlagCDN with expo-image and disk caching on Android, falling back to emoji if offline/failed.
  if (Platform.OS === "android" && !imageFailed) {
    const width = Math.round(size * 1.33);
    const height = size;
    return (
      <View style={[styles.container, { width, height }, style]}>
        <Image
          source={{
            uri: `https://flagcdn.com/w80/${cleanCode.toLowerCase()}.png`,
          }}
          cachePolicy="disk"
          contentFit="cover"
          transition={100}
          onError={() => setImageFailed(true)}
          style={[styles.image, { width, height }]}
          accessibilityLabel={`${cleanCode} flag`}
        />
      </View>
    );
  }

  return (
    <View
      style={[styles.container, { width: size * 1.25, height: size }, style]}
    >
      <Text
        style={{
          fontSize: size * 0.95,
          lineHeight: size * 1.15,
          textAlign: "center",
          includeFontPadding: false,
        }}
        accessibilityLabel={`${cleanCode} flag`}
      >
        {emoji}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  image: {
    borderRadius: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(128, 128, 128, 0.25)",
  },
});
