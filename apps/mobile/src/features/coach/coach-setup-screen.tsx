import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
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
import {
  cleanAssistantProposalText,
  type CoachConversation,
  type CoachDailyPlanProposal,
  type CoachMessage,
  type CoachMultiWorkoutPlanProposal,
  type CoachNutritionProposal,
  type CoachProviderStatus,
  type CoachWorkoutProposal,
  type CoachWorkoutEditProposal,
  type CoachWeeklyAdaptationProposal,
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
  mergeCoachSendResult,
  newCoachMessageIdempotencyKey,
  optimisticCoachMessageId,
  previewFor,
  relativeLabel,
  sendCoachMessage,
  sendCoachMealPhoto,
  type CoachPendingDraft,
} from "./coach-data";
import { ThreadListSheet } from "./thread-list-sheet";
import { TrainingPlanCard } from "./training-plan-card";
import {
  humanFocusLabel,
  saveMultiWorkoutPlan,
  type MultiWorkoutPlanSaveResult,
} from "./multi-workout-plan";
import { applyWorkoutEditProposal } from "./workout-edit-proposal";

// AI-MOB-002 — error taxonomy. The data layer returns humanized
// text for any failure; the screen additionally surfaces a
// category the user can act on. Categories map to distinct UI
// toasts: rate-limit copies a Retry-After hint, unconfigured
// suggests contacting support, etc.
type AlertCategory = "rate_limited" | "unavailable" | "config" | "generic";

/**
 * Minimum time the "Coach is thinking…" indicator stays on screen
 * after a send. The deterministic multi-workout path returns in
 * well under 200 ms; without this floor the spinner flashes so
 * briefly it reads as "loaded from cache" rather than a real
 * response. LLM calls take 1–5 s and are unaffected.
 */
const MIN_SEND_INDICATOR_MS = 500;

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
  const [planExpanded, setPlanExpanded] = useState(false);
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
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      () => setIsKeyboardVisible(true),
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => setIsKeyboardVisible(false),
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

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
    if (messages.length > 0) {
      requestAnimationFrame(() =>
        scrollRef.current?.scrollToEnd({ animated: true }),
      );
    }
  }, [messages]);

  const create = useCallback(async () => {
    setLoading(true);
    const statusResult = await loadCoach();
    if (statusResult.ok) {
      setStatus(statusResult.status);
    }
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

  const send = useCallback(
    async (retryDraft?: CoachPendingDraft) => {
      const retry =
        retryDraft?.conversationId === active?.id ? retryDraft : undefined;
      const text = retry?.text ?? draft.trim();
      if (
        !active ||
        text.length === 0 ||
        sending ||
        sendLock.current ||
        deleteLock.current
      ) {
        return;
      }
      sendLock.current = true;
      draftLoadGeneration.current += 1;
      setSending(true);
      const sentAt = Date.now();
      const idempotencyKey =
        retry !== undefined
          ? retry.idempotencyKey
          : pendingDraft?.conversationId === active.id &&
              pendingDraft.text === text
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
          id: optimisticCoachMessageId(idempotencyKey),
          conversationId: active.id,
          role: "user",
          text,
          status: "complete",
          provider: null,
          evidenceKinds: [],
          actionProposal: null,
          createdAt: new Date().toISOString(),
        };
        setMessages((current) =>
          current.some((item) => item.id === userBubble.id)
            ? current
            : [...current, userBubble],
        );
        const result = await sendCoachMessage(active.id, text, idempotencyKey);
        if (result.ok) {
          setActive(result.conversation);
          // Replace the optimistic bubble and de-duplicate the canonical user
          // message if this retry was restored after an app restart.
          setMessages((current) =>
            mergeCoachSendResult(current, userBubble.id, result.messages),
          );
          setPendingDraft(null);
          if (userId !== null) await clearLoggingDraft(userId, "coach");
          // Announce the new assistant message to assistive tech.
          setLiveRegionTick((tick) => tick + 1);
        } else {
          setMessage(result.message);
          // Keep the failed bubble and encrypted retry payload, but leave the
          // composer empty. The bubble owns the explicit retry affordance.
        }
      } finally {
        // AI-MOB-002 — keep the "Coach is thinking…" indicator
        // visible for at least MIN_SEND_INDICATOR_MS so the
        // deterministic multi-workout path (which is genuinely
        // fast, well under 200 ms) does not flash the spinner
        // so quickly it looks like the answer was loaded from
        // cache. LLM paths take 1–5 s and are unaffected.
        const elapsed = Date.now() - sentAt;
        const remaining = MIN_SEND_INDICATOR_MS - elapsed;
        if (remaining > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, remaining));
        }
        sendLock.current = false;
        setSending(false);
        // AI-MOB-002 — focus returns to the composer after every
        // send (success or failure) so the user can immediately
        // type the next message.
        inputRef.current?.focus();
      }
    },
    [active, draft, pendingDraft, sending, userId],
  );

  const activeRetry =
    active !== null && pendingDraft?.conversationId === active.id
      ? pendingDraft
      : null;
  const activeRetryBubbleId =
    activeRetry === null
      ? null
      : optimisticCoachMessageId(activeRetry.idempotencyKey);
  const retryBubbleVisible =
    activeRetryBubbleId !== null &&
    messages.some((item) => item.id === activeRetryBubbleId);

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
      mediaTypes: ["images"],
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
  const sendPrompt = useCallback((promptText: string) => {
    setDraft(promptText);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, []);

  return (
    <ThemedView style={styles.page}>
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
        <KeyboardAvoidingView
          style={styles.safeArea}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
        >
          {/* AI-MOB-002 — screen-reader live region */}
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

          {/* Top Bar: Thread Switcher & Actions */}
          <View style={styles.topBar}>
            {active !== null ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open thread list"
                onPress={() => {
                  setNow(new Date());
                  setThreadListVisible(true);
                }}
                style={styles.threadSelector}
              >
                <ThemedText type="smallBold">
                  {active.title ?? "Coach check-in"}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  ▾
                </ThemedText>
              </Pressable>
            ) : (
              <ThemedText type="subtitle">Coach</ThemedText>
            )}

            <View style={styles.topBarActions}>
              {status?.ready ? (
                <View style={styles.modelBadge}>
                  <View style={[styles.statusDot, styles.readyDot]} />
                  <ThemedText type="small" style={styles.modelBadgeText}>
                    {status.model
                      ? status.model.replace("mistral-", "")
                      : "Mistral"}
                  </ThemedText>
                </View>
              ) : null}

              {active !== null ? (
                <>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="New conversation"
                    onPress={() => void create()}
                    style={styles.iconActionButton}
                  >
                    <ThemedText type="smallBold">＋</ThemedText>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Delete thread"
                    disabled={sending || deleting}
                    onPress={remove}
                    style={styles.iconActionButton}
                  >
                    <ThemedText type="small" themeColor="textSecondary">
                      🗑️
                    </ThemedText>
                  </Pressable>
                </>
              ) : null}
            </View>
          </View>

          {/* Expandable Plan & Disclaimer Header */}
          <Pressable
            accessibilityRole="button"
            onPress={() => setPlanExpanded((expanded) => !expanded)}
            style={styles.planToggleBar}
          >
            <ThemedText type="small" themeColor="textSecondary">
              ⚡ Training plan &amp; advisory info {planExpanded ? "▲" : "▼"}
            </ThemedText>
          </Pressable>

          {planExpanded ? (
            <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled>
              <View
                style={{
                  paddingHorizontal: Spacing.four,
                  paddingBottom: Spacing.two,
                }}
              >
                <ThemedText
                  type="small"
                  themeColor="textSecondary"
                  style={{ marginBottom: Spacing.two }}
                >
                  AI can be wrong. Mizyun uses confirmed records for general
                  fitness and nutrition wellness—not diagnosis or treatment.
                </ThemedText>
                <TrainingPlanCard />
              </View>
            </ScrollView>
          ) : null}

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
              <ScrollView
                ref={scrollRef}
                style={styles.thread}
                contentContainerStyle={styles.threadContent}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
              >
                {messages.length === 0 ? (
                  <View style={styles.emptyStateContainer}>
                    <ThemedText type="subtitle" style={styles.emptyStateTitle}>
                      What can I help with?
                    </ThemedText>
                    <ThemedText
                      type="small"
                      themeColor="textSecondary"
                      style={{ marginTop: Spacing.one }}
                    >
                      Tap a suggestion or type below
                    </ThemedText>
                    <View style={styles.promptChipsGrid}>
                      <View style={styles.promptChipsRow}>
                        <Pressable
                          style={styles.promptChip}
                          onPress={() =>
                            sendPrompt(
                              "Help me design a specialized workout to build a V-shape body",
                            )
                          }
                        >
                          <ThemedText style={styles.promptChipEmoji}>
                            🏋️
                          </ThemedText>
                          <ThemedText
                            type="small"
                            style={styles.promptChipLabel}
                          >
                            V-Shape
                          </ThemedText>
                        </Pressable>
                        <Pressable
                          style={styles.promptChip}
                          onPress={() =>
                            sendPrompt(
                              "How much protein should I eat today and what foods work best?",
                            )
                          }
                        >
                          <ThemedText style={styles.promptChipEmoji}>
                            🥗
                          </ThemedText>
                          <ThemedText
                            type="small"
                            style={styles.promptChipLabel}
                          >
                            Protein
                          </ThemedText>
                        </Pressable>
                      </View>
                      <View style={styles.promptChipsRow}>
                        <Pressable
                          style={styles.promptChip}
                          onPress={() =>
                            sendPrompt(
                              "Explain my latest weight trend and calorie balance",
                            )
                          }
                        >
                          <ThemedText style={styles.promptChipEmoji}>
                            📈
                          </ThemedText>
                          <ThemedText
                            type="small"
                            style={styles.promptChipLabel}
                          >
                            Progress
                          </ThemedText>
                        </Pressable>
                        <Pressable
                          style={styles.promptChip}
                          onPress={() =>
                            sendPrompt(
                              "Suggest a 45-minute full body gym session",
                            )
                          }
                        >
                          <ThemedText style={styles.promptChipEmoji}>
                            ⚡
                          </ThemedText>
                          <ThemedText
                            type="small"
                            style={styles.promptChipLabel}
                          >
                            Quick Gym
                          </ThemedText>
                        </Pressable>
                      </View>
                    </View>
                  </View>
                ) : (
                  messages.map((item) => (
                    <MessageBubble
                      key={item.id}
                      message={item}
                      retrying={sending && item.id === activeRetryBubbleId}
                      onRetry={
                        item.id === activeRetryBubbleId && activeRetry !== null
                          ? () => void send(activeRetry)
                          : undefined
                      }
                      onReviewNutritionProposal={reviewNutritionProposal}
                      onReviewWorkoutProposal={reviewWorkoutProposal}
                      onAcceptWeeklyAdaptation={acceptAdaptation}
                    />
                  ))
                )}
                {sending ? (
                  <View style={styles.pendingRow}>
                    <ActivityIndicator size="small" color="#10B981" />
                    <ThemedText type="small" themeColor="textSecondary">
                      Mizyun Coach is thinking…
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
                  {activeRetry !== null && !retryBubbleVisible ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Retry saved Coach message"
                      accessibilityState={{ disabled: sending, busy: sending }}
                      disabled={sending}
                      onPress={() => void send(activeRetry)}
                      style={styles.retryButton}
                    >
                      <ThemedText type="smallBold">Retry</ThemedText>
                    </Pressable>
                  ) : null}
                </View>
              ) : activeRetry !== null && !retryBubbleVisible ? (
                <View style={styles.alert} accessibilityRole="alert">
                  <ThemedText type="small">
                    A saved message still needs to be sent.
                  </ThemedText>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Retry saved Coach message"
                    accessibilityState={{ disabled: sending, busy: sending }}
                    disabled={sending}
                    onPress={() => void send(activeRetry)}
                    style={styles.retryButton}
                  >
                    <ThemedText type="smallBold">Retry</ThemedText>
                  </Pressable>
                </View>
              ) : null}

              {/* Composer Bar */}
              <View
                style={[
                  styles.composerWrapper,
                  isKeyboardVisible && styles.composerWrapperKeyboardActive,
                ]}
              >
                <View style={styles.composerCapsule}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Attach a meal photo"
                    accessibilityHint="Choose a meal photo and create an editable nutrition proposal."
                    accessibilityState={{ disabled: sending || deleting }}
                    disabled={sending || deleting}
                    onPress={() => void attachMealPhoto()}
                    style={styles.photoIconButton}
                  >
                    <ThemedText style={styles.composerIconEmoji}>📷</ThemedText>
                  </Pressable>
                  <TextInput
                    ref={inputRef}
                    accessibilityLabel="Message Coach"
                    editable={!sending && !deleting}
                    multiline
                    maxLength={4_000}
                    placeholder="Message..."
                    placeholderTextColor="#64748B"
                    value={draft}
                    onChangeText={setDraft}
                    style={styles.capsuleInput}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Send message"
                    accessibilityState={{
                      busy: sending,
                      disabled:
                        sending || deleting || draft.trim().length === 0,
                    }}
                    disabled={sending || deleting || draft.trim().length === 0}
                    onPress={() => void send()}
                    style={[
                      styles.circleSendButton,
                      (sending || deleting || draft.trim().length === 0) &&
                        styles.disabledSendButton,
                    ]}
                  >
                    {sending ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <ThemedText style={styles.sendArrow}>↑</ThemedText>
                    )}
                  </Pressable>
                </View>
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
  retrying,
  onRetry,
  onReviewNutritionProposal,
  onReviewWorkoutProposal,
  onAcceptWeeklyAdaptation,
}: {
  readonly message: CoachMessage;
  readonly retrying: boolean;
  readonly onRetry?: (() => void) | undefined;
  readonly onReviewNutritionProposal: (
    proposal: CoachNutritionProposal,
  ) => void;
  readonly onReviewWorkoutProposal: (proposal: CoachWorkoutProposal) => void;
  readonly onAcceptWeeklyAdaptation: (
    proposal: CoachWeeklyAdaptationProposal,
  ) => void;
}) {
  const assistant = message.role === "assistant";
  const displayText =
    assistant && message.actionProposal
      ? cleanAssistantProposalText(message.text, message.actionProposal)
      : message.text;

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
      {displayText.trim().length > 0 ? (
        <ThemedText>{displayText}</ThemedText>
      ) : null}
      {onRetry !== undefined ? (
        <View style={styles.failedMessageActions}>
          <ThemedText type="small" themeColor="textSecondary">
            Not completed
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry failed Coach message"
            accessibilityState={{ disabled: retrying, busy: retrying }}
            disabled={retrying}
            onPress={onRetry}
            style={styles.retryButton}
          >
            {retrying ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <ThemedText type="smallBold">Retry</ThemedText>
            )}
          </Pressable>
        </View>
      ) : null}
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
      {message.actionProposal?.kind === "multi_workout_plan" ? (
        <MultiWorkoutPlanCard proposal={message.actionProposal} />
      ) : null}
      {message.actionProposal?.kind === "daily_plan" ? (
        <DailyPlanCard proposal={message.actionProposal} />
      ) : null}
      {message.actionProposal?.kind === "workout_edit" ? (
        <WorkoutEditProposalCard proposal={message.actionProposal} />
      ) : null}
      {message.actionProposal?.kind === "weekly_adaptation" ? (
        <WeeklyAdaptationCard
          proposal={message.actionProposal}
          onAccept={onAcceptWeeklyAdaptation}
        />
      ) : null}
      {assistant && message.evidenceKinds.length > 0 ? (
        <EvidenceChips kinds={message.evidenceKinds} />
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

function formatTargetDay(targetDay: string): string {
  // The server emits YYYY-MM-DD; render a short locale-friendly
  // label so the user can scan the schedule without a heavy
  // date picker.
  const [year, month, day] = targetDay
    .split("-")
    .map((part) => Number.parseInt(part, 10));
  if (
    Number.isNaN(year) ||
    Number.isNaN(month) ||
    Number.isNaN(day) ||
    year < 2000 ||
    year > 2100
  ) {
    return targetDay;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function MultiWorkoutPlanCard({
  proposal,
}: {
  readonly proposal: CoachMultiWorkoutPlanProposal;
}) {
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<MultiWorkoutPlanSaveResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSaveAll = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await saveMultiWorkoutPlan(proposal);
      setResult(saved);
      if (!saved.ok) {
        setError(
          "One or more sessions could not be saved. Retry the failed ones below.",
        );
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `Could not save the plan: ${cause.message}`
          : "Could not save the plan.",
      );
    } finally {
      setSaving(false);
    }
  }, [proposal, saving]);

  const onOpenWorkout = useCallback((workoutId: string) => {
    router.push(`/log-workout?workoutId=${workoutId}` as Href);
  }, []);

  const onOpenFirst = useCallback(() => {
    const first = result?.saved.find((entry) => entry.result.ok);
    if (first?.result.ok) {
      onOpenWorkout(first.result.workout.id);
    }
  }, [onOpenWorkout, result]);

  const savedByIndex = new Map<
    number,
    NonNullable<MultiWorkoutPlanSaveResult["saved"][number]>
  >();
  result?.saved.forEach((entry) => {
    savedByIndex.set(entry.session.index, entry);
  });

  return (
    <View style={styles.proposalCard}>
      <ThemedText type="smallBold">
        {proposal.requestedSessions}-session plan
        {humanFocusLabel(proposal.focus) === null
          ? ""
          : ` · ${humanFocusLabel(proposal.focus)}`}{" "}
        · {proposal.sessionMinutes} min each
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {proposal.rationale}
      </ThemedText>
      {proposal.sessions.map((session) => {
        const saved = savedByIndex.get(session.index);
        const isSaved = saved?.result.ok === true;
        const isFailed = saved !== undefined && !saved.result.ok;
        // The engine now sets the per-session focus to either the
        // distribution slot ("upper" / "lower") or the plan-level
        // focus. We humanize it for the row subtitle so the user
        // never sees raw snake_case.
        const sessionFocusLabel = humanFocusLabel(session.focus);
        const isDuplicateLabel =
          sessionFocusLabel !== null &&
          sessionFocusLabel.toLowerCase().trim() ===
            session.label.toLowerCase().trim();
        return (
          <View
            key={session.index}
            style={styles.multiWorkoutRow}
            accessibilityLabel={`Session ${session.index}: ${session.label}${sessionFocusLabel === null || isDuplicateLabel ? "" : `, ${sessionFocusLabel}`} on ${formatTargetDay(session.targetDay)}, ${session.estimatedMinutes} minutes, ${session.exercises.length} exercises`}
          >
            <View style={{ flex: 1, gap: Spacing.one }}>
              <ThemedText type="smallBold">
                Day {session.index} · {session.label}
                {sessionFocusLabel === null || isDuplicateLabel
                  ? ""
                  : ` · ${sessionFocusLabel}`}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {formatTargetDay(session.targetDay)} ·{" "}
                {session.estimatedMinutes} min · {session.exercises.length}{" "}
                exercises
              </ThemedText>
              {session.exercises.map((exercise) => (
                <ThemedText
                  key={`${session.index}-${exercise.catalogId}`}
                  type="small"
                  themeColor="textSecondary"
                >
                  · {exercise.name} · {exercise.sets}×
                  {exercise.repsMin === null
                    ? `${exercise.durationMinutes} min`
                    : `${exercise.repsMin}–${exercise.repsMax}`}
                </ThemedText>
              ))}
              {isSaved ? (
                <ThemedText type="small" themeColor="textSecondary">
                  Saved · ready to open and edit
                </ThemedText>
              ) : null}
              {isFailed ? (
                <ThemedText type="small" themeColor="textSecondary">
                  Could not save ·{" "}
                  {saved?.result.ok === false
                    ? saved.result.message
                    : "unknown error"}
                </ThemedText>
              ) : null}
            </View>
            {isSaved ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open ${session.label} on ${formatTargetDay(session.targetDay)}`}
                onPress={() =>
                  saved.result.ok && onOpenWorkout(saved.result.workout.id)
                }
                style={styles.multiWorkoutOpenButton}
              >
                <ThemedText type="smallBold">Open</ThemedText>
              </Pressable>
            ) : null}
          </View>
        );
      })}
      {error !== null ? (
        <ThemedText
          type="small"
          themeColor="textSecondary"
          accessibilityRole="alert"
        >
          {error}
        </ThemedText>
      ) : null}
      {result === null ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Save all ${proposal.requestedSessions} sessions`}
          accessibilityHint="Creates one real workout per session, scheduled to the days above. You can then open any session to add sets, reorder exercises, or adjust weights."
          disabled={saving}
          accessibilityState={{ disabled: saving, busy: saving }}
          onPress={() => {
            void onSaveAll();
          }}
          style={styles.proposalButton}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <ThemedText type="smallBold">
              Save {proposal.requestedSessions} sessions
            </ThemedText>
          )}
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open the first saved session"
          onPress={() => {
            onOpenFirst();
          }}
          style={styles.proposalButton}
        >
          <ThemedText type="smallBold">Open first session</ThemedText>
        </Pressable>
      )}
    </View>
  );
}

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

function WorkoutEditProposalCard({
  proposal,
}: {
  readonly proposal: CoachWorkoutEditProposal;
}) {
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onApply = useCallback(async () => {
    if (applying) return;
    setApplying(true);
    setError(null);
    try {
      const result = await applyWorkoutEditProposal(proposal);
      if (result.ok) {
        setApplied(true);
      } else {
        setError(
          result.message ?? "Could not apply changes. Please try again.",
        );
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `Could not apply changes: ${cause.message}`
          : "Could not apply changes.",
      );
    } finally {
      setApplying(false);
    }
  }, [applying, proposal]);

  const onOpen = useCallback(() => {
    router.push(`/log-workout?workoutId=${proposal.workoutId}` as Href);
  }, [proposal.workoutId]);

  return (
    <View style={styles.proposalCard}>
      <ThemedText type="smallBold">
        Proposed workout changes · {proposal.targetName}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {proposal.summary}
      </ThemedText>
      <View style={{ gap: Spacing.one }}>
        {proposal.exercises.map((exercise) => (
          <ThemedText
            key={exercise.catalogId}
            type="small"
            themeColor="textSecondary"
          >
            · {exercise.name} · {exercise.sets}×
            {exercise.repsMin === null
              ? `${exercise.durationMinutes} min`
              : `${exercise.repsMin}–${exercise.repsMax}`}{" "}
            · {exercise.restSeconds}s rest
          </ThemedText>
        ))}
      </View>
      {error !== null ? (
        <ThemedText
          type="small"
          themeColor="textSecondary"
          accessibilityRole="alert"
        >
          {error}
        </ThemedText>
      ) : null}
      {!applied ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Apply changes to workout"
          disabled={applying}
          accessibilityState={{ disabled: applying, busy: applying }}
          onPress={onApply}
          style={({ pressed }) => [
            styles.proposalButton,
            pressed && { opacity: 0.8 },
          ]}
        >
          <ThemedText type="smallBold" style={{ color: "#FFFFFF" }}>
            {applying ? "Applying…" : "Apply changes to workout"}
          </ThemedText>
        </Pressable>
      ) : (
        <View style={{ gap: Spacing.one }}>
          <ThemedText type="smallBold" style={{ color: "#34C759" }}>
            ✓ Changes applied to workout
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${proposal.targetName}`}
            onPress={onOpen}
            style={({ pressed }) => [
              styles.proposalButton,
              pressed && { opacity: 0.8 },
            ]}
          >
            <ThemedText type="smallBold" style={{ color: "#FFFFFF" }}>
              Open workout
            </ThemedText>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  safeArea: { flex: 1 },
  topBar: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
  },
  threadSelector: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
  },
  topBarActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  modelBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(16, 185, 129, 0.12)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  modelBadgeText: {
    fontSize: 12,
    color: "#10B981",
    fontWeight: "600",
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  readyDot: { backgroundColor: "#10B981" },
  disabledDot: { backgroundColor: "#E8A230" },
  iconActionButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  planToggleBar: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.one,
  },
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
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    opacity: 0,
  },
  thread: { flex: 1 },
  threadContent: {
    flexGrow: 1,
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    gap: Spacing.four,
    paddingBottom: 16,
  },
  emptyStateContainer: {
    flex: 1,
    justifyContent: "center",
    paddingVertical: Spacing.four,
  },
  emptyStateTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: "#FFFFFF",
    letterSpacing: -0.4,
  },
  promptChipsGrid: {
    marginTop: Spacing.four,
    gap: Spacing.two,
  },
  promptChipsRow: {
    flexDirection: "row",
    gap: Spacing.two,
  },
  promptChip: {
    flex: 1,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    borderRadius: 16,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    alignItems: "center",
    gap: 4,
  },
  promptChipEmoji: {
    fontSize: 24,
  },
  promptChipLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#CBD5E1",
    textAlign: "center",
  },
  bubble: {
    maxWidth: "88%",
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderRadius: 20,
    gap: Spacing.two,
  },
  userBubble: {
    alignSelf: "flex-end",
    backgroundColor: "rgba(16, 185, 129, 0.22)",
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.4)",
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    alignSelf: "flex-start",
    backgroundColor: "#16181D",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    borderBottomLeftRadius: 4,
  },
  proposalCard: {
    marginTop: Spacing.one,
    padding: Spacing.three,
    gap: Spacing.two,
    borderRadius: 14,
    backgroundColor: "rgba(16, 185, 129, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.25)",
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
    paddingVertical: Spacing.two,
  },
  failedMessageActions: {
    marginTop: Spacing.one,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.two,
  },
  retryButton: {
    minHeight: 44,
    minWidth: 88,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: "#10B981",
    paddingHorizontal: Spacing.three,
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
  composerWrapper: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    backgroundColor: "#0D0E12",
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: BottomTabInset + Spacing.one,
  },
  composerWrapperKeyboardActive: {
    paddingBottom: Spacing.two,
  },
  composerCapsule: {
    flexDirection: "row",
    alignItems: "flex-end",
    backgroundColor: "#1E2028",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    paddingLeft: 8,
    paddingRight: 8,
    paddingVertical: 8,
    gap: 6,
  },
  photoIconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  composerIconEmoji: {
    fontSize: 20,
  },
  capsuleInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    paddingHorizontal: Spacing.two,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 16,
    lineHeight: 20,
    color: "#FFFFFF",
  },
  circleSendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#10B981",
    alignItems: "center",
    justifyContent: "center",
  },
  disabledSendButton: {
    backgroundColor: "rgba(255, 255, 255, 0.1)",
  },
  sendArrow: {
    fontSize: 20,
    fontWeight: "700",
    color: "#FFFFFF",
    lineHeight: 22,
    textAlign: "center",
  },
  multiWorkoutRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.two,
    paddingVertical: Spacing.two,
  },
  multiWorkoutOpenButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#1F1F23",
    borderRadius: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(16, 185, 129, 0.15)",
  },
});
