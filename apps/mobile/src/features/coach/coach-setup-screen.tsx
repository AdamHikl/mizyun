import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, type Href, useLocalSearchParams } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import type {
  CoachConversation,
  CoachDailyPlanProposal,
  CoachMessage,
  CoachNutritionProposal,
  CoachProviderStatus,
  CoachWorkoutProposal,
  CoachWeeklyAdaptationProposal,
} from "@mizyun/contracts";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import {
  BottomTabInset,
  Colors,
  MaxContentWidth,
  Spacing,
} from "@/constants/theme";

import {
  clearLoggingDraft,
  loadLoggingDraft,
  saveLoggingDraft,
} from "@/features/logging-draft-storage";
import { useAuth } from "@/features/auth/auth-context";
import { mealFormStringsFromDraft } from "@/features/log-meal/meal-form";
import { normalizeMealPhoto } from "@/features/log-meal/meal-photo";

import { EvidenceChips } from "./evidence-chips";
import {
  acceptWeeklyAdaptation,
  createCoachConversation,
  deleteCoachConversation,
  isCoachPendingDraft,
  loadCoach,
  loadCoachThread,
  newCoachMessageIdempotencyKey,
  previewFor,
  relativeLabel,
  sendCoachMessage,
  sendCoachMealPhoto,
  type CoachPendingDraft,
} from "./coach-data";
import { ThreadListSheet } from "./thread-list-sheet";
import { TrainingPlanCard } from "./training-plan-card";

// AI-MOB-002 — error taxonomy. The data layer returns humanized
// text for any failure; the screen additionally surfaces a
// category the user can act on. Categories map to distinct UI
// toasts: rate-limit copies a Retry-After hint, unconfigured
// suggests contacting support, etc.
type AlertCategory = "rate_limited" | "unavailable" | "config" | "generic";
const alertCategoryFromMessage = (message: string | null): AlertCategory => {
  if (message === null) return "generic";
  if (/rate limited|busy|try again in \d+/i.test(message))
    return "rate_limited";
  if (/not configured|configuration/i.test(message)) return "config";
  if (/unavailable|offline|expired/i.test(message)) return "unavailable";
  return "generic";
};

export function CoachSetupScreen() {
  const params = useLocalSearchParams<{ prompt?: string }>();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [status, setStatus] = useState<CoachProviderStatus | null>(null);
  const [conversations, setConversations] = useState<
    readonly CoachConversation[]
  >([]);
  const [active, setActive] = useState<CoachConversation | null>(null);
  const [messages, setMessages] = useState<readonly CoachMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<CoachPendingDraft | null>(
    null,
  );
  const [threadListVisible, setThreadListVisible] = useState(false);
  // Per-conversation message cache. The thread-list sheet previews
  // the latest assistant text per conversation. Caching here
  // avoids re-fetching on every list open.
  const [messagesByConversation, setMessagesByConversation] = useState<
    ReadonlyMap<string, readonly CoachMessage[]>
  >(new Map());
  const scrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);
  const sendLock = useRef(false);
  const deleteLock = useRef(false);
  const draftLoadGeneration = useRef(0);
  // AI-MOB-002 — flag that toggles when a new assistant message
  // arrives so the screen-reader live region announces it.
  const [liveRegionTick, setLiveRegionTick] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const reminderPromptApplied = useRef(false);

  useEffect(() => {
    if (
      !reminderPromptApplied.current &&
      typeof params.prompt === "string" &&
      params.prompt.trim().length > 0
    ) {
      reminderPromptApplied.current = true;
      setDraft(params.prompt.trim());
    }
  }, [params.prompt]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const result = await loadCoach();
    if (!result.ok) {
      setMessage(result.message);
      setLoading(false);
      return;
    }
    setStatus(result.status);
    setConversations(result.conversations);
    setMessage(null);
    if (result.status.ready && result.conversations[0]) {
      const thread = await loadCoachThread(result.conversations[0].id);
      if (thread.ok) {
        setActive(thread.conversation);
        setMessages(thread.messages);
        setMessagesByConversation((current) => {
          const next = new Map(current);
          next.set(thread.conversation.id, thread.messages);
          return next;
        });
      } else {
        setMessage(thread.message);
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const generation = draftLoadGeneration.current + 1;
    draftLoadGeneration.current = generation;
    if (userId === null) {
      setPendingDraft(null);
      return;
    }
    let mounted = true;
    void loadLoggingDraft(userId, "coach", isCoachPendingDraft).then(
      (stored) => {
        if (
          mounted &&
          draftLoadGeneration.current === generation &&
          !sendLock.current
        ) {
          setPendingDraft(stored);
        }
      },
    );
    return () => {
      mounted = false;
    };
  }, [userId]);

  useEffect(() => {
    if (
      active !== null &&
      pendingDraft?.conversationId === active.id &&
      draft.length === 0
    ) {
      setDraft(pendingDraft.text);
    }
  }, [active, draft.length, pendingDraft]);

  useEffect(() => {
    if (messages.length > 0) {
      requestAnimationFrame(() =>
        scrollRef.current?.scrollToEnd({ animated: true }),
      );
    }
  }, [messages]);

  const create = useCallback(async () => {
    setLoading(true);
    const result = await createCoachConversation();
    if (result.ok) {
      setActive(result.conversation);
      setMessages([]);
      setConversations((current) => [result.conversation, ...current]);
      setMessage(null);
    } else {
      setMessage(result.message);
    }
    setLoading(false);
  }, []);

  const switchToConversation = useCallback(
    async (conversationId: string) => {
      if (active?.id === conversationId) return;
      setLoading(true);
      setActive(null);
      setMessages([]);
      setMessage(null);
      const thread = await loadCoachThread(conversationId);
      if (thread.ok) {
        setActive(thread.conversation);
        setMessages(thread.messages);
        setMessagesByConversation((current) => {
          const next = new Map(current);
          next.set(thread.conversation.id, thread.messages);
          return next;
        });
      } else {
        setMessage(thread.message);
      }
      setLoading(false);
    },
    [active?.id],
  );

  const send = useCallback(async () => {
    if (
      !active ||
      draft.trim().length === 0 ||
      sending ||
      sendLock.current ||
      deleteLock.current
    ) {
      return;
    }
    sendLock.current = true;
    draftLoadGeneration.current += 1;
    setSending(true);
    const text = draft.trim();
    const idempotencyKey =
      pendingDraft?.conversationId === active.id && pendingDraft.text === text
        ? pendingDraft.idempotencyKey
        : newCoachMessageIdempotencyKey();
    const nextPending: CoachPendingDraft = {
      conversationId: active.id,
      text,
      idempotencyKey,
    };
    try {
      setPendingDraft(nextPending);
      if (userId !== null) {
        await saveLoggingDraft(userId, "coach", nextPending);
      }
      // AI-MOB-002 — clear the input but keep the user bubble on
      // screen until the assistant response lands. The optimistic
      // bubble is added to `messages` immediately so the screen
      // reader can announce it as the user has spoken.
      setDraft("");
      setMessage(null);
      const userBubble: CoachMessage = {
        id: `optimistic-${idempotencyKey}`,
        conversationId: active.id,
        role: "user",
        text,
        status: "complete",
        provider: null,
        evidenceKinds: [],
        actionProposal: null,
        createdAt: new Date().toISOString(),
      };
      setMessages((current) => [...current, userBubble]);
      const result = await sendCoachMessage(active.id, text, idempotencyKey);
      if (result.ok) {
        setActive(result.conversation);
        // Replace the optimistic user bubble with the canonical one
        // returned by the server.
        setMessages((current) =>
          current.flatMap((item) =>
            item.id === userBubble.id ? result.messages : [item],
          ),
        );
        setPendingDraft(null);
        if (userId !== null) await clearLoggingDraft(userId, "coach");
        // Announce the new assistant message to assistive tech.
        setLiveRegionTick((tick) => tick + 1);
      } else {
        setDraft(text);
        setMessage(result.message);
        // AI-MOB-002 — keep the optimistic user bubble on retry.
        // It only disappears when the user clears the composer or
        // the request succeeds.
      }
    } finally {
      sendLock.current = false;
      setSending(false);
      // AI-MOB-002 — focus returns to the composer after every
      // send (success or failure) so the user can immediately
      // type the next message.
      inputRef.current?.focus();
    }
  }, [active, draft, pendingDraft, sending, userId]);

  const remove = useCallback(() => {
    if (!active || sendLock.current || deleteLock.current) return;
    Alert.alert(
      "Delete conversation?",
      "This permanently deletes the conversation and its messages.",
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            deleteLock.current = true;
            setDeleting(true);
            void (async () => {
              try {
                const result = await deleteCoachConversation(active.id);
                if (!result.ok) {
                  setMessage(result.message);
                  return;
                }
                if (pendingDraft?.conversationId === active.id) {
                  setPendingDraft(null);
                  if (userId !== null) {
                    await clearLoggingDraft(userId, "coach");
                  }
                }
                setActive(null);
                setMessages([]);
                setConversations((current) =>
                  current.filter((item) => item.id !== active.id),
                );
              } finally {
                deleteLock.current = false;
                setDeleting(false);
              }
            })();
          },
        },
      ],
    );
  }, [active, pendingDraft, userId]);

  const reviewNutritionProposal = useCallback(
    async (proposal: CoachNutritionProposal) => {
      if (userId === null) {
        setMessage("Your session expired. Sign in again.");
        return;
      }
      const stored = await saveLoggingDraft(userId, "meal", {
        ...mealFormStringsFromDraft(proposal.candidate),
        aiDraft: proposal.candidate,
        sourceProposalId: proposal.id,
      });
      if (!stored) {
        setMessage("Could not prepare the meal draft. Try again.");
        return;
      }
      router.push("/log-meal" as Href);
    },
    [userId],
  );

  const reviewWorkoutProposal = useCallback(
    async (proposal: CoachWorkoutProposal) => {
      if (userId === null) {
        setMessage("Your session expired. Sign in again.");
        return;
      }
      const stored = await saveLoggingDraft(userId, "workout", {
        name: proposal.session.label,
        notes: `Coach plan · ${proposal.volumeAction} volume · ${proposal.session.estimatedMinutes} min`,
        selectedExerciseId: "",
        repetitions: "",
        load: "",
        durationSeconds: "",
        distanceMeters: "",
        perceivedExertion: "",
        workoutProposal: proposal,
      });
      if (!stored) {
        setMessage("Could not prepare the workout proposal. Try again.");
        return;
      }
      router.push("/log-workout" as Href);
    },
    [userId],
  );

  const acceptAdaptation = useCallback(
    async (proposal: CoachWeeklyAdaptationProposal) => {
      if (active === null || sending || deleting) return;
      setSending(true);
      setMessage(null);
      try {
        const result = await acceptWeeklyAdaptation(active.id, proposal.id);
        if (!result.ok) {
          setMessage(result.message);
          return;
        }
        setMessages((current) => [...current, result.value.assistantMessage]);
        setLiveRegionTick((tick) => tick + 1);
      } finally {
        setSending(false);
      }
    },
    [active, deleting, sending],
  );

  const attachMealPhoto = useCallback(async () => {
    if (
      active === null ||
      sending ||
      deleting ||
      sendLock.current ||
      deleteLock.current
    ) {
      return;
    }
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setMessage("Photo library access is required to choose a meal photo.");
      return;
    }
    const selection = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      allowsEditing: false,
    });
    if (selection.canceled || selection.assets?.[0] === undefined) return;
    sendLock.current = true;
    setSending(true);
    setMessage(null);
    try {
      const photo = await normalizeMealPhoto(selection.assets[0]);
      const result = await sendCoachMealPhoto(
        active.id,
        photo,
        newCoachMessageIdempotencyKey(),
      );
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setActive(result.conversation);
      setMessages((current) => [...current, ...result.messages]);
      setLiveRegionTick((tick) => tick + 1);
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? `Couldn't read the photo: ${cause.message}`
          : "Couldn't read the photo.",
      );
    } finally {
      sendLock.current = false;
      setSending(false);
    }
  }, [active, deleting, sending]);
  return (
    <ThemedView style={styles.page}>
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
        <KeyboardAvoidingView
          style={styles.safeArea}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          {/* AI-MOB-002 — screen-reader live region. Whenever
              `liveRegionTick` advances, assistive tech announces
              the latest assistant message. The textContent of the
              View is the actual announcement. */}
          <View
            accessibilityLiveRegion="polite"
            accessibilityRole="text"
            style={styles.srOnly}
          >
            {liveRegionTick > 0 && messages.length > 0
              ? `New Coach message: ${
                  messages[messages.length - 1]?.text?.slice(0, 200) ?? ""
                }`
              : ""}
          </View>

          <View style={styles.header}>
            <View style={styles.statusRow}>
              <View
                accessibilityElementsHidden
                importantForAccessibility="no"
                style={[
                  styles.statusDot,
                  status?.ready ? styles.readyDot : styles.disabledDot,
                ]}
              />
              <ThemedText type="smallBold" accessibilityRole="text">
                {status?.ready
                  ? `Coach ready · ${status.provider} · ${
                      status.model ?? "configured model"
                    }`
                  : "Coach off · AI access disabled"}
              </ThemedText>
            </View>
            <ThemedText type="subtitle">Coach</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              AI can be wrong. Mizyun uses confirmed records for general fitness
              and nutrition wellness—not diagnosis or treatment.
            </ThemedText>
          </View>

          <TrainingPlanCard />

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator />
              <ThemedText type="small" themeColor="textSecondary">
                Loading Coach…
              </ThemedText>
            </View>
          ) : status !== null && !status.ready ? (
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold">Coach is safely off</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {status.reason}
              </ThemedText>
              <Pressable
                accessibilityRole="button"
                onPress={() => void refresh()}
                style={styles.secondaryButton}
              >
                <ThemedText type="smallBold">Check again</ThemedText>
              </Pressable>
            </ThemedView>
          ) : active === null ? (
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold">Start a private check-in</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Coach can explain your confirmed goal, meals, training, and
                weight trend. It cannot change those records.
              </ThemedText>
              <Pressable
                accessibilityRole="button"
                onPress={() => void create()}
                style={styles.primaryButton}
              >
                <ThemedText type="smallBold">New conversation</ThemedText>
              </Pressable>
            </ThemedView>
          ) : (
            <>
              <View style={styles.threadHeader}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Open thread list"
                  accessibilityHint={`${conversations.length} conversation${
                    conversations.length === 1 ? "" : "s"
                  }, currently on ${active.title ?? "Coach check-in"}`}
                  onPress={() => {
                    setNow(new Date());
                    setThreadListVisible(true);
                  }}
                  style={styles.threadTitle}
                >
                  <ThemedText type="smallBold">
                    {active.title ?? "Coach check-in"}
                  </ThemedText>
                  <ThemedText
                    type="small"
                    themeColor="textSecondary"
                    style={{ marginTop: 2 }}
                  >
                    {relativeLabel(active.updatedAt, now)} · tap to switch
                  </ThemedText>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: sending || deleting }}
                  disabled={sending || deleting}
                  onPress={remove}
                  style={styles.deleteButton}
                >
                  <ThemedText type="small" themeColor="textSecondary">
                    Delete
                  </ThemedText>
                </Pressable>
              </View>
              <ScrollView
                ref={scrollRef}
                style={styles.thread}
                contentContainerStyle={styles.threadContent}
                keyboardShouldPersistTaps="handled"
              >
                {messages.length === 0 ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    Ask about today’s confirmed nutrition, recent training,
                    active goal, or weight trend.
                  </ThemedText>
                ) : (
                  messages.map((item) => (
                    <MessageBubble
                      key={item.id}
                      message={item}
                      onReviewNutritionProposal={reviewNutritionProposal}
                      onReviewWorkoutProposal={reviewWorkoutProposal}
                      onAcceptWeeklyAdaptation={acceptAdaptation}
                    />
                  ))
                )}
                {sending ? (
                  <View style={styles.pendingRow}>
                    <ActivityIndicator size="small" />
                    <ThemedText type="small" themeColor="textSecondary">
                      Reviewing confirmed records…
                    </ThemedText>
                  </View>
                ) : null}
              </ScrollView>
              {message ? (
                <View
                  style={[
                    styles.alert,
                    alertCategoryFromMessage(message) === "rate_limited" &&
                      styles.alertRateLimited,
                    alertCategoryFromMessage(message) === "unavailable" &&
                      styles.alertUnavailable,
                    alertCategoryFromMessage(message) === "config" &&
                      styles.alertConfig,
                  ]}
                  accessibilityRole="alert"
                >
                  <ThemedText type="small">{message}</ThemedText>
                </View>
              ) : null}
              <View style={styles.composer}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Attach a meal photo"
                  accessibilityHint="Choose a meal photo and create an editable nutrition proposal."
                  accessibilityState={{ disabled: sending || deleting }}
                  disabled={sending || deleting}
                  onPress={() => void attachMealPhoto()}
                  style={[
                    styles.photoButton,
                    (sending || deleting) && styles.disabledButton,
                  ]}
                >
                  <ThemedText type="subtitle">📷</ThemedText>
                </Pressable>
                <TextInput
                  ref={inputRef}
                  accessibilityLabel="Message Coach"
                  editable={!sending && !deleting}
                  multiline
                  maxLength={4_000}
                  placeholder="Ask about your confirmed progress…"
                  placeholderTextColor="#7B7B82"
                  value={draft}
                  onChangeText={setDraft}
                  style={styles.input}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Send message"
                  accessibilityState={{
                    busy: sending,
                    disabled: sending || deleting || draft.trim().length === 0,
                  }}
                  disabled={sending || deleting || draft.trim().length === 0}
                  onPress={() => void send()}
                  style={[
                    styles.sendButton,
                    (sending || deleting || draft.trim().length === 0) &&
                      styles.disabledButton,
                  ]}
                >
                  {sending ? (
                    <ActivityIndicator
                      size="small"
                      color={Colors.dark.text}
                      accessibilityLabel="Sending"
                    />
                  ) : (
                    <ThemedText type="smallBold">Send</ThemedText>
                  )}
                </Pressable>
              </View>
            </>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>

      <ThreadListSheet
        visible={threadListVisible}
        conversations={conversations}
        activeId={active?.id ?? null}
        messagesByConversation={messagesByConversation}
        now={now}
        onSelect={(id) => {
          setThreadListVisible(false);
          void switchToConversation(id);
        }}
        onNew={() => {
          setThreadListVisible(false);
          void create();
        }}
        onClose={() => setThreadListVisible(false)}
      />
    </ThemedView>
  );
}

function MessageBubble({
  message,
  onReviewNutritionProposal,
  onReviewWorkoutProposal,
  onAcceptWeeklyAdaptation,
}: {
  readonly message: CoachMessage;
  readonly onReviewNutritionProposal: (
    proposal: CoachNutritionProposal,
  ) => void;
  readonly onReviewWorkoutProposal: (proposal: CoachWorkoutProposal) => void;
  readonly onAcceptWeeklyAdaptation: (
    proposal: CoachWeeklyAdaptationProposal,
  ) => void;
}) {
  const assistant = message.role === "assistant";
  return (
    <View
      style={[
        styles.bubble,
        assistant ? styles.assistantBubble : styles.userBubble,
      ]}
    >
      <ThemedText type="smallBold">
        {assistant ? "Mizyun Coach" : "You"}
      </ThemedText>
      <ThemedText>{message.text}</ThemedText>
      {message.actionProposal?.kind === "meal_log" ? (
        <NutritionProposalCard
          proposal={message.actionProposal}
          onReview={onReviewNutritionProposal}
        />
      ) : null}
      {message.actionProposal?.kind === "workout_start" ? (
        <WorkoutProposalCard
          proposal={message.actionProposal}
          onReview={onReviewWorkoutProposal}
        />
      ) : null}
      {message.actionProposal?.kind === "daily_plan" ? (
        <DailyPlanCard proposal={message.actionProposal} />
      ) : null}
      {message.actionProposal?.kind === "weekly_adaptation" ? (
        <WeeklyAdaptationCard
          proposal={message.actionProposal}
          onAccept={onAcceptWeeklyAdaptation}
        />
      ) : null}
      {assistant && message.evidenceKinds.length > 0 ? (
        <View style={{ marginTop: Spacing.two, gap: Spacing.one }}>
          <ThemedText type="small" themeColor="textSecondary">
            Used confirmed
          </ThemedText>
          <EvidenceChips kinds={message.evidenceKinds} />
        </View>
      ) : null}
    </View>
  );
}

function NutritionProposalCard({
  proposal,
  onReview,
}: {
  readonly proposal: CoachNutritionProposal;
  readonly onReview: (proposal: CoachNutritionProposal) => void;
}) {
  const draft = proposal.candidate;
  const point = [
    draft.caloriesKcal === null ? null : `${draft.caloriesKcal} kcal`,
    draft.proteinG === null ? null : `${draft.proteinG} g protein`,
    draft.carbohydrateG === null ? null : `${draft.carbohydrateG} g carbs`,
    draft.fatG === null ? null : `${draft.fatG} g fat`,
  ]
    .filter((value): value is string => value !== null)
    .join(" · ");
  return (
    <View style={styles.proposalCard}>
      <ThemedText type="smallBold">{draft.name ?? "Meal estimate"}</ThemedText>
      <ThemedText type="small">
        {point || "Nutrition values need review"}
      </ThemedText>
      {draft.calorieRangeKcal !== null ? (
        <ThemedText type="small" themeColor="textSecondary">
          Estimated range {draft.calorieRangeKcal.low}–
          {draft.calorieRangeKcal.high} kcal · confidence{" "}
          {Math.round(draft.confidence * 100)}%
        </ThemedText>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Review and log ${draft.name ?? "meal"} draft`}
        accessibilityHint="Opens an editable meal form. Nothing is logged until you save it."
        onPress={() => onReview(proposal)}
        style={styles.proposalButton}
      >
        <ThemedText type="smallBold">Review &amp; log</ThemedText>
      </Pressable>
    </View>
  );
}

function WorkoutProposalCard({
  proposal,
  onReview,
}: {
  readonly proposal: CoachWorkoutProposal;
  readonly onReview: (proposal: CoachWorkoutProposal) => void;
}) {
  return (
    <View style={styles.proposalCard}>
      <ThemedText type="smallBold">
        {proposal.session.label} · {proposal.session.estimatedMinutes} min
      </ThemedText>
      {proposal.session.exercises.map((exercise) => (
        <ThemedText key={exercise.catalogId} type="small">
          {exercise.name} · {exercise.sets}×
          {exercise.repsMin === null
            ? `${exercise.durationMinutes} min`
            : `${exercise.repsMin}–${exercise.repsMax}`}{" "}
          · {exercise.restSeconds}s rest
        </ThemedText>
      ))}
      <ThemedText type="small" themeColor="textSecondary">
        {proposal.volumeAction} volume · deterministic plan
      </ThemedText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Review and start ${proposal.session.label}`}
        accessibilityHint="Opens an editable workout plan. Nothing is started until you confirm."
        onPress={() => onReview(proposal)}
        style={styles.proposalButton}
      >
        <ThemedText type="smallBold">Review &amp; start</ThemedText>
      </Pressable>
    </View>
  );
}

const nextActionLabel: Record<CoachDailyPlanProposal["nextAction"], string> = {
  complete_setup: "Complete your Coach setup",
  log_meal: "Log your next meal",
  prioritise_protein: "Prioritise protein in your next meal",
  train: "Complete today’s planned training",
  stay_on_plan: "Stay on plan and keep logging",
};

function DailyPlanCard({
  proposal,
}: {
  readonly proposal: CoachDailyPlanProposal;
}) {
  return (
    <View style={styles.proposalCard}>
      <ThemedText type="smallBold">Today · {proposal.date}</ThemedText>
      {proposal.calorie === null ? null : (
        <ThemedText type="small">
          Calories ·{" "}
          {proposal.calorie.consumedKcal === null
            ? "not logged"
            : `${proposal.calorie.consumedKcal} logged · ${proposal.calorie.remainingKcal} remaining`}{" "}
          · {proposal.calorie.targetKcal} target
        </ThemedText>
      )}
      {proposal.protein === null ? null : (
        <ThemedText type="small">
          Protein ·{" "}
          {proposal.protein.consumedG === null
            ? "not logged"
            : `${proposal.protein.consumedG} g logged · ${proposal.protein.remainingG} g remaining`}{" "}
          · {proposal.protein.targetG} g target
        </ThemedText>
      )}
      {proposal.training === null ? null : (
        <ThemedText type="small">
          Training ·{" "}
          {proposal.training.completedToday
            ? "completed today"
            : proposal.training.due
              ? "due today"
              : "base frequency on track"}
        </ThemedText>
      )}
      <ThemedText type="smallBold">
        Next · {nextActionLabel[proposal.nextAction]}
      </ThemedText>
      {proposal.missingInputs.length > 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          Missing: {proposal.missingInputs.join(", ")}
        </ThemedText>
      ) : null}
      <ThemedText type="small" themeColor="textSecondary">
        Deterministic plan · updates from confirmed logs
      </ThemedText>
    </View>
  );
}

function WeeklyAdaptationCard({
  proposal,
  onAccept,
}: {
  readonly proposal: CoachWeeklyAdaptationProposal;
  readonly onAccept: (proposal: CoachWeeklyAdaptationProposal) => void;
}) {
  const canApply =
    proposal.readiness === "ready" &&
    proposal.goalId !== null &&
    proposal.currentPace !== null &&
    proposal.proposedPace !== null &&
    proposal.currentPace !== proposal.proposedPace;
  return (
    <View style={styles.proposalCard}>
      <ThemedText type="smallBold">Weekly adaptation</ThemedText>
      <ThemedText type="small">
        Calories · {proposal.calorieAction}
        {proposal.currentPace === null
          ? ""
          : ` · ${proposal.currentPace}${canApply ? ` → ${proposal.proposedPace}` : ""}`}
      </ThemedText>
      <ThemedText type="small">
        Training volume · {proposal.trainingVolumeAction}
      </ThemedText>
      <ThemedText type="small">
        Evidence · {proposal.observations.loggedNutritionDays} nutrition days ·{" "}
        {proposal.observations.averageCalorieAdherencePercent ?? "—"}% calories
        · {proposal.observations.averageProteinAdherencePercent ?? "—"}% protein
      </ThemedText>
      <ThemedText type="small">
        Weight trend ·{" "}
        {proposal.observations.weeklyWeightChangeKg === null
          ? "not ready"
          : `${proposal.observations.weeklyWeightChangeKg} kg/week`}
      </ThemedText>
      {proposal.reasons.map((reason) => (
        <ThemedText key={reason} type="small" themeColor="textSecondary">
          {reason}
        </ThemedText>
      ))}
      {canApply ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Accept goal pace change from ${proposal.currentPace} to ${proposal.proposedPace}`}
          accessibilityHint="Updates the active goal and recalculates future deterministic calorie targets."
          onPress={() => onAccept(proposal)}
          style={styles.proposalButton}
        >
          <ThemedText type="smallBold">Accept pace change</ThemedText>
        </Pressable>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          No goal change is available to accept.
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  safeArea: { flex: 1 },
  header: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.three,
    gap: Spacing.two,
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  readyDot: { backgroundColor: "#2F9E69" },
  disabledDot: { backgroundColor: "#E8A230" },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.three,
  },
  card: {
    margin: Spacing.four,
    borderRadius: 18,
    padding: Spacing.four,
    gap: Spacing.three,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.15)",
  },
  primaryButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: "#10B981",
    paddingHorizontal: Spacing.four,
  },
  secondaryButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.3)",
  },
  // AI-MOB-002 — visually-hidden but announced to screen readers.
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    opacity: 0,
  },
  threadHeader: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  threadTitle: {
    flex: 1,
    minHeight: 44,
    paddingVertical: Spacing.one,
    justifyContent: "center",
  },
  deleteButton: {
    minHeight: 44,
    paddingHorizontal: Spacing.two,
    justifyContent: "center",
  },
  thread: { flex: 1 },
  threadContent: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    padding: Spacing.four,
    gap: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.six,
  },
  bubble: {
    maxWidth: "90%",
    padding: Spacing.three,
    borderRadius: 16,
    gap: Spacing.two,
  },
  userBubble: {
    alignSelf: "flex-end",
    backgroundColor: "#059669",
  },
  assistantBubble: {
    alignSelf: "flex-start",
    backgroundColor: Colors.dark.backgroundElement,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.15)",
  },
  proposalCard: {
    marginTop: Spacing.one,
    padding: Spacing.three,
    gap: Spacing.two,
    borderRadius: 12,
    backgroundColor: "rgba(16, 185, 129, 0.1)",
  },
  proposalButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: "#10B981",
    paddingHorizontal: Spacing.three,
  },
  pendingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  alert: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    borderLeftWidth: 3,
    borderLeftColor: "#E8A230",
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  alertRateLimited: { borderLeftColor: "#E8A230" },
  alertUnavailable: { borderLeftColor: "#7B7B82" },
  alertConfig: { borderLeftColor: "#C8403B" },
  composer: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "flex-end",
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: BottomTabInset,
  },
  photoButton: {
    width: 48,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.3)",
  },
  input: {
    flex: 1,
    minHeight: 48,
    maxHeight: 120,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.3)",
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  sendButton: {
    minWidth: 72,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: "#10B981",
  },
  disabledButton: { opacity: 0.45 },
});
