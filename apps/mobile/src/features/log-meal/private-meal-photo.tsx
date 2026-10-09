import { useEffect, useRef, useState, type ReactNode } from "react";
import { Modal, Pressable, View } from "react-native";
import { Image } from "expo-image";
import { ThemedText } from "@/components/themed-text";
import { useAuth } from "@/features/auth/auth-context";
import {
  deleteMealPhoto,
  fetchMealPhoto,
  loadMealPhotoRetry,
  mealPhotoRetentionEnabled,
  removeMealPhotoRetry,
  uploadMealPhotoRetry,
  type StoredMealPhoto,
} from "./meal-photo-retention";

/** Signed URLs exist only in this account/request generation and never enter image caches. */
export function PrivateMealPhoto({
  entryId,
  hasPhoto,
  editable = false,
  fallback = null,
  onPhotoRemoved,
}: {
  readonly entryId: string;
  readonly hasPhoto: boolean;
  readonly editable?: boolean;
  readonly fallback?: ReactNode;
  readonly onPhotoRemoved?: () => void;
}) {
  const { session } = useAuth();
  const owner = session?.user.id ?? null;
  const scope = `${owner ?? ""}:${session?.accessToken ?? ""}:${entryId}`;
  const current = useRef(scope);
  current.current = scope;
  const generation = useRef(0);
  const [state, setState] = useState<{
    scope: string;
    photo: StoredMealPhoto | null;
    pending: boolean;
    message: string | null;
  } | null>(null);
  const [previewScope, setPreviewScope] = useState<string | null>(null);
  const [busyScope, setBusyScope] = useState<string | null>(null);
  const enabled = mealPhotoRetentionEnabled();
  const load = async (force = false) => {
    const requestGeneration = ++generation.current;
    const valid = () =>
      current.current === scope && generation.current === requestGeneration;
    if (!owner || !enabled) return;
    const pending = await loadMealPhotoRetry(owner, entryId);
    if (!valid()) return;
    if (!hasPhoto && !pending && !force) {
      setState({ scope, photo: null, pending: false, message: null });
      return;
    }
    const response = await fetchMealPhoto(entryId);
    if (!valid()) return;
    setState({
      scope,
      photo: response.ok ? response.value.photo : null,
      pending: pending !== null,
      message:
        !response.ok && hasPhoto ? "Photo unavailable. Try again." : null,
    });
  };
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [scope, enabled, hasPhoto]);
  if (!enabled || !owner) return fallback;
  const visible = state?.scope === scope ? state : null;
  if (!hasPhoto && !visible?.photo && !visible?.pending) return fallback;
  const busy = busyScope === scope;
  const perform = async (action: "retry" | "discard" | "remove") => {
    if (busy) return;
    const requestGeneration = ++generation.current;
    const valid = () =>
      current.current === scope && generation.current === requestGeneration;
    setBusyScope(scope);
    setPreviewScope(null);
    let ok = false;
    try {
      if (action === "retry")
        ok = await uploadMealPhotoRetry(owner, entryId, valid);
      else if (action === "discard")
        ok = await removeMealPhotoRetry(owner, entryId);
      else {
        const result = await deleteMealPhoto(entryId);
        ok = result.ok;
        if (ok && valid()) onPhotoRemoved?.();
        if (ok && valid()) ok = await removeMealPhotoRetry(owner, entryId);
      }
      if (!valid()) return;
      if (ok) await load(true);
      else
        setState((previous) =>
          previous?.scope === scope
            ? {
                ...previous,
                message: "Meal saved. Photo could not be updated. Try again.",
              }
            : previous,
        );
    } finally {
      if (current.current === scope) setBusyScope(null);
    }
  };
  const photo = visible?.photo;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 8,
      }}
    >
      {photo ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="View meal photo"
          onPress={() => {
            if (Date.parse(photo.expiresAt) <= Date.now()) {
              void load();
              return;
            }
            setPreviewScope(scope);
          }}
          style={{ width: 60, height: 60 }}
        >
          <Image
            key={`${scope}:${photo.assetId}`}
            recyclingKey={`${scope}:${photo.assetId}`}
            source={{
              uri: photo.signedUrl,
              headers: { "Cache-Control": "no-store" },
            }}
            cachePolicy="none"
            contentFit="cover"
            style={{ width: 60, height: 60, borderRadius: 8 }}
            accessibilityLabel="Meal photo"
          />
        </Pressable>
      ) : (
        fallback
      )}
      {visible?.message ? (
        <ThemedText accessibilityRole="alert" type="small">
          {visible.message}
        </ThemedText>
      ) : null}
      {visible?.pending ? (
        <>
          <ThemedText type="small">
            Meal saved · photo upload pending
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry meal photo upload"
            disabled={busy}
            onPress={() => void perform("retry")}
            style={{ minHeight: 44, justifyContent: "center" }}
          >
            <ThemedText type="smallBold">
              {busy ? "Uploading…" : "Retry photo"}
            </ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Discard pending meal photo"
            disabled={busy}
            onPress={() => void perform("discard")}
            style={{ minHeight: 44, justifyContent: "center" }}
          >
            <ThemedText type="smallBold">Discard photo</ThemedText>
          </Pressable>
        </>
      ) : null}
      {hasPhoto && !photo && !visible?.pending ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Reload meal photo"
          disabled={busy}
          onPress={() => void load()}
          style={{ minHeight: 44, justifyContent: "center" }}
        >
          <ThemedText type="smallBold">Load photo</ThemedText>
        </Pressable>
      ) : null}
      {editable && photo ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Remove saved meal photo"
          disabled={busy}
          onPress={() => void perform("remove")}
          style={{ minHeight: 44, justifyContent: "center" }}
        >
          <ThemedText type="smallBold">Remove photo</ThemedText>
        </Pressable>
      ) : null}
      {photo && previewScope === scope ? (
        <Modal
          transparent
          animationType="fade"
          visible
          onRequestClose={() => setPreviewScope(null)}
        >
          <View
            style={{
              flex: 1,
              backgroundColor: "rgba(0,0,0,0.92)",
              justifyContent: "center",
              padding: 24,
            }}
          >
            <Image
              key={`${scope}:${photo.assetId}:preview`}
              source={{
                uri: photo.signedUrl,
                headers: { "Cache-Control": "no-store" },
              }}
              cachePolicy="none"
              contentFit="contain"
              style={{ width: "100%", height: "70%" }}
              accessibilityLabel="Meal photo preview"
            />
            {editable ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Remove meal photo from preview"
                disabled={busy}
                onPress={() => void perform("remove")}
                style={{ minHeight: 44, justifyContent: "center" }}
              >
                <ThemedText style={{ color: "#fff", textAlign: "center" }}>
                  Remove photo
                </ThemedText>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close meal photo preview"
              onPress={() => setPreviewScope(null)}
              style={{ minHeight: 44, justifyContent: "center" }}
            >
              <ThemedText style={{ color: "#fff", textAlign: "center" }}>
                Close
              </ThemedText>
            </Pressable>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}
