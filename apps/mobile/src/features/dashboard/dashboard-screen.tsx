import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { BottomTabInset, MaxContentWidth, Spacing } from "@/constants/theme";

const metrics = [
  { label: "Calories today", value: "—", detail: "Start with a meal" },
  { label: "Current weight", value: "—", detail: "Add a measurement" },
  { label: "Training", value: "0", detail: "workouts this week" },
] as const;

const actions = [
  "Log a meal",
  "Start a workout",
  "Add weight",
  "Add progress photo",
] as const;

export function DashboardScreen() {
  return (
    <ThemedView style={styles.page}>
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              MIZYUN
            </ThemedText>
            <ThemedText type="subtitle">Your day, in one place.</ThemedText>
            <ThemedText themeColor="textSecondary">
              Build the record first. Coaching and automation can plug into the
              same data later.
            </ThemedText>
          </View>

          <View style={styles.metrics}>
            {metrics.map((metric) => (
              <ThemedView
                key={metric.label}
                type="backgroundElement"
                style={styles.metricCard}
              >
                <ThemedText type="small" themeColor="textSecondary">
                  {metric.label}
                </ThemedText>
                <ThemedText type="subtitle">{metric.value}</ThemedText>
                <ThemedText type="small">{metric.detail}</ThemedText>
              </ThemedView>
            ))}
          </View>

          <View style={styles.section}>
            <ThemedText type="smallBold">Quick add</ThemedText>
            <View style={styles.actionGrid}>
              {actions.map((action) => (
                <Pressable
                  key={action}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.action,
                    pressed && styles.pressed,
                  ]}
                >
                  <ThemedText type="smallBold">{action}</ThemedText>
                  <ThemedText themeColor="textSecondary">＋</ThemedText>
                </Pressable>
              ))}
            </View>
          </View>

          <ThemedView type="backgroundElement" style={styles.foundationCard}>
            <ThemedText type="smallBold">Foundation mode</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Model APIs are intentionally disconnected. Tracking features
              remain independent and the coach has a replaceable provider
              boundary.
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
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.six,
    gap: Spacing.five,
  },
  header: { gap: Spacing.two },
  metrics: { gap: Spacing.three },
  metricCard: {
    borderRadius: Spacing.four,
    padding: Spacing.four,
    gap: Spacing.one,
  },
  section: { gap: Spacing.three },
  actionGrid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  action: {
    minWidth: "47%",
    flexGrow: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#8A8D91",
    borderRadius: Spacing.three,
    padding: Spacing.three,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pressed: { opacity: 0.65 },
  foundationCard: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
  },
});
