import { ActivityIndicator, StyleSheet, View } from "react-native";

import { useTheme } from "@/hooks/use-theme";

export function LoadingScreen() {
  const theme = useTheme();
  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ActivityIndicator size="large" color={theme.textSecondary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center" },
});
