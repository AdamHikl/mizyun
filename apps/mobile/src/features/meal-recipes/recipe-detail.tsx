import { Pressable, StyleSheet, View } from "react-native";
import type { MealRecipeDraft } from "@mizyun/contracts";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
export const macroText = (value: number | null) =>
  value === null ? "Unknown" : `${value} g`;
export function RecipeDetail({
  recipe,
  portion,
  canAct,
  busy,
  portionLocked = false,
  onPortion,
  onLog,
}: {
  recipe: MealRecipeDraft;
  portion: number;
  canAct: boolean;
  busy: boolean;
  portionLocked?: boolean;
  onPortion: (value: number) => void;
  onLog: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.detail}>
      <ThemedText type="subtitle">{recipe.name}</ThemedText>
      <ThemedText>
        Estimated for your selected serving:{" "}
        {recipe.caloriesKcal === null
          ? "calories unknown"
          : `${recipe.caloriesKcal} kcal`}
      </ThemedText>
      <ThemedText type="small">
        P {macroText(recipe.nutritionPerServing.proteinG)} · C{" "}
        {macroText(recipe.nutritionPerServing.carbohydrateG)} · F{" "}
        {macroText(recipe.nutritionPerServing.fatG)}
      </ThemedText>
      {recipe.calorieRangeKcal ? (
        <ThemedText type="small">
          Estimated range: {recipe.calorieRangeKcal.minimum}–
          {recipe.calorieRangeKcal.maximum} kcal
        </ThemedText>
      ) : null}
      <ThemedText type="small" themeColor="textSecondary">
        {(["proteinG", "carbohydrateG", "fatG"] as const)
          .filter((key) => recipe.rangesPerServing[key] !== null)
          .map(
            (key) =>
              `${key === "proteinG" ? "P" : key === "carbohydrateG" ? "C" : "F"} ${recipe.rangesPerServing[key]!.minimum}–${recipe.rangesPerServing[key]!.maximum} g`,
          )
          .join(" · ")}
      </ThemedText>
      {portionLocked ? (
        <ThemedText type="small">
          This serving has a saved meal draft. Reopen it to edit, or prepare a
          separate consumption.
        </ThemedText>
      ) : null}
      <View style={styles.portions}>
        {[0.5, 1, 1.5, 2].map((value) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityLabel={`${value} serving`}
            accessibilityState={{
              selected: value === portion,
              disabled: busy || portionLocked,
            }}
            disabled={busy || portionLocked}
            onPress={() => onPortion(value)}
            style={[styles.button, { borderColor: theme.border }]}
          >
            <ThemedText>{value}×</ThemedText>
          </Pressable>
        ))}
      </View>
      <ThemedText type="smallBold">
        Ingredients for {portion}× the recipe ({recipe.servings} base serving)
      </ThemedText>
      {recipe.ingredients.map((row) => (
        <ThemedText key={row.ingredientId} type="small">
          {row.ingredientId.replaceAll("_", " ")} · {row.weightGrams} g ·{" "}
          {row.preparationState.replaceAll("_", " ")}
        </ThemedText>
      ))}
      <ThemedText type="smallBold">
        Preparation · {recipe.prepMinutes} min
      </ThemedText>
      {recipe.steps.map((step, index) => (
        <ThemedText key={index} type="small">
          {index + 1}. {step}
        </ThemedText>
      ))}
      {[...recipe.assumptions, ...recipe.warnings].map((text, index) => (
        <ThemedText key={index} type="small" themeColor="textSecondary">
          {text}
        </ThemedText>
      ))}
      <ThemedText type="small" themeColor="textSecondary">
        Estimate: {recipe.provenance.source}. Check ingredient quantities,
        preparation and food safety. Confirm what you actually ate in the
        editable meal form.
      </ThemedText>
      {!canAct ? (
        <ThemedText type="smallBold">
          Saved details only. Check current constraints before cooking or
          creating a recipe meal draft.
        </ThemedText>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: busy || !canAct }}
        disabled={busy || !canAct}
        accessibilityLabel="I ate this · Review meal"
        onPress={onLog}
        style={[
          styles.button,
          { borderColor: theme.border, opacity: busy || !canAct ? 0.5 : 1 },
        ]}
      >
        <ThemedText type="smallBold">I ate this · Review meal</ThemedText>
      </Pressable>
    </View>
  );
}
const styles = StyleSheet.create({
  detail: { gap: 12 },
  portions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  button: {
    minHeight: 44,
    padding: 12,
    borderWidth: 1,
    borderRadius: 12,
    justifyContent: "center",
  },
});
