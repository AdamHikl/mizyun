import { Modal, Pressable, StyleSheet, View } from "react-native";
import type { WorkoutSetType } from "@mizyun/contracts";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

export interface SetTypeOption {
  readonly type: WorkoutSetType;
  readonly label: string;
  readonly badge: string;
  readonly description: string;
  readonly badgeColor: string;
  readonly badgeBg: string;
}

export const SET_TYPE_OPTIONS: ReadonlyArray<SetTypeOption> = [
  {
    type: "normal",
    label: "Normal Set",
    badge: "1",
    description:
      "Standard working set. Counted toward total volume and progressive overload.",
    badgeColor: "#FFFFFF",
    badgeBg: "rgba(255, 255, 255, 0.15)",
  },
  {
    type: "warmup",
    label: "Warmup Set",
    badge: "W",
    description:
      "Lighter preparatory set. Excluded from working volume and personal records.",
    badgeColor: "#F59E0B",
    badgeBg: "rgba(245, 158, 11, 0.2)",
  },
  {
    type: "failure",
    label: "Failure Set",
    badge: "F",
    description: "Set pushed to muscular failure (0 reps in reserve / RPE 10).",
    badgeColor: "#EF4444",
    badgeBg: "rgba(239, 68, 68, 0.2)",
  },
  {
    type: "drop",
    label: "Drop Set",
    badge: "D",
    description:
      "Immediate weight reduction following a working set with zero rest.",
    badgeColor: "#8B5CF6",
    badgeBg: "rgba(139, 92, 246, 0.2)",
  },
];

export interface SetTypeModalProps {
  readonly visible: boolean;
  readonly currentType: WorkoutSetType;
  readonly exerciseName?: string;
  readonly onClose: () => void;
  readonly onSelectType: (type: WorkoutSetType) => void;
}

export function SetTypeModal({
  visible,
  currentType,
  exerciseName,
  onClose,
  onSelectType,
}: SetTypeModalProps) {
  const theme = useTheme();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
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
              <ThemedText type="subtitle">Select Set Type</ThemedText>
              {exerciseName ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {exerciseName}
                </ThemedText>
              ) : null}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close set type selector"
              onPress={onClose}
              style={styles.closeButton}
            >
              <ThemedText type="smallBold" themeColor="textSecondary">
                ✕
              </ThemedText>
            </Pressable>
          </View>

          {/* Options List */}
          <View style={styles.optionsList}>
            {SET_TYPE_OPTIONS.map((option) => {
              const isSelected = option.type === currentType;

              return (
                <Pressable
                  key={option.type}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={`${option.label}: ${option.description}`}
                  onPress={() => {
                    onSelectType(option.type);
                    onClose();
                  }}
                  style={[
                    styles.optionRow,
                    {
                      borderColor: isSelected
                        ? theme.primary
                        : "rgba(255, 255, 255, 0.08)",
                      backgroundColor: isSelected
                        ? "rgba(16, 185, 129, 0.08)"
                        : "rgba(255, 255, 255, 0.02)",
                    },
                  ]}
                >
                  {/* Badge */}
                  <View
                    style={[
                      styles.badgeContainer,
                      { backgroundColor: option.badgeBg },
                    ]}
                  >
                    <ThemedText
                      type="smallBold"
                      style={{ color: option.badgeColor }}
                    >
                      {option.badge}
                    </ThemedText>
                  </View>

                  {/* Text details */}
                  <View style={styles.optionTextContainer}>
                    <ThemedText type="default">{option.label}</ThemedText>
                    <ThemedText
                      type="small"
                      themeColor="textSecondary"
                      style={styles.descriptionText}
                    >
                      {option.description}
                    </ThemedText>
                  </View>

                  {/* Radio check icon */}
                  {isSelected ? (
                    <View style={styles.selectedCheck}>
                      <ThemedText
                        type="smallBold"
                        style={styles.checkCheckText}
                      >
                        ✓
                      </ThemedText>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
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
    maxWidth: 440,
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
    gap: 2,
  },
  closeButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  optionsList: {
    gap: Spacing.two,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 56,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
    borderWidth: 1,
    gap: Spacing.three,
  },
  badgeContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  optionTextContainer: {
    flex: 1,
    gap: 2,
  },
  descriptionText: {
    lineHeight: 16,
  },
  selectedCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#10B981",
    alignItems: "center",
    justifyContent: "center",
  },
  checkCheckText: {
    color: "#FFFFFF",
    fontSize: 14,
  },
});
