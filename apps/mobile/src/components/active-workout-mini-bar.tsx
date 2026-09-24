import { router, usePathname } from "expo-router";
import { memo } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { BottomTabInset, MaxContentWidth, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { formatStopwatch, useOptionalActiveWorkout } from "@/features/workouts";

export function ActiveWorkoutMiniBar() {
  const pathname = usePathname();
  const workoutContext = useOptionalActiveWorkout();
  const theme = useTheme();

  if (!workoutContext || !workoutContext.activeWorkout) {
    return null;
  }

  // Hide the floating mini-bar when already on the full active workout screen
  if (pathname.startsWith("/log-workout")) {
    return null;
  }

  const { activeWorkout, elapsedSeconds, restTimer, restRemainingSeconds } =
    workoutContext;
  const isResting = restTimer !== null && restRemainingSeconds > 0;
  const durationText = formatStopwatch(elapsedSeconds);
  const restText = formatStopwatch(restRemainingSeconds);

  const accessibilityLabel = `Resume active workout: ${activeWorkout.name}, ${durationText} elapsed${
    isResting ? `, rest timer ${restText} remaining` : ""
  }`;

  const handlePress = () => {
    router.push({
      pathname: "/log-workout",
      params: { workoutId: activeWorkout.id },
    });
  };

  return (
    <View style={styles.dockContainer} pointerEvents="box-none">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={handlePress}
        style={({ pressed }) => [
          styles.card,
          {
            backgroundColor: theme.backgroundElement,
            borderColor: isResting ? theme.primary : theme.border,
          },
          pressed && styles.pressed,
        ]}
      >
        {/* Left pulse indicator */}
        <View style={styles.indicatorContainer}>
          <View
            style={[
              styles.pulseDot,
              { backgroundColor: isResting ? "#F59E0B" : theme.primary },
            ]}
          />
          <ThemedText style={styles.workoutIcon}>
            {isResting ? "⏳" : "🏋️"}
          </ThemedText>
        </View>

        {/* Middle title and live timers */}
        <View style={styles.infoColumn}>
          <ThemedText
            type="smallBold"
            numberOfLines={1}
            style={styles.workoutTitle}
          >
            {activeWorkout.name || "Live Workout"}
          </ThemedText>
          <View style={styles.timersRow}>
            <ThemedText type="small" themeColor="textSecondary">
              ⏱️ {durationText}
            </ThemedText>
            {isResting ? (
              <ThemedView type="backgroundSelected" style={styles.restBadge}>
                <ThemedText
                  type="smallBold"
                  themeColor="primary"
                  style={styles.restBadgeText}
                >
                  Rest {restText}
                </ThemedText>
              </ThemedView>
            ) : null}
          </View>
        </View>

        {/* Right resume button */}
        <View style={[styles.resumeButton, { backgroundColor: theme.primary }]}>
          <ThemedText style={styles.resumeButtonText}>Resume →</ThemedText>
        </View>
      </Pressable>
    </View>
  );
}

export default memo(ActiveWorkoutMiniBar);

const styles = StyleSheet.create({
  dockContainer: {
    position: "absolute",
    left: Spacing.three,
    right: Spacing.three,
    bottom: BottomTabInset + Spacing.two,
    alignItems: "center",
    zIndex: 999,
  },
  card: {
    width: "100%",
    maxWidth: MaxContentWidth,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.two + Spacing.half,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth * 2,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
      },
      android: {
        elevation: 6,
      },
      default: {},
    }),
  },
  pressed: {
    opacity: 0.9,
    transform: [{ scale: 0.99 }],
  },
  indicatorContainer: {
    position: "relative",
    marginRight: Spacing.two,
    justifyContent: "center",
    alignItems: "center",
  },
  pulseDot: {
    position: "absolute",
    top: -2,
    right: -2,
    width: 8,
    height: 8,
    borderRadius: 4,
    zIndex: 2,
  },
  workoutIcon: {
    fontSize: 20,
  },
  infoColumn: {
    flex: 1,
    marginRight: Spacing.two,
  },
  workoutTitle: {
    fontSize: 14,
  },
  timersRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    marginTop: 2,
  },
  restBadge: {
    paddingHorizontal: Spacing.one + Spacing.half,
    paddingVertical: 1,
    borderRadius: Spacing.one,
  },
  restBadgeText: {
    fontSize: 12,
  },
  resumeButton: {
    paddingVertical: Spacing.one + Spacing.half,
    paddingHorizontal: Spacing.two + Spacing.half,
    borderRadius: Spacing.two,
    alignItems: "center",
    justifyContent: "center",
  },
  resumeButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
});
