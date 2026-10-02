import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
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
import {
  Stack,
  router,
  useFocusEffect,
  useLocalSearchParams,
  type Href,
} from "expo-router";
import { randomUUID } from "expo-crypto";
import {
  communityCommentIdSchema,
  communityCommentTextSchema,
  type CommunityComment,
} from "@mizyun/contracts";
import { apiClient } from "@/composition/api-client";
import { useAuth } from "@/features/auth/auth-context";
import { useTheme } from "@/hooks/use-theme";
import { MaxContentWidth } from "@/constants/theme";
import { ThemedText } from "@/components/themed-text";
import { CommunityIntro } from "../community-presentation";
import { CommentsController } from "./controller";

export function CommunityCommentsScreen() {
  const { session } = useAuth();
  const params = useLocalSearchParams<{ activityId?: string }>();
  const activity = communityCommentIdSchema.safeParse(params.activityId);
  return (
    <CommentsContent
      key={`${session?.user.id ?? "signed-out"}:${activity.success ? activity.data : "mentions"}`}
      principal={session?.user.id ?? null}
      activityId={activity.success ? activity.data : null}
    />
  );
}
function CommentsContent({
  principal,
  activityId,
}: {
  principal: string | null;
  activityId: string | null;
}) {
  const theme = useTheme();
  const alive = useRef(true);
  const controller = useMemo(
    () =>
      new CommentsController(
        apiClient,
        principal,
        activityId,
        () => alive.current,
      ),
    [principal, activityId],
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  const [body, setBody] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [mentions, setMentions] = useState<string[]>([]);
  const [editing, setEditing] = useState<CommunityComment | null>(null);
  const [reply, setReply] = useState<string | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);
  const intent = useRef<{
    id: string;
    operationId: string;
    signature: string;
  } | null>(null);
  const clearDraft = useCallback(() => {
    setBody("");
    setAccepted(false);
    setMentions([]);
    setEditing(null);
    setReply(null);
    setReportId(null);
    intent.current = null;
  }, []);
  const protectedDraft = useRef(false);
  protectedDraft.current =
    editing !== null || reply !== null || mentions.length > 0;
  const retireProtectedDraft = useCallback(() => {
    // A new plain-text draft belongs to its author. Audience-derived editing,
    // reply and recipient context expires with the delivered discussion.
    if (protectedDraft.current) setAccepted(false);
    setMentions([]);
    setEditing(null);
    setReply(null);
    setReportId(null);
    // An expired edit/reply cannot become a new root comment with the old
    // target identity. New plain-text drafts retain their unchanged retry ID.
    if (protectedDraft.current) intent.current = null;
  }, []);
  useEffect(() => {
    // An expiry can clear and immediately start a new read in one render batch.
    // The monotonic privacy revision still retires every old audience target.
    retireProtectedDraft();
  }, [state.privacyRevision, retireProtectedDraft]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.pause();
    };
  }, [controller]);
  useFocusEffect(
    useCallback(() => {
      let focused = true;
      let foreground = AppState.currentState === "active";
      if (foreground) {
        controller.resume();
        void controller.load();
      } else controller.pause();
      const subscription = AppState.addEventListener("change", (next) => {
        if (!focused || foreground === (next === "active")) return;
        foreground = next === "active";
        clearDraft();
        controller.pause();
        if (foreground) {
          controller.resume();
          void controller.load();
        }
      });
      return () => {
        focused = false;
        subscription.remove();
        controller.pause();
        clearDraft();
      };
    }, [controller, clearDraft]),
  );
  const button = (
    label: string,
    onPress: () => void,
    disabled = state.busy,
  ) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        {
          backgroundColor: theme.backgroundElement,
          borderColor: theme.border,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
  const toggle = (
    label: string,
    value: boolean,
    onPress: () => void,
    disabled = state.busy,
  ) => (
    <Pressable
      key={label}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        { borderColor: theme.border, backgroundColor: theme.backgroundElement },
      ]}
    >
      <ThemedText>
        {value ? "✓ " : "○ "}
        {label}
      </ThemedText>
    </Pressable>
  );
  const compose = (comment: CommunityComment, edit: boolean) => {
    clearDraft();
    if (edit) {
      setEditing(comment);
      setBody(comment.body);
      setMentions(comment.mentions.map((person) => person.userId));
    } else setReply(comment.parentId ?? comment.id);
  };
  const bodyValidation = communityCommentTextSchema.safeParse(body);
  const submit = async () => {
    if (!accepted || !communityCommentTextSchema.safeParse(body).success)
      return;
    const parentId = editing?.parentId ?? reply;
    const signature = JSON.stringify({
      body: body.trim(),
      mentions,
      parentId,
      version: editing?.version ?? 0,
    });
    if (!intent.current)
      intent.current = {
        id: editing?.id ?? randomUUID(),
        operationId: randomUUID(),
        signature,
      };
    else if (intent.current.signature !== signature)
      intent.current = {
        ...intent.current,
        operationId: randomUUID(),
        signature,
      };
    const saved = await controller.submit({
      id: intent.current.id,
      operationId: intent.current.operationId,
      body: body.trim(),
      parentId,
      expectedVersion: editing?.version ?? 0,
      mentions,
    });
    if (saved && alive.current) clearDraft();
  };
  const remove = (comment: CommunityComment) =>
    Alert.alert(
      "Remove this comment?",
      "The text will disappear from the discussion. Safety evidence already saved may remain for its limited retention period.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => void controller.remove(comment.id, comment.version),
        },
      ],
    );
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={{ flex: 1, backgroundColor: theme.background }}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Stack.Screen
          options={{
            title: activityId ? "Workout discussion" : "Comment updates",
          }}
        />
        <CommunityIntro
          icon="💬"
          title={activityId ? "A little conversation" : "Your comment updates"}
          description={
            activityId
              ? "Share supportive plain text with the people who can see this workout. Private workout notes stay private."
              : "Find workouts where an approved friend mentioned you, and choose whether friends can mention you."
          }
          tone="blue"
        />
        {button(
          "Back to Community",
          () => router.replace("/(tabs)/community" as Href),
          false,
        )}
        {!principal ? (
          <ThemedText>
            Sign in to use Community comments. Your private tracking stays
            available.
          </ThemedText>
        ) : (
          <>
            {button(
              state.busy ? "Checking comments…" : "Refresh",
              () => void controller.load(),
            )}
            {state.error && (
              <ThemedText accessibilityLiveRegion="polite">
                {state.error}
              </ThemedText>
            )}
            {state.notice && (
              <ThemedText accessibilityLiveRegion="polite">
                {state.notice}
              </ThemedText>
            )}
            {toggle(
              "Allow approved friends to mention me",
              state.allowMentions,
              () => void controller.preferences(!state.allowMentions),
            )}
            {button(
              "Stop all comment mention updates",
              () => void controller.preferences(false),
            )}
            {!activityId &&
              !state.busy &&
              !state.error &&
              state.mentions.length === 0 && (
                <ThemedText>
                  No comment updates yet. Mentions from approved friends will
                  appear here.
                </ThemedText>
              )}
            {!activityId &&
              state.mentions.map((mention) => (
                <View key={mention.id}>
                  {button("Open mentioned workout", () =>
                    router.push(
                      `/community/comments?activityId=${encodeURIComponent(mention.activityId)}` as Href,
                    ),
                  )}
                </View>
              ))}
            {activityId && (
              <>
                {state.canManage &&
                  button(
                    state.enabled
                      ? "Close comments on this workout"
                      : "Open comments on this workout",
                    () => void controller.settings(!state.enabled),
                  )}
                {!state.busy && !state.error && !state.enabled && (
                  <ThemedText>
                    Comments are closed on this workout. The author can choose
                    to open them.
                  </ThemedText>
                )}
                {!state.busy &&
                  !state.error &&
                  state.enabled &&
                  state.items.length === 0 && (
                    <ThemedText>
                      No comments yet. You can be the first to offer some
                      encouragement.
                    </ThemedText>
                  )}
                {state.items.map((comment) => (
                  <View
                    key={comment.id}
                    style={[
                      styles.comment,
                      {
                        borderColor: theme.border,
                        backgroundColor: theme.backgroundElement,
                      },
                    ]}
                  >
                    <ThemedText accessibilityRole="header">
                      {comment.author.displayName} · @{comment.author.handle}
                    </ThemedText>
                    {comment.parentId && (
                      <ThemedText>Reply in this discussion</ThemedText>
                    )}
                    <ThemedText selectable>{comment.body}</ThemedText>
                    {comment.mentions.length > 0 && (
                      <ThemedText>
                        Mentioned:{" "}
                        {comment.mentions
                          .map((person) => person.displayName)
                          .join(", ")}
                      </ThemedText>
                    )}
                    {state.enabled &&
                      button(`Reply to ${comment.author.displayName}`, () =>
                        compose(comment, false),
                      )}
                    {comment.author.userId === principal &&
                      state.enabled &&
                      button("Edit my comment", () => compose(comment, true))}
                    {(comment.author.userId === principal || state.canManage) &&
                      button("Remove comment", () => remove(comment))}
                    {comment.author.userId !== principal &&
                      button("Report comment", () => setReportId(comment.id))}
                    {reportId === comment.id && (
                      <View>
                        <ThemedText>
                          Choose a report reason. The author cannot see who
                          reported them.
                        </ThemedText>
                        {[
                          "harassment",
                          "offensive_content",
                          "spam",
                          "unsafe_or_sexual_content",
                          "impersonation",
                          "other",
                        ].map((reason) =>
                          button(reason.replaceAll("_", " "), () => {
                            setReportId(null);
                            void controller.report(comment.id, reason);
                          }),
                        )}
                        {button("Cancel report", () => setReportId(null))}
                      </View>
                    )}
                  </View>
                ))}
                {state.nextCursor &&
                  button("More comments", () => void controller.load(true))}
                {state.enabled && (
                  <View style={styles.composer}>
                    <ThemedText accessibilityRole="header">
                      {editing
                        ? "Edit your comment"
                        : reply
                          ? "Write a reply"
                          : "Write a supportive comment"}
                    </ThemedText>
                    <TextInput
                      accessibilityLabel="Comment text"
                      multiline
                      editable={!state.busy}
                      maxLength={500}
                      value={body}
                      onChangeText={(text) => {
                        setBody(text);
                        setAccepted(false);
                      }}
                      placeholder="A little encouragement…"
                      placeholderTextColor={theme.textSecondary}
                      style={[
                        styles.input,
                        { color: theme.text, borderColor: theme.border },
                      ]}
                    />
                    <ThemedText>
                      {body.length}/500 · No line breaks, links, contact details
                      or typed @mentions.
                    </ThemedText>
                    {body.trim() && !bodyValidation.success && (
                      <ThemedText
                        accessibilityLiveRegion="polite"
                        style={{ color: theme.text }}
                      >
                        {bodyValidation.error.issues[0]?.message}
                      </ThemedText>
                    )}
                    {state.candidates.length > 0 && (
                      <ThemedText>
                        Optional mentions: only approved friends who opted in
                        and can see this workout.
                      </ThemedText>
                    )}
                    {state.candidates.map((candidate) =>
                      toggle(
                        `Mention ${candidate.displayName}`,
                        mentions.includes(candidate.userId),
                        () => {
                          setAccepted(false);
                          setMentions((current) =>
                            current.includes(candidate.userId)
                              ? current.filter((id) => id !== candidate.userId)
                              : [...current, candidate.userId],
                          );
                        },
                        state.busy ||
                          (!mentions.includes(candidate.userId) &&
                            mentions.length >= 3),
                      ),
                    )}
                    <ThemedText>
                      Your preview: {body || "Write your comment above."}
                    </ThemedText>
                    {toggle(
                      "I choose to share this text with everyone who can see this workout, including followers added later",
                      accepted,
                      () => setAccepted(!accepted),
                    )}
                    {button(
                      editing
                        ? "Save edited comment"
                        : reply
                          ? "Publish reply"
                          : "Publish comment",
                      () => void submit(),
                      state.busy ||
                        !accepted ||
                        !communityCommentTextSchema.safeParse(body).success,
                    )}
                    {button("Clear my draft", clearDraft)}
                  </View>
                )}
              </>
            )}
            {button("Community safety and appeals", () =>
              router.push("/community/safety" as Href),
            )}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
const styles = StyleSheet.create({
  content: {
    padding: 20,
    gap: 14,
    paddingBottom: 48,
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
  },
  button: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    justifyContent: "center",
    marginVertical: 3,
  },
  comment: { padding: 16, gap: 8, borderWidth: 1, borderRadius: 16 },
  composer: { gap: 12, paddingVertical: 14 },
  input: {
    minHeight: 110,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    textAlignVertical: "top",
  },
});
