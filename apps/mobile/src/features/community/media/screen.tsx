import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Alert,
  AppState,
  KeyboardAvoidingView,
  Platform,
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useFocusEffect } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as Crypto from "expo-crypto";
import type { CommunityMediaItem } from "@mizyun/contracts";
import { apiClient } from "@/composition/api-client";
import { useAuth } from "@/features/auth/auth-context";
import { useTheme } from "@/hooks/use-theme";
import { ReportModal, scopeCommunityClient } from "@/features/community";
import {
  fetchCommunityMedia,
  fetchCommunityMediaContent,
  uploadCommunityMedia,
  removeCommunityMedia,
  reviewCommunityMedia,
} from "./client";
export function CommunityMediaScreen() {
  const { session } = useAuth();
  return (
    <MediaContent
      key={session?.user.id ?? "signed-out"}
      principal={session?.user.id ?? null}
    />
  );
}
function MediaContent({ principal }: { principal: string | null }) {
  const theme = useTheme();
  const active = useRef(false);
  const actionLock = useRef<symbol | null>(null);
  const routeAlive = useRef(false);
  const pickerEpoch = useRef(0);
  const epoch = useRef(0);
  const freshRead = useRef(0);
  const freshLoading = useRef(false);
  const expiry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const client = useMemo(
    () => scopeCommunityClient(apiClient, principal, () => active.current),
    [principal],
  );
  const [mode, setMode] = useState<"feed" | "mine" | "review">("feed");
  const [items, setItems] = useState<CommunityMediaItem[]>([]);
  const [images, setImages] = useState<Record<string, string>>({});
  const [prepared, setPrepared] = useState<{
    uri: string;
    base64: string;
    operationId: string;
  } | null>(null);
  const [altText, setAltText] = useState("");
  const [rights, setRights] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [report, setReport] = useState<CommunityMediaItem | null>(null);
  const [reviewReason, setReviewReason] = useState("");
  const reset = useCallback(() => {
    freshRead.current++;
    if (expiry.current !== null) clearTimeout(expiry.current);
    expiry.current = null;
    freshLoading.current = false;
    active.current = false;
    actionLock.current = null;
    epoch.current++;
    setItems([]);
    setImages({});
    setPrepared(null);
    setAltText("");
    setRights(false);
    setReport(null);
    setBusy(false);
    setCursor(null);
    setReviewReason("");
    setNotice(null);
    setError(null);
  }, []);
  const load = useCallback(
    async (nextMode = mode, append = false) => {
      const current = ++epoch.current;
      const read = ++freshRead.current;
      freshLoading.current = true;
      const deadline = Date.now() + 10_000;
      if (expiry.current !== null) clearTimeout(expiry.current);
      // Expiry is tied to the authorization request start, including byte reads.
      setItems([]);
      setReport(null);
      expiry.current = setTimeout(() => {
        if (freshRead.current !== read) return;
        freshRead.current++;
        expiry.current = null;
        setItems([]);
        setImages({});
        setReport(null);
        setCursor(null);
        if (freshLoading.current) {
          freshLoading.current = false;
          setBusy(false);
        }
        setError("Refresh images to check current access.");
      }, 10_000);
      setBusy(true);
      setError(null);
      setImages({});
      const result = await fetchCommunityMedia(
        client,
        nextMode,
        append ? (cursor ?? undefined) : undefined,
      ).catch(() => ({ ok: false as const }));
      if (
        current !== epoch.current ||
        freshRead.current !== read ||
        Date.now() >= deadline ||
        !active.current
      )
        return;
      if (!result.ok) {
        freshLoading.current = false;
        setBusy(false);
        setItems([]);
        setError(
          nextMode === "review"
            ? "Review requires a named moderator with a current MFA session."
            : "Images unavailable. Refresh to check current access.",
        );
        return;
      }
      setItems(result.value.items);
      setCursor(result.value.nextCursor);
      const visible = result.value.items.filter(
        (item) => item.state === "approved" || item.state === "pending",
      );
      const nextImages: Record<string, string> = {};
      for (let offset = 0; offset < visible.length; offset += 2) {
        let denied = false;
        await Promise.all(
          visible.slice(offset, offset + 2).map(async (item) => {
            const response = await fetchCommunityMediaContent(
              client,
              item.id,
            ).catch(() => ({ ok: false as const }));
            if (response.ok)
              nextImages[item.id] =
                `data:image/jpeg;base64,${response.value.base64}`;
            else denied = true;
          }),
        );
        if (
          current !== epoch.current ||
          freshRead.current !== read ||
          Date.now() >= deadline ||
          !active.current
        )
          return;
        if (denied) {
          freshLoading.current = false;
          setItems([]);
          setImages({});
          setReport(null);
          setCursor(null);
          setBusy(false);
          setError("Image access changed. Refresh to check current access.");
          return;
        }
      }
      setImages(nextImages);
      freshLoading.current = false;
      setBusy(false);
    },
    [client, cursor, mode],
  );
  const loadRef = useRef(load);
  loadRef.current = load;
  useFocusEffect(
    useCallback(() => {
      routeAlive.current = true;
      let foreground = AppState.currentState === "active";
      if (foreground) {
        active.current = true;
        void loadRef.current();
      }
      const sub = AppState.addEventListener("change", (state) => {
        if (foreground === (state === "active")) return;
        foreground = state === "active";
        reset();
        if (foreground) {
          active.current = true;
          void loadRef.current();
        }
      });
      return () => {
        routeAlive.current = false;
        pickerEpoch.current++;
        sub.remove();
        reset();
      };
    }, [reset]),
  );
  const perform = async (
    action: () => Promise<{ ok: boolean }>,
    message: string,
  ) => {
    if (!active.current || actionLock.current) return;
    const token = Symbol();
    actionLock.current = token;
    const current = epoch.current;
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (
        current !== epoch.current ||
        !active.current ||
        actionLock.current !== token
      )
        return;
      actionLock.current = null;
      setBusy(false);
      if (!result.ok) {
        setItems([]);
        setImages({});
        setError(
          "Unable to finish. Refresh and try again; the same upload can be safely retried.",
        );
        return;
      }
      setPrepared(null);
      setRights(false);
      setAltText("");
      setReviewReason("");
      setNotice(message);
      await load();
    } catch {
      if (
        current === epoch.current &&
        active.current &&
        actionLock.current === token
      ) {
        actionLock.current = null;
        setBusy(false);
        setItems([]);
        setImages({});
        setError("Unable to finish image action. Refresh and try again.");
      }
    }
  };
  const choose = async () => {
    const current = ++pickerEpoch.current;
    setBusy(true);
    setError(null);
    try {
      const selection = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: false,
        exif: false,
        quality: 1,
      });
      if (current !== pickerEpoch.current || !routeAlive.current) return;
      if (selection.canceled) {
        setBusy(false);
        return;
      }
      const conversionEpoch = epoch.current;
      if (!active.current) return;
      const asset = selection.assets[0];
      if (!asset) throw new Error("No image");
      const context = ImageManipulator.manipulate(asset.uri);
      if (Math.max(asset.width, asset.height) > 1600)
        context.resize(
          asset.width >= asset.height
            ? { width: 1600, height: null }
            : { width: null, height: 1600 },
        );
      const rendered = await context.renderAsync();
      const saved = await rendered.saveAsync({
        format: SaveFormat.JPEG,
        compress: 0.82,
        base64: true,
      });
      if (current !== pickerEpoch.current || !routeAlive.current) return;
      if (!active.current || conversionEpoch !== epoch.current) return;
      if (!saved.base64 || saved.base64.length > 4194304)
        throw new Error("Too large");
      setPrepared({
        uri: saved.uri,
        base64: saved.base64,
        operationId: Crypto.randomUUID(),
      });
      setRights(false);
      setAltText("");
      setBusy(false);
    } catch {
      if (current === pickerEpoch.current && routeAlive.current) {
        setBusy(false);
        setError("Choose a supported still image under 3 MiB after resizing.");
      }
    }
  };
  const button = (label: string, action: () => void, disabled = busy) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={action}
      style={{
        borderWidth: 1,
        borderColor: theme.border,
        padding: 12,
        minHeight: 48,
        justifyContent: "center",
        borderRadius: 12,
        marginVertical: 4,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text style={{ color: theme.text }}>{label}</Text>
    </Pressable>
  );
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.background }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <Stack.Screen options={{ title: "Community images" }} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 20, gap: 12 }}
      >
        <Text style={{ color: theme.text, fontSize: 24, fontWeight: "700" }}>
          Choose an image to share
        </Text>
        <Text style={{ color: theme.text }}>
          Select an image deliberately from your device. Nothing from your
          private progress photos is shared automatically. Metadata is removed
          on the server. A named moderator must review each image before your
          approved followers can view it.
        </Text>
        <Text style={{ color: theme.text }}>
          Use only images you have permission to share, with everyone pictured
          consenting. Do not upload nudity, sensitive documents or unsafe
          advice. Recipients may retain a screenshot of an image they already
          viewed.
        </Text>
        {error && (
          <Text accessibilityRole="alert" style={{ color: theme.text }}>
            {error}
          </Text>
        )}
        {notice && (
          <Text accessibilityLiveRegion="polite" style={{ color: theme.text }}>
            {notice}
          </Text>
        )}
        {button("Choose a new image", () => void choose(), busy || !principal)}
        {prepared && (
          <>
            <Image
              source={{ uri: prepared.uri }}
              accessibilityLabel="Your selected image preview"
              style={{ width: "100%", height: 240 }}
              resizeMode="contain"
            />
            <TextInput
              editable={!busy}
              accessibilityLabel="Image description for accessibility"
              maxLength={240}
              value={altText}
              onChangeText={(value) => {
                setAltText(value);
                setPrepared((previous) =>
                  previous
                    ? { ...previous, operationId: Crypto.randomUUID() }
                    : null,
                );
              }}
              placeholder="Describe the image without private or contact details"
              placeholderTextColor={theme.textSecondary}
              style={{
                color: theme.text,
                borderWidth: 1,
                borderColor: theme.border,
                padding: 12,
              }}
            />
            <Pressable
              disabled={busy}
              style={{ minHeight: 48, justifyContent: "center" }}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: rights, disabled: busy }}
              onPress={() => setRights(!rights)}
            >
              <Text style={{ color: theme.text }}>
                {rights ? "☑" : "☐"} I have the rights and permission of
                everyone pictured.
              </Text>
            </Pressable>
            {button(
              "Confirm preview and submit for review",
              () => {
                const image = prepared;
                void perform(
                  () =>
                    uploadCommunityMedia(client, {
                      operationId: image.operationId,
                      base64: image.base64,
                      altText,
                    }),
                  "Image submitted for independent moderation.",
                );
              },
              busy || !rights || !altText.trim(),
            )}
            {button("Discard selected image", () => {
              setPrepared(null);
              setRights(false);
              setAltText("");
            })}
          </>
        )}
        <Text style={{ color: theme.text, fontSize: 18, fontWeight: "600" }}>
          Browse community images
        </Text>
        {button("Approved images", () => {
          setMode("feed");
          void load("feed");
        })}
        {button("Manage my images", () => {
          setMode("mine");
          void load("mine");
        })}
        {button("Moderator review", () => {
          setMode("review");
          void load("review");
        })}
        {button(
          busy ? "Loading…" : "Refresh",
          () => void load(),
          busy || !principal,
        )}
        {mode === "review" && (
          <TextInput
            editable={!busy}
            accessibilityLabel="Moderation decision reason"
            maxLength={500}
            placeholder="Record your review reason"
            placeholderTextColor={theme.textSecondary}
            value={reviewReason}
            onChangeText={setReviewReason}
            style={{
              color: theme.text,
              borderWidth: 1,
              borderColor: theme.border,
              padding: 12,
            }}
          />
        )}
        {items.map((item) => (
          <View
            key={item.id}
            style={{
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: 12,
              padding: 12,
              gap: 6,
            }}
          >
            <Text style={{ color: theme.text }}>
              @{item.authorHandle} · {item.state}
            </Text>
            {images[item.id] ? (
              <Image
                source={{ uri: images[item.id] }}
                accessibilityLabel={item.altText}
                style={{ width: "100%", height: 240 }}
                resizeMode="contain"
              />
            ) : (
              <Text style={{ color: theme.text }}>
                Image not currently available.
              </Text>
            )}
            <Text style={{ color: theme.text }}>{item.altText}</Text>
            {item.isOwner
              ? button("Remove image", () => {
                  const intentEpoch = epoch.current;
                  const intentRead = freshRead.current;
                  Alert.alert(
                    "Remove this image?",
                    "Followers immediately lose access. A reported image can remain as restricted case evidence for up to 30 days.",
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Remove",
                        style: "destructive",
                        onPress: () => {
                          if (
                            !active.current ||
                            epoch.current !== intentEpoch ||
                            freshRead.current !== intentRead
                          )
                            return;
                          void perform(
                            () => removeCommunityMedia(client, item.id),
                            "Image removed from Community.",
                          );
                        },
                      },
                    ],
                  );
                })
              : button("Report image", () => setReport(item))}
            {mode === "review" && item.state === "pending" && !item.isOwner && (
              <>
                {button(
                  "Approve for existing approved followers",
                  () =>
                    void perform(
                      () =>
                        reviewCommunityMedia(
                          client,
                          item.id,
                          "approve",
                          reviewReason,
                        ),
                      "Image approved.",
                    ),
                  busy || !reviewReason.trim(),
                )}
                {button(
                  "Reject image",
                  () =>
                    void perform(
                      () =>
                        reviewCommunityMedia(
                          client,
                          item.id,
                          "reject",
                          reviewReason,
                        ),
                      "Image rejected.",
                    ),
                  busy || !reviewReason.trim(),
                )}
              </>
            )}
          </View>
        ))}
        {!busy && !items.length && !error && (
          <Text style={{ color: theme.text }}>
            No images available in this view.
          </Text>
        )}
        {cursor && button("Next page of images", () => void load(mode, true))}
        <ReportModal
          visible={report !== null}
          targetType="media"
          targetId={report?.id ?? ""}
          targetHandle={report?.authorHandle ?? ""}
          principalKey={principal}
          onClose={() => setReport(null)}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
