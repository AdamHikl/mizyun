import { StyleSheet, View } from "react-native";

import { BrandWordmark } from "@/components/brand-wordmark";
import { ThemedText } from "@/components/themed-text";
import { Card } from "@/components/ui";
import { PageGutter, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

export function AuthSetupScreen({ reason }: { reason: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <BrandWordmark />
      <ThemedText type="subtitle">Mizyun is ready</ThemedText>
      <ThemedText themeColor="textSecondary">{reason}</ThemedText>
      <Card>
        <ThemedText type="code" selectable>
          Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY.
        </ThemedText>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: PageGutter,
    gap: Spacing.three,
  },
});
