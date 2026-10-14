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
import { mealRecipeInputSchema, type MealRecipeInput } from "@mizyun/contracts";
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
  const inputRevision = useRef(0);
  const invalidateInputs = () => {
    inputRevision.current += 1;
    controller.invalidateInputs();
  };
  const [eraseError, setEraseError] = useState(false);
  const [optionsExpanded, setOptionsExpanded] = useState(false);
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
  const button = (
    label: string,
    onPress: () => void,
    disabled = false,
    primary = false,
    accessibilityLabel = label,
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        {
          borderColor: primary ? "transparent" : theme.border,
          backgroundColor: primary ? "#047857" : theme.backgroundElement,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <ThemedText
        type="smallBold"
        style={primary ? styles.primaryText : undefined}
      >
        {label}
      </ThemedText>
    </Pressable>
  );
  const saveInputs = async () => {
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
    const revision = inputRevision.current;
    const parsed = mealRecipeInputSchema.safeParse(input);
    await controller.setInput(input);
    const latest = controller.getSnapshot();
    const saved = mealRecipeInputSchema.safeParse(latest.session?.input);
    if (
      isCurrent() &&
      inputRevision.current === revision &&
      parsed.success &&
      saved.success &&
      latest.phase === "idle" &&
      latest.persistenceReady &&
      JSON.stringify(saved.data) === JSON.stringify(parsed.data)
    ) {
      setRows([]);
      setChoices({});
      setSearch("");
    }
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
            <View style={styles.intro}>
              <ThemedText style={styles.heading}>
                A meal that fits your day
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Turn what you have into something good.
              </ThemedText>
            </View>
            <View
              style={[
                styles.balanceCard,
                { backgroundColor: theme.backgroundElement },
              ]}
            >
              <View style={styles.sectionHeader}>
                <ThemedText type="smallBold">
                  {freshContext ? "Left for today" : "Your daily balance"}
                </ThemedText>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Refresh daily targets"
                  accessibilityState={{ disabled: busy }}
                  disabled={busy}
                  onPress={() =>
                    void (snapshot.persistenceReady
                      ? controller.refresh()
                      : controller.init())
                  }
                  style={styles.textButton}
                >
                  <ThemedText type="small" themeColor="primary">
                    Refresh
                  </ThemedText>
                </Pressable>
              </View>
              <View style={styles.macros}>
                {(
                  [
                    [
                      "Protein",
                      freshContext ? context.remaining.proteinG : null,
                    ],
                    [
                      "Carbs",
                      freshContext ? context.remaining.carbohydrateG : null,
                    ],
                    ["Fat", freshContext ? context.remaining.fatG : null],
                  ] as const
                ).map(([label, value]) => (
                  <View key={label} style={styles.macro}>
                    <ThemedText type="small" themeColor="textSecondary">
                      {label}
                    </ThemedText>
                    <ThemedText style={styles.macroValue}>
                      {macroText(value === null ? null : Math.abs(value))}
                    </ThemedText>
                    {value !== null && value < 0 ? (
                      <ThemedText type="small" themeColor="textSecondary">
                        over target
                      </ThemedText>
                    ) : null}
                  </View>
                ))}
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                {freshContext
                  ? "Based on what you’ve logged so far."
                  : "Log meals and set targets to see your balance. You can still find recipes."}
              </ThemedText>
              {freshContext && context.focus.length > 0 ? (
                <View
                  style={[
                    styles.focusBadge,
                    { backgroundColor: theme.primaryLight },
                  ]}
                >
                  <ThemedText type="small" themeColor="primary">
                    {`Let’s focus on ${context.focus.map((value) => (value === "carbohydrate" ? "carbs" : value)).join(" and ")}`}
                  </ThemedText>
                </View>
              ) : null}
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
            {!snapshot.capabilities?.suggest && snapshot.phase !== "loading" ? (
              <View
                style={[
                  styles.card,
                  {
                    backgroundColor: theme.backgroundElement,
                    borderColor: theme.border,
                  },
                ]}
              >
                <ThemedText type="small">
                  {snapshot.capabilities?.reason === "access_required"
                    ? "Review your AI sharing consent and age eligibility to get meal ideas."
                    : "Meal suggestions couldn’t connect. Refresh to try again."}
                </ThemedText>
                {snapshot.capabilities?.reason === "access_required"
                  ? button("Review AI sharing consent", () =>
                      router.push("/account-settings/ai-data-consent" as Href),
                    )
                  : null}
              </View>
            ) : null}
            <View
              style={[
                styles.kitchenCard,
                { backgroundColor: theme.backgroundElement },
              ]}
            >
              <View style={styles.sectionHeader}>
                <ThemedText style={styles.sectionTitle}>
                  What’s in your kitchen?
                </ThemedText>
                {(snapshot.session?.input || rows.length > 0) && !reviewing ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Edit ingredients"
                    accessibilityState={{ disabled: busy }}
                    disabled={busy}
                    onPress={() => {
                      setRows([]);
                      setReviewing(true);
                    }}
                    style={styles.textButton}
                  >
                    <ThemedText type="small" themeColor="primary">
                      Edit
                    </ThemedText>
                  </Pressable>
                ) : null}
              </View>
              {snapshot.session?.input ? (
                <View style={styles.row}>
                  {snapshot.session.input.ingredients.map((row) => (
                    <View
                      key={row.ingredientId}
                      style={[
                        styles.ingredientChip,
                        { backgroundColor: theme.backgroundSelected },
                      ]}
                    >
                      <ThemedText type="small">{row.name}</ThemedText>
                    </View>
                  ))}
                </View>
              ) : (
                <ThemedText type="small" themeColor="textSecondary">
                  Add a few ingredients, or take a photo of your fridge and
                  cupboard.
                </ThemedText>
              )}
              {!snapshot.session?.input && !reviewing && rows.length === 0
                ? button(
                    "Add ingredients",
                    () => {
                      setRows([]);
                      setReviewing(true);
                    },
                    busy,
                    true,
                  )
                : null}
              {snapshot.session?.input ? (
                <ThemedText type="small" themeColor="textSecondary">
                  Check you have enough of each ingredient before cooking.
                </ThemedText>
              ) : null}
            </View>
            {reviewing ? (
              <RecipeIngredientReview
                userId={owner}
                isCurrent={isCurrent}
                onCancel={() => setReviewing(false)}
                onConfirmed={(value) => {
                  invalidateInputs();
                  setRows(value.ingredients);
                  setChoices({});
                  setReviewing(false);
                }}
              />
            ) : null}
            {rows.length ? (
              <View style={styles.card}>
                <ThemedText type="smallBold">Match your ingredients</ThemedText>
                <ThemedText type="small">
                  Choose each food as you’ll use it, such as raw or cooked. This
                  helps estimate the meal’s macros.
                </ThemedText>
                <TextInput
                  editable={!busy}
                  accessibilityLabel="Search supported ingredients"
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Find a food"
                  placeholderTextColor={theme.textSecondary}
                  style={[
                    styles.input,
                    { color: theme.text, borderColor: theme.border },
                  ]}
                />
                {rows.map((row) => (
                  <View key={row.id} style={styles.card}>
                    <ThemedText>
                      {row.name} · {row.preparationState.replaceAll("_", " ")}
                    </ThemedText>
                    <ThemedText type="small">
                      {snapshot.metadata?.catalog.find(
                        (item) => item.id === choices[row.id],
                      )?.name ?? "Choose a food"}
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
                            invalidateInputs();
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
                  editable={!busy}
                  accessibilityLabel="Maximum prep minutes"
                  keyboardType="number-pad"
                  value={prep}
                  onChangeText={(value) => {
                    invalidateInputs();
                    setPrep(value);
                  }}
                  placeholder="Ready in… minutes (optional)"
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
                      disabled={busy}
                      accessibilityState={{
                        selected: size === value,
                        disabled: busy,
                      }}
                      onPress={() => {
                        invalidateInputs();
                        setSize(value);
                      }}
                      style={[
                        styles.button,
                        {
                          borderColor:
                            size === value ? theme.primary : theme.border,
                          backgroundColor:
                            size === value
                              ? theme.primaryLight
                              : theme.backgroundElement,
                        },
                      ]}
                    >
                      <ThemedText>{value}</ThemedText>
                    </Pressable>
                  ))}
                </View>
                <TextInput
                  editable={!busy}
                  accessibilityLabel="Excluded allergens"
                  value={allergens}
                  onChangeText={(value) => {
                    invalidateInputs();
                    setAllergens(value);
                  }}
                  placeholder="Avoid, e.g. milk, nuts"
                  placeholderTextColor={theme.textSecondary}
                  style={[
                    styles.input,
                    { color: theme.text, borderColor: theme.border },
                  ]}
                />
                <TextInput
                  editable={!busy}
                  accessibilityLabel="Dietary restrictions"
                  value={diet}
                  onChangeText={(value) => {
                    invalidateInputs();
                    setDiet(value);
                  }}
                  placeholder="Diet, e.g. vegan (optional)"
                  placeholderTextColor={theme.textSecondary}
                  style={[
                    styles.input,
                    { color: theme.text, borderColor: theme.border },
                  ]}
                />
                {button(
                  "Use these ingredients",
                  saveInputs,
                  busy || rows.some((row) => !choices[row.id]),
                  true,
                )}
              </View>
            ) : null}
            {snapshot.session?.input && !reviewing && rows.length === 0
              ? button(
                  "Find meals",
                  () => void controller.generate(),
                  busy ||
                    !snapshot.persistenceReady ||
                    !snapshot.capabilities?.suggest,
                  true,
                  "Suggest meals",
                )
              : null}
            <ThemedText type="small" themeColor="textSecondary">
              Estimated macros. Nothing is logged until you save a meal.
            </ThemedText>
            {snapshot.session?.result?.recipes.length ? (
              <ThemedText style={styles.sectionTitle}>
                Meal ideas for you
              </ThemedText>
            ) : null}
            {snapshot.session?.result?.recipes.map((recipe) => (
              <View
                key={recipe.recipeId}
                style={[
                  styles.card,
                  {
                    borderColor: theme.border,
                    backgroundColor: theme.backgroundElement,
                  },
                ]}
              >
                <ThemedText style={styles.sectionTitle}>
                  {recipe.name}
                </ThemedText>
                <ThemedText type="small">
                  {recipe.prepMinutes} min · Estimated{" "}
                  {recipe.caloriesKcal === null
                    ? "unknown"
                    : Math.round(recipe.caloriesKcal)}{" "}
                  kcal · P {macroText(recipe.nutritionPerServing.proteinG)} · C{" "}
                  {macroText(recipe.nutritionPerServing.carbohydrateG)} · F{" "}
                  {macroText(recipe.nutritionPerServing.fatG)}
                </ThemedText>
                <ThemedText type="small">
                  {controller.fresh() &&
                  ranking?.ranked.find(
                    (row) => row.recipeId === recipe.recipeId,
                  )?.fitLoss !== null &&
                  context?.state === "ready"
                    ? `Focuses on ${context.focus.map((value) => (value === "carbohydrate" ? "carbs" : value)).join(" and ")}`
                    : "Choose a meal that sounds good to you"}
                </ThemedText>
                {button(
                  "View recipe",
                  () => void controller.select(recipe.recipeId),
                  busy,
                  false,
                  `View ${recipe.name}`,
                )}
              </View>
            ))}
            {selected ? (
              <RecipeDetail
                recipe={selected.recipe}
                portion={snapshot.session?.portion ?? 1}
                busy={busy || reviewing || rows.length > 0}
                portionLocked={!!snapshot.session?.operationId}
                canAct={controller.fresh() && !reviewing && rows.length === 0}
                onPortion={(value) => void controller.portion(value)}
                onLog={() => void handoff()}
              />
            ) : null}
            {snapshot.session?.operationId
              ? button(
                  "Log this meal again",
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
                Some recipe data couldn’t be cleared. Please try again.
              </ThemedText>
            ) : null}
            <View style={styles.footer}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Log a meal manually"
                onPress={() => router.push("/log-meal" as Href)}
                style={styles.textButton}
              >
                <ThemedText type="small" themeColor="primary">
                  Log a meal yourself
                </ThemedText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Recipe options"
                accessibilityState={{ expanded: optionsExpanded || eraseError }}
                onPress={() => setOptionsExpanded((value) => !value)}
                style={styles.textButton}
              >
                <ThemedText type="small" themeColor="textSecondary">
                  Recipe options
                </ThemedText>
              </Pressable>
            </View>
            {optionsExpanded || eraseError
              ? button(
                  eraseError
                    ? "Retry clearing recipe data"
                    : "Clear recipe data",
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
                )
              : null}
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
  intro: { gap: 8, paddingTop: 4 },
  heading: { fontSize: 28, lineHeight: 34, fontWeight: "700" },
  sectionTitle: {
    fontSize: 20,
    lineHeight: 28,
    fontWeight: "600",
    flexShrink: 1,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  balanceCard: { gap: 12, padding: 18, borderRadius: 20 },
  kitchenCard: { gap: 14, padding: 18, borderRadius: 20 },
  macros: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  macro: { flexGrow: 1, flexBasis: 85, gap: 4 },
  macroValue: {
    fontSize: 24,
    lineHeight: 32,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  focusBadge: {
    alignSelf: "flex-start",
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  ingredientChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  card: { gap: 12, padding: 16, borderWidth: 1, borderRadius: 18 },
  primaryText: { color: "#FFFFFF" },
  textButton: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: "center",
    paddingVertical: 8,
  },
  footer: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 16,
  },
  button: {
    minHeight: 48,
    padding: 14,
    borderWidth: 1,
    borderRadius: 14,
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
