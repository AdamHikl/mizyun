import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, type Href, useLocalSearchParams } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import type { ApiClient } from "@mizyun/api-client";
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

import { ThemedText, type ThemedTextProps } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { coachMessagesLeftLabel } from "@/lib/ai-allowance";
import {
  Button,
  Card,
  Chip,
  Icon,
  IconBadge,
  IconButton,
  ListGroup,
  ListRow,
  SectionHeader,
  type IconName,
} from "@/components/ui";
import { TabHeader, useTabHeaderLayout } from "@/components/tab-header";
import {
  BottomTabInset,
  MaxContentWidth,
  MinTouchTarget,
  PageGutter,
  Radius,
  Spacing,
} from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { announce, useAnnouncement } from "@/lib/announce";

import {
  clearLoggingDraft,
  loadLoggingDraft,
  saveLoggingDraft,
} from "@/features/logging-draft-storage";
import { useAuth } from "@/features/auth/auth-context";
import { mealFormStringsFromDraft } from "@/features/log-meal/meal-form";
import { fetchAdvancedNutritionCapability } from "@/features/log-meal/advanced-nutrition";
import { normalizeMealPhoto } from "@/features/log-meal/meal-photo";

import { apiClient } from "@/composition/api-client";
import { subscribeSessionReadUpdates } from "@/composition/personal-read-events";
import {
  useAiConsentController,
  type PendingAiAction,
} from "./ai-consent-controller";
import { AiConsentModal } from "./ai-consent-modal";
import { EvidenceChips } from "./evidence-chips";
import {
  acceptWeeklyAdaptation,
  createCoachConversation,
  deleteCoachConversation,
  isCoachPendingDraft,
  loadCoachWith,
  loadCoachThread,
  peekCoachHistory,
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
  startRoutineSession,
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

const alertTones: Record<AlertCategory, "warning" | "info" | "danger"> = {
  rate_limited: "warning",
  unavailable: "info",
  config: "danger",
  generic: "warning",
};

const alertCategoryFromMessage = (message: string | null): AlertCategory => {
  if (message === null) return "generic";
  if (/rate limited|busy|try again in \d+/i.test(message))
    return "rate_limited";
  if (/not configured|configuration/i.test(message)) return "config";
  if (/unavailable|offline|expired/i.test(message)) return "unavailable";
  return "generic";
};

/** Composer text belongs to a user; rotating that user's token preserves it. */
function useUserOwnedCoachState<T>(
  userId: string | null,
  initial: T,
  currentUser: { current: string | null },
): [T, Dispatch<SetStateAction<T>>] {
  const [record, setRecord] = useState({ userId, value: initial });
  const setValue = useCallback(
    (next: SetStateAction<T>) => {
      if (currentUser.current !== userId) return;
      setRecord((previous) => ({
        userId,
        value:
          typeof next === "function"
            ? (next as (value: T) => T)(
                previous.userId === userId ? previous.value : initial,
              )
            : next,
      }));
    },
    [userId, initial],
  );
  return [record.userId === userId ? record.value : initial, setValue];
}

export function CoachSetupScreen() {
  const [, redrawPrefetch] = useState(0);
  useEffect(
    () =>
      subscribeSessionReadUpdates((path) => {
        if (path === "*" || path.startsWith("/v1/coach/conversations"))
          redrawPrefetch((revision) => revision + 1);
      }),
    [],
  );
  const params = useLocalSearchParams<{
    prompt?: string;
    autoSend?: string;
  }>();
  const { session, profile, refreshProfile } = useAuth();
  const theme = useTheme();
  const { headerHeight, onHeaderLayout } = useTabHeaderLayout();
  const { width, fontScale } = useWindowDimensions();
  const stackHeader = width < 360 || fontScale > 1.3;
  const userId = session?.user.id ?? null;
  const currentUser = useRef(userId);
  currentUser.current = userId;
  const operationUser = useRef(userId);
  const ownerKey = `${userId ?? ""}:${session?.accessToken ?? ""}`;
  const currentOwner = useRef(ownerKey);
  currentOwner.current = ownerKey;
  const activeConversationId = useRef<string | null>(null);
  const completedHistoryOwner = useRef<string | null>(null);
  const warmHistory =
    completedHistoryOwner.current === ownerKey
      ? null
      : peekCoachHistory(session, undefined, activeConversationId.current);
  const historyStateOwner = useRef(ownerKey);
  const historyUser = useRef(userId);
  // A same-user token rotation retires the read cache, but the history already
  // on screen still belongs to this user. Keep it visible while it revalidates;
  // readiness and generation actions are still re-checked for the new token.
  const retainRotatedHistory =
    historyStateOwner.current !== ownerKey &&
    userId !== null &&
    historyUser.current === userId &&
    warmHistory === null;
  const useWarmHistory =
    (historyStateOwner.current !== ownerKey && !retainRotatedHistory) ||
    (completedHistoryOwner.current !== ownerKey && warmHistory !== null);
  const readGeneration = useRef(0);
  const [status, setStatus] = useState<CoachProviderStatus | null>(null);
  const [storedConversations, setConversations] = useState<
    readonly CoachConversation[]
  >(() => warmHistory?.conversations ?? []);
  const conversations = useWarmHistory
    ? (warmHistory?.conversations ?? [])
    : storedConversations;
  const [storedActive, setActive] = useState<CoachConversation | null>(
    () => warmHistory?.conversation ?? null,
  );
  const active = useWarmHistory
    ? (warmHistory?.conversation ?? null)
    : storedActive;
  if (active) activeConversationId.current = active.id;
  const [storedMessages, setMessages] = useState<readonly CoachMessage[]>(
    () => warmHistory?.messages ?? [],
  );
  const messages = useWarmHistory
    ? (warmHistory?.messages ?? [])
    : storedMessages;
  const [draft, setDraft] = useUserOwnedCoachState(userId, "", currentUser);
  const [message, setMessage] = useUserOwnedCoachState<string | null>(
    userId,
    null,
    currentUser,
  );
  const [loadingState, setLoading] = useState(warmHistory === null);
  const loading = useWarmHistory ? warmHistory === null : loadingState;
  const [loadFailedState, setLoadFailed] = useState(false);
  const loadFailed = useWarmHistory ? false : loadFailedState;
  const historyOwner = useRef<string | null>(warmHistory ? ownerKey : null);
  // Owner whose completed history read was empty; a refresh keeps it loaded.
  const emptyHistoryOwner = useRef<string | null>(
    warmHistory && !warmHistory.conversation ? ownerKey : null,
  );
  const readyOwner = useRef<string | null>(null);
  const [sending, setSending] = useUserOwnedCoachState(
    userId,
    false,
    currentUser,
  );
  // Messages left today from the latest reply (ADR-0085); shown when few.
  const [messageUsage, setMessageUsage] = useUserOwnedCoachState<{
    readonly messagesRemaining: number;
    readonly resetsAt: string;
  } | null>(userId, null, currentUser);
  const messagesLeft =
    messageUsage !== null && Date.parse(messageUsage.resetsAt) > Date.now()
      ? coachMessagesLeftLabel(messageUsage)
      : null;
  const [deleting, setDeleting] = useUserOwnedCoachState(
    userId,
    false,
    currentUser,
  );
  const [pendingDraft, setPendingDraft] =
    useUserOwnedCoachState<CoachPendingDraft | null>(userId, null, currentUser);
  const [threadListVisible, setThreadListVisible] = useUserOwnedCoachState(
    userId,
    false,
    currentUser,
  );
  const [planExpanded, setPlanExpanded] = useUserOwnedCoachState(
    userId,
    false,
    currentUser,
  );
  // Per-conversation message cache. The thread-list sheet previews
  // the latest assistant text per conversation. Caching here
  // avoids re-fetching on every list open.
  const [storedMessagesByConversation, setMessagesByConversation] = useState<
    ReadonlyMap<string, readonly CoachMessage[]>
  >(
    () =>
      new Map(
        warmHistory?.conversation
          ? [[warmHistory.conversation.id, warmHistory.messages]]
          : [],
      ),
  );
  const messagesByConversation = useWarmHistory
    ? new Map(
        warmHistory?.conversation
          ? [[warmHistory.conversation.id, warmHistory.messages]]
          : [],
      )
    : storedMessagesByConversation;
  const scrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);
  const sendLock = useRef(false);
  const deleteLock = useRef(false);
  const switchLock = useRef(false);
  const refreshPending = useRef(false);
  const draftLoadGeneration = useRef(0);
  // AI-MOB-002 — flag that toggles when a new assistant message
  // arrives so the screen-reader live region announces it.
  const [liveRegionTick, setLiveRegionTick] = useState(0);
  // The live region above is Android-only; announce each new assistant
  // reply on iOS once, never a restored or re-rendered message.
  const announcedReply = useRef<string | null>(null);
  useAnnouncement(message);
  useEffect(() => {
    const latest = messages.at(-1);
    if (liveRegionTick === 0 || latest?.role !== "assistant") return;
    if (announcedReply.current === latest.id) return;
    announcedReply.current = latest.id;
    announce(`New Coach message: ${latest.text?.slice(0, 200) ?? ""}`);
  }, [liveRegionTick]);
  const [now, setNow] = useState(() => new Date());
  const lastHandledPrompt = useRef<string | null>(null);
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

  const refresh = useCallback(async () => {
    if (!userId || currentOwner.current !== ownerKey) return;
    if (sendLock.current || deleteLock.current || switchLock.current) {
      refreshPending.current = true;
      return;
    }
    refreshPending.current = false;
    const generation = ++readGeneration.current;
    const isCurrent = () =>
      generation === readGeneration.current &&
      currentOwner.current === ownerKey &&
      AppState.currentState === "active";
    const scoped: ApiClient = {
      status: () => apiClient.status(),
      request: (options) =>
        apiClient.request({ ...options, expectedUserId: userId, isCurrent }),
    };
    readyOwner.current = null;
    setStatus(null);
    setLoading(
      historyOwner.current !== ownerKey &&
        emptyHistoryOwner.current !== ownerKey,
    );
    setLoadFailed(false);
    setMessage("Checking Coach availability…");
    let historyShown = false;
    let historyError: string | null = null;
    const showHistory = async (history: readonly CoachConversation[]) => {
      if (!isCurrent()) return;
      historyShown = true;
      setConversations(history);
      const selected =
        history.find(
          (conversation) => conversation.id === activeConversationId.current,
        ) ?? history[0];
      if (selected) {
        const thread = await loadCoachThread(selected.id, scoped);
        if (!isCurrent()) return;
        if (thread.ok) {
          historyOwner.current = ownerKey;
          setActive(thread.conversation);
          setMessages(thread.messages);
          setMessagesByConversation((current) => {
            const next = new Map(current);
            next.set(thread.conversation.id, thread.messages);
            return next;
          });
        } else {
          historyError = thread.message;
          setMessage(thread.message);
          setLoadFailed(true);
          historyOwner.current = null;
          emptyHistoryOwner.current = null;
          setActive(null);
          setMessages([]);
        }
      } else {
        historyOwner.current = null;
        emptyHistoryOwner.current = ownerKey;
        activeConversationId.current = null;
        setActive(null);
        setMessages([]);
      }
      setLoading(false);
      completedHistoryOwner.current = ownerKey;
    };
    const result = await loadCoachWith(scoped, showHistory);
    if (!isCurrent()) return;
    if (!result.ok) {
      completedHistoryOwner.current = ownerKey;
      historyOwner.current = null;
      emptyHistoryOwner.current = null;
      setActive(null);
      setMessages([]);
      setConversations([]);
      setMessagesByConversation(new Map());
      setMessage(result.message);
      setLoadFailed(true);
      setLoading(false);
      return;
    }
    // Older callers/mocks may return the history without using the callback.
    if (!historyShown) await showHistory(result.conversations);
    if (!isCurrent()) return;
    setStatus(result.status);
    readyOwner.current = result.status?.ready ? ownerKey : null;
    setMessage(
      historyError ??
        result.readinessMessage ??
        (result.status && !result.status.ready ? result.status.reason : null),
    );
    setLoading(false);
  }, [ownerKey, userId]);

  useEffect(() => {
    let foreground = AppState.currentState === "active";
    if (foreground) void refresh();
    const subscription = AppState.addEventListener("change", (state) => {
      const next = state === "active";
      if (next === foreground) return;
      foreground = next;
      readGeneration.current++;
      if (foreground) void refresh();
    });
    return () => {
      readGeneration.current++;
      subscription.remove();
    };
  }, [refresh]);

  useEffect(() => {
    return subscribeSessionReadUpdates((path) => {
      if (
        path.startsWith("/v1/coach/conversations") &&
        AppState.currentState === "active"
      )
        void refresh();
    });
  }, [refresh]);

  useEffect(() => {
    if (
      refreshPending.current &&
      !sendLock.current &&
      !deleteLock.current &&
      !switchLock.current &&
      AppState.currentState === "active"
    )
      void refresh();
  }, [sending, deleting, loading, refresh]);

  useEffect(() => {
    const sameUser = historyUser.current === userId;
    const previousOwner = historyStateOwner.current;
    historyUser.current = userId;
    historyStateOwner.current = ownerKey;
    if (sameUser && userId !== null && warmHistory === null) {
      // Same-user token rotation: rebind the visible history to the new token
      // without blanking it. Readiness stays unresolved until refresh settles.
      if (historyOwner.current === previousOwner)
        historyOwner.current = ownerKey;
      if (emptyHistoryOwner.current === previousOwner)
        emptyHistoryOwner.current = ownerKey;
      completedHistoryOwner.current = null;
      readyOwner.current = null;
      setStatus(null);
      // The refresh effect for the new token runs first; it must not blank
      // history that was already shown, nor hide a read that never completed.
      setLoading(
        historyOwner.current !== ownerKey &&
          emptyHistoryOwner.current !== ownerKey,
      );
      return;
    }
    completedHistoryOwner.current = warmHistory ? ownerKey : null;
    activeConversationId.current =
      warmHistory?.conversation?.id ??
      (sameUser ? activeConversationId.current : null);
    historyOwner.current = warmHistory ? ownerKey : null;
    emptyHistoryOwner.current =
      warmHistory && !warmHistory.conversation ? ownerKey : null;
    readyOwner.current = null;
    setStatus(null);
    setConversations(warmHistory?.conversations ?? []);
    setActive(warmHistory?.conversation ?? null);
    setMessages(warmHistory?.messages ?? []);
    setMessagesByConversation(
      new Map(
        warmHistory?.conversation
          ? [[warmHistory.conversation.id, warmHistory.messages]]
          : [],
      ),
    );
    setLoading(warmHistory === null);
    setLoadFailed(false);
  }, [ownerKey]);

  useEffect(() => {
    if (operationUser.current !== userId) {
      operationUser.current = userId;
      const restart =
        sendLock.current ||
        deleteLock.current ||
        switchLock.current ||
        refreshPending.current;
      sendLock.current = false;
      deleteLock.current = false;
      switchLock.current = false;
      refreshPending.current = false;
      setSending(false);
      setDeleting(false);
      if (restart) void refresh();
    }
    setDraft("");
    setMessage(null);
    setPendingDraft(null);
    setThreadListVisible(false);
    setPlanExpanded(false);
  }, [userId]);

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

  const historyAvailable =
    historyOwner.current === ownerKey ||
    (retainRotatedHistory &&
      historyOwner.current !== null &&
      historyOwner.current === historyStateOwner.current) ||
    (useWarmHistory && warmHistory !== null);
  const historyVisible = historyAvailable && active !== null;
  const canUseCoach =
    status?.ready === true &&
    readyOwner.current === ownerKey &&
    !loading &&
    !loadFailed;

  // Opening an empty Coach page is read-only. Persist a thread only for an
  // explicit new-conversation action or the first consent-approved send.
  const beginConversation = useCallback(async () => {
    if (currentUser.current !== userId) return null;
    const result = await createCoachConversation();
    if (currentUser.current !== userId) return null;
    if (result.ok) {
      historyOwner.current = ownerKey;
      setActive(result.conversation);
      setMessages([]);
      setConversations((current) => [result.conversation, ...current]);
      setMessage(null);
    } else {
      setMessage(result.message);
    }
    return result.ok ? result.conversation : null;
  }, [ownerKey, userId]);

  const create = useCallback(async () => {
    if (
      loading ||
      loadFailed ||
      !canUseCoach ||
      currentOwner.current !== ownerKey ||
      AppState.currentState !== "active" ||
      sendLock.current ||
      deleteLock.current
    )
      return;
    sendLock.current = true;
    setLoading(true);
    try {
      await beginConversation();
    } finally {
      if (currentUser.current === userId) {
        sendLock.current = false;
        setLoading(false);
      }
    }
  }, [beginConversation, canUseCoach, loadFailed, loading, ownerKey]);

  const switchToConversation = useCallback(
    async (conversationId: string) => {
      if (
        currentUser.current !== userId ||
        active?.id === conversationId ||
        sendLock.current ||
        deleteLock.current ||
        switchLock.current
      )
        return;
      switchLock.current = true;
      const generation = ++readGeneration.current;
      const isCurrent = () =>
        generation === readGeneration.current &&
        currentOwner.current === ownerKey &&
        AppState.currentState === "active";
      const scoped: ApiClient = {
        status: () => apiClient.status(),
        request: (options) =>
          apiClient.request({
            ...options,
            expectedUserId: userId ?? undefined,
            isCurrent,
          }),
      };
      activeConversationId.current = conversationId;
      setLoading(true);
      setLoadFailed(false);
      setActive(null);
      setMessages([]);
      setMessage(null);
      try {
        const thread = await loadCoachThread(conversationId, scoped);
        if (!isCurrent()) return;
        if (thread.ok) {
          historyOwner.current = ownerKey;
          setActive(thread.conversation);
          setMessages(thread.messages);
          setMessagesByConversation((current) => {
            const next = new Map(current);
            next.set(thread.conversation.id, thread.messages);
            return next;
          });
        } else {
          setMessage(thread.message);
          setLoadFailed(true);
        }
      } finally {
        if (currentUser.current === userId) {
          switchLock.current = false;
          setLoading(false);
        }
      }
    },
    [active?.id, ownerKey, userId],
  );

  const sendInternal = useCallback(
    async (retryIdempotencyKey?: string, textOverride?: string) => {
      const text = (textOverride ?? draft).trim();
      if (
        loading ||
        loadFailed ||
        !canUseCoach ||
        currentOwner.current !== ownerKey ||
        AppState.currentState !== "active" ||
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
      try {
        const conversation = active ?? (await beginConversation());
        if (currentUser.current !== userId) return;
        if (conversation === null) {
          setDraft(text);
          return;
        }
        const retryBubbleId =
          retryIdempotencyKey !== undefined
            ? optimisticCoachMessageId(retryIdempotencyKey)
            : undefined;
        const idempotencyKey =
          retryIdempotencyKey ?? newCoachMessageIdempotencyKey();
        const nextPending: CoachPendingDraft = {
          conversationId: conversation.id,
          text,
          idempotencyKey,
        };
        setPendingDraft(nextPending);
        if (userId !== null) {
          await saveLoggingDraft(userId, "coach", nextPending);
        }
        if (currentUser.current !== userId) return;
        // AI-MOB-002 — clear the input but keep the user bubble on
        // screen until the assistant response lands. The optimistic
        // bubble is added to `messages` immediately so the screen
        // reader can announce it as the user has spoken.
        setDraft("");
        setMessage(null);
        const userBubble: CoachMessage = {
          id: optimisticCoachMessageId(idempotencyKey),
          conversationId: conversation.id,
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
        const result = await sendCoachMessage(
          conversation.id,
          text,
          idempotencyKey,
        );
        if (currentUser.current !== userId) return;
        if (result.ok) {
          setActive(result.conversation);
          if (result.usage !== undefined) setMessageUsage(result.usage);
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
          // The refusal names the reset; an older "N left" line would conflict.
          if (result.limitReached) setMessageUsage(null);
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
        if (currentUser.current === userId) {
          sendLock.current = false;
          setSending(false);
        }
        // AI-MOB-002 — focus returns to the composer after every
        // send (success or failure) so the user can immediately
        // type the next message.
        if (currentUser.current === userId) inputRef.current?.focus();
      }
    },
    [
      active,
      beginConversation,
      canUseCoach,
      draft,
      loadFailed,
      loading,
      ownerKey,
      sending,
      userId,
    ],
  );

  const pickAndSendMealPhoto = useCallback(async () => {
    if (
      loading ||
      loadFailed ||
      !canUseCoach ||
      currentOwner.current !== ownerKey ||
      AppState.currentState !== "active" ||
      sending ||
      deleting ||
      sendLock.current ||
      deleteLock.current
    ) {
      return;
    }
    sendLock.current = true;
    setSending(true);
    setMessage(null);
    const photoOwner = currentOwner.current;
    const hint = draft.trim();
    try {
      const pro = await fetchAdvancedNutritionCapability();
      if (photoOwner !== currentOwner.current) return;
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setMessage("Photo library access is required to choose a meal photo.");
        return;
      }
      const selection = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.85,
        allowsEditing: false,
        allowsMultipleSelection: pro,
        selectionLimit: pro ? 3 : 1,
        orderedSelection: pro,
      });
      if (
        photoOwner !== currentOwner.current ||
        selection.canceled ||
        !selection.assets?.length
      )
        return;
      if (selection.assets.length > (pro ? 3 : 1)) {
        setMessage("Choose up to three photos with Pro, or one with Free.");
        return;
      }
      const photos: Blob[] = [];
      for (const asset of selection.assets)
        photos.push(await normalizeMealPhoto(asset));
      if (photoOwner !== currentOwner.current) return;
      const conversation = active ?? (await beginConversation());
      if (conversation === null || photoOwner !== currentOwner.current) return;
      const result = await sendCoachMealPhoto(
        conversation.id,
        photos[0]!,
        newCoachMessageIdempotencyKey(),
        photos
          .slice(1)
          .map((photo) => ({ photo, mimeType: "image/jpeg" as const })),
        hint || undefined,
      );
      if (photoOwner !== currentOwner.current) return;
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      if (hint === draft.trim()) setDraft("");
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
      if (currentUser.current === userId) {
        sendLock.current = false;
        setSending(false);
      }
    }
  }, [
    active,
    beginConversation,
    deleting,
    draft,
    canUseCoach,
    ownerKey,
    loadFailed,
    loading,
    sending,
  ]);

  const executeAiAction = useCallback(
    async (action: PendingAiAction) => {
      if (action.kind === "coach_message") {
        await sendInternal(action.idempotencyKey, action.text);
      } else if (action.kind === "coach_photo") {
        await pickAndSendMealPhoto();
      }
    },
    [sendInternal, pickAndSendMealPhoto],
  );

  const {
    isModalVisible: aiConsentModalVisible,
    confirmConsent,
    declineConsent,
    requestAction,
    isSaving: isAiConsentSaving,
    error: aiConsentError,
  } = useAiConsentController({
    userId,
    apiClient,
    onExecuteAction: executeAiAction,
  });

  const send = useCallback(
    async (retryDraft?: CoachPendingDraft, textOverride?: string) => {
      if (
        !canUseCoach ||
        currentOwner.current !== ownerKey ||
        AppState.currentState !== "active"
      )
        return;
      const retry =
        retryDraft?.conversationId === active?.id ? retryDraft : undefined;
      const text = (retry?.text ?? textOverride ?? draft).trim();
      if (text.length === 0) return;
      await requestAction({
        kind: "coach_message",
        text,
        idempotencyKey: retry?.idempotencyKey,
      });
    },
    [active?.id, canUseCoach, draft, ownerKey, requestAction],
  );

  const attachMealPhoto = useCallback(async () => {
    if (
      !canUseCoach ||
      currentOwner.current !== ownerKey ||
      AppState.currentState !== "active"
    )
      return;
    await requestAction({ kind: "coach_photo", photoUri: "" });
  }, [canUseCoach, ownerKey, requestAction]);

  useEffect(() => {
    if (
      typeof params.prompt === "string" &&
      params.prompt.trim().length > 0 &&
      lastHandledPrompt.current !== params.prompt
    ) {
      if (params.autoSend === "true") {
        if (
          !loading &&
          !loadFailed &&
          canUseCoach &&
          !sending &&
          !sendLock.current
        ) {
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
  }, [
    canUseCoach,
    loadFailed,
    loading,
    params.autoSend,
    params.prompt,
    send,
    sending,
    status?.ready,
  ]);

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
    if (
      !active ||
      currentUser.current !== userId ||
      sendLock.current ||
      deleteLock.current
    )
      return;
    Alert.alert(
      "Delete conversation?",
      "This permanently deletes the conversation and its messages.",
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            if (currentUser.current !== userId) return;
            deleteLock.current = true;
            setDeleting(true);
            void (async () => {
              try {
                const result = await deleteCoachConversation(active.id);
                if (currentUser.current !== userId) return;
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
                if (currentUser.current !== userId) return;
                setActive(null);
                activeConversationId.current = null;
                setMessages([]);
                setConversations((current) =>
                  current.filter((item) => item.id !== active.id),
                );
              } finally {
                if (currentUser.current === userId) {
                  deleteLock.current = false;
                  setDeleting(false);
                }
              }
            })();
          },
        },
      ],
    );
  }, [active, pendingDraft, userId]);

  const reviewNutritionProposal = useCallback(
    async (proposal: CoachNutritionProposal) => {
      if (currentUser.current !== userId) return;
      if (userId === null) {
        setMessage("Your session expired. Sign in again.");
        return;
      }
      const stored = await saveLoggingDraft(userId, "meal", {
        ...mealFormStringsFromDraft(proposal.candidate),
        aiDraft: proposal.candidate,
        sourceProposalId: proposal.id,
      });
      if (currentUser.current !== userId) return;
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
      if (currentUser.current !== userId) return;
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
      if (currentUser.current !== userId) return;
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
      if (
        active === null ||
        sending ||
        deleting ||
        !canUseCoach ||
        currentOwner.current !== ownerKey ||
        AppState.currentState !== "active"
      )
        return;
      setSending(true);
      setMessage(null);
      try {
        const result = await acceptWeeklyAdaptation(active.id, proposal.id);
        if (currentUser.current !== userId) return;
        if (!result.ok) {
          setMessage(result.message);
          return;
        }
        setMessages((current) => [...current, result.value.assistantMessage]);
        setLiveRegionTick((tick) => tick + 1);
      } finally {
        if (currentUser.current === userId) setSending(false);
      }
    },
    [active, canUseCoach, deleting, ownerKey, sending, userId],
  );
  const sendPrompt = useCallback((promptText: string) => {
    setDraft(promptText);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, []);

  const newConversationDisabled =
    loading || loadFailed || !canUseCoach || sending || deleting;
  const deleteDisabled = sending || deleting || !canUseCoach;
  const photoDisabled = sending || deleting || !canUseCoach;
  const sendDisabled =
    sending || deleting || !canUseCoach || draft.trim().length === 0;
  const showThreadSwitcher = canUseCoach || historyVisible;
  const alertTone = alertTones[alertCategoryFromMessage(message)];

  return (
    <ThemedView style={styles.page}>
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
        <TabHeader
          title="Coach"
          onLayout={onHeaderLayout}
          actions={
            <>
              <IconButton
                icon="cook"
                accessibilityLabel="What can I cook?"
                onPress={() => router.push("/meal-recipes" as Href)}
              />
              <IconButton
                icon="info"
                accessibilityLabel="Toggle training plan & advisory info"
                accessibilityState={{ expanded: planExpanded }}
                onPress={() => setPlanExpanded((expanded) => !expanded)}
                selected={planExpanded}
              />
              <IconButton
                icon="add"
                accessibilityLabel="New conversation"
                disabled={newConversationDisabled}
                accessibilityState={{ disabled: newConversationDisabled }}
                onPress={() => void create()}
                style={newConversationDisabled ? styles.disabled : undefined}
              />
            </>
          }
        >
          {showThreadSwitcher || active !== null ? (
            <View style={styles.threadRow}>
              {showThreadSwitcher ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Open thread list"
                  accessibilityValue={{
                    text: `Current conversation: ${active?.title ?? "Coach check-in"}`,
                  }}
                  onPress={() => {
                    setNow(new Date());
                    setThreadListVisible(true);
                  }}
                  style={({ pressed }) => [
                    styles.threadSwitcher,
                    pressed && styles.pressed,
                  ]}
                >
                  <Icon name="chat" size={15} color="textSecondary" />
                  <ThemedText
                    type="smallBold"
                    themeColor="textSecondary"
                    numberOfLines={stackHeader ? 2 : 1}
                    style={styles.threadTitle}
                  >
                    {active?.title ?? "Coach check-in"}
                  </ThemedText>
                  <Icon name="chevronDown" size={12} color="textSecondary" />
                </Pressable>
              ) : (
                <View style={styles.flex} />
              )}
              {active !== null ? (
                <IconButton
                  icon="trash"
                  variant="plain"
                  accessibilityLabel="Delete conversation"
                  disabled={deleteDisabled}
                  accessibilityState={{ disabled: deleteDisabled }}
                  onPress={remove}
                  style={deleteDisabled ? styles.disabled : undefined}
                />
              ) : null}
            </View>
          ) : null}

          {/* Expandable plan and advisory drawer */}
          {planExpanded ? (
            <View style={styles.advisoryWrapper}>
              <Card>
                <View style={styles.advisoryHeader}>
                  <IconBadge name="info" tone="info" />
                  <View style={styles.flexText}>
                    <ThemedText type="headline">
                      Advisory &amp; Privacy Notice
                    </ThemedText>
                    <ThemedText type="footnote" themeColor="textSecondary">
                      AI can make mistakes. Mizyun references confirmed data for
                      fitness &amp; nutrition wellness—never medical diagnosis
                      or treatment.
                    </ThemedText>
                  </View>
                  <IconButton
                    icon="close"
                    variant="plain"
                    accessibilityLabel="Close advisory panel"
                    onPress={() => setPlanExpanded(false)}
                  />
                </View>
              </Card>
              <TrainingPlanCard />
            </View>
          ) : null}
        </TabHeader>
        <KeyboardAvoidingView
          style={[styles.safeArea, { marginTop: -headerHeight }]}
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

          {(loading && !historyVisible) ||
          (historyOwner.current !== null &&
            historyOwner.current !== ownerKey &&
            !historyAvailable) ? (
            <View style={[styles.center, { paddingTop: headerHeight }]}>
              <ActivityIndicator color={theme.primary} />
              <ThemedText type="small" themeColor="textSecondary">
                Loading Coach…
              </ThemedText>
            </View>
          ) : status !== null && !status.ready && !historyVisible ? (
            <Card
              style={[
                styles.stateCard,
                { marginTop: headerHeight + Spacing.four },
              ]}
            >
              <ThemedText type="headline">Coach is safely off</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {status.reason}
              </ThemedText>
              <Button
                label="Check again"
                variant="secondary"
                onPress={() => void refresh()}
              />
            </Card>
          ) : loadFailed && !historyVisible ? (
            <Card
              style={[
                styles.stateCard,
                { marginTop: headerHeight + Spacing.four },
              ]}
            >
              <ThemedText type="headline">Couldn't load Coach</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {message}
              </ThemedText>
              <Button
                label="Check again"
                variant="secondary"
                onPress={() => void refresh()}
              />
            </Card>
          ) : (
            <>
              <ScrollView
                ref={scrollRef}
                style={styles.thread}
                contentContainerStyle={[
                  styles.threadContent,
                  { paddingTop: headerHeight + Spacing.four },
                ]}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
              >
                {messages.length === 0 ? (
                  <View style={styles.emptyState}>
                    <ThemedText type="small" themeColor="textSecondary">
                      Private fitness &amp; nutrition guidance grounded in your
                      confirmed data.
                    </ThemedText>
                    <View style={styles.section}>
                      <SectionHeader title="Suggested check-ins" />
                      <ListGroup>
                        <ListRow
                          icon="sparkles"
                          title="Ask Coach anything"
                          subtitle="Insights, meal analysis and workout plans"
                          accessibilityLabel="Ask AI Coach"
                          onPress={() => {
                            inputRef.current?.focus();
                          }}
                        />
                        <ListRow
                          icon="dumbbell"
                          title="Workout routine"
                          subtitle="Design a specialised exercise plan"
                          accessibilityLabel="Suggest a workout routine"
                          onPress={() =>
                            sendPrompt(
                              "Help me design a specialized workout routine to build a V-shape body",
                            )
                          }
                        />
                        <ListRow
                          icon="fork"
                          title="Nutrition & macros"
                          subtitle="Protein goals & meal ideas"
                          accessibilityLabel="Review nutrition targets"
                          onPress={() =>
                            sendPrompt(
                              "How much protein should I eat today and what foods work best?",
                            )
                          }
                        />
                        <ListRow
                          icon="chart"
                          title="Progress & trends"
                          subtitle="Weight & calorie trend"
                          accessibilityLabel="Explain weight trend"
                          onPress={() =>
                            sendPrompt(
                              "Explain my latest weight trend and calorie balance",
                            )
                          }
                        />
                        <ListRow
                          icon="run"
                          title="Quick session"
                          subtitle="45-minute full body workout"
                          accessibilityLabel="Suggest a quick gym session"
                          onPress={() =>
                            sendPrompt(
                              "Suggest a 45-minute full body gym session",
                            )
                          }
                        />
                      </ListGroup>
                    </View>
                  </View>
                ) : (
                  messages.map((item) => (
                    <MessageBubble
                      key={item.id}
                      message={item}
                      retrying={sending && item.id === activeRetryBubbleId}
                      actionsEnabled={canUseCoach}
                      onRetry={
                        canUseCoach &&
                        item.id === activeRetryBubbleId &&
                        activeRetry !== null
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
                    <ActivityIndicator size="small" color={theme.primary} />
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
                    { backgroundColor: theme[`${alertTone}Light`] },
                  ]}
                  accessibilityRole="alert"
                >
                  <Icon
                    name={alertTone === "info" ? "info" : "warning"}
                    size={18}
                    color={alertTone}
                  />
                  <View style={styles.alertBody}>
                    <ThemedText type="small">{message}</ThemedText>
                    {!canUseCoach && !sending ? (
                      <Button
                        label="Check again"
                        variant="plain"
                        size="small"
                        accessibilityLabel="Check Coach availability"
                        onPress={() => void refresh()}
                      />
                    ) : null}
                    {activeRetry !== null && !retryBubbleVisible ? (
                      <Button
                        label="Retry"
                        variant="plain"
                        size="small"
                        accessibilityLabel="Retry saved Coach message"
                        accessibilityState={{
                          disabled: sending || !canUseCoach,
                          busy: sending,
                        }}
                        disabled={sending || !canUseCoach}
                        onPress={() => void send(activeRetry)}
                      />
                    ) : null}
                  </View>
                </View>
              ) : activeRetry !== null && !retryBubbleVisible ? (
                <View
                  style={[
                    styles.alert,
                    { backgroundColor: theme.warningLight },
                  ]}
                  accessibilityRole="alert"
                >
                  <Icon name="warning" size={18} color="warning" />
                  <View style={styles.alertBody}>
                    <ThemedText type="small">
                      A saved message still needs to be sent.
                    </ThemedText>
                    <Button
                      label="Retry"
                      variant="plain"
                      size="small"
                      accessibilityLabel="Retry saved Coach message"
                      accessibilityState={{
                        disabled: sending || !canUseCoach,
                        busy: sending,
                      }}
                      disabled={sending || !canUseCoach}
                      onPress={() => void send(activeRetry)}
                    />
                  </View>
                </View>
              ) : null}

              {messagesLeft !== null ? (
                <ThemedText
                  type="small"
                  themeColor="textSecondary"
                  style={styles.messagesLeft}
                  accessibilityLiveRegion="polite"
                >
                  {messagesLeft}
                </ThemedText>
              ) : null}

              {/* Composer */}
              <View
                style={[
                  styles.composerWrapper,
                  isKeyboardVisible && styles.composerWrapperKeyboardActive,
                ]}
              >
                <View
                  style={[
                    styles.composerCapsule,
                    { backgroundColor: theme.backgroundSelected },
                  ]}
                >
                  <IconButton
                    icon="camera"
                    variant="plain"
                    accessibilityLabel="Attach photos"
                    accessibilityHint="Choose up to three photos with Pro, or one with Free. Type a question first for meals, menus, labels or training context."
                    accessibilityState={{ disabled: photoDisabled }}
                    disabled={photoDisabled}
                    onPress={() => void attachMealPhoto()}
                    style={[
                      styles.composerIconButton,
                      photoDisabled && styles.disabled,
                    ]}
                  />
                  <TextInput
                    ref={inputRef}
                    accessibilityLabel="Message Coach"
                    editable={!sending && !deleting}
                    multiline
                    maxLength={4_000}
                    placeholder="Message..."
                    placeholderTextColor={theme.textTertiary}
                    value={draft}
                    onChangeText={setDraft}
                    style={[styles.capsuleInput, { color: theme.text }]}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Send message"
                    accessibilityState={{
                      busy: sending,
                      disabled: sendDisabled,
                    }}
                    disabled={sendDisabled}
                    onPress={() => void send()}
                    style={styles.sendTarget}
                  >
                    <View
                      style={[
                        styles.sendCircle,
                        { backgroundColor: theme.primary },
                        sendDisabled && !sending && styles.sendCircleDisabled,
                      ]}
                    >
                      {sending ? (
                        <ActivityIndicator
                          size="small"
                          color={theme.onPrimary}
                        />
                      ) : (
                        <Icon
                          name="arrowUp"
                          size={17}
                          tintColor={theme.onPrimary}
                        />
                      )}
                    </View>
                  </Pressable>
                </View>
              </View>
            </>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>

      <ThreadListSheet
        visible={threadListVisible && (historyVisible || canUseCoach)}
        conversations={historyVisible || canUseCoach ? conversations : []}
        activeId={historyVisible ? (active?.id ?? null) : null}
        messagesByConversation={
          historyVisible || canUseCoach ? messagesByConversation : new Map()
        }
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
        isSaving={isAiConsentSaving}
        error={aiConsentError}
        currentBirthYear={profile?.birthYear ?? null}
        onConsent={async (birthYear) => {
          await confirmConsent(birthYear);
          if (birthYear !== undefined) void refreshProfile();
        }}
        onDecline={() => {
          declineConsent();
          setMessage(
            "AI Coach requires consent to third-party AI processing and adult eligibility.",
          );
        }}
      />
    </ThemedView>
  );
}

// Fabric's iOS Text selectable only offers whole-block Copy. A read-only
// UITextView (multiline TextInput) also provides native selection handles.
function SelectableCoachText({
  children,
  style,
  type,
}: Pick<ThemedTextProps, "children" | "style" | "type">) {
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  const textStyle = [
    styles.messageText,
    type === "smallBold" && styles.messageBoldText,
    style,
  ];
  const content = (
    <ThemedText type={type} style={textStyle}>
      {children}
    </ThemedText>
  );

  if (Platform.OS !== "ios") {
    return (
      <ThemedText selectable type={type} style={textStyle}>
        {children}
      </ThemedText>
    );
  }

  return (
    <TextInput
      key={fontScale}
      multiline
      editable={false}
      scrollEnabled={false}
      showSoftInputOnFocus={false}
      style={[{ color: theme.text, padding: 0 }, textStyle]}
    >
      {content}
    </TextInput>
  );
}

function FormattedCoachMessage({ text }: { readonly text: string }) {
  const lines = useMemo(() => text.split("\n"), [text]);
  const theme = useTheme();
  const markerColor = { color: theme.textSecondary };

  return (
    <View style={styles.formattedMessageContainer}>
      {lines.map((line, lineIndex) => {
        const trimmed = line.trim();
        if (trimmed.length === 0) {
          return <View key={`blank-${lineIndex}`} style={{ height: 4 }} />;
        }

        // Horizontal Rule
        if (trimmed === "---" || trimmed === "***" || trimmed === "___") {
          return (
            <View
              key={`hr-${lineIndex}`}
              style={[
                styles.messageDivider,
                { backgroundColor: theme.separator },
              ]}
            />
          );
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
              <SelectableCoachText
                type="smallBold"
                style={styles.messageHeaderText}
              >
                {headerText}
              </SelectableCoachText>
            </View>
          );
        }

        // Bullet lists: * or - or •
        const bulletMatch = trimmed.match(/^[\*\-•]\s+(.*)$/);
        if (bulletMatch) {
          const bulletContent = bulletMatch[1] ?? "";
          return (
            <View key={`bullet-${lineIndex}`} style={styles.messageBulletRow}>
              <SelectableCoachText
                style={[styles.messageBulletDot, markerColor]}
              >
                •
              </SelectableCoachText>
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
              <SelectableCoachText
                type="smallBold"
                style={[styles.messageNumberDot, markerColor]}
              >
                {num}
              </SelectableCoachText>
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
    return (
      <SelectableCoachText style={styles.messageText}>
        {text}
      </SelectableCoachText>
    );
  }

  return (
    <SelectableCoachText style={styles.messageText}>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <ThemedText
            key={`${keyPrefix}-bold-${i}`}
            type="smallBold"
            style={[styles.messageText, styles.messageBoldText]}
          >
            {part}
          </ThemedText>
        ) : (
          <ThemedText key={`${keyPrefix}-text-${i}`} style={styles.messageText}>
            {part}
          </ThemedText>
        ),
      )}
    </SelectableCoachText>
  );
}

function MessageBubble({
  message,
  retrying,
  actionsEnabled,
  onRetry,
  onReviewNutritionProposal,
  onReviewWorkoutProposal,
  onAcceptWeeklyAdaptation,
}: {
  readonly message: CoachMessage;
  readonly retrying: boolean;
  readonly actionsEnabled: boolean;
  readonly onRetry?: (() => void) | undefined;
  readonly onReviewNutritionProposal: (
    proposal: CoachNutritionProposal,
  ) => void;
  readonly onReviewWorkoutProposal: (proposal: CoachWorkoutProposal) => void;
  readonly onAcceptWeeklyAdaptation: (
    proposal: CoachWeeklyAdaptationProposal,
  ) => void;
}) {
  const theme = useTheme();
  const assistant = message.role === "assistant";
  const displayText =
    assistant && message.actionProposal
      ? cleanAssistantProposalText(message.text, message.actionProposal)
      : message.text;

  return (
    <View style={[styles.messageGroup, !assistant && styles.userGroup]}>
      <View
        style={[
          styles.bubble,
          assistant
            ? [
                styles.assistantBubble,
                { backgroundColor: theme.backgroundElement },
              ]
            : [styles.userBubble, { backgroundColor: theme.primary }],
        ]}
      >
        <View style={styles.bubbleHeaderRow}>
          {assistant ? (
            <Icon name="sparkles" size={13} color="primary" />
          ) : null}
          <ThemedText
            type="caption"
            themeColor={assistant ? "primary" : "onPrimary"}
          >
            {assistant ? "Mizyun Coach" : "You"}
          </ThemedText>
        </View>
        {displayText.trim().length > 0 ? (
          assistant ? (
            <FormattedCoachMessage text={displayText} />
          ) : (
            <ThemedText themeColor="onPrimary" style={styles.messageText}>
              {displayText}
            </ThemedText>
          )
        ) : null}
        {onRetry !== undefined ? (
          <View style={styles.failedMessageActions}>
            <ThemedText
              type="footnote"
              themeColor={assistant ? "textSecondary" : "onPrimary"}
            >
              Not completed
            </ThemedText>
            <Button
              label="Retry"
              variant="secondary"
              size="small"
              loading={retrying}
              accessibilityLabel="Retry failed Coach message"
              accessibilityState={{ disabled: retrying, busy: retrying }}
              disabled={retrying}
              onPress={onRetry}
            />
          </View>
        ) : null}
        {assistant && message.evidenceKinds.length > 0 ? (
          <EvidenceChips kinds={message.evidenceKinds} />
        ) : null}
      </View>
      {message.actionProposal?.kind === "meal_log"
        ? [
            message.actionProposal.candidate,
            ...(message.actionProposal.additionalCandidates ?? []),
          ].map((candidate, index) => (
            <NutritionProposalCard
              key={`${message.actionProposal!.id}-${index}`}
              proposal={{
                id: message.actionProposal!.id,
                kind: "meal_log",
                candidate,
              }}
              onReview={onReviewNutritionProposal}
            />
          ))
        : null}
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
          disabled={!actionsEnabled}
        />
      ) : null}
    </View>
  );
}

/** Icon badge, headline title, footnote metadata and an optional status chip. */
function ProposalHeader({
  icon,
  title,
  subtitle,
  status,
}: {
  readonly icon: IconName;
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly status?: ReactNode;
}) {
  return (
    <View style={styles.proposalHeaderRow}>
      <IconBadge name={icon} />
      <View style={styles.flexText}>
        <ThemedText type="headline">{title}</ThemedText>
        {subtitle ? (
          <ThemedText type="footnote" themeColor="textSecondary">
            {subtitle}
          </ThemedText>
        ) : null}
      </View>
      {status}
    </View>
  );
}

/** One labelled fact inside a proposal, led by a quiet icon. */
function ProposalFact({
  icon,
  children,
}: {
  readonly icon: IconName;
  readonly children: ReactNode;
}) {
  return (
    <View style={styles.factRow}>
      <Icon
        name={icon}
        size={15}
        color="textSecondary"
        style={styles.factIcon}
      />
      <ThemedText type="small" style={styles.flexText}>
        {children}
      </ThemedText>
    </View>
  );
}

/** Confirmation line shown after a proposal action succeeds. */
function ProposalDone({ label }: { readonly label: string }) {
  return (
    <View style={styles.factRow}>
      <Icon name="checkCircle" size={16} color="primary" />
      <ThemedText type="smallBold" themeColor="primary" style={styles.flexText}>
        {label}
      </ThemedText>
    </View>
  );
}

function ProposalError({ message }: { readonly message: string }) {
  return (
    <ThemedText type="footnote" themeColor="warning" accessibilityRole="alert">
      {message}
    </ThemedText>
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
    <Card>
      <ProposalHeader
        icon="fork"
        title={draft.name ?? "Meal Estimate"}
        subtitle="Photo/text draft · tap to confirm"
        status={<Chip label="Draft" />}
      />

      <ThemedView type="backgroundSelected" style={styles.proposalMetricBox}>
        <ThemedText type="smallBold">
          {point || "Nutrition values need review"}
        </ThemedText>
        {draft.calorieRangeKcal !== null ? (
          <ThemedText type="footnote" themeColor="textSecondary">
            Estimated range {draft.calorieRangeKcal.low}–
            {draft.calorieRangeKcal.high} kcal · confidence{" "}
            {Math.round(draft.confidence * 100)}%
          </ThemedText>
        ) : null}
      </ThemedView>

      <Button
        label="Review & log meal"
        block
        accessibilityLabel={`Review and log ${draft.name ?? "meal"} draft`}
        accessibilityHint="Opens an editable meal form. Nothing is logged until you save it."
        onPress={() => onReview(proposal)}
      />
    </Card>
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
  const startingRef = useRef(false);

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

  const onOpenSaved = useCallback(async () => {
    if (!savedWorkout || saving || startingRef.current) return;
    startingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await startRoutineSession(savedWorkout);
      if (result.ok && result.workout) {
        router.push(`/log-workout?workoutId=${result.workout.id}` as Href);
      } else if (!result.ok) {
        setSaveError(result.message);
      }
    } finally {
      startingRef.current = false;
      setSaving(false);
    }
  }, [savedWorkout, saving]);

  return (
    <Card>
      <ProposalHeader
        icon="dumbbell"
        title={proposal.session.label}
        subtitle={`~${proposal.session.estimatedMinutes} min · ${proposal.volumeAction} volume`}
        status={
          savedWorkout !== null ? (
            <Chip label="Saved" icon="check" tone="primary" />
          ) : undefined
        }
      />

      <View style={styles.proposalList}>
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

      {saveError !== null ? <ProposalError message={saveError} /> : null}

      {savedWorkout !== null ? (
        <View style={styles.proposalActions}>
          <ProposalDone label="Added to your workout routines" />
          <Button
            label={saving ? "Starting Session…" : "Start Workout Now"}
            block
            accessibilityLabel={`Start ${proposal.session.label}`}
            disabled={saving}
            onPress={() => void onOpenSaved()}
          />
        </View>
      ) : (
        <View style={styles.proposalActions}>
          <Button
            label={saving ? "Saving to Routines…" : "Save to My Routines"}
            block
            accessibilityLabel={`Save ${proposal.session.label} to my routines`}
            disabled={saving}
            onPress={() => void handleSaveToRoutines()}
          />
          <Button
            label="Start Live Session Directly"
            variant="tinted"
            block
            accessibilityLabel={`Review and start ${proposal.session.label}`}
            accessibilityHint="Opens the live workout tracker directly."
            onPress={() => onReview(proposal)}
          />
        </View>
      )}
    </Card>
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
  const theme = useTheme();
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<MultiWorkoutPlanSaveResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startingRef = useRef(false);

  const onSaveAll = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await saveMultiWorkoutPlan(proposal);
      setResult(saved);
      if (!saved.ok) {
        setError(
          "One or more routines could not be saved. Retry the failed ones below.",
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

  const onOpenWorkout = useCallback(
    async (workout: Workout) => {
      if (saving || startingRef.current) return;
      startingRef.current = true;
      setSaving(true);
      setError(null);
      try {
        const started = await startRoutineSession(workout);
        if (started.ok && started.workout) {
          router.push(`/log-workout?workoutId=${started.workout.id}` as Href);
        } else if (!started.ok) {
          setError(started.message);
        }
      } finally {
        startingRef.current = false;
        setSaving(false);
      }
    },
    [saving],
  );

  const onOpenFirst = useCallback(() => {
    const first = result?.saved.find((entry) => entry.result.ok);
    if (first?.result.ok) {
      void onOpenWorkout(first.result.workout);
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
    <Card>
      <ProposalHeader
        icon="calendar"
        title={`${proposal.requestedSessions}-Session Workout Plan`}
        subtitle={`${humanFocusLabel(proposal.focus) ?? "Specialized Plan"} · ${proposal.sessionMinutes} min each`}
      />

      <ThemedText type="footnote" themeColor="textSecondary">
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
            style={[
              styles.multiWorkoutRow,
              { borderTopColor: theme.separator },
            ]}
            accessibilityLabel={`Routine ${session.index}: ${session.label}${sessionFocusLabel === null || isDuplicateLabel ? "" : `, ${sessionFocusLabel}`}, ${session.estimatedMinutes} minutes, ${session.exercises.length} exercises`}
          >
            <View style={styles.multiWorkoutBody}>
              <ThemedText type="smallBold">
                Routine {session.index} · {session.label}
                {sessionFocusLabel === null || isDuplicateLabel
                  ? ""
                  : ` · ${sessionFocusLabel}`}
              </ThemedText>
              <ThemedText type="footnote" themeColor="textSecondary">
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
              {isSaved ? <ProposalDone label="Saved to routines" /> : null}
              {isFailed ? (
                <ThemedText type="footnote" themeColor="warning">
                  Could not save ·{" "}
                  {saved?.result.ok === false
                    ? saved.result.message
                    : "unknown error"}
                </ThemedText>
              ) : null}
            </View>
            {isSaved ? (
              <Button
                label="Start"
                variant="tinted"
                size="small"
                accessibilityLabel={`Start ${session.label}`}
                onPress={() =>
                  saved.result.ok && void onOpenWorkout(saved.result.workout)
                }
              />
            ) : null}
          </View>
        );
      })}
      {error !== null ? <ProposalError message={error} /> : null}
      {result === null ? (
        <Button
          label={`Save ${proposal.requestedSessions} routines`}
          block
          loading={saving}
          accessibilityLabel={`Save all ${proposal.requestedSessions} routines`}
          accessibilityHint="Saves reusable routines for the planned days. Starting one creates a separate live workout session."
          disabled={saving}
          accessibilityState={{ disabled: saving, busy: saving }}
          onPress={() => {
            void onSaveAll();
          }}
        />
      ) : (
        <Button
          label="Start first routine"
          block
          accessibilityLabel="Start the first saved routine"
          onPress={() => {
            void onOpenFirst();
          }}
        />
      )}
    </Card>
  );
}

function DailyPlanCard({
  proposal,
}: {
  readonly proposal: CoachDailyPlanProposal;
}) {
  return (
    <Card>
      <ProposalHeader
        icon="sunrise"
        title="Daily Action Plan"
        subtitle={proposal.date}
        status={<Chip label="Today" tone="primary" />}
      />

      <ThemedView type="backgroundSelected" style={styles.proposalMetricBox}>
        {proposal.calorie === null ? null : (
          <ProposalFact icon="energy">
            Calories:{" "}
            {proposal.calorie.consumedKcal === null
              ? "not logged"
              : `${proposal.calorie.consumedKcal} / ${proposal.calorie.targetKcal} kcal (${proposal.calorie.remainingKcal} left)`}
          </ProposalFact>
        )}
        {proposal.protein === null ? null : (
          <ProposalFact icon="fork">
            Protein:{" "}
            {proposal.protein.consumedG === null
              ? "not logged"
              : `${proposal.protein.consumedG}g / ${proposal.protein.targetG}g target (${proposal.protein.remainingG}g left)`}
          </ProposalFact>
        )}
        {proposal.training === null ? null : (
          <ProposalFact icon="dumbbell">
            Training:{" "}
            {proposal.training.completedToday
              ? "completed today"
              : proposal.training.due
                ? "due today"
                : "base frequency on track"}
          </ProposalFact>
        )}
      </ThemedView>

      <ThemedView type="primaryLight" style={styles.proposalMetricBox}>
        <ThemedText type="smallBold" themeColor="primary">
          Next focus
        </ThemedText>
        <ThemedText type="small">
          {nextActionLabel[proposal.nextAction]}
        </ThemedText>
      </ThemedView>

      {proposal.missingInputs.length > 0 ? (
        <ThemedText type="footnote" themeColor="textSecondary">
          Missing inputs: {proposal.missingInputs.join(", ")}
        </ThemedText>
      ) : null}
      <ThemedText type="footnote" themeColor="textSecondary">
        Deterministic plan · updates from confirmed logs
      </ThemedText>
    </Card>
  );
}

const calorieActionTone: Record<
  CoachWeeklyAdaptationProposal["calorieAction"],
  "primary" | "neutral" | "warning"
> = {
  hold: "primary",
  increase: "neutral",
  decrease: "warning",
};

function WeeklyAdaptationCard({
  proposal,
  onAccept,
  disabled,
}: {
  readonly proposal: CoachWeeklyAdaptationProposal;
  readonly onAccept: (proposal: CoachWeeklyAdaptationProposal) => void;
  readonly disabled: boolean;
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

  const actionLabel =
    proposal.calorieAction.charAt(0).toUpperCase() +
    proposal.calorieAction.slice(1);

  return (
    <Card>
      <ProposalHeader
        icon="chart"
        title="Weekly Review & Adaptation"
        subtitle="7-day confirmed adherence scorecard"
        status={
          <Chip
            label={actionLabel}
            tone={calorieActionTone[proposal.calorieAction] ?? "neutral"}
          />
        }
      />

      <ThemedText type="small">
        Goal pace · {proposal.currentPace ?? "steady"}
        {canApply ? ` to ${proposal.proposedPace}` : " (maintained)"}
      </ThemedText>

      <ThemedView type="backgroundSelected" style={styles.proposalMetricBox}>
        <ProposalFact icon="energy">Nutrition: {nutritionSummary}</ProposalFact>
        <ProposalFact icon="fork">Protein: {proteinSummary}</ProposalFact>
        <ProposalFact icon="dumbbell">Training: {trainingSummary}</ProposalFact>
        <ProposalFact icon="scale">Weight trend: {weightSummary}</ProposalFact>
      </ThemedView>

      {proposal.reasons.map((reason) => (
        <ThemedText key={reason} type="footnote" themeColor="textSecondary">
          • {reason}
        </ThemedText>
      ))}

      {canApply ? (
        <Button
          label="Accept pace change"
          block
          accessibilityLabel={`Accept goal pace change from ${proposal.currentPace} to ${proposal.proposedPace}`}
          accessibilityHint="Updates the active goal and recalculates future deterministic calorie targets."
          disabled={disabled}
          accessibilityState={{ disabled }}
          onPress={() => {
            if (!disabled) onAccept(proposal);
          }}
        />
      ) : (
        <ThemedText type="footnote" themeColor="textSecondary">
          {proposal.readiness === "ready"
            ? "Current pace is on track. No changes needed."
            : "No goal change available. Continue logging next week."}
        </ThemedText>
      )}
    </Card>
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
    <Card>
      <ProposalHeader
        icon="edit"
        title={`Workout Changes · ${proposal.targetName}`}
        subtitle={proposal.summary}
      />

      <View style={styles.proposalList}>
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
      {error !== null ? <ProposalError message={error} /> : null}
      {!applied ? (
        <Button
          label={applying ? "Applying…" : "Apply changes to workout"}
          block
          accessibilityLabel="Apply changes to workout"
          disabled={applying}
          accessibilityState={{ disabled: applying, busy: applying }}
          onPress={onApply}
        />
      ) : (
        <View style={styles.proposalActions}>
          <ProposalDone label="Changes applied to workout" />
          <Button
            label="Open workout"
            variant="tinted"
            block
            accessibilityLabel={`Open ${proposal.targetName}`}
            onPress={onOpen}
          />
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  safeArea: { flex: 1 },
  flex: { flex: 1 },
  flexText: { flex: 1, gap: Spacing.half },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.6 },
  threadRow: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingLeft: PageGutter,
    // IconButton carries its own 6pt margin inside the 48pt target.
    paddingRight: PageGutter - 6,
  },
  threadSwitcher: {
    flex: 1,
    minHeight: MinTouchTarget,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  threadTitle: { flexShrink: 1 },
  advisoryWrapper: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    paddingHorizontal: PageGutter,
    paddingTop: Spacing.one,
    paddingBottom: Spacing.two,
    gap: Spacing.two,
  },
  advisoryHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.three,
  },
  stateCard: {
    marginHorizontal: PageGutter,
    gap: Spacing.three,
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
    paddingHorizontal: PageGutter,
    gap: Spacing.three,
    paddingBottom: Spacing.three,
  },
  emptyState: {
    flex: 1,
    gap: Spacing.four,
    paddingVertical: Spacing.two,
  },
  section: { gap: Spacing.two },
  messageGroup: {
    width: "100%",
    gap: Spacing.two,
  },
  userGroup: { alignItems: "flex-end" },
  bubble: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: Radius.xl,
    borderCurve: "continuous",
    gap: Spacing.one,
  },
  userBubble: {
    maxWidth: "82%",
    borderBottomRightRadius: Spacing.one,
  },
  assistantBubble: {
    alignSelf: "stretch",
    borderBottomLeftRadius: Spacing.one,
  },
  bubbleHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
  },
  formattedMessageContainer: {
    gap: Spacing.one,
  },
  messageParagraph: {},
  // Coach replies keep one explicit size so the iOS selectable surface and
  // its nested bold spans measure identically (matches the `small` style).
  messageText: {
    fontSize: 15,
    lineHeight: 22,
  },
  messageBoldText: {
    fontWeight: "700",
  },
  messageHeaderContainer: {
    marginTop: Spacing.two,
    marginBottom: Spacing.half,
  },
  messageHeaderText: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "600",
  },
  messageBulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
  },
  messageBulletDot: {
    lineHeight: 22,
  },
  messageNumberDot: {
    lineHeight: 22,
    minWidth: 16,
  },
  messageBulletContent: {
    flex: 1,
  },
  messageDivider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: Spacing.two,
  },
  proposalHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  proposalMetricBox: {
    padding: 12,
    borderRadius: Radius.md,
    gap: Spacing.one,
  },
  proposalList: { gap: Spacing.half },
  proposalActions: { gap: Spacing.two },
  factRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.two,
  },
  factIcon: { marginTop: 2 },
  pendingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingVertical: Spacing.two,
  },
  failedMessageActions: {
    marginTop: Spacing.one,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.two,
  },
  alert: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingHorizontal: PageGutter,
    paddingVertical: 10,
  },
  alertBody: {
    flex: 1,
    gap: Spacing.one,
    alignItems: "flex-start",
  },
  messagesLeft: {
    textAlign: "center",
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.one,
  },
  composerWrapper: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom:
      Platform.select({
        android: Spacing.two,
        default: BottomTabInset + Spacing.one,
      }) ?? Spacing.two,
  },
  composerWrapperKeyboardActive: {
    paddingBottom: Spacing.two,
  },
  composerCapsule: {
    flexDirection: "row",
    alignItems: "flex-end",
    borderRadius: Radius.xl + 2,
    borderCurve: "continuous",
    paddingHorizontal: Spacing.one,
    gap: Spacing.half,
  },
  composerIconButton: { margin: 4 },
  capsuleInput: {
    flex: 1,
    minHeight: MinTouchTarget,
    maxHeight: 120,
    paddingHorizontal: Spacing.one,
    paddingTop: 12,
    paddingBottom: 12,
    // TextInput needs an explicit size; matches the body text style.
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
  sendCircleDisabled: { opacity: 0.35 },
  multiWorkoutRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-start",
    gap: Spacing.two,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  multiWorkoutBody: { flex: 1, minWidth: 180, gap: Spacing.half },
});
