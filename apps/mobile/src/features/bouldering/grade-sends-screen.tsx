import { Image } from "expo-image";
import { router, Stack, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { ApiClient } from "@mizyun/api-client";
import type {
  BoulderGradeSendsResponse,
  BoulderProgressWindowValue,
} from "@mizyun/contracts";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import {
  Button,
  Card,
  EmptyState,
  Icon,
  IconButton,
  ListGroup,
  Notice,
} from "@/components/ui";
import {
  MaxContentWidth,
  MinTouchTarget,
  Radius,
  Spacing,
} from "@/constants/theme";
import { apiClient } from "@/composition/api-client";
import { isBoulderingEnabled } from "@/composition/app-variant";
import { useAuth } from "@/features/auth/auth-context";
import { useTheme } from "@/hooks/use-theme";
import { signBoulderPhoto } from "./boulder-photo";
import { getBoulderGradeSends, type BoulderFailure } from "./client";
import { HoldColourSwatch } from "./log-boulder-sheet";
import {
  ascentAccessibilityLabel,
  formatBoulderDate,
  holdColourLabel,
  RESULT_ICONS,
  resultText,
} from "./presentation";
import {
  gradeScreenTitle,
  gradeSendsSummary,
  groupGradeSends,
} from "./progress";

type GradeSend = BoulderGradeSendsResponse["sends"][number];

type Status =
  | { kind: "loading" }
  | { kind: "ready"; value: BoulderGradeSendsResponse }
  | { kind: "disabled" }
  | { kind: "invalid" }
  | { kind: "error"; failure: BoulderFailure };

/** Every send at one grade in the progress window, opened from "Sends by grade". */
export function BoulderGradeSendsScreen({
  grade,
  window,
}: {
  /** Null for a link without a valid Font grade. */
  grade: string | null;
  window: BoulderProgressWindowValue;
}) {
  const { session: auth } = useAuth();
  const userId = auth?.user.id ?? "";
  const ownerRef = useRef(userId);
  ownerRef.current = userId;
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [photosSigning, setPhotosSigning] = useState(false);
  const [selected, setSelected] = useState<GradeSend | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const latestLoad = useRef(0);
  const photoUrlsRef = useRef(photoUrls);
  photoUrlsRef.current = photoUrls;

  // An account switch never shows the previous account's boulders.
  useEffect(() => {
    setStatus({ kind: "loading" });
    setPhotoUrls({});
    setPhotosSigning(false);
    setSelected(null);
  }, [userId]);

  const client = useCallback((): {
    client: ApiClient;
    isCurrent: () => boolean;
  } => {
    const owner = userId;
    const isCurrent = () => ownerRef.current === owner && owner !== "";
    return {
      isCurrent,
      client: {
        status: () => apiClient.status(),
        request: (options) =>
          apiClient.request({ ...options, expectedUserId: owner, isCurrent }),
      },
    };
  }, [userId]);

  const load = useCallback(async () => {
    if (!isBoulderingEnabled()) {
      setStatus({ kind: "disabled" });
      return;
    }
    if (grade === null) {
      setStatus({ kind: "invalid" });
      return;
    }
    const { client: c, isCurrent: isOwner } = client();
    // Only the newest load may update the screen (focus, refresh and retry overlap).
    const request = ++latestLoad.current;
    const isCurrent = () => isOwner() && request === latestLoad.current;
    if (!isCurrent()) return;
    const result = await getBoulderGradeSends(grade, window, c);
    if (!isCurrent()) return;
    if (!result.ok) {
      setStatus(
        result.error.kind === "disabled"
          ? { kind: "disabled" }
          : { kind: "error", failure: result.error },
      );
      return;
    }
    setStatus({ kind: "ready", value: result.value });
    // Thumbnails are best effort; a row without a URL shows a photo icon.
    setPhotosSigning(true);
    for (const send of result.value.sends) {
      const assetId = send.ascent.photoAssetId;
      if (!assetId || photoUrlsRef.current[assetId]) continue;
      const url = await signBoulderPhoto(c, assetId);
      if (!isCurrent()) return;
      if (url) setPhotoUrls((current) => ({ ...current, [assetId]: url }));
    }
    setPhotosSigning(false);
  }, [client, grade, window]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const urlFor = (send: GradeSend) =>
    send.ascent.photoAssetId ? photoUrls[send.ascent.photoAssetId] : undefined;

  return (
    <ThemedView style={styles.page}>
      <Stack.Screen
        options={{ title: grade ? gradeScreenTitle(grade) : "Sends" }}
      />
      <SafeAreaView style={styles.page} edges={["left", "right", "bottom"]}>
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load().finally(() => setRefreshing(false));
              }}
            />
          }
        >
          {status.kind === "loading" ? (
            <ThemedText
              type="small"
              themeColor="textSecondary"
              accessibilityLiveRegion="polite"
            >
              Loading boulders…
            </ThemedText>
          ) : status.kind === "disabled" ? (
            <Card>
              <EmptyState
                icon="info"
                title="Bouldering isn't available"
                message="Indoor bouldering is not turned on for this app yet."
              />
            </Card>
          ) : status.kind === "invalid" ? (
            <Card>
              <EmptyState
                icon="info"
                title="Grade not found"
                message="Open a grade from Bouldering progress to see its sends."
              />
            </Card>
          ) : status.kind === "error" ? (
            <View accessibilityRole="alert">
              <Notice
                tone={status.failure.kind === "offline" ? "warning" : "danger"}
                title={
                  status.failure.kind === "offline"
                    ? "You're offline"
                    : "Couldn't load boulders"
                }
                message={status.failure.message}
                action={
                  <Button
                    label="Retry"
                    variant="plain"
                    size="small"
                    onPress={() => {
                      setStatus({ kind: "loading" });
                      void load();
                    }}
                  />
                }
              />
            </View>
          ) : status.value.sends.length === 0 ? (
            <Card>
              <EmptyState
                icon="mobility"
                title={`No ${status.value.grade} sends`}
                message="Sends at this grade in this period appear here."
              />
            </Card>
          ) : (
            <>
              <ThemedText type="footnote" themeColor="textSecondary">
                {gradeSendsSummary(status.value.sends, status.value.window)}
              </ThemedText>
              {groupGradeSends(status.value.sends).map((group) => (
                <View key={group.sessionId} style={styles.group}>
                  <ThemedText
                    type="smallBold"
                    themeColor="textSecondary"
                    accessibilityRole="header"
                  >
                    {group.title}
                  </ThemedText>
                  <ListGroup>
                    {group.sends.map((send) => (
                      <SendRow
                        key={send.ascent.id}
                        send={send}
                        photoUrl={urlFor(send)}
                        onPress={() => setSelected(send)}
                      />
                    ))}
                  </ListGroup>
                </View>
              ))}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
      {selected ? (
        <SendDetails
          send={selected}
          photoUrl={urlFor(selected)}
          photoLoading={photosSigning}
          onClose={() => setSelected(null)}
          onOpenSession={() => {
            const sessionId = selected.ascent.sessionId;
            setSelected(null);
            router.push({
              pathname: "/bouldering/[id]",
              params: { id: sessionId },
            });
          }}
        />
      ) : null}
    </ThemedView>
  );
}

function SendRow({
  send,
  photoUrl,
  onPress,
}: {
  send: GradeSend;
  photoUrl?: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { ascent } = send;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={ascentAccessibilityLabel(ascent, false)}
      accessibilityHint="Shows the photo and details"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pressed && { backgroundColor: theme.backgroundSelected },
      ]}
    >
      <View style={styles.rowText}>
        <View style={styles.inline}>
          <Icon name={RESULT_ICONS[ascent.result]} size={14} color="primary" />
          <ThemedText type="default">
            {resultText(ascent.result, ascent.attempts)}
          </ThemedText>
        </View>
        {ascent.holdColour ? (
          <View style={styles.inline}>
            <HoldColourSwatch colour={ascent.holdColour} size={12} />
            <ThemedText type="footnote" themeColor="textSecondary">
              {holdColourLabel(ascent.holdColour)}
            </ThemedText>
          </View>
        ) : null}
        {ascent.note ? (
          <ThemedText
            type="footnote"
            themeColor="textSecondary"
            numberOfLines={2}
          >
            {ascent.note}
          </ThemedText>
        ) : null}
      </View>
      {ascent.photoAssetId ? (
        photoUrl ? (
          <Image
            source={{ uri: photoUrl }}
            style={styles.thumb}
            accessibilityLabel="Boulder photo"
          />
        ) : (
          <Icon name="photo" size={20} color="textTertiary" />
        )
      ) : null}
      <Icon name="chevronRight" size={14} color="textTertiary" />
    </Pressable>
  );
}

function SendDetails({
  send,
  photoUrl,
  photoLoading,
  onClose,
  onOpenSession,
}: {
  send: GradeSend;
  photoUrl?: string;
  photoLoading: boolean;
  onClose: () => void;
  onOpenSession: () => void;
}) {
  const theme = useTheme();
  const { ascent } = send;
  const when = formatBoulderDate(send.activityDate);
  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <ThemedView style={styles.page}>
        <SafeAreaView style={styles.page} edges={["top", "bottom"]}>
          <View style={styles.header}>
            <ThemedText type="title3" accessibilityRole="header">
              {`${ascent.grade} boulder`}
            </ThemedText>
            <IconButton
              icon="close"
              accessibilityLabel="Close"
              variant="plain"
              onPress={onClose}
            />
          </View>
          <ScrollView contentContainerStyle={styles.content}>
            {ascent.photoAssetId ? (
              photoUrl ? (
                <Image
                  source={{ uri: photoUrl }}
                  style={[
                    styles.photo,
                    { backgroundColor: theme.backgroundElement },
                  ]}
                  contentFit="contain"
                  accessibilityLabel={`Photo of the ${ascent.grade} boulder`}
                />
              ) : (
                <View
                  style={[
                    styles.photo,
                    styles.photoPending,
                    { backgroundColor: theme.backgroundElement },
                  ]}
                >
                  <Icon name="photo" size={28} color="textTertiary" />
                  <ThemedText type="footnote" themeColor="textSecondary">
                    {photoLoading
                      ? "Loading photo…"
                      : "Photo couldn't be loaded"}
                  </ThemedText>
                </View>
              )
            ) : null}
            <Card>
              <Detail label="Result">
                <View style={styles.inline}>
                  <Icon
                    name={RESULT_ICONS[ascent.result]}
                    size={14}
                    color="primary"
                  />
                  <ThemedText type="default">
                    {resultText(ascent.result, ascent.attempts)}
                  </ThemedText>
                </View>
              </Detail>
              <Detail label="Hold colour">
                {ascent.holdColour ? (
                  <View style={styles.inline}>
                    <HoldColourSwatch colour={ascent.holdColour} size={14} />
                    <ThemedText type="default">
                      {holdColourLabel(ascent.holdColour)}
                    </ThemedText>
                  </View>
                ) : (
                  <ThemedText type="default" themeColor="textSecondary">
                    Not recorded
                  </ThemedText>
                )}
              </Detail>
              <Detail label="Session">
                <ThemedText type="default">
                  {send.gymName ? `${when} · ${send.gymName}` : when}
                </ThemedText>
              </Detail>
              {ascent.note ? (
                <Detail label="Note">
                  <ThemedText type="default">{ascent.note}</ThemedText>
                </Detail>
              ) : null}
            </Card>
            <Button
              label="Open session"
              variant="secondary"
              block
              accessibilityHint="Shows every boulder from that session, where you can edit this one"
              onPress={onOpenSession}
            />
          </ScrollView>
        </SafeAreaView>
      </ThemedView>
    </Modal>
  );
}

function Detail({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.detail}>
      <ThemedText type="footnote" themeColor="textSecondary">
        {label}
      </ThemedText>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    padding: Spacing.three,
    gap: Spacing.three,
  },
  group: { gap: Spacing.one },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    minHeight: MinTouchTarget + Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  rowText: { flex: 1, gap: Spacing.half },
  inline: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: Spacing.one + Spacing.half,
  },
  thumb: { width: 48, height: 48, borderRadius: Radius.sm },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  photo: { width: "100%", aspectRatio: 3 / 4, borderRadius: Radius.md },
  photoPending: {
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.one,
  },
  detail: { gap: Spacing.half },
});
