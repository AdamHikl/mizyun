import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { ThemedText } from "@/components/themed-text";
import { Button, IconButton, ListGroup } from "@/components/ui";
import { Radius, Spacing } from "@/constants/theme";
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
      <Pressable
        style={[styles.overlay, { backgroundColor: theme.overlay }]}
        onPress={onClose}
      >
        <Pressable
          style={[styles.sheet, { backgroundColor: theme.background }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.header}>
            <View style={styles.headerTitleBlock}>
              <ThemedText type="subtitle">Reorder exercises</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Change the exercise order for your active workout session.
              </ThemedText>
            </View>
            <IconButton
              icon="close"
              accessibilityLabel="Close reorder exercises modal"
              onPress={onClose}
            />
          </View>

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
              <ListGroup>
                {exercises.map((exercise, index) => {
                  const isFirst = index === 0;
                  const isLast = index === exercises.length - 1;
                  const summary = formatExerciseTargetSummary(exercise);

                  return (
                    <View key={exercise.id} style={styles.exerciseRow}>
                      <View
                        style={[
                          styles.sequenceBadge,
                          { backgroundColor: theme.backgroundSelected },
                        ]}
                      >
                        <ThemedText type="smallBold">{index + 1}</ThemedText>
                      </View>

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
                            type="footnote"
                            themeColor="textSecondary"
                            numberOfLines={1}
                          >
                            {summary}
                          </ThemedText>
                        ) : null}
                      </View>

                      <View style={styles.actionButtons}>
                        <IconButton
                          icon="chevronUp"
                          accessibilityLabel={`Move ${exercise.name} up`}
                          accessibilityState={{ disabled: isFirst }}
                          disabled={isFirst}
                          onPress={() => {
                            if (!isFirst) {
                              onMoveExercise(index, index - 1);
                            }
                          }}
                        />
                        <IconButton
                          icon="chevronDown"
                          accessibilityLabel={`Move ${exercise.name} down`}
                          accessibilityState={{ disabled: isLast }}
                          disabled={isLast}
                          onPress={() => {
                            if (!isLast) {
                              onMoveExercise(index, index + 1);
                            }
                          }}
                        />
                      </View>
                    </View>
                  );
                })}
              </ListGroup>
            )}
          </ScrollView>

          <Button
            label="Done"
            accessibilityLabel="Done"
            variant="primary"
            block
            onPress={onClose}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.four,
  },
  sheet: {
    width: "100%",
    maxWidth: 480,
    maxHeight: "85%",
    borderRadius: Radius.xl,
    borderCurve: "continuous",
    padding: Spacing.three,
    gap: Spacing.three,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: Spacing.two,
  },
  headerTitleBlock: {
    flex: 1,
    gap: Spacing.half,
  },
  scrollList: {
    maxHeight: 400,
  },
  scrollContent: {
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
    gap: 12,
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
    gap: 1,
  },
  exerciseNameText: {
    fontWeight: "600",
  },
  actionButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
  },
});
