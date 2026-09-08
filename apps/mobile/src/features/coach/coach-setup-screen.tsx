import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  type Workout,
} from "@mizyun/contracts";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { FeedbackHeaderButton } from "@/components/feedback-header-button";
import {
  BottomTabInset,
  Colors,
  MaxContentWidth,
  Spacing,
} from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

import {
  clearLoggingDraft,
  loadLoggingDraft,
  saveLoggingDraft,
} from "@/features/logging-draft-storage";
import { useAuth } from "@/features/auth/auth-context";
import { mealFormStringsFromDraft } from "@/features/log-meal/meal-form";
import { normalizeMealPhoto } from "@/features/log-meal/meal-photo";

import { loadAiConsent, saveAiConsent } from "./ai-consent";
import { AiConsentModal } from "./ai-consent-modal";
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
import {
  createCustomWorkout,
  type PlannedExerciseItem,
} from "@/features/workouts/workouts-hub-data";

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
  const params = useLocalSearchParams<{
    prompt?: string;
    autoSend?: string;
  }>();
  const { session } = useAuth();
  const theme = useTheme();
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
  const lastHandledPrompt = useRef<string | null>(null);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const [aiConsentGranted, setAiConsentGranted] = useState(false);
  const [aiConsentModalVisible, setAiConsentModalVisible] = useState(false);
  const pendingAiAction = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (userId === null) return;
    void loadAiConsent(userId).then((status) => {
      setAiConsentGranted(status.granted && status.confirmedAdult);
    });
  }, [userId]);

  const handleAiConsent = useCallback(async () => {
    if (userId !== null) {
      await saveAiConsent(userId, true, true);
    }
    setAiConsentGranted(true);
    setAiConsentModalVisible(false);
    if (pendingAiAction.current) {
      const action = pendingAiAction.current;
      pendingAiAction.current = null;
      action();
    }
  }, [userId]);

  const handleAiDecline = useCallback(() => {
    setAiConsentModalVisible(false);
    pendingAiAction.current = null;
    setMessage(
      "AI Coach requires consent to third-party AI processing and adult eligibility.",
    );
  }, []);

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
    if (result.status.ready) {
      if (result.conversations[0]) {
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
      } else if (params.autoSend === "true") {
        const created = await createCoachConversation();
        if (created.ok) {
          setActive(created.conversation);
          setMessages([]);
          setConversations([created.conversation]);
        }
      }
    }
    setLoading(false);
  }, [params.autoSend]);

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
    async (retryDraft?: CoachPendingDraft, textOverride?: string) => {
      if (!aiConsentGranted) {
        pendingAiAction.current = () => void send(retryDraft, textOverride);
        setAiConsentModalVisible(true);
        return;
      }
      const retry =
        retryDraft?.conversationId === active?.id ? retryDraft : undefined;
      const text = (retry?.text ?? textOverride ?? draft).trim();
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
      const retryBubbleId =
        retry !== undefined
          ? optimisticCoachMessageId(retry.idempotencyKey)
          : undefined;
      const idempotencyKey = newCoachMessageIdempotencyKey();
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
        setMessages((current) => {
          const base = retryBubbleId
            ? current.filter((item) => item.id !== retryBubbleId)
            : current;
          return base.some((item) => item.id === userBubble.id)
            ? base
            : [...base, userBubble];
        });
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
    [active, aiConsentGranted, draft, pendingDraft, sending, userId],
  );

  useEffect(() => {
    if (
      typeof params.prompt === "string" &&
      params.prompt.trim().length > 0 &&
      lastHandledPrompt.current !== params.prompt
    ) {
      if (params.autoSend === "true") {
        if (!loading && active !== null && !sending && !sendLock.current) {
          lastHandledPrompt.current = params.prompt;
          void send(undefined, params.prompt.trim());
        }
      } else {
        lastHandledPrompt.current = params.prompt;
        setDraft(params.prompt.trim());
        requestAnimationFrame(() => {
          inputRef.current?.focus();
        });
      }
    }
  }, [active, loading, params.autoSend, params.prompt, send, sending]);

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
    if (!aiConsentGranted) {
      pendingAiAction.current = () => void attachMealPhoto();
      setAiConsentModalVisible(true);
      return;
    }
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
  }, [active, aiConsentGranted, deleting, sending]);
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

          {/* Top Header */}
          <View style={styles.header}>
            <View style={styles.headerTopRow}>
              <ThemedText type="smallBold" themeColor="textSecondary">
                MIZYUN
              </ThemedText>
              <View style={styles.headerActions}>
                <FeedbackHeaderButton />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Toggle training plan & advisory info"
                  onPress={() => setPlanExpanded((expanded) => !expanded)}
                  style={({ pressed }) => [
                    styles.navIconButton,
                    planExpanded && styles.navIconButtonActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <ThemedText
                    style={[
                      styles.navIconText,
                      planExpanded && styles.navIconTextActive,
                    ]}
                  >
                    ⚡
                  </ThemedText>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="New conversation"
                  onPress={() => void create()}
                  style={({ pressed }) => [
                    styles.navIconButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <ThemedText style={styles.navIconText}>＋</ThemedText>
                </Pressable>

                {active !== null ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Delete conversation"
                    disabled={sending || deleting}
                    onPress={remove}
                    style={({ pressed }) => [
                      styles.navIconButton,
                      pressed && styles.pressed,
                    ]}
                  >
                    <ThemedText style={styles.navIconText}>🗑️</ThemedText>
                  </Pressable>
                ) : null}
              </View>
            </View>

            <View style={styles.headerTitleRow}>
              <ThemedText type="subtitle">Coach</ThemedText>
              {active !== null ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Open thread list"
                  onPress={() => {
                    setNow(new Date());
                    setThreadListVisible(true);
                  }}
                  style={({ pressed }) => [
                    styles.topBarThreadPill,
                    pressed && styles.pressed,
                  ]}
                >
                  <ThemedText style={styles.navChatIcon}>💬</ThemedText>
                  <ThemedText
                    type="smallBold"
                    numberOfLines={1}
                    style={styles.navThreadTitle}
                  >
                    {active.title ?? "Coach check-in"}
                  </ThemedText>
                  <ThemedText
                    type="small"
                    themeColor="textSecondary"
                    style={styles.navChevron}
                  >
                    ▾
                  </ThemedText>
                </Pressable>
              ) : null}
            </View>

            <ThemedText type="small" themeColor="textSecondary">
              Private fitness &amp; nutrition guidance grounded in your
              confirmed data.
            </ThemedText>
          </View>

          {/* Expandable Plan & Advisory Info Drawer */}
          {planExpanded ? (
            <View style={styles.advisoryCardWrapper}>
              <ThemedView type="backgroundElement" style={styles.advisoryCard}>
                <View style={styles.advisoryCardHeader}>
                  <View style={styles.advisoryIconContainer}>
                    <ThemedText style={styles.advisoryIcon}>💡</ThemedText>
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <ThemedText type="smallBold">
                      Advisory &amp; Privacy Notice
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      AI can make mistakes. Mizyun references confirmed data for
                      fitness &amp; nutrition wellness—never medical diagnosis
                      or treatment.
                    </ThemedText>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Close advisory panel"
                    onPress={() => setPlanExpanded(false)}
                    style={styles.advisoryCloseButton}
                  >
                    <ThemedText type="small" themeColor="textSecondary">
                      ✕
                    </ThemedText>
                  </Pressable>
                </View>
                <TrainingPlanCard />
              </ThemedView>
            </View>
          ) : null}

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color="#10B981" />
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
                <ThemedText type="smallBold" style={{ color: "#FFFFFF" }}>
                  New conversation
                </ThemedText>
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
                    {/* Primary Action Card: Ask AI Coach */}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Ask AI Coach"
                      onPress={() => {
                        inputRef.current?.focus();
                      }}
                      style={({ pressed }) => [
                        styles.coachHeroCard,
                        pressed && styles.pressed,
                      ]}
                    >
                      <View style={styles.coachHeroIconContainer}>
                        <ThemedText style={styles.coachHeroIcon}>✨</ThemedText>
                      </View>
                      <View style={styles.coachHeroBody}>
                        <ThemedText type="smallBold">Ask AI Coach</ThemedText>
                        <ThemedText type="small" themeColor="textSecondary">
                          Personalized insights, meal analysis, and workout
                          plans
                        </ThemedText>
                      </View>
                      <View style={styles.coachHeroBadge}>
                        <ThemedText
                          type="smallBold"
                          style={styles.coachHeroBadgeText}
                        >
                          💬 Ask
                        </ThemedText>
                      </View>
                    </Pressable>

                    <View style={styles.section}>
                      <ThemedText type="smallBold" style={styles.sectionTitle}>
                        SUGGESTED CHECK-INS
                      </ThemedText>
                      <View style={styles.actionGrid}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Suggest a workout routine"
                          onPress={() =>
                            sendPrompt(
                              "Help me design a specialized workout routine to build a V-shape body",
                            )
                          }
                          style={({ pressed }) => [
                            styles.actionCard,
                            pressed && styles.pressed,
                          ]}
                        >
                          <View style={styles.actionIconContainer}>
                            <ThemedText style={styles.actionIcon}>
                              🏋️
                            </ThemedText>
                          </View>
                          <View style={styles.actionBody}>
                            <ThemedText type="smallBold">
                              Workout Routine
                            </ThemedText>
                            <ThemedText type="small" themeColor="textSecondary">
                              Design specialized exercise plan
                            </ThemedText>
                          </View>
                          <ThemedText style={styles.actionArrow}>→</ThemedText>
                        </Pressable>

                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Review nutrition targets"
                          onPress={() =>
                            sendPrompt(
                              "How much protein should I eat today and what foods work best?",
                            )
                          }
                          style={({ pressed }) => [
                            styles.actionCard,
                            pressed && styles.pressed,
                          ]}
                        >
                          <View style={styles.actionIconContainer}>
                            <ThemedText style={styles.actionIcon}>
                              🥗
                            </ThemedText>
                          </View>
                          <View style={styles.actionBody}>
                            <ThemedText type="smallBold">
                              Nutrition &amp; Macros
                            </ThemedText>
                            <ThemedText type="small" themeColor="textSecondary">
                              Protein goals &amp; meal ideas
                            </ThemedText>
                          </View>
                          <ThemedText style={styles.actionArrow}>→</ThemedText>
                        </Pressable>

                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Explain weight trend"
                          onPress={() =>
                            sendPrompt(
                              "Explain my latest weight trend and calorie balance",
                            )
                          }
                          style={({ pressed }) => [
                            styles.actionCard,
                            pressed && styles.pressed,
                          ]}
                        >
                          <View style={styles.actionIconContainer}>
                            <ThemedText style={styles.actionIcon}>
                              📈
                            </ThemedText>
                          </View>
                          <View style={styles.actionBody}>
                            <ThemedText type="smallBold">
                              Progress &amp; Trends
                            </ThemedText>
                            <ThemedText type="small" themeColor="textSecondary">
                              Analyze weight &amp; calorie trend
                            </ThemedText>
                          </View>
                          <ThemedText style={styles.actionArrow}>→</ThemedText>
                        </Pressable>

                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Suggest a quick gym session"
                          onPress={() =>
                            sendPrompt(
                              "Suggest a 45-minute full body gym session",
                            )
                          }
                          style={({ pressed }) => [
                            styles.actionCard,
                            pressed && styles.pressed,
                          ]}
                        >
                          <View style={styles.actionIconContainer}>
                            <ThemedText style={styles.actionIcon}>
                              ⚡
                            </ThemedText>
                          </View>
                          <View style={styles.actionBody}>
                            <ThemedText type="smallBold">
                              Quick Session
                            </ThemedText>
                            <ThemedText type="small" themeColor="textSecondary">
                              45-minute full body workout
                            </ThemedText>
                          </View>
                          <ThemedText style={styles.actionArrow}>→</ThemedText>
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
                    style={[styles.capsuleInput, { color: theme.text }]}
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

      <AiConsentModal
        visible={aiConsentModalVisible}
        onConsent={() => void handleAiConsent()}
        onDecline={handleAiDecline}
      />
    </ThemedView>
  );
}

function FormattedCoachMessage({ text }: { readonly text: string }) {
  const lines = useMemo(() => text.split("\n"), [text]);

  return (
    <View style={styles.formattedMessageContainer}>
      {lines.map((line, lineIndex) => {
        const trimmed = line.trim();
        if (trimmed.length === 0) {
          return <View key={`blank-${lineIndex}`} style={{ height: 4 }} />;
        }

        // Horizontal Rule
        if (trimmed === "---" || trimmed === "***" || trimmed === "___") {
          return <View key={`hr-${lineIndex}`} style={styles.messageDivider} />;
        }

        // Headers: ###, ##, #
        const headerMatch = trimmed.match(/^(#{1,3})\s+(.*)$/);
        if (headerMatch) {
          const headerText = headerMatch[2] ?? "";
          return (
            <View
              key={`header-${lineIndex}`}
              style={styles.messageHeaderContainer}
            >
              <ThemedText type="smallBold" style={styles.messageHeaderText}>
                {headerText}
              </ThemedText>
            </View>
          );
        }

        // Bullet lists: * or - or •
        const bulletMatch = trimmed.match(/^[\*\-•]\s+(.*)$/);
        if (bulletMatch) {
          const bulletContent = bulletMatch[1] ?? "";
          return (
            <View key={`bullet-${lineIndex}`} style={styles.messageBulletRow}>
              <ThemedText style={styles.messageBulletDot}>•</ThemedText>
              <View style={styles.messageBulletContent}>
                {renderInlineMarkdown(bulletContent, `bullet-${lineIndex}`)}
              </View>
            </View>
          );
        }

        // Numbered lists: 1. 2. etc
        const numberedMatch = trimmed.match(/^(\d+[\.\)])\s+(.*)$/);
        if (numberedMatch) {
          const num = numberedMatch[1] ?? "";
          const content = numberedMatch[2] ?? "";
          return (
            <View key={`num-${lineIndex}`} style={styles.messageBulletRow}>
              <ThemedText type="smallBold" style={styles.messageNumberDot}>
                {num}
              </ThemedText>
              <View style={styles.messageBulletContent}>
                {renderInlineMarkdown(content, `num-${lineIndex}`)}
              </View>
            </View>
          );
        }

        // Normal paragraph
        return (
          <View key={`p-${lineIndex}`} style={styles.messageParagraph}>
            {renderInlineMarkdown(trimmed, `p-${lineIndex}`)}
          </View>
        );
      })}
    </View>
  );
}

function renderInlineMarkdown(text: string, keyPrefix: string) {
  const parts = text.split(/\*\*/g);
  if (parts.length === 1) {
    return <ThemedText style={styles.messageText}>{text}</ThemedText>;
  }

  return (
    <ThemedText style={styles.messageText}>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <ThemedText
            key={`${keyPrefix}-bold-${i}`}
            type="smallBold"
            style={styles.messageBoldText}
          >
            {part}
          </ThemedText>
        ) : (
          <ThemedText key={`${keyPrefix}-text-${i}`}>{part}</ThemedText>
        ),
      )}
    </ThemedText>
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
      <View style={styles.bubbleHeaderRow}>
        {assistant ? (
          <View style={styles.coachAvatarBadge}>
            <ThemedText style={styles.coachAvatarEmoji}>🤖</ThemedText>
          </View>
        ) : null}
        <ThemedText
          type="smallBold"
          style={assistant ? styles.coachNameText : styles.userNameText}
        >
          {assistant ? "Mizyun Coach" : "You"}
        </ThemedText>
      </View>
      {displayText.trim().length > 0 ? (
        assistant ? (
          <FormattedCoachMessage text={displayText} />
        ) : (
          <ThemedText style={styles.userMessageText}>{displayText}</ThemedText>
        )
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
              <ThemedText type="smallBold" style={{ color: "#FFFFFF" }}>
                Retry
              </ThemedText>
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
    draft.proteinG === null ? null : `${draft.proteinG}g P`,
    draft.carbohydrateG === null ? null : `${draft.carbohydrateG}g C`,
    draft.fatG === null ? null : `${draft.fatG}g F`,
  ]
    .filter((value): value is string => value !== null)
    .join(" · ");
  return (
    <View style={styles.proposalCard}>
      <View style={styles.proposalHeaderRow}>
        <View style={styles.proposalIconBox}>
          <ThemedText style={styles.proposalIcon}>🥗</ThemedText>
        </View>
        <View style={styles.proposalTitleBox}>
          <ThemedText type="smallBold">
            {draft.name ?? "Meal Estimate"}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Photo/text draft · tap to confirm
          </ThemedText>
        </View>
        <View style={styles.proposalBadge}>
          <ThemedText type="smallBold" style={styles.proposalBadgeText}>
            ＋ LOG
          </ThemedText>
        </View>
      </View>

      <View style={styles.proposalMetricBox}>
        <ThemedText type="smallBold">
          {point || "Nutrition values need review"}
        </ThemedText>
        {draft.calorieRangeKcal !== null ? (
          <ThemedText type="small" themeColor="textSecondary">
            Estimated range {draft.calorieRangeKcal.low}–
            {draft.calorieRangeKcal.high} kcal · confidence{" "}
            {Math.round(draft.confidence * 100)}%
          </ThemedText>
        ) : null}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Review and log ${draft.name ?? "meal"} draft`}
        accessibilityHint="Opens an editable meal form. Nothing is logged until you save it."
        onPress={() => onReview(proposal)}
        style={({ pressed }) => [
          styles.proposalButton,
          pressed && styles.pressed,
        ]}
      >
        <ThemedText type="smallBold" style={styles.proposalButtonText}>
          Review &amp; log meal
        </ThemedText>
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
  const [saving, setSaving] = useState(false);
  const [savedWorkout, setSavedWorkout] = useState<Workout | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSaveToRoutines = useCallback(async () => {
    if (saving || savedWorkout !== null) return;
    setSaving(true);
    setSaveError(null);
    try {
      const plannedExercises: PlannedExerciseItem[] =
        proposal.session.exercises.map((e) => ({
          name: e.name,
          catalogId: e.catalogId,
          movementPattern: e.movementPattern,
          targetSets: e.sets,
          targetReps:
            e.repsMin !== null && e.repsMax !== null
              ? `${e.repsMin}–${e.repsMax}`
              : e.durationMinutes
                ? `${e.durationMinutes} min`
                : "8–12",
          restSeconds: e.restSeconds,
        }));

      const result = await createCustomWorkout({
        name: proposal.session.label,
        notes: `Coach plan · ${proposal.volumeAction} volume · ~${proposal.session.estimatedMinutes} min`,
        plannedExercises,
      });

      if (result.ok && result.workout) {
        setSavedWorkout(result.workout);
      } else if (!result.ok) {
        setSaveError(result.message);
      }
    } catch (cause) {
      setSaveError(
        cause instanceof Error
          ? cause.message
          : "Could not save routine. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }, [proposal, savedWorkout, saving]);

  const onOpenSaved = useCallback(() => {
    if (savedWorkout) {
      router.push(`/log-workout?workoutId=${savedWorkout.id}` as Href);
    }
  }, [savedWorkout]);

  return (
    <View style={styles.proposalCard}>
      <View style={styles.proposalHeaderRow}>
        <View style={styles.proposalIconBox}>
          <ThemedText style={styles.proposalIcon}>🏋️</ThemedText>
        </View>
        <View style={styles.proposalTitleBox}>
          <ThemedText type="smallBold">{proposal.session.label}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            ~{proposal.session.estimatedMinutes} min · {proposal.volumeAction}{" "}
            volume
          </ThemedText>
        </View>
        <View style={styles.proposalBadge}>
          <ThemedText type="smallBold" style={styles.proposalBadgeText}>
            {savedWorkout !== null ? "✓ SAVED" : "＋ ROUTINE"}
          </ThemedText>
        </View>
      </View>

      <View style={styles.proposalListContainer}>
        {proposal.session.exercises.map((exercise) => (
          <ThemedText key={exercise.catalogId} type="small">
            • {exercise.name} · {exercise.sets}×
            {exercise.repsMin === null
              ? `${exercise.durationMinutes} min`
              : `${exercise.repsMin}–${exercise.repsMax}`}{" "}
            · {exercise.restSeconds}s rest
          </ThemedText>
        ))}
      </View>

      {saveError !== null ? (
        <ThemedText
          type="small"
          themeColor="textSecondary"
          accessibilityRole="alert"
          style={styles.proposalErrorText}
        >
          {saveError}
        </ThemedText>
      ) : null}

      {savedWorkout !== null ? (
        <View style={{ gap: Spacing.one }}>
          <ThemedText type="smallBold" style={{ color: "#10B981" }}>
            ✓ Added to your workout routines
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Start ${proposal.session.label}`}
            onPress={onOpenSaved}
            style={({ pressed }) => [
              styles.proposalButton,
              pressed && styles.pressed,
            ]}
          >
            <ThemedText type="smallBold" style={styles.proposalButtonText}>
              Start Workout Now →
            </ThemedText>
          </Pressable>
        </View>
      ) : (
        <View style={{ gap: Spacing.two, marginTop: Spacing.one }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Save ${proposal.session.label} to my routines`}
            disabled={saving}
            onPress={() => void handleSaveToRoutines()}
            style={({ pressed }) => [
              styles.proposalButton,
              pressed && styles.pressed,
              saving && { opacity: 0.6 },
            ]}
          >
            <ThemedText type="smallBold" style={styles.proposalButtonText}>
              {saving ? "Saving to Routines…" : "💾 Save to My Routines"}
            </ThemedText>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Review and start ${proposal.session.label}`}
            accessibilityHint="Opens the live workout tracker directly."
            onPress={() => onReview(proposal)}
            style={({ pressed }) => [
              styles.proposalSecondaryButton,
              pressed && styles.pressed,
            ]}
          >
            <ThemedText
              type="smallBold"
              style={styles.proposalSecondaryButtonText}
            >
              ⚡ Start Live Session Directly
            </ThemedText>
          </Pressable>
        </View>
      )}
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
      <View style={styles.proposalHeaderRow}>
        <View style={styles.proposalIconBox}>
          <ThemedText style={styles.proposalIcon}>🏋️</ThemedText>
        </View>
        <View style={styles.proposalTitleBox}>
          <ThemedText type="smallBold">
            {proposal.requestedSessions}-Session Workout Plan
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {humanFocusLabel(proposal.focus) ?? "Specialized Plan"} ·{" "}
            {proposal.sessionMinutes} min each
          </ThemedText>
        </View>
      </View>

      <ThemedText type="small" themeColor="textSecondary">
        {proposal.rationale}
      </ThemedText>

      {proposal.sessions.map((session) => {
        const saved = savedByIndex.get(session.index);
        const isSaved = saved?.result.ok === true;
        const isFailed = saved !== undefined && !saved.result.ok;
        const sessionFocusLabel = humanFocusLabel(session.focus);
        const isDuplicateLabel =
          sessionFocusLabel !== null &&
          sessionFocusLabel.toLowerCase().trim() ===
            session.label.toLowerCase().trim();
        return (
          <View
            key={session.index}
            style={styles.multiWorkoutRow}
            accessibilityLabel={`Routine ${session.index}: ${session.label}${sessionFocusLabel === null || isDuplicateLabel ? "" : `, ${sessionFocusLabel}`}, ${session.estimatedMinutes} minutes, ${session.exercises.length} exercises`}
          >
            <View style={{ flex: 1, gap: Spacing.half }}>
              <ThemedText type="smallBold">
                Routine {session.index} · {session.label}
                {sessionFocusLabel === null || isDuplicateLabel
                  ? ""
                  : ` · ${sessionFocusLabel}`}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                ~{session.estimatedMinutes} min · {session.exercises.length}{" "}
                exercises
              </ThemedText>
              {session.exercises.map((exercise) => (
                <ThemedText
                  key={`${session.index}-${exercise.catalogId}`}
                  type="small"
                  themeColor="textSecondary"
                >
                  • {exercise.name} · {exercise.sets}×
                  {exercise.repsMin === null
                    ? `${exercise.durationMinutes} min`
                    : `${exercise.repsMin}–${exercise.repsMax}`}
                </ThemedText>
              ))}
              {isSaved ? (
                <ThemedText type="smallBold" style={{ color: "#10B981" }}>
                  ✓ Saved to workouts
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
                accessibilityLabel={`Open ${session.label}`}
                onPress={() =>
                  saved.result.ok && onOpenWorkout(saved.result.workout.id)
                }
                style={({ pressed }) => [
                  styles.multiWorkoutOpenButton,
                  pressed && styles.pressed,
                ]}
              >
                <ThemedText type="smallBold" style={{ color: "#10B981" }}>
                  Open →
                </ThemedText>
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
          style={({ pressed }) => [
            styles.proposalButton,
            pressed && styles.pressed,
          ]}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <ThemedText type="smallBold" style={styles.proposalButtonText}>
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
          style={({ pressed }) => [
            styles.proposalButton,
            pressed && styles.pressed,
          ]}
        >
          <ThemedText type="smallBold" style={styles.proposalButtonText}>
            Open first session
          </ThemedText>
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
      <View style={styles.proposalHeaderRow}>
        <View style={styles.proposalIconBox}>
          <ThemedText style={styles.proposalIcon}>⚡</ThemedText>
        </View>
        <View style={styles.proposalTitleBox}>
          <ThemedText type="smallBold">Daily Action Plan</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {proposal.date}
          </ThemedText>
        </View>
        <View style={styles.proposalBadge}>
          <ThemedText type="smallBold" style={styles.proposalBadgeText}>
            TODAY
          </ThemedText>
        </View>
      </View>

      <View style={styles.proposalMetricBox}>
        {proposal.calorie === null ? null : (
          <ThemedText type="small">
            🥗 Calories:{" "}
            {proposal.calorie.consumedKcal === null
              ? "not logged"
              : `${proposal.calorie.consumedKcal} / ${proposal.calorie.targetKcal} kcal (${proposal.calorie.remainingKcal} left)`}
          </ThemedText>
        )}
        {proposal.protein === null ? null : (
          <ThemedText type="small">
            🥩 Protein:{" "}
            {proposal.protein.consumedG === null
              ? "not logged"
              : `${proposal.protein.consumedG}g / ${proposal.protein.targetG}g target (${proposal.protein.remainingG}g left)`}
          </ThemedText>
        )}
        {proposal.training === null ? null : (
          <ThemedText type="small">
            🏋️ Training:{" "}
            {proposal.training.completedToday
              ? "completed today"
              : proposal.training.due
                ? "due today"
                : "base frequency on track"}
          </ThemedText>
        )}
      </View>

      <View
        style={{
          padding: Spacing.two,
          borderRadius: 10,
          backgroundColor: "rgba(16, 185, 129, 0.12)",
          gap: 2,
        }}
      >
        <ThemedText type="smallBold" style={{ color: "#10B981" }}>
          Next Focus
        </ThemedText>
        <ThemedText type="small">
          {nextActionLabel[proposal.nextAction]}
        </ThemedText>
      </View>

      {proposal.missingInputs.length > 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          Missing inputs: {proposal.missingInputs.join(", ")}
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

  const obs = proposal.observations;
  const nutritionSummary =
    obs.averageCaloriesKcal !== null &&
    obs.targetKcal !== null &&
    obs.averageCaloriesKcal !== undefined &&
    obs.targetKcal !== undefined
      ? `${obs.loggedNutritionDays}/7 days · Avg ${obs.averageCaloriesKcal} / ${obs.targetKcal} kcal (${obs.averageCalorieAdherencePercent ?? "—"}%)`
      : `${obs.loggedNutritionDays}/7 days logged · ${obs.averageCalorieAdherencePercent ?? "—"}% calories`;

  const proteinSummary =
    obs.averageProteinG !== null &&
    obs.targetProteinG !== null &&
    obs.averageProteinG !== undefined &&
    obs.targetProteinG !== undefined
      ? `Avg ${obs.averageProteinG}g / ${obs.targetProteinG}g target (${obs.averageProteinAdherencePercent ?? "—"}%)`
      : `${obs.averageProteinAdherencePercent ?? "—"}% protein adherence`;

  const trainingSummary =
    obs.completedWorkoutsCount !== null &&
    obs.completedWorkoutsCount !== undefined
      ? `${obs.completedWorkoutsCount} workouts completed · ${proposal.trainingVolumeAction} volume`
      : `${proposal.trainingVolumeAction} volume`;

  const weightSummary =
    obs.weeklyWeightChangeKg !== null
      ? `${obs.smoothedWeightKg ? `${obs.smoothedWeightKg} kg smoothed · ` : ""}${obs.weeklyWeightChangeKg > 0 ? "+" : ""}${obs.weeklyWeightChangeKg} kg/week`
      : obs.smoothedWeightKg
        ? `${obs.smoothedWeightKg} kg smoothed · Need 3+ weigh-ins for rate`
        : "Pending weight data";

  const actionBadgeColor =
    proposal.calorieAction === "hold"
      ? "rgba(16, 185, 129, 0.2)"
      : proposal.calorieAction === "increase"
        ? "rgba(59, 130, 246, 0.2)"
        : "rgba(245, 158, 11, 0.2)";

  return (
    <View style={styles.proposalCard}>
      {/* Header with Title & Action Badge */}
      <View style={styles.proposalHeaderRow}>
        <View style={styles.proposalIconBox}>
          <ThemedText style={styles.proposalIcon}>📊</ThemedText>
        </View>
        <View style={styles.proposalTitleBox}>
          <ThemedText type="smallBold">
            Weekly Review &amp; Adaptation
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            7-day confirmed adherence scorecard
          </ThemedText>
        </View>
        <View
          style={{
            backgroundColor: actionBadgeColor,
            paddingHorizontal: 8,
            paddingVertical: 3,
            borderRadius: 6,
          }}
        >
          <ThemedText type="smallBold">
            {proposal.calorieAction.toUpperCase()}
          </ThemedText>
        </View>
      </View>

      {/* Goal Pace Status */}
      <ThemedText type="small">
        Goal Pace · {proposal.currentPace ?? "steady"}
        {canApply ? ` → ${proposal.proposedPace}` : " (maintained)"}
      </ThemedText>

      {/* Metric Breakdown Rows */}
      <View style={styles.proposalMetricBox}>
        <ThemedText type="small">🥗 Nutrition: {nutritionSummary}</ThemedText>
        <ThemedText type="small">🥩 Protein: {proteinSummary}</ThemedText>
        <ThemedText type="small">🏋️ Training: {trainingSummary}</ThemedText>
        <ThemedText type="small">⚖️ Weight Trend: {weightSummary}</ThemedText>
      </View>

      {/* Rationale & Reasons */}
      {proposal.reasons.map((reason) => (
        <ThemedText key={reason} type="small" themeColor="textSecondary">
          • {reason}
        </ThemedText>
      ))}

      {/* Action button */}
      {canApply ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Accept goal pace change from ${proposal.currentPace} to ${proposal.proposedPace}`}
          accessibilityHint="Updates the active goal and recalculates future deterministic calorie targets."
          onPress={() => onAccept(proposal)}
          style={({ pressed }) => [
            styles.proposalButton,
            pressed && styles.pressed,
          ]}
        >
          <ThemedText type="smallBold" style={styles.proposalButtonText}>
            Accept pace change
          </ThemedText>
        </Pressable>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          {proposal.readiness === "ready"
            ? "Current pace is on track. No changes needed."
            : "No goal change available. Continue logging next week."}
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
      <View style={styles.proposalHeaderRow}>
        <View style={styles.proposalIconBox}>
          <ThemedText style={styles.proposalIcon}>✏️</ThemedText>
        </View>
        <View style={styles.proposalTitleBox}>
          <ThemedText type="smallBold">
            Workout Changes · {proposal.targetName}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {proposal.summary}
          </ThemedText>
        </View>
      </View>

      <View style={styles.proposalListContainer}>
        {proposal.exercises.map((exercise) => (
          <ThemedText
            key={exercise.catalogId}
            type="small"
            themeColor="textSecondary"
          >
            • {exercise.name} · {exercise.sets}×
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
            pressed && styles.pressed,
          ]}
        >
          <ThemedText type="smallBold" style={styles.proposalButtonText}>
            {applying ? "Applying…" : "Apply changes to workout"}
          </ThemedText>
        </Pressable>
      ) : (
        <View style={{ gap: Spacing.one }}>
          <ThemedText type="smallBold" style={{ color: "#10B981" }}>
            ✓ Changes applied to workout
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${proposal.targetName}`}
            onPress={onOpen}
            style={({ pressed }) => [
              styles.proposalButton,
              pressed && styles.pressed,
            ]}
          >
            <ThemedText type="smallBold" style={styles.proposalButtonText}>
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
  header: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
    gap: Spacing.one,
  },
  headerTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.two,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  topBarThreadPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(148, 163, 184, 0.08)",
    paddingHorizontal: Spacing.three,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.18)",
    maxWidth: "60%",
  },
  navChatIcon: { fontSize: 13 },
  navThreadTitle: { fontSize: 13 },
  navChevron: { fontSize: 11, marginLeft: 2 },
  navActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  navIconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(148, 163, 184, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  navIconButtonActive: {
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    borderColor: "#10B981",
  },
  navIconText: { fontSize: 14 },
  navIconTextActive: { color: "#10B981" },
  advisoryCloseButton: {
    padding: 4,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  advisoryCardWrapper: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.two,
  },
  advisoryCard: {
    borderRadius: 16,
    padding: Spacing.three,
    gap: Spacing.three,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.18)",
  },
  advisoryCardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.two,
  },
  advisoryIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "rgba(16, 185, 129, 0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  advisoryIcon: { fontSize: 16 },
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
    paddingTop: Spacing.two,
    gap: Spacing.three,
    paddingBottom: 16,
  },
  emptyStateContainer: {
    flex: 1,
    gap: Spacing.four,
    paddingVertical: Spacing.two,
  },
  coachHeroCard: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.2)",
    backgroundColor: "rgba(16, 185, 129, 0.05)",
  },
  coachHeroIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  coachHeroIcon: {
    fontSize: 20,
  },
  coachHeroBody: {
    flex: 1,
    gap: 2,
  },
  coachHeroBadge: {
    backgroundColor: "#10B981",
    paddingHorizontal: Spacing.three,
    paddingVertical: 7,
    borderRadius: 10,
  },
  coachHeroBadgeText: {
    color: "#ffffff",
    fontSize: 12,
  },
  section: { gap: Spacing.two },
  sectionTitle: {
    letterSpacing: 0.8,
    fontSize: 11,
    color: "#64748B",
  },
  actionGrid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  actionCard: {
    minWidth: "47%",
    flexGrow: 1,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.18)",
    borderRadius: 16,
    padding: Spacing.three,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    backgroundColor: "rgba(148, 163, 184, 0.05)",
  },
  actionIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "rgba(16, 185, 129, 0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  actionIcon: { fontSize: 18 },
  actionBody: { flex: 1, gap: 2 },
  actionArrow: {
    color: "#10B981",
    fontSize: 16,
    fontWeight: "700",
  },
  bubble: {
    maxWidth: "96%",
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderRadius: 18,
    gap: Spacing.two,
  },
  userBubble: {
    alignSelf: "flex-end",
    maxWidth: "82%",
    backgroundColor: "rgba(16, 185, 129, 0.18)",
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.35)",
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    alignSelf: "stretch",
    width: "100%",
    maxWidth: "100%",
    backgroundColor: "rgba(148, 163, 184, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.15)",
    borderBottomLeftRadius: 4,
  },
  bubbleHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  coachAvatarBadge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  coachAvatarEmoji: { fontSize: 10 },
  coachNameText: { color: "#10B981" },
  userNameText: {},
  bubbleMessageText: { lineHeight: 22 },
  formattedMessageContainer: {
    gap: 6,
  },
  messageParagraph: {},
  messageText: {
    fontSize: 15,
    lineHeight: 22,
  },
  messageBoldText: {
    fontWeight: "700",
    color: "#FFFFFF",
  },
  messageHeaderContainer: {
    marginTop: 8,
    marginBottom: 2,
  },
  messageHeaderText: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "700",
    color: "#10B981",
  },
  messageBulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  messageBulletDot: {
    fontSize: 14,
    lineHeight: 22,
    color: "#10B981",
  },
  messageNumberDot: {
    fontSize: 14,
    lineHeight: 22,
    color: "#10B981",
    minWidth: 16,
  },
  messageBulletContent: {
    flex: 1,
  },
  messageDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(148, 163, 184, 0.2)",
    marginVertical: 8,
  },
  userMessageText: {
    fontSize: 15,
    lineHeight: 22,
  },
  proposalCard: {
    marginTop: Spacing.two,
    padding: Spacing.three,
    gap: Spacing.two,
    borderRadius: 16,
    backgroundColor: "rgba(16, 185, 129, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.22)",
  },
  proposalHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.two,
  },
  proposalIconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  proposalIcon: { fontSize: 16 },
  proposalTitleBox: { flex: 1, gap: 1 },
  proposalBadge: {
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  proposalBadgeText: { fontSize: 11, color: "#10B981" },
  proposalMetricBox: {
    backgroundColor: "rgba(0, 0, 0, 0.15)",
    padding: Spacing.two,
    borderRadius: 10,
    gap: 4,
  },
  proposalListContainer: { gap: Spacing.half },
  proposalButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: "#10B981",
    paddingHorizontal: Spacing.three,
  },
  proposalButtonText: { color: "#FFFFFF" },
  proposalSecondaryButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.4)",
    backgroundColor: "rgba(16, 185, 129, 0.08)",
    paddingHorizontal: Spacing.three,
  },
  proposalSecondaryButtonText: {
    color: "#10B981",
    fontSize: 14,
  },
  proposalErrorText: {
    color: "#E8A230",
    fontSize: 13,
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
    minHeight: 40,
    minWidth: 80,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
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
    backgroundColor: "rgba(148, 163, 184, 0.08)",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.2)",
    paddingLeft: 8,
    paddingRight: 8,
    paddingVertical: 6,
    gap: 6,
  },
  photoIconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(16, 185, 129, 0.12)",
  },
  composerIconEmoji: { fontSize: 18 },
  capsuleInput: {
    flex: 1,
    minHeight: 38,
    maxHeight: 120,
    paddingHorizontal: Spacing.two,
    paddingTop: 8,
    paddingBottom: 8,
    fontSize: 16,
    lineHeight: 20,
  },
  circleSendButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#10B981",
    alignItems: "center",
    justifyContent: "center",
  },
  disabledSendButton: {
    backgroundColor: "rgba(148, 163, 184, 0.2)",
  },
  sendArrow: {
    fontSize: 18,
    fontWeight: "700",
    color: "#FFFFFF",
    lineHeight: 20,
    textAlign: "center",
  },
  multiWorkoutRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(148, 163, 184, 0.15)",
  },
  multiWorkoutOpenButton: {
    borderWidth: 1,
    borderColor: "#10B981",
    borderRadius: 10,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(16, 185, 129, 0.15)",
  },
  pressed: { opacity: 0.7, transform: [{ scale: 0.98 }] },
});
