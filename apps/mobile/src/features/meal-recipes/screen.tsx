import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
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
import { randomUUID } from "expo-crypto";
import { createMealRecipeApi } from "@mizyun/api-client";
import {
  RECIPE_ASSISTANT_MAX_MESSAGE_LENGTH,
  type RecipeAssistantIdea,
} from "@mizyun/contracts";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Button, Icon, IconButton } from "@/components/ui";
import { Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useAuth } from "@/features/auth/auth-context";
import { apiClient } from "@/composition/api-client";
import { stageRecipeMealDraft } from "@/features/log-meal/public-data";
import { getDefaultIngredientPhotoAdapter } from "./ingredient-review-composition";
import { registerIngredientReviewRetirement } from "./ingredient-review-lifecycle";
import { subscribeRecipeConsentGrant } from "./public-data";
import { CookingAssistant } from "./cooking-assistant";

/** "What can I cook?": one photo, a few ideas, then a chat to refine them. */
export function MealRecipesScreen() {
  const { session } = useAuth();
  const owner = session?.user.id ?? null;
  const live = useRef(session);
  live.current = session;
  // A retired assistant stays fenced; consent changes start a fresh one.
  const [epoch, setEpoch] = useState(0);
  const assistant = useMemo(() => {
    if (!owner) return null;
    const isCurrent = () =>
      // Owner-scoped: a token refresh must not drop an in-flight turn; each
      // request still re-reads and fences its own session token.
      live.current?.user.id === owner;
    return new CookingAssistant({
      owner,
      isCurrent,
      api: createMealRecipeApi(apiClient),
      photos: getDefaultIngredientPhotoAdapter(),
      newId: randomUUID,
    });
  }, [owner, epoch]);
  useEffect(() => {
    if (!assistant || !owner) return;
    void assistant.init();
    const unregister = registerIngredientReviewRetirement(owner, () => {
      assistant.retire();
      setEpoch((value) => value + 1);
    });
    const offGrant = subscribeRecipeConsentGrant(owner, () =>
      setEpoch((value) => value + 1),
    );
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void assistant.init();
    });
    return () => {
      unregister();
      offGrant();
      listener.remove();
      assistant.dispose();
    };
  }, [assistant, owner]);
  useFocusEffect(
    useCallback(() => {
      void assistant?.init();
    }, [assistant]),
  );
  if (!assistant || !owner)
    return (
      <ThemedView style={styles.fill}>
        <ThemedText>Sign in to get meal ideas.</ThemedText>
      </ThemedView>
    );
  return (
    <CookingAssistantView
      assistant={assistant}
      onCook={async (idea, replace) => {
        const value = (n: number | null) =>
          n === null ? null : Math.round(n * 10) / 10;
        const staged = await stageRecipeMealDraft(
          owner,
          {
            name: idea.name.slice(0, 80),
            caloriesKcal: value(idea.estimatePerServing.caloriesKcal),
            proteinG: value(idea.estimatePerServing.proteinG),
            carbohydrateG: value(idea.estimatePerServing.carbohydrateG),
            fatG: value(idea.estimatePerServing.fatG),
            assumptions: [
              "AI estimate for one serving of a recipe idea. Check the amounts before saving.",
            ],
          },
          {
            replace,
            isCurrent: () => live.current?.user.id === owner,
          },
        );
        if (staged.status === "ready" || staged.status === "resolved") {
          router.push("/log-meal" as Href);
          return "done";
        }
        return staged.status === "collision" ? "collision" : "failed";
      }}
    />
  );
}

export type CookResult = "done" | "collision" | "failed";

export function CookingAssistantView({
  assistant,
  onCook,
}: {
  assistant: CookingAssistant;
  onCook: (idea: RecipeAssistantIdea, replace: boolean) => Promise<CookResult>;
}) {
  const snapshot = useSyncExternalStore(
    assistant.subscribe,
    assistant.getSnapshot,
    assistant.getSnapshot,
  );
  const theme = useTheme();
  const scroll = useRef<ScrollView>(null);
  const scrolledFor = useRef("");
  // The stack header sits above this view; avoid the keyboard by our real offset.
  const frame = useRef<View>(null);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [cook, setCook] = useState<{
    ideaId: string;
    state: "busy" | "collision" | "failed";
  } | null>(null);
  useEffect(() => {
    if (snapshot.unsentText) setDraft(snapshot.unsentText);
  }, [snapshot.unsentText]);
  const latest = snapshot.messages.at(-1);
  // Announce new replies only, not a restored conversation on reopen.
  const announced = useRef(latest?.id);
  useEffect(() => {
    if (latest?.role !== "assistant" || announced.current === latest.id) return;
    announced.current = latest.id;
    AccessibilityInfo.announceForAccessibility(latest.text);
  }, [latest?.id]);
  const sending = snapshot.phase === "sending";
  const busy = snapshot.phase !== "idle";
  const ready = snapshot.availability === "ready";
  const started = snapshot.messages.length > 0;
  const photoDisabled = busy || !ready || !snapshot.canUsePhotos;
  const sendDisabled = busy || !ready || !draft.trim();
  const send = () => {
    if (sendDisabled) return;
    const text = draft;
    setDraft("");
    void assistant.sendText(text);
  };
  const startCooking = async (idea: RecipeAssistantIdea, replace = false) => {
    setCook({ ideaId: idea.ideaId, state: "busy" });
    const result = await onCook(idea, replace);
    setCook(result === "done" ? null : { ideaId: idea.ideaId, state: result });
  };
  let lastAssistant = -1;
  snapshot.messages.forEach((message, index) => {
    if (message.role === "assistant") lastAssistant = index;
  });
  const choosePhoto = () =>
    Alert.alert("Add a photo", undefined, [
      { text: "Take photo", onPress: () => void assistant.sendPhoto("camera") },
      {
        text: "Choose from library",
        onPress: () => void assistant.sendPhoto("library"),
      },
      { text: "Cancel", style: "cancel" },
    ]);

  return (
    <ThemedView style={styles.fill}>
      <SafeAreaView style={styles.fill} edges={["bottom"]}>
        <View
          ref={frame}
          style={styles.fill}
          onLayout={() =>
            frame.current?.measureInWindow((_x, y) =>
              setKeyboardOffset(Math.max(0, Math.round(y))),
            )
          }
        >
          <KeyboardAvoidingView
            style={styles.fill}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            keyboardVerticalOffset={Platform.OS === "ios" ? keyboardOffset : 0}
          >
            <ScrollView
              ref={scroll}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.content}
              onContentSizeChange={() => {
                // Follow new messages, but not an idea card being expanded.
                const marker = `${snapshot.messages.length}:${sending}`;
                if (scrolledFor.current === marker) return;
                scrolledFor.current = marker;
                scroll.current?.scrollToEnd({ animated: true });
              }}
            >
              {!started ? (
                <View
                  style={[
                    styles.intro,
                    { backgroundColor: theme.backgroundElement },
                  ]}
                >
                  <Icon name="cook" size={28} tintColor={theme.primary} />
                  <ThemedText style={styles.heading}>
                    Snap your fridge, get meal ideas
                  </ThemedText>
                  <ThemedText themeColor="textSecondary">
                    Take a photo of your fridge or cupboard and I’ll suggest a
                    few meals that fit what’s left of your day. Then tell me
                    what you feel like and we’ll shape it together.
                  </ThemedText>
                  <View style={styles.row}>
                    <Button
                      label="Take photo"
                      icon="camera"
                      disabled={photoDisabled}
                      loading={snapshot.phase === "picking"}
                      onPress={() => void assistant.sendPhoto("camera")}
                      style={styles.grow}
                    />
                    <Button
                      label="Choose photo"
                      icon="photo"
                      variant="secondary"
                      disabled={photoDisabled}
                      onPress={() => void assistant.sendPhoto("library")}
                      style={styles.grow}
                    />
                  </View>
                  <ThemedText type="small" themeColor="textSecondary">
                    No photo? Just type what you have below.
                  </ThemedText>
                </View>
              ) : null}

              {snapshot.availability === "access_required" ? (
                <View style={[styles.notice, { borderColor: theme.border }]}>
                  <ThemedText type="small">
                    Review your AI sharing consent and age eligibility to get
                    meal ideas.
                  </ThemedText>
                  <Button
                    label="Review AI sharing consent"
                    variant="secondary"
                    size="small"
                    onPress={() =>
                      router.push("/account-settings/ai-data-consent" as Href)
                    }
                  />
                </View>
              ) : snapshot.availability !== null &&
                snapshot.availability !== "ready" ? (
                <View style={[styles.notice, { borderColor: theme.border }]}>
                  <ThemedText type="small">
                    Meal ideas aren’t available right now.
                  </ThemedText>
                  <Button
                    label="Try again"
                    variant="secondary"
                    size="small"
                    onPress={() => void assistant.init()}
                  />
                </View>
              ) : null}

              {snapshot.messages.map((message, index) => (
                <View
                  key={message.id}
                  style={[
                    styles.group,
                    message.role === "user" && styles.userGroup,
                  ]}
                >
                  <View
                    style={[
                      styles.bubble,
                      message.role === "user"
                        ? [
                            styles.userBubble,
                            { backgroundColor: theme.primaryLight },
                          ]
                        : [
                            styles.assistantBubble,
                            { backgroundColor: theme.backgroundElement },
                          ],
                    ]}
                  >
                    {message.photo ? (
                      <View style={styles.inline}>
                        <Icon
                          name="photo"
                          size={15}
                          tintColor={theme.primary}
                        />
                        <ThemedText type="small" themeColor="primary">
                          Photo sent
                        </ThemedText>
                      </View>
                    ) : null}
                    <ThemedText selectable>{message.text}</ThemedText>
                  </View>
                  {index === lastAssistant ? (
                    <>
                      {snapshot.ingredients.length ? (
                        <View style={styles.spotted}>
                          <ThemedText type="small" themeColor="textSecondary">
                            Using
                          </ThemedText>
                          <View style={styles.chips}>
                            {snapshot.ingredients.map((name) => (
                              <Pressable
                                key={name}
                                accessibilityRole="button"
                                accessibilityLabel={`Remove ${name}`}
                                accessibilityHint="Your next message uses the updated list."
                                hitSlop={6}
                                disabled={busy}
                                onPress={() => assistant.removeIngredient(name)}
                                style={[
                                  styles.chip,
                                  { backgroundColor: theme.backgroundSelected },
                                ]}
                              >
                                <ThemedText type="small">{name}</ThemedText>
                                <Icon
                                  name="close"
                                  size={11}
                                  tintColor={theme.textSecondary}
                                />
                              </Pressable>
                            ))}
                          </View>
                        </View>
                      ) : null}
                      {snapshot.ideas.map((idea) => (
                        <IdeaCard
                          key={idea.ideaId}
                          idea={idea}
                          expanded={open === idea.ideaId}
                          onToggle={() =>
                            setOpen((value) =>
                              value === idea.ideaId ? null : idea.ideaId,
                            )
                          }
                          cookState={
                            cook?.ideaId === idea.ideaId ? cook.state : null
                          }
                          onCook={(replace) => void startCooking(idea, replace)}
                          disabled={busy}
                        />
                      ))}
                    </>
                  ) : null}
                </View>
              ))}

              {sending ? (
                <View
                  accessibilityLabel="Thinking of meal ideas"
                  accessibilityLiveRegion="polite"
                  style={[
                    styles.bubble,
                    styles.assistantBubble,
                    styles.inline,
                    { backgroundColor: theme.backgroundElement },
                  ]}
                >
                  <ActivityIndicator size="small" color={theme.primary} />
                  <ThemedText type="small" themeColor="textSecondary">
                    Thinking of ideas…
                  </ThemedText>
                </View>
              ) : null}

              {snapshot.error ? (
                <ThemedText accessibilityRole="alert" type="small">
                  {snapshot.error}
                </ThemedText>
              ) : null}

              <View style={styles.footer}>
                <Button
                  label="Log a meal yourself"
                  variant="plain"
                  size="small"
                  onPress={() => router.push("/log-meal" as Href)}
                />
                {started ? (
                  <Button
                    label="Start over"
                    variant="plain"
                    size="small"
                    disabled={sending}
                    onPress={() => {
                      setDraft("");
                      setOpen(null);
                      setCook(null);
                      assistant.reset();
                    }}
                  />
                ) : null}
              </View>
            </ScrollView>

            <View style={styles.composerWrapper}>
              <View
                style={[
                  styles.composer,
                  { backgroundColor: theme.backgroundSelected },
                ]}
              >
                <IconButton
                  icon="camera"
                  variant="plain"
                  accessibilityLabel="Add a photo"
                  disabled={photoDisabled}
                  onPress={choosePhoto}
                  style={styles.composerIcon}
                />
                <TextInput
                  accessibilityLabel="Message the cooking assistant"
                  editable={!busy && ready}
                  multiline
                  maxLength={RECIPE_ASSISTANT_MAX_MESSAGE_LENGTH}
                  placeholder={
                    started
                      ? "e.g. no eggs, more protein, 15 minutes"
                      : "Or type what you have…"
                  }
                  placeholderTextColor={theme.textTertiary}
                  value={draft}
                  onChangeText={setDraft}
                  style={[styles.input, { color: theme.text }]}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Send message"
                  accessibilityState={{ busy: sending, disabled: sendDisabled }}
                  disabled={sendDisabled}
                  onPress={send}
                  style={styles.sendTarget}
                >
                  <View
                    style={[
                      styles.sendCircle,
                      { backgroundColor: theme.primary },
                      sendDisabled && styles.sendDisabled,
                    ]}
                  >
                    <Icon
                      name="arrowUp"
                      size={17}
                      tintColor={theme.onPrimary}
                    />
                  </View>
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const round = (value: number | null) =>
  value === null ? "?" : String(Math.round(value));

function IdeaCard({
  idea,
  expanded,
  onToggle,
  cookState,
  onCook,
  disabled,
}: {
  idea: RecipeAssistantIdea;
  expanded: boolean;
  onToggle: () => void;
  cookState: "busy" | "collision" | "failed" | null;
  onCook: (replace: boolean) => void;
  disabled: boolean;
}) {
  const theme = useTheme();
  const estimate = idea.estimatePerServing;
  return (
    <View
      style={[
        styles.idea,
        {
          backgroundColor: theme.backgroundElement,
          borderColor: expanded ? theme.primary : theme.border,
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${idea.name}, ${idea.prepMinutes} minutes`}
        accessibilityState={{ expanded }}
        onPress={onToggle}
        style={styles.ideaHeader}
      >
        <View style={styles.grow}>
          <ThemedText type="headline">{idea.name}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {idea.prepMinutes} min · ~{round(estimate.caloriesKcal)} kcal · P{" "}
            {round(estimate.proteinG)} g · C {round(estimate.carbohydrateG)} g ·
            F {round(estimate.fatG)} g
          </ThemedText>
          <ThemedText type="small">{idea.summary}</ThemedText>
        </View>
        <Icon
          name={expanded ? "chevronUp" : "chevronDown"}
          size={16}
          tintColor={theme.textSecondary}
        />
      </Pressable>
      {expanded ? (
        <View style={styles.ideaBody}>
          <ThemedText type="smallBold">
            Ingredients
            {idea.servings > 1 ? ` · ${idea.servings} servings` : ""}
          </ThemedText>
          {idea.ingredients.map((item, index) => (
            <ThemedText key={index} type="small">
              {item.fromPhoto ? "• " : "+ "}
              {item.amount ? `${item.amount} ` : ""}
              {item.name}
              {item.fromPhoto ? "" : " (you may need this)"}
            </ThemedText>
          ))}
          <ThemedText type="smallBold">Steps</ThemedText>
          {idea.steps.map((step, index) => (
            <ThemedText key={index} type="small">
              {index + 1}. {step}
            </ThemedText>
          ))}
          {idea.warnings.map((warning, index) => (
            <ThemedText key={index} type="small" themeColor="textSecondary">
              {warning}
            </ThemedText>
          ))}
          <ThemedText type="small" themeColor="textSecondary">
            Nutrition is an AI estimate per serving. Check amounts, allergens
            and that food is cooked through. Nothing is logged until you save.
          </ThemedText>
          {cookState === "collision" ? (
            <View style={styles.ideaBody}>
              <ThemedText type="small">
                You have an unfinished meal you haven’t saved.
              </ThemedText>
              <Button
                label="Open unfinished meal"
                variant="secondary"
                size="small"
                onPress={() => router.push("/log-meal" as Href)}
              />
              <Button
                label="Replace it with this meal"
                variant="secondary"
                size="small"
                onPress={() => onCook(true)}
              />
            </View>
          ) : (
            <Button
              label="I ate this · Review meal"
              variant="tinted"
              size="small"
              disabled={disabled}
              loading={cookState === "busy"}
              onPress={() => onCook(false)}
            />
          )}
          {cookState === "failed" ? (
            <ThemedText accessibilityRole="alert" type="small">
              The meal couldn’t be prepared. Please try again.
            </ThemedText>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  grow: { flexGrow: 1, flexShrink: 1 },
  content: {
    padding: Spacing.three,
    gap: Spacing.three,
    maxWidth: 720,
    width: "100%",
    alignSelf: "center",
    paddingBottom: Spacing.four,
  },
  intro: {
    gap: Spacing.two,
    padding: 18,
    borderRadius: Radius.xl,
    borderCurve: "continuous",
  },
  heading: { fontSize: 22, lineHeight: 28, fontWeight: "700" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  notice: {
    gap: Spacing.two,
    padding: 14,
    borderWidth: 1,
    borderRadius: Radius.lg,
  },
  group: { width: "100%", gap: Spacing.two },
  userGroup: { alignItems: "flex-end" },
  bubble: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: Radius.xl,
    borderCurve: "continuous",
    gap: Spacing.one,
  },
  userBubble: { maxWidth: "82%", borderBottomRightRadius: Spacing.one },
  assistantBubble: {
    alignSelf: "stretch",
    borderBottomLeftRadius: Spacing.one,
  },
  inline: { flexDirection: "row", alignItems: "center", gap: Spacing.one },
  spotted: { gap: Spacing.one },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.one },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 10,
    borderRadius: Radius.pill,
  },
  idea: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    borderCurve: "continuous",
    padding: 14,
    gap: Spacing.two,
  },
  ideaHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.two,
    minHeight: 44,
  },
  ideaBody: { gap: Spacing.one },
  footer: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: Spacing.two,
  },
  composerWrapper: {
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    borderRadius: Radius.xl + 2,
    borderCurve: "continuous",
    paddingHorizontal: Spacing.one,
    gap: Spacing.half,
  },
  composerIcon: { margin: 4 },
  input: {
    flex: 1,
    minHeight: 48,
    maxHeight: 120,
    paddingHorizontal: Spacing.one,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: 17,
    lineHeight: 22,
  },
  sendTarget: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  sendCircle: {
    width: 34,
    height: 34,
    borderRadius: Radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  sendDisabled: { opacity: 0.35 },
});
