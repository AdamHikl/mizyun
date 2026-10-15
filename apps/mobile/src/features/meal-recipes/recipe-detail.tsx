import { Pressable, StyleSheet, View } from "react-native";
import type {
  MealRecipeDraft,
  MealRecipeSessionCatalogItem,
} from "@mizyun/contracts";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { preparationText } from "./recipe-presentation";
const numberText = (value: number | null): string =>
  value === null || !Number.isFinite(value)
    ? "Unknown"
    : String(Number(value.toFixed(1)));
export const macroText = (value: number | null) => {
  const text = numberText(value);
  return text === "Unknown" ? text : `${text} g`;
};
export function RecipeDetail({
  recipe,
  catalog = [],
  portion,
  canAct,
  busy,
  portionLocked = false,
  onPortion,
  onLog,
}: {
  recipe: MealRecipeDraft;
  catalog?: readonly MealRecipeSessionCatalogItem[];
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
      <ThemedText>
        Estimated for your selected serving:{" "}
        {recipe.caloriesKcal === null || !Number.isFinite(recipe.caloriesKcal)
          ? "calories unknown"
          : `${numberText(recipe.caloriesKcal)} kcal`}
      </ThemedText>
      <ThemedText type="small">
        P {macroText(recipe.nutritionPerServing.proteinG)} · C{" "}
        {macroText(recipe.nutritionPerServing.carbohydrateG)} · F{" "}
        {macroText(recipe.nutritionPerServing.fatG)}
      </ThemedText>
      {recipe.calorieRangeKcal ? (
        <ThemedText type="small">
          Estimated range: {numberText(recipe.calorieRangeKcal.minimum)}–
          {numberText(recipe.calorieRangeKcal.maximum)} kcal
        </ThemedText>
      ) : null}
      <ThemedText type="small" themeColor="textSecondary">
        {(["proteinG", "carbohydrateG", "fatG"] as const)
          .filter((key) => recipe.rangesPerServing[key] !== null)
          .map(
            (key) =>
              `${key === "proteinG" ? "P" : key === "carbohydrateG" ? "C" : "F"} ${numberText(recipe.rangesPerServing[key]!.minimum)}–${numberText(recipe.rangesPerServing[key]!.maximum)} g`,
          )
          .join(" · ")}
      </ThemedText>
      {portionLocked ? (
        <ThemedText type="small">
          A meal draft is ready. Reopen it to make changes, or log this meal
          again.
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
            style={[
              styles.button,
              {
                borderColor: value === portion ? theme.primary : theme.border,
                backgroundColor:
                  value === portion
                    ? theme.primaryLight
                    : theme.backgroundElement,
              },
            ]}
          >
            <ThemedText>{value}×</ThemedText>
          </Pressable>
        ))}
      </View>
      <ThemedText type="smallBold">Ingredients · {portion}× serving</ThemedText>
      {recipe.ingredients.map((row) => {
        const food = catalog.find((item) => item.id === row.ingredientId);
        return (
          <ThemedText key={row.ingredientId} type="small">
            {food?.name ?? row.ingredientId.replaceAll(/[-_]/g, " ")} ·{" "}
            {macroText(row.weightGrams)} ·{" "}
            {preparationText(row.preparationState)}
          </ThemedText>
        );
      })}
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
        Estimated nutrition. Check ingredient quantities, preparation and food
        safety. Confirm what you actually ate in the editable meal form.
      </ThemedText>
      {!canAct ? (
        <ThemedText type="smallBold">
          These meal details may be out of date. Refresh your daily targets
          before using this recipe.
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
