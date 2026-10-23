import { useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import {
  MAX_BARBELL_TARGET,
  STANDARD_BARS,
  STANDARD_PLATES,
  barbellTotal,
  platesForTarget,
  type PlateUnit,
} from "@mizyun/core";
import { ThemedText } from "@/components/themed-text";
import {
  IconButton,
  ListGroup,
  ListRow,
  SegmentedControl,
} from "@/components/ui";
import { MinTouchTarget, Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

export interface PlateCalculatorModalProps {
  readonly visible: boolean;
  readonly unitSystem: "metric" | "imperial";
  /** Session exercises the total can be copied into. */
  readonly exercises: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
  }>;
  /** Fills the exercise's next-set load with `load` (display unit). */
  readonly onUseWeight: (exerciseId: string, load: string) => void;
  readonly onClose: () => void;
}

const formatWeight = (value: number): string =>
  Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));

const NUMERIC_INPUT = /^\d*[.,]?\d*$/;

/** Parses a typed weight; NaN for anything but plain decimal digits. */
const parseWeight = (text: string): number =>
  NUMERIC_INPUT.test(text.trim()) && /\d/.test(text)
    ? Number(text.trim().replace(",", "."))
    : Number.NaN;

const emptyCounts = (plates: readonly number[]): number[] =>
  plates.map(() => 0);

/**
 * Barbell plate calculator for the live session. Plate counts are per side;
 * entering a target fills in the closest loadout at or below it.
 */
export function PlateCalculatorModal({
  visible,
  unitSystem,
  exercises,
  onUseWeight,
  onClose,
}: PlateCalculatorModalProps) {
  const theme = useTheme();
  const unit: PlateUnit = unitSystem === "imperial" ? "lb" : "kg";
  const plates = STANDARD_PLATES[unit];
  const bars = STANDARD_BARS[unit];

  const [bar, setBar] = useState<number>(bars[0] ?? 0);
  const [counts, setCounts] = useState<number[]>(() => emptyCounts(plates));
  const [target, setTarget] = useState("");
  const [shortBy, setShortBy] = useState(0);

  const total = useMemo(
    () =>
      barbellTotal(
        bar,
        plates.map((plate, i) => ({ plate, perSide: counts[i] ?? 0 })),
      ),
    [bar, counts, plates],
  );

  const applyTarget = (text: string, barWeight: number) => {
    setTarget(text);
    const loadout = platesForTarget(
      parseWeight(text),
      barWeight,
      plates,
      MAX_BARBELL_TARGET[unit],
    );
    // An empty, invalid or unloadable target shows the empty bar.
    setCounts(loadout?.plates.map((p) => p.perSide) ?? emptyCounts(plates));
    setShortBy(loadout?.shortBy ?? 0);
  };

  const targetValue = parseWeight(target);
  const targetProblem =
    target.trim() === ""
      ? null
      : !Number.isFinite(targetValue)
        ? "Enter a number."
        : targetValue < bar
          ? "Target is lighter than the bar."
          : targetValue > MAX_BARBELL_TARGET[unit]
            ? `Enter ${MAX_BARBELL_TARGET[unit]} ${unit} or less.`
            : null;

  const changeCount = (index: number, delta: number) => {
    setTarget("");
    setShortBy(0);
    setCounts((current) =>
      current.map((count, i) =>
        i === index ? Math.max(0, count + delta) : count,
      ),
    );
  };

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
              <ThemedText type="subtitle">Plate calculator</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Plates are counted per side.
              </ThemedText>
            </View>
            <IconButton
              icon="close"
              accessibilityLabel="Close plate calculator"
              onPress={onClose}
            />
          </View>

          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            <View
              accessible
              accessibilityLabel={`Total ${formatWeight(total)} ${unit}`}
              accessibilityLiveRegion="polite"
              style={styles.totalBlock}
            >
              <ThemedText type="footnote" themeColor="textSecondary">
                Total
              </ThemedText>
              <ThemedText type="title" testID="plate-calculator-total">
                {formatWeight(total)} {unit}
              </ThemedText>
            </View>

            <View style={styles.field}>
              <ThemedText type="footnote" themeColor="textSecondary">
                Bar
              </ThemedText>
              <SegmentedControl
                accessibilityLabel="Bar weight"
                options={bars.map((weight) => ({
                  value: String(weight),
                  label: `${formatWeight(weight)} ${unit}`,
                }))}
                value={String(bar)}
                onChange={(value) => {
                  const next = Number(value);
                  setBar(next);
                  if (target.trim() !== "") applyTarget(target, next);
                }}
              />
            </View>

            <View style={styles.field}>
              <ThemedText type="footnote" themeColor="textSecondary">
                Target weight ({unit})
              </ThemedText>
              <TextInput
                testID="plate-calculator-target"
                value={target}
                onChangeText={(text) => applyTarget(text, bar)}
                placeholder="Optional"
                placeholderTextColor={theme.textTertiary}
                keyboardType="decimal-pad"
                returnKeyType="done"
                accessibilityLabel={`Target weight in ${unit}`}
                accessibilityHint="Fills in the plates for each side."
                style={[
                  styles.input,
                  {
                    color: theme.text,
                    backgroundColor: theme.backgroundSelected,
                  },
                ]}
              />
              {targetProblem ? (
                <ThemedText type="footnote" themeColor="warning">
                  {targetProblem}
                </ThemedText>
              ) : shortBy > 0 ? (
                <ThemedText type="footnote" themeColor="warning">
                  Closest loadable weight is {formatWeight(total)} {unit} (
                  {formatWeight(shortBy)} {unit} short).
                </ThemedText>
              ) : null}
            </View>

            <ListGroup>
              {plates.map((plate, index) => {
                const count = counts[index] ?? 0;
                const label = `${formatWeight(plate)} ${unit}`;
                return (
                  <View key={plate} style={styles.plateRow}>
                    <ThemedText
                      type="default"
                      style={styles.plateLabel}
                      importantForAccessibility="no-hide-descendants"
                      accessibilityElementsHidden
                    >
                      {label}
                    </ThemedText>
                    <IconButton
                      icon="minus"
                      accessibilityLabel={`Remove a ${label} plate from each side`}
                      disabled={count === 0}
                      onPress={() => changeCount(index, -1)}
                    />
                    <ThemedText
                      type="headline"
                      style={styles.plateCount}
                      accessibilityLabel={`${count} ${label} plates per side`}
                      testID={`plate-calculator-count-${plate}`}
                    >
                      {count}
                    </ThemedText>
                    <IconButton
                      icon="add"
                      accessibilityLabel={`Add a ${label} plate to each side`}
                      onPress={() => changeCount(index, 1)}
                    />
                  </View>
                );
              })}
            </ListGroup>

            <View style={styles.field}>
              <ThemedText type="footnote" themeColor="textSecondary">
                Copy {formatWeight(total)} {unit} to the next set of
              </ThemedText>
              {exercises.length === 0 ? (
                <ThemedText type="footnote" themeColor="textSecondary">
                  Add a weight-and-reps exercise to copy this weight into a set.
                </ThemedText>
              ) : (
                <ListGroup>
                  {exercises.map((exercise) => (
                    <ListRow
                      key={exercise.id}
                      testID={`plate-calculator-use-${exercise.id}`}
                      title={exercise.name}
                      value="Use"
                      accessibilityLabel={`Use ${formatWeight(total)} ${unit} for the next ${exercise.name} set`}
                      onPress={() => {
                        onUseWeight(exercise.id, formatWeight(total));
                        onClose();
                      }}
                    />
                  ))}
                </ListGroup>
              )}
            </View>
          </ScrollView>
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
    maxHeight: "90%",
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
  headerTitleBlock: { flex: 1, gap: 2 },
  content: { gap: Spacing.three },
  totalBlock: { alignItems: "center", gap: 2 },
  field: { gap: Spacing.one },
  input: {
    minHeight: MinTouchTarget,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    fontSize: 17,
  },
  plateRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 56,
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
  },
  plateLabel: { flex: 1 },
  plateCount: { minWidth: 28, textAlign: "center" },
});
