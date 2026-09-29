import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

export interface ReorderExerciseItem {
  readonly id: string;
  readonly name: string;
  readonly targetSets?: number;
  readonly repsMin?: number | null;
  readonly repsMax?: number | null;
}

export interface ReorderExercisesModalProps {
  readonly visible: boolean;
  readonly exercises: ReadonlyArray<ReorderExerciseItem>;
  readonly onMoveExercise: (fromIndex: number, toIndex: number) => void;
  readonly onClose: () => void;
}

export function formatExerciseTargetSummary(
  exercise: ReorderExerciseItem,
): string | null {
  const parts: string[] = [];

  if (typeof exercise.targetSets === "number" && exercise.targetSets > 0) {
    parts.push(
      `${exercise.targetSets} ${exercise.targetSets === 1 ? "set" : "sets"}`,
    );
  }

  const hasMin = typeof exercise.repsMin === "number" && exercise.repsMin > 0;
  const hasMax = typeof exercise.repsMax === "number" && exercise.repsMax > 0;

  if (hasMin && hasMax) {
    if (exercise.repsMin === exercise.repsMax) {
      parts.push(`${exercise.repsMin} reps`);
    } else {
      parts.push(`${exercise.repsMin}-${exercise.repsMax} reps`);
    }
  } else if (hasMin) {
    parts.push(`${exercise.repsMin}+ reps`);
  } else if (hasMax) {
    parts.push(`up to ${exercise.repsMax} reps`);
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}

export function ReorderExercisesModal({
  visible,
  exercises,
  onMoveExercise,
  onClose,
}: ReorderExercisesModalProps) {
  const theme = useTheme();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      presentationStyle={Platform.select({
        ios: "pageSheet",
        default: "overFullScreen",
      })}
      onRequestClose={onClose}
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable
          style={[
            styles.sheet,
            {
              backgroundColor: theme.backgroundElement,
              borderColor: theme.border,
            },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleBlock}>
              <ThemedText type="subtitle">Reorder Exercises</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Change the exercise order for your active workout session.
              </ThemedText>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close reorder exercises modal"
              onPress={onClose}
              style={styles.closeButton}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <ThemedText type="smallBold" themeColor="textSecondary">
                ✕
              </ThemedText>
            </Pressable>
          </View>

          {/* List */}
          <ScrollView
            style={styles.scrollList}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {exercises.length === 0 ? (
              <View style={styles.emptyContainer}>
                <ThemedText
                  type="small"
                  themeColor="textSecondary"
                  style={styles.emptyText}
                >
                  No exercises in current workout session.
                </ThemedText>
              </View>
            ) : (
              exercises.map((exercise, index) => {
                const isFirst = index === 0;
                const isLast = index === exercises.length - 1;
                const summary = formatExerciseTargetSummary(exercise);

                return (
                  <View
                    key={exercise.id}
                    style={[
                      styles.exerciseRow,
                      {
                        backgroundColor: theme.background,
                        borderColor: theme.border,
                      },
                    ]}
                  >
                    {/* Sequence Badge */}
                    <View
                      style={[
                        styles.sequenceBadge,
                        { backgroundColor: theme.backgroundSelected },
                      ]}
                    >
                      <ThemedText
                        type="smallBold"
                        style={{ color: theme.text }}
                      >
                        {index + 1}
                      </ThemedText>
                    </View>

                    {/* Details */}
                    <View style={styles.exerciseDetails}>
                      <ThemedText
                        type="default"
                        style={styles.exerciseNameText}
                        numberOfLines={1}
                      >
                        {exercise.name}
                      </ThemedText>
                      {summary ? (
                        <ThemedText
                          type="small"
                          themeColor="textSecondary"
                          numberOfLines={1}
                        >
                          {summary}
                        </ThemedText>
                      ) : null}
                    </View>

                    {/* Move Actions */}
                    <View style={styles.actionButtons}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Move ${exercise.name} up`}
                        accessibilityState={{ disabled: isFirst }}
                        disabled={isFirst}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        onPress={() => {
                          if (!isFirst) {
                            onMoveExercise(index, index - 1);
                          }
                        }}
                        style={[
                          styles.reorderButton,
                          {
                            borderColor: theme.border,
                            backgroundColor: isFirst
                              ? "transparent"
                              : theme.backgroundSelected,
                          },
                          isFirst && styles.reorderButtonDisabled,
                        ]}
                      >
                        <ThemedText
                          type="default"
                          style={[
                            styles.reorderButtonIcon,
                            {
                              color: isFirst ? theme.textSecondary : theme.text,
                            },
                            isFirst && styles.iconDisabled,
                          ]}
                        >
                          ↑
                        </ThemedText>
                      </Pressable>

                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Move ${exercise.name} down`}
                        accessibilityState={{ disabled: isLast }}
                        disabled={isLast}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        onPress={() => {
                          if (!isLast) {
                            onMoveExercise(index, index + 1);
                          }
                        }}
                        style={[
                          styles.reorderButton,
                          {
                            borderColor: theme.border,
                            backgroundColor: isLast
                              ? "transparent"
                              : theme.backgroundSelected,
                          },
                          isLast && styles.reorderButtonDisabled,
                        ]}
                      >
                        <ThemedText
                          type="default"
                          style={[
                            styles.reorderButtonIcon,
                            {
                              color: isLast ? theme.textSecondary : theme.text,
                            },
                            isLast && styles.iconDisabled,
                          ]}
                        >
                          ↓
                        </ThemedText>
                      </Pressable>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>

          {/* Prominent Done Button */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Done"
            onPress={onClose}
            style={[styles.doneButton, { backgroundColor: theme.primary }]}
          >
            <ThemedText type="default" style={styles.doneButtonText}>
              Done
            </ThemedText>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.65)",
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.four,
  },
  sheet: {
    width: "100%",
    maxWidth: 480,
    maxHeight: "85%",
    borderRadius: Spacing.four,
    borderWidth: 1,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  headerTitleBlock: {
    flex: 1,
    gap: Spacing.half,
  },
  closeButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  scrollList: {
    maxHeight: 400,
  },
  scrollContent: {
    gap: Spacing.two,
    paddingVertical: Spacing.one,
  },
  emptyContainer: {
    padding: Spacing.four,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    textAlign: "center",
  },
  exerciseRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 60,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
    borderWidth: 1,
    gap: Spacing.three,
  },
  sequenceBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  exerciseDetails: {
    flex: 1,
    gap: 2,
  },
  exerciseNameText: {
    fontWeight: "600",
  },
  actionButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  reorderButton: {
    width: 44,
    height: 44,
    minWidth: 44,
    minHeight: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  reorderButtonDisabled: {
    opacity: 0.35,
  },
  reorderButtonIcon: {
    fontSize: 18,
    lineHeight: 22,
    fontWeight: "700",
  },
  iconDisabled: {
    opacity: 0.5,
  },
  doneButton: {
    minHeight: 48,
    borderRadius: Spacing.three,
    alignItems: "center",
    justifyContent: "center",
    marginTop: Spacing.one,
  },
  doneButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
});
