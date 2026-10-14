import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { router, useFocusEffect, type Href } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { isMealRecipeSnapshotFresh } from "@mizyun/core";
import type { MealRecipeInput } from "@mizyun/contracts";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useTheme } from "@/hooks/use-theme";
import { useAuth } from "@/features/auth/auth-context";
import { subscribeSessionReadUpdates } from "@/composition/personal-read-events";
import { clearRecipeIngredientData } from "./public-data";
import { createRecipeController } from "./recipe-data";
import { RecipeIngredientReview } from "./ingredient-review-session";
import { subscribeRecipeConsentGrant } from "./public-data";
import { registerIngredientReviewRetirement } from "./ingredient-review-lifecycle";
import type { ReviewedIngredient } from "./ingredient-review-storage";
import type { RecipeController } from "./recipe-controller";
import { RecipeDetail, macroText } from "./recipe-detail";
export function MealRecipesScreen() {
  const { session } = useAuth();
  const [consentGeneration, setConsentGeneration] = useState(0);
  const live = useRef(session);
  live.current = session;
  const captured = useMemo(
    () => ({
      owner: session?.user.id ?? null,
      token: session?.accessToken ?? null,
      active: true,
    }),
    [session?.user.id, session?.accessToken, consentGeneration],
  );
  const current = useCallback(
    () =>
      captured.active &&
      live.current?.user.id === captured.owner &&
      live.current?.accessToken === captured.token,
    [captured],
  );
  const controller = useMemo(
    () =>
      captured.owner ? createRecipeController(captured.owner, current) : null,
    [captured, current],
  );
  useEffect(() => {
    captured.active = true;
    if (!controller || !captured.owner) return;
    const offGrant = subscribeRecipeConsentGrant(captured.owner, () => {
      if (!current()) return;
      captured.active = false;
      setConsentGeneration((value) => value + 1);
    });
    const unregister = registerIngredientReviewRetirement(
      captured.owner,
      (reason) =>
        reason === "account" ? controller.dispose() : controller.retireAi(),
    );
    void controller.init();
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void controller.refresh();
    });
    const unlisten = subscribeSessionReadUpdates(() => {
      controller.expire();
      void controller.refresh();
    });
    const timer = setInterval(() => controller.expire(), 1000);
    return () => {
      captured.active = false;
      offGrant();
      unregister();
      listener.remove();
      unlisten();
      clearInterval(timer);
      controller.dispose();
    };
  }, [controller, captured, current]);
  useFocusEffect(
    useCallback(() => {
      if (controller?.getSnapshot().phase === "idle") void controller.refresh();
    }, [controller]),
  );
  if (!controller || !captured.owner)
    return (
      <ThemedView>
        <ThemedText>Sign in to review recipes.</ThemedText>
      </ThemedView>
    );
  return (
    <RecipeFlow
      key={`${captured.owner}:${captured.token}:${consentGeneration}`}
      controller={controller}
      owner={captured.owner}
      isCurrent={current}
    />
  );
}
export function RecipeFlow({
  controller,
  owner,
  isCurrent,
}: {
  controller: RecipeController;
  owner: string;
  isCurrent: () => boolean;
}) {
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const theme = useTheme();
  const [eraseError, setEraseError] = useState(false);
  const [erasing, setErasing] = useState(false);
  const [reviewing, setReviewing] = useState(false),
    [rows, setRows] = useState<readonly ReviewedIngredient[]>([]),
    [choices, setChoices] = useState<Record<string, string>>({}),
    [search, setSearch] = useState("");
  const [prep, setPrep] = useState(""),
    [size, setSize] = useState<"small" | "normal" | "large">("normal"),
    [allergens, setAllergens] = useState(""),
    [diet, setDiet] = useState("");
  const busy = snapshot.phase !== "idle",
    selected = controller.selected(),
    ranking = controller.ranking();
  const context = ranking?.context ?? snapshot.metadata?.context;
  const freshContext =
    context &&
    isMealRecipeSnapshotFresh(context.snapshot, new Date(), context.snapshot) &&
    context.state === "ready";
  const button = (label: string, onPress: () => void, disabled = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        { borderColor: theme.border, opacity: disabled ? 0.5 : 1 },
      ]}
    >
      <ThemedText type="smallBold">{label}</ThemedText>
    </Pressable>
  );
  const saveInputs = () => {
    const catalog = snapshot.metadata?.catalog ?? [];
    const ingredients = rows.map((row) =>
      catalog.find((item) => item.id === choices[row.id]),
    );
    if (ingredients.some((row) => !row)) return;
    const maximumPrepMinutes = prep.trim() ? Number(prep) : null;
    const input: MealRecipeInput = {
      version: "meal-recipe-v1",
      ingredients: ingredients.map((item) => ({
        ingredientId: item!.id,
        name: item!.name,
        preparationState: item!.preparationState,
        confirmed: true,
        quantity: null,
        quantityUnit: "g",
        availability: "check_quantity",
      })),
      exclusions: {
        ingredientIds: [],
        allergens: allergens
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        dietaryRestrictions: diet
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      },
      preferences: { maximumPrepMinutes, mealSize: size, cuisines: [] },
    };
    void controller.setInput(input);
  };
  const handoff = async (replace = false) => {
    if ((await controller.handoff(replace)) && isCurrent())
      router.push("/log-meal" as Href);
  };
  return (
    <ThemedView style={styles.fill}>
      <SafeAreaView style={styles.fill} edges={["bottom"]}>
        <KeyboardAvoidingView
          style={styles.fill}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.content}
          >
            <ThemedText type="title">What can I cook?</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Use confirmed fridge and cabinet ingredients. Suggestions and
              macros are estimates; only Save in the meal form records food.
            </ThemedText>
            <View style={[styles.card, { borderColor: theme.border }]}>
              <ThemedText type="smallBold">
                {freshContext
                  ? "Remaining, based on what you’ve logged"
                  : "Macro fit unavailable"}
              </ThemedText>
              <ThemedText>
                P {macroText(freshContext ? context.remaining.proteinG : null)}{" "}
                · C{" "}
                {macroText(
                  freshContext ? context.remaining.carbohydrateG : null,
                )}{" "}
                · F {macroText(freshContext ? context.remaining.fatG : null)}
              </ThemedText>
              {freshContext ? (
                <ThemedText type="small">
                  Focus: {context.focus.join(", ") || "No remaining gaps"}
                </ThemedText>
              ) : (
                <ThemedText type="small">
                  Ordinary recipe discovery remains available when your logged
                  intake or targets are incomplete.
                </ThemedText>
              )}
            </View>
            {snapshot.message ? (
              <ThemedText accessibilityRole="alert" type="small">
                {snapshot.message}
              </ThemedText>
            ) : null}
            {snapshot.phase === "loading" ? (
              <ThemedText>
                Loading saved ingredients and current context…
              </ThemedText>
            ) : null}
            {button(
              "Check current macros and recipe constraints",
              () =>
                void (snapshot.persistenceReady
                  ? controller.refresh()
                  : controller.init()),
              busy,
            )}
            {!snapshot.capabilities?.suggest ? (
              <View style={styles.card}>
                <ThemedText type="small">
                  {snapshot.capabilities?.reason === "access_required"
                    ? "Current adult eligibility and AI sharing consent are required for suggestions."
                    : "AI recipe suggestions are currently unavailable in this environment."}
                </ThemedText>
                {button("Review AI sharing consent", () =>
                  router.push("/account-settings/ai-data-consent" as Href),
                )}
              </View>
            ) : null}
            {button(
              "Review fridge and cabinet ingredients",
              () => {
                controller.invalidateInputs();
                setRows([]);
                setReviewing(true);
              },
              busy,
            )}
            {reviewing ? (
              <RecipeIngredientReview
                userId={owner}
                isCurrent={isCurrent}
                onCancel={() => setReviewing(false)}
                onConfirmed={(value) => {
                  setRows(value.ingredients);
                  setChoices({});
                  setReviewing(false);
                }}
              />
            ) : null}
            {rows.length ? (
              <View style={styles.card}>
                <ThemedText type="smallBold">
                  Choose the exact food and preparation reference for each
                  ingredient
                </ThemedText>
                <ThemedText type="small">
                  Unsupported foods cannot be guessed. Edit your inventory or
                  choose a supported reference you can confirm.
                </ThemedText>
                <TextInput
                  accessibilityLabel="Search supported ingredients"
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search supported foods"
                  placeholderTextColor={theme.textSecondary}
                  style={[
                    styles.input,
                    { color: theme.text, borderColor: theme.border },
                  ]}
                />
                {rows.map((row) => (
                  <View key={row.id} style={styles.card}>
                    <ThemedText>
                      {row.name} · {row.preparationState}
                    </ThemedText>
                    <ThemedText type="small">
                      {snapshot.metadata?.catalog.find(
                        (item) => item.id === choices[row.id],
                      )?.name ?? "Choose a reference"}
                    </ThemedText>
                    {(snapshot.metadata?.catalog ?? [])
                      .filter((item) =>
                        item.name.toLowerCase().includes(search.toLowerCase()),
                      )
                      .map((item) => (
                        <Pressable
                          key={item.id}
                          accessibilityRole="button"
                          disabled={busy}
                          accessibilityState={{
                            disabled: busy,
                            selected: choices[row.id] === item.id,
                          }}
                          onPress={() => {
                            controller.invalidateInputs();
                            setChoices((value) => ({
                              ...value,
                              [row.id]: item.id,
                            }));
                          }}
                          style={[styles.button, { borderColor: theme.border }]}
                        >
                          <ThemedText type="small">
                            {item.name} ·{" "}
                            {item.preparationState.replaceAll("_", " ")}
                          </ThemedText>
                        </Pressable>
                      ))}
                  </View>
                ))}
                <TextInput
                  accessibilityLabel="Maximum prep minutes"
                  keyboardType="number-pad"
                  value={prep}
                  onChangeText={(value) => {
                    controller.invalidateInputs();
                    setPrep(value);
                  }}
                  placeholder="Optional maximum prep minutes"
                  placeholderTextColor={theme.textSecondary}
                  style={[
                    styles.input,
                    { color: theme.text, borderColor: theme.border },
                  ]}
                />
                <View style={styles.row}>
                  {(["small", "normal", "large"] as const).map((value) => (
                    <Pressable
                      key={value}
                      accessibilityRole="button"
                      accessibilityLabel={`${value} meal`}
                      accessibilityState={{ selected: size === value }}
                      onPress={() => {
                        controller.invalidateInputs();
                        setSize(value);
                      }}
                      style={[styles.button, { borderColor: theme.border }]}
                    >
                      <ThemedText>{value}</ThemedText>
                    </Pressable>
                  ))}
                </View>
                <TextInput
                  accessibilityLabel="Excluded allergens"
                  value={allergens}
                  onChangeText={(value) => {
                    controller.invalidateInputs();
                    setAllergens(value);
                  }}
                  placeholder="Excluded allergens, comma separated"
                  placeholderTextColor={theme.textSecondary}
                  style={[
                    styles.input,
                    { color: theme.text, borderColor: theme.border },
                  ]}
                />
                <TextInput
                  accessibilityLabel="Dietary restrictions"
                  value={diet}
                  onChangeText={(value) => {
                    controller.invalidateInputs();
                    setDiet(value);
                  }}
                  placeholder="Dietary restrictions, e.g. vegan"
                  placeholderTextColor={theme.textSecondary}
                  style={[
                    styles.input,
                    { color: theme.text, borderColor: theme.border },
                  ]}
                />
                {button(
                  "Save confirmed recipe inputs",
                  saveInputs,
                  busy || rows.some((row) => !choices[row.id]),
                )}
              </View>
            ) : null}
            {snapshot.session?.input ? (
              <ThemedText type="small">
                Confirmed:{" "}
                {snapshot.session.input.ingredients
                  .map((row) => `${row.name} (${row.preparationState})`)
                  .join(", ")}
                . Quantities still need checking.
              </ThemedText>
            ) : null}
            {button(
              "Suggest meals",
              () => void controller.generate(),
              busy ||
                !snapshot.persistenceReady ||
                !snapshot.session?.input ||
                !snapshot.capabilities?.suggest,
            )}
            {snapshot.session?.result?.recipes.map((recipe) => (
              <View
                key={recipe.recipeId}
                style={[styles.card, { borderColor: theme.border }]}
              >
                <ThemedText type="subtitle">{recipe.name}</ThemedText>
                <ThemedText type="small">
                  {recipe.prepMinutes} min · Estimated{" "}
                  {recipe.caloriesKcal ?? "unknown"} kcal · P{" "}
                  {macroText(recipe.nutritionPerServing.proteinG)} · C{" "}
                  {macroText(recipe.nutritionPerServing.carbohydrateG)} · F{" "}
                  {macroText(recipe.nutritionPerServing.fatG)}
                </ThemedText>
                <ThemedText type="small">
                  {controller.fresh() &&
                  ranking?.ranked.find(
                    (row) => row.recipeId === recipe.recipeId,
                  )?.fitLoss !== null &&
                  context?.state === "ready"
                    ? `Focuses on ${context.focus.join(" and ")}`
                    : "Macro fit unavailable"}
                </ThemedText>
                {button(
                  `View ${recipe.name}`,
                  () => void controller.select(recipe.recipeId),
                  busy,
                )}
              </View>
            ))}
            {selected ? (
              <RecipeDetail
                recipe={selected.recipe}
                portion={snapshot.session?.portion ?? 1}
                busy={busy}
                portionLocked={!!snapshot.session?.operationId}
                canAct={controller.fresh()}
                onPortion={(value) => void controller.portion(value)}
                onLog={() => void handoff()}
              />
            ) : null}
            {snapshot.session?.operationId
              ? button(
                  "Prepare a separate consumption",
                  () => void controller.anotherConsumption(),
                  busy,
                )
              : null}
            {snapshot.collision ? (
              <View style={styles.card}>
                {button("Return to saved meal draft", () =>
                  router.push("/log-meal" as Href),
                )}
                {button(
                  "Replace unfinished draft and review this meal",
                  () => void handoff(true),
                  busy,
                )}
              </View>
            ) : null}
            {eraseError ? (
              <ThemedText accessibilityRole="alert">
                Local recipe erasure is incomplete. Retry to remove the
                remaining data.
              </ThemedText>
            ) : null}
            {button(
              eraseError
                ? "Retry recipe erasure"
                : "Erase saved recipe inventory and suggestions",
              () => {
                if (erasing) return;
                setErasing(true);
                setReviewing(false);
                void clearRecipeIngredientData(owner)
                  .then(() => {
                    if (isCurrent()) router.back();
                  })
                  .catch(() => {
                    if (isCurrent()) setEraseError(true);
                  })
                  .finally(() => {
                    if (isCurrent()) setErasing(false);
                  });
              },
              erasing || (busy && !eraseError),
            )}
            {button("Log a meal manually", () =>
              router.push("/log-meal" as Href),
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}
const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: {
    padding: 20,
    gap: 16,
    maxWidth: 720,
    width: "100%",
    alignSelf: "center",
    paddingBottom: 40,
  },
  card: { gap: 10, padding: 12, borderWidth: 1, borderRadius: 12 },
  button: {
    minHeight: 44,
    padding: 12,
    borderWidth: 1,
    borderRadius: 12,
    justifyContent: "center",
  },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
  },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
