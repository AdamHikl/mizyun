import { Stack } from "expo-router";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ActivityIndicator } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Button, Notice } from "@/components/ui";
import {
  BottomTabInset,
  MaxContentWidth,
  PageGutter,
  Spacing,
} from "@/constants/theme";
import { useAuth } from "@/features/auth/auth-context";
import { refreshEnergyAfterDecision } from "./refresh-energy";
import { useWeeklyReview } from "./use-weekly-review";
import { WeeklyReviewPanel } from "./weekly-review-panel";

/** Full-screen weekly calorie check-in (also the notification destination). */
export function WeeklyReviewScreen() {
  const { profile } = useAuth();
  const { controller, state } = useWeeklyReview({
    onDecided: refreshEnergyAfterDecision,
  });

  return (
    <ThemedView style={styles.flex}>
      <Stack.Screen options={{ title: "Weekly check-in" }} />
      <SafeAreaView style={styles.flex} edges={["bottom"]}>
        <ScrollView
          contentContainerStyle={styles.content}
          contentInsetAdjustmentBehavior="automatic"
        >
          <View style={styles.inner}>
            {controller === null ? (
              <ThemedText type="small" themeColor="textSecondary">
                Sign in to see your weekly calorie check-in.
              </ThemedText>
            ) : state.phase === "loading" && state.snapshot === null ? (
              <ActivityIndicator accessibilityLabel="Loading weekly check-in" />
            ) : state.snapshot === null ? (
              <View style={styles.inner}>
                <Notice
                  tone="danger"
                  message={
                    state.message ??
                    "The weekly check-in could not be loaded. Try again."
                  }
                />
                <Button
                  label="Try again"
                  variant="tinted"
                  onPress={() => void controller.load()}
                />
              </View>
            ) : (
              <WeeklyReviewPanel
                snapshot={state.snapshot}
                unitSystem={profile?.unitSystem ?? "metric"}
                submitting={state.submitting}
                message={state.message}
                outcome={state.outcome}
                liveTargetKcal={state.liveTargetKcal}
                onAccept={() => void controller.decide("accept")}
                onDecline={() => void controller.decide("decline")}
              />
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    paddingHorizontal: PageGutter,
    paddingTop: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.four,
    alignItems: "center",
  },
  inner: { width: "100%", maxWidth: MaxContentWidth, gap: Spacing.three },
});
