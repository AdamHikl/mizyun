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
import {
  inFlightPhotoRead,
  mealPhotoMemoryGeneration,
  mealPhotoScope,
  rememberPhoto,
  rememberedPhoto,
  sharedPhotoRead,
} from "./meal-photo-memory";
import { keepMealBackupOnDevice } from "./meal-photo-download";

/** Signed URLs exist only in this account/request generation and never reach a disk cache. */
export function PrivateMealPhoto({
  entryId,
  hasPhoto,
  photoAssetId,
  editable = false,
  fallback = null,
  onPhotoRemoved,
  displayEnabled = true,
}: {
  readonly entryId: string;
  readonly hasPhoto: boolean;
  readonly photoAssetId?: string | null;
  readonly editable?: boolean;
  readonly fallback?: ReactNode;
  readonly onPhotoRemoved?: () => void;
  readonly displayEnabled?: boolean;
}) {
  const { session } = useAuth();
  const owner = session?.user.id ?? null;
  const scope = mealPhotoScope(
    owner ?? "",
    session?.accessToken ?? "",
    entryId,
  );
  const current = useRef(scope);
  current.current = scope;
  const currentDisplay = useRef(displayEnabled);
  currentDisplay.current = displayEnabled;
  const generation = useRef(0);
  const [state, setState] = useState<{
    scope: string;
    photo: StoredMealPhoto | null;
    pending: boolean;
    message: string | null;
    removed?: boolean;
    // Text-only state captured while display was off must not hide a
    // remembered photo once display returns (for example on tab refocus).
    textOnly?: boolean;
  } | null>(null);
  const [previewScope, setPreviewScope] = useState<string | null>(null);
  const [busyScope, setBusyScope] = useState<string | null>(null);
  const enabled = mealPhotoRetentionEnabled();
  const load = async (force = false) => {
    const requestGeneration = ++generation.current;
    const valid = () =>
      current.current === scope && generation.current === requestGeneration;
    if (!owner || (displayEnabled && !enabled)) return;
    const memoryGeneration = mealPhotoMemoryGeneration();
    const pending = await loadMealPhotoRetry(owner, entryId);
    if (!valid()) return;
    if (!currentDisplay.current) {
      setState({
        scope,
        photo: null,
        pending: pending !== null,
        message: null,
        textOnly: true,
      });
      return;
    }
    if (!hasPhoto) rememberPhoto(scope, null);
    if (!hasPhoto && !pending && !force) {
      setState({ scope, photo: null, pending: false, message: null });
      return;
    }
    const remembered = force ? null : rememberedPhoto(scope, photoAssetId);
    if (remembered) {
      setState({
        scope,
        photo: remembered,
        pending: pending !== null,
        message: null,
      });
      return;
    }
    const read = () => fetchMealPhoto(entryId);
    // Join a prefetch in flight, but read again rather than inherit its failure.
    const joined = force
      ? null
      : inFlightPhotoRead<Awaited<ReturnType<typeof read>>>(scope);
    let response = joined ? await joined : null;
    if (!valid()) return;
    if (!response?.ok)
      response = await (force ? read() : sharedPhotoRead(scope, read));
    if (!valid()) return;
    if (response.ok) {
      rememberPhoto(scope, response.value.photo, memoryGeneration);
      keepMealBackupOnDevice(owner, entryId, response.value.photo);
    }
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
  }, [scope, enabled, hasPhoto, photoAssetId, displayEnabled]);
  if (!owner) return displayEnabled ? fallback : null;
  if (displayEnabled && !enabled) return fallback;
  const sameScope = state?.scope === scope ? state : null;
  // Text-only state from while display was off knows nothing about the photo.
  const staleTextOnly = displayEnabled && hasPhoto && sameScope?.textOnly;
  const settled = staleTextOnly ? null : sameScope;
  const remembered =
    displayEnabled && hasPhoto && !settled
      ? rememberedPhoto(scope, photoAssetId)
      : null;
  const visible = settled
    ? settled
    : remembered
      ? {
          scope,
          photo: remembered,
          pending: sameScope?.pending ?? false,
          message: null,
        }
      : null;
  if (!displayEnabled && !editable) return null;
  if (!hasPhoto && !visible?.photo && !visible?.pending)
    return displayEnabled ? fallback : null;
  const busy = busyScope === scope;
  const perform = async (action: "retry" | "discard" | "remove") => {
    if (busy || (action === "retry" && !currentDisplay.current)) return;
    const requestGeneration = ++generation.current;
    const valid = () =>
      current.current === scope &&
      generation.current === requestGeneration &&
      (action !== "retry" || currentDisplay.current);
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
        if (ok) rememberPhoto(scope, null);
        if (ok && valid()) onPhotoRemoved?.();
        if (ok && valid()) ok = await removeMealPhotoRetry(owner, entryId);
      }
      if (!valid()) return;
      if (ok && !currentDisplay.current)
        setState({
          scope,
          photo: null,
          pending: false,
          message: null,
          removed: action === "remove" || visible?.removed === true,
          textOnly: true,
        });
      else if (ok) await load(true);
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
  if (!displayEnabled) {
    const canRemove = hasPhoto && visible?.removed !== true;
    if (!canRemove && !visible?.pending && !visible?.message) return null;
    return (
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {visible?.message ? (
          <ThemedText accessibilityRole="alert" type="small">
            {visible.message}
          </ThemedText>
        ) : null}
        {canRemove ? (
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
        {visible?.pending ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Discard pending meal photo"
            disabled={busy}
            onPress={() => void perform("discard")}
            style={{ minHeight: 44, justifyContent: "center" }}
          >
            <ThemedText type="smallBold">Discard photo</ThemedText>
          </Pressable>
        ) : null}
      </View>
    );
  }
  const photo = visible?.photo;
  // Until the first read settles, hold the tile's space instead of flashing
  // the illustration and a reload control for a meal that has a photo.
  const resolving = hasPhoto && !visible;
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
            if (!currentDisplay.current) return;
            if (Date.parse(photo.expiresAt) <= Date.now()) {
              rememberPhoto(scope, null);
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
            cachePolicy="memory"
            contentFit="cover"
            style={{ width: 60, height: 60, borderRadius: 8 }}
            accessibilityLabel="Meal photo"
          />
        </Pressable>
      ) : resolving ? (
        <View
          accessible
          accessibilityLabel="Loading meal photo"
          style={{
            width: 60,
            height: 60,
            borderRadius: 8,
            backgroundColor: "rgba(127,127,127,0.15)",
          }}
        />
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
      {hasPhoto && visible && !photo && !visible.pending ? (
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
              cachePolicy="memory"
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
