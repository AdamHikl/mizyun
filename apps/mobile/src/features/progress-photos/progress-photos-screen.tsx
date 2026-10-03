import { Image } from "expo-image";
import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { apiClient } from "@/composition/api-client";
import { analyticsClient } from "@/composition/analytics-client";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { BottomTabInset, MaxContentWidth, Spacing } from "@/constants/theme";
import { useAuth } from "@/features/auth/auth-context";
import type {
  MediaCompareResponse,
  MediaTimelineResponse,
} from "@mizyun/contracts";

import {
  compareProgressPhotos,
  deleteProgressPhoto,
  fetchProgressTimeline,
  progressPhotoErrorMessage,
  uploadProgressPhoto,
  type PreparedProgressPhoto,
} from "./progress-photo-data";

const MAX_IMAGE_EDGE = 2048;

const normalizeImage = async (
  asset: ImagePicker.ImagePickerAsset,
): Promise<PreparedProgressPhoto> => {
  const context = ImageManipulator.manipulate(asset.uri);
  const longestEdge = Math.max(asset.width, asset.height);
  if (longestEdge > MAX_IMAGE_EDGE) {
    if (asset.width >= asset.height) {
      context.resize({ width: MAX_IMAGE_EDGE, height: null });
    } else {
      context.resize({ width: null, height: MAX_IMAGE_EDGE });
    }
  }
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({
    compress: 0.85,
    format: SaveFormat.JPEG,
  });
  const file = new File(saved.uri);
  if (!file.exists || file.size <= 0) {
    throw new Error("The selected photo could not be read.");
  }
  return {
    uri: saved.uri,
    mimeType: "image/jpeg",
    byteSize: file.size,
    width: saved.width,
    height: saved.height,
    capturedAt: new Date().toISOString(),
  };
};

const dateLabel = (iso: string): string =>
  new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(`${iso}T12:00:00Z`));

export function ProgressPhotosScreen() {
  const { session } = useAuth();
  const [timeline, setTimeline] = useState<MediaTimelineResponse | null>(null);
  const [selectedPhoto, setSelectedPhoto] =
    useState<PreparedProgressPhoto | null>(null);
  const [selectedIds, setSelectedIds] = useState<ReadonlyArray<string>>([]);
  const [comparison, setComparison] = useState<MediaCompareResponse | null>(
    null,
  );
  const [consented, setConsented] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const principal = session
    ? { userId: session.user.id, accessToken: session.accessToken }
    : null;

  const ownerKey = `${principal?.userId ?? ""}:${principal?.accessToken ?? ""}`;
  const currentOwner = useRef(ownerKey);
  currentOwner.current = ownerKey;
  const requestVersion = useRef(0);
  const loaded = useRef(false);
  useEffect(() => {
    requestVersion.current += 1;
    loaded.current = false;
    setTimeline(null);
    setSelectedPhoto(null);
    setSelectedIds([]);
    setComparison(null);
    setConsented(false);
    setError(null);
    setLoading(principal !== null);
  }, [ownerKey]);

  const refresh = useCallback(async (): Promise<void> => {
    if (principal === null) return;
    const version = ++requestVersion.current;
    const requestOwner = ownerKey;
    setLoading(!loaded.current);
    const result = await fetchProgressTimeline(apiClient, principal);
    if (
      version !== requestVersion.current ||
      requestOwner !== currentOwner.current
    )
      return;
    if (result.ok) {
      loaded.current = true;
      setTimeline(result.value);
      setError(null);
    } else {
      setError(progressPhotoErrorMessage(result.error));
    }
    setLoading(false);
  }, [principal?.accessToken, principal?.userId, ownerKey]);

  useFocusEffect(
    useCallback(() => {
      void analyticsClient.track({
        name: "feature_viewed",
        properties: { feature: "progress_photos" },
      });
      void refresh();
      const subscription = AppState.addEventListener("change", (state) => {
        if (state === "active") void refresh();
      });
      return () => subscription.remove();
    }, [refresh]),
  );

  const acceptPickerResult = useCallback(
    async (result: ImagePicker.ImagePickerResult): Promise<void> => {
      if (result.canceled || !result.assets[0]) return;
      setBusy(true);
      setError(null);
      try {
        setSelectedPhoto(await normalizeImage(result.assets[0]));
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "The selected photo could not be prepared.",
        );
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  useEffect(() => {
    let active = true;
    void ImagePicker.getPendingResultAsync()
      .then((pending) => {
        if (!active || pending === null) return;
        if ("canceled" in pending) {
          void acceptPickerResult(pending);
        } else {
          setError(pending.message);
        }
      })
      .catch(() => {
        if (active) {
          setError("The pending photo selection could not be recovered.");
        }
      });
    return () => {
      active = false;
    };
  }, [acceptPickerResult]);

  const requireConsent = (): boolean => {
    if (consented) return true;
    setError("Confirm the private-photo consent before choosing a photo.");
    return false;
  };

  const choosePhoto = async (): Promise<void> => {
    if (!requireConsent()) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: false,
      allowsMultipleSelection: false,
      exif: false,
      quality: 1,
    });
    await acceptPickerResult(result);
  };

  const takePhoto = async (): Promise<void> => {
    if (!requireConsent()) return;
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError("Camera permission is required to take a progress photo.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      allowsEditing: false,
      exif: false,
      quality: 1,
    });
    await acceptPickerResult(result);
  };

  const upload = async (): Promise<void> => {
    if (principal === null || selectedPhoto === null || busy) return;
    setBusy(true);
    setError(null);
    const result = await uploadProgressPhoto(
      apiClient,
      principal,
      selectedPhoto,
    );
    if (result.ok) {
      setSelectedPhoto(null);
      setConsented(false);
      await refresh();
    } else {
      setError(progressPhotoErrorMessage(result.error));
    }
    setBusy(false);
  };

  const toggleSelected = (assetId: string): void => {
    setComparison(null);
    setSelectedIds((current) => {
      if (current.includes(assetId)) {
        return current.filter((id) => id !== assetId);
      }
      return current.length < 2
        ? [...current, assetId]
        : [current[1]!, assetId];
    });
  };

  const compare = async (): Promise<void> => {
    if (principal === null || selectedIds.length !== 2) return;
    setBusy(true);
    const result = await compareProgressPhotos(
      apiClient,
      principal,
      selectedIds[0]!,
      selectedIds[1]!,
    );
    if (result.ok) {
      setComparison(result.value);
      setError(null);
    } else {
      setError(progressPhotoErrorMessage(result.error));
    }
    setBusy(false);
  };

  const confirmDelete = (assetId: string): void => {
    Alert.alert(
      "Delete progress photo?",
      "The private image bytes will be permanently removed. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete permanently",
          style: "destructive",
          onPress: () => {
            if (principal === null) return;
            setBusy(true);
            void deleteProgressPhoto(apiClient, principal, assetId).then(
              async (result) => {
                if (result.ok) {
                  setSelectedIds((ids) => ids.filter((id) => id !== assetId));
                  setComparison(null);
                  await refresh();
                } else {
                  setError(progressPhotoErrorMessage(result.error));
                }
                setBusy(false);
              },
            );
          },
        },
      ],
    );
  };

  const entries = timeline?.buckets.flatMap((bucket) => bucket.entries) ?? [];

  return (
    <ThemedView style={styles.page}>
      <SafeAreaView style={styles.safeArea} edges={["left", "right", "bottom"]}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.card}>
            <ThemedText type="subtitle">Private by default</ThemedText>
            <ThemedText themeColor="textSecondary">
              Photos are sensitive. Mizyun uploads only the photo you choose,
              stores it in your private account folder, and never uses it as an
              authoritative body or nutrition measurement.
            </ThemedText>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: consented }}
              accessibilityLabel="Consent to upload a private progress photo"
              onPress={() => setConsented((value) => !value)}
              style={[styles.consent, consented && styles.selected]}
            >
              <ThemedText type="smallBold">
                {consented ? "✓ " : "○ "}I choose to upload this photo to my
                private timeline.
              </ThemedText>
            </Pressable>
            <View style={styles.row}>
              <Pressable
                accessibilityRole="button"
                onPress={() => void takePhoto()}
                disabled={busy}
                style={styles.primaryButton}
              >
                <ThemedText type="smallBold" style={styles.buttonText}>
                  Take photo
                </ThemedText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => void choosePhoto()}
                disabled={busy}
                style={styles.secondaryButton}
              >
                <ThemedText type="smallBold">Choose photo</ThemedText>
              </Pressable>
            </View>
            {selectedPhoto ? (
              <View style={styles.previewBlock}>
                <Image
                  source={selectedPhoto.uri}
                  style={styles.preview}
                  contentFit="cover"
                  accessibilityLabel="Selected progress photo preview"
                />
                <ThemedText themeColor="textSecondary">
                  {selectedPhoto.width} × {selectedPhoto.height} ·{" "}
                  {Math.ceil(selectedPhoto.byteSize / 1024)} KB JPEG
                </ThemedText>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void upload()}
                  disabled={busy}
                  style={styles.primaryButton}
                >
                  <ThemedText type="smallBold" style={styles.buttonText}>
                    Upload privately
                  </ThemedText>
                </Pressable>
              </View>
            ) : null}
          </View>

          {error ? (
            <ThemedText accessibilityRole="alert" style={styles.error}>
              {error}
            </ThemedText>
          ) : null}
          {busy || loading ? (
            <ActivityIndicator accessibilityLabel="Loading photos" />
          ) : null}

          <View style={styles.sectionHeader}>
            <View>
              <ThemedText type="subtitle">Timeline</ThemedText>
              <ThemedText themeColor="textSecondary">
                Select two photos to compare.
              </ThemedText>
            </View>
            <Pressable
              accessibilityRole="button"
              disabled={selectedIds.length !== 2 || busy}
              onPress={() => void compare()}
              style={[
                styles.secondaryButton,
                selectedIds.length !== 2 && styles.disabled,
              ]}
            >
              <ThemedText type="smallBold">Compare</ThemedText>
            </Pressable>
          </View>

          {entries.length === 0 && !loading ? (
            <View style={styles.card}>
              <ThemedText>No progress photos yet.</ThemedText>
            </View>
          ) : null}

          <View style={styles.grid}>
            {entries.map((entry) => {
              const selected = selectedIds.includes(entry.asset.id);
              return (
                <View key={entry.asset.id} style={styles.photoCard}>
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected }}
                    accessibilityLabel={`Progress photo from ${dateLabel(entry.asset.createdAt.slice(0, 10))}`}
                    onPress={() => toggleSelected(entry.asset.id)}
                    style={[styles.imageFrame, selected && styles.selected]}
                  >
                    <Image
                      source={entry.signedUrl}
                      style={styles.thumbnail}
                      contentFit="cover"
                      accessibilityIgnoresInvertColors
                    />
                  </Pressable>
                  <ThemedText type="smallBold">
                    {dateLabel(entry.asset.createdAt.slice(0, 10))}
                  </ThemedText>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Delete this progress photo"
                    onPress={() => confirmDelete(entry.asset.id)}
                  >
                    <ThemedText style={styles.deleteText}>Delete</ThemedText>
                  </Pressable>
                </View>
              );
            })}
          </View>

          {comparison ? (
            <View style={styles.card}>
              <ThemedText type="subtitle">Comparison</ThemedText>
              <ThemedText themeColor="textSecondary">
                {Math.abs(comparison.daysBetween)} days apart · visual reference
                only
              </ThemedText>
              <View style={styles.row}>
                {[comparison.sideA, comparison.sideB].map((side) => (
                  <Image
                    key={side.asset.id}
                    source={side.signedUrl}
                    style={styles.compareImage}
                    contentFit="cover"
                    accessibilityLabel={`Compared progress photo from ${dateLabel(side.asset.createdAt.slice(0, 10))}`}
                  />
                ))}
              </View>
            </View>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  safeArea: { flex: 1 },
  content: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    padding: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.six,
    gap: Spacing.four,
  },
  card: {
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.15)",
    borderRadius: 18,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  consent: {
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.3)",
    borderRadius: 14,
    padding: Spacing.three,
  },
  selected: { borderColor: "#10B981", borderWidth: 2 },
  row: { flexDirection: "row", gap: Spacing.two, alignItems: "center" },
  primaryButton: {
    flex: 1,
    backgroundColor: "#10B981",
    borderRadius: 14,
    padding: Spacing.three,
    alignItems: "center",
  },
  secondaryButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.3)",
    borderRadius: 14,
    padding: Spacing.three,
    alignItems: "center",
  },
  buttonText: { color: "#FFFFFF" },
  disabled: { opacity: 0.45 },
  previewBlock: { gap: Spacing.two },
  preview: { width: "100%", aspectRatio: 3 / 4, borderRadius: 14 },
  error: { color: "#EF4444" },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: Spacing.three,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.three },
  photoCard: { width: "47%", gap: Spacing.one },
  imageFrame: { borderRadius: 14, overflow: "hidden" },
  thumbnail: { width: "100%", aspectRatio: 3 / 4 },
  deleteText: { color: "#EF4444" },
  compareImage: { flex: 1, aspectRatio: 3 / 4, borderRadius: 14 },
});
