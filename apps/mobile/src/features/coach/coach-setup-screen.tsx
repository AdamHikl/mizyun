import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { BottomTabInset, MaxContentWidth, Spacing } from "@/constants/theme";

const boundaries = [
  "AgentProvider — text, vision, and tool calls",
  "MemoryStore — retrieval, consolidation, and deletion",
  "Feature tools — nutrition, training, progress, and energy",
] as const;

export function CoachSetupScreen() {
  return (
    <ThemedView style={styles.page}>
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <View style={styles.statusRow}>
              <View style={styles.statusDot} />
              <ThemedText type="smallBold">Provider not connected</ThemedText>
            </View>
            <ThemedText type="subtitle">Coach, ready for a plug-in.</ThemedText>
            <ThemedText themeColor="textSecondary">
              The UI and orchestration layer do not know which model vendor will
              be selected.
            </ThemedText>
          </View>

          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold">Stable boundaries</ThemedText>
            {boundaries.map((boundary) => (
              <View key={boundary} style={styles.boundaryRow}>
                <ThemedText themeColor="textSecondary">○</ThemedText>
                <ThemedText type="small" style={styles.boundaryText}>
                  {boundary}
                </ThemedText>
              </View>
            ))}
          </ThemedView>

          <ThemedView style={styles.notice}>
            <ThemedText type="smallBold">Before enabling chat</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Complete docs/BEFORE_TESTING.md in the repository. It covers
              provider selection, privacy, memory isolation, evaluations, and
              release gates.
            </ThemedText>
          </ThemedView>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  safeArea: { flex: 1, alignItems: "center" },
  content: {
    width: "100%",
    maxWidth: MaxContentWidth,
    padding: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.six,
    gap: Spacing.five,
  },
  header: { gap: Spacing.three },
  statusRow: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#E8A230",
  },
  card: {
    borderRadius: Spacing.four,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  boundaryRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.two,
  },
  boundaryText: { flex: 1 },
  notice: {
    borderLeftWidth: 3,
    borderLeftColor: "#E8A230",
    paddingLeft: Spacing.three,
    gap: Spacing.two,
  },
});
