import { Modal, Pressable, StyleSheet, View } from "react-native";
import type { WorkoutSetType } from "@mizyun/contracts";
import { ThemedText } from "@/components/themed-text";
import { Icon, IconButton, ListGroup } from "@/components/ui";
import { Radius, Spacing, type ThemeColors } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

export type SetTypeTone = "neutral" | "warning" | "danger" | "fat";

export interface SetTypeOption {
  readonly type: WorkoutSetType;
  readonly label: string;
  readonly badge: string;
  readonly description: string;
  readonly tone: SetTypeTone;
}

export const SET_TYPE_OPTIONS: ReadonlyArray<SetTypeOption> = [
  {
    type: "normal",
    label: "Normal Set",
    badge: "1",
    description:
      "Standard working set. Counted toward total volume and progressive overload.",
    tone: "neutral",
  },
  {
    type: "warmup",
    label: "Warmup Set",
    badge: "W",
    description:
      "Lighter preparatory set. Excluded from working volume and personal records.",
    tone: "warning",
  },
  {
    type: "failure",
    label: "Failure Set",
    badge: "F",
    description: "Set pushed to muscular failure (0 reps in reserve / RPE 10).",
    tone: "danger",
  },
  {
    type: "drop",
    label: "Drop Set",
    badge: "D",
    description:
      "Immediate weight reduction following a working set with zero rest.",
    tone: "fat",
  },
];

/** Theme-aware foreground and fill colours for a set type badge. */
export function setTypeBadgeColors(
  theme: ThemeColors,
  tone: SetTypeTone,
): { readonly color: string; readonly backgroundColor: string } {
  switch (tone) {
    case "warning":
      return { color: theme.warning, backgroundColor: theme.warningLight };
    case "danger":
      return { color: theme.danger, backgroundColor: theme.dangerLight };
    case "fat":
      return { color: theme.fat, backgroundColor: theme.backgroundSelected };
    default:
      return { color: theme.text, backgroundColor: theme.backgroundSelected };
  }
}

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
              <ThemedText type="subtitle">Select set type</ThemedText>
              {exerciseName ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {exerciseName}
                </ThemedText>
              ) : null}
            </View>
            <IconButton
              icon="close"
              accessibilityLabel="Close set type selector"
              onPress={onClose}
            />
          </View>

          <ListGroup>
            {SET_TYPE_OPTIONS.map((option) => {
              const isSelected = option.type === currentType;
              const badge = setTypeBadgeColors(theme, option.tone);

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
                  style={({ pressed }) => [
                    styles.optionRow,
                    pressed && { backgroundColor: theme.backgroundSelected },
                  ]}
                >
                  <View
                    style={[
                      styles.badgeContainer,
                      { backgroundColor: badge.backgroundColor },
                    ]}
                  >
                    <ThemedText type="smallBold" style={{ color: badge.color }}>
                      {option.badge}
                    </ThemedText>
                  </View>

                  <View style={styles.optionTextContainer}>
                    <ThemedText type="default">{option.label}</ThemedText>
                    <ThemedText type="footnote" themeColor="textSecondary">
                      {option.description}
                    </ThemedText>
                  </View>

                  {isSelected ? (
                    <Icon name="check" size={18} color="primary" />
                  ) : null}
                </Pressable>
              );
            })}
          </ListGroup>
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
    maxWidth: 440,
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
    gap: 2,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 56,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
    gap: 12,
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
    gap: 1,
  },
});
