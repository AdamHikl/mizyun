import { StyleSheet, Text, View } from "react-native";

export function AuthSetupScreen({ reason }: { reason: string }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Mizyun is ready</Text>
      <Text style={styles.body}>{reason}</Text>
      <Text style={styles.code}>
        Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    padding: 28,
    gap: 14,
    backgroundColor: "#f7f8f4",
  },
  title: { fontSize: 30, fontWeight: "700", color: "#132019" },
  body: { fontSize: 17, lineHeight: 25, color: "#4d5c53" },
  code: {
    padding: 16,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#e7ece8",
    fontFamily: "monospace",
  },
});
