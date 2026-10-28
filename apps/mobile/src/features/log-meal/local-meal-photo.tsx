import { useState } from "react";
import { Modal, Pressable, View } from "react-native";
import { Image } from "expo-image";
import { ThemedText } from "@/components/themed-text";
import { useAuth } from "@/features/auth/auth-context";
import { removeLocalPhoto } from "@/features/private-photos/local-photo-library";
import { deleteMealPhoto } from "./meal-photo-retention";
import { mealPhotoScope, rememberPhoto } from "./meal-photo-memory";
import { useAnnouncement } from "@/lib/announce";

/** A meal photo shown from this device's copy (ADR-0079); no network, no disk cache. */
export function LocalMealPhoto({
  owner,
  entryId,
  uri,
  hasServerCopy,
  editable = false,
  onPhotoRemoved,
}: {
  readonly owner: string;
  readonly entryId: string;
  readonly uri: string;
  readonly hasServerCopy: boolean;
  readonly editable?: boolean;
  readonly onPhotoRemoved?: () => void;
}) {
  const { session } = useAuth();
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useAnnouncement(message);
  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      // Remove the backup first so a failure never leaves a server copy the
      // phone no longer shows.
      if (hasServerCopy) {
        const result = await deleteMealPhoto(entryId).catch(() => null);
        if (!result?.ok) {
          setMessage("Photo could not be removed. Try again.");
          return;
        }
        // Forget the deleted backup's signed link for this session.
        rememberPhoto(
          mealPhotoScope(owner, session?.accessToken ?? "", entryId),
          null,
        );
      }
      if (!removeLocalPhoto(owner, "meal", entryId)) {
        setMessage("Photo could not be removed. Try again.");
        return;
      }
      setPreview(false);
      onPhotoRemoved?.();
    } finally {
      setBusy(false);
    }
  };
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 8,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="View meal photo"
        onPress={() => setPreview(true)}
        style={{ width: 60, height: 60 }}
      >
        <Image
          key={uri}
          recyclingKey={uri}
          source={{ uri }}
          cachePolicy="none"
          contentFit="cover"
          style={{ width: 60, height: 60, borderRadius: 8 }}
          accessibilityLabel="Meal photo"
        />
      </Pressable>
      {message ? (
        <ThemedText accessibilityRole="alert" type="small">
          {message}
        </ThemedText>
      ) : null}
      {editable ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Remove saved meal photo"
          disabled={busy}
          onPress={() => void remove()}
          style={{ minHeight: 44, justifyContent: "center" }}
        >
          <ThemedText type="smallBold">Remove photo</ThemedText>
        </Pressable>
      ) : null}
      {preview ? (
        <Modal
          transparent
          animationType="fade"
          visible
          onRequestClose={() => setPreview(false)}
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
              key={`${uri}:preview`}
              source={{ uri }}
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
                onPress={() => void remove()}
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
              onPress={() => setPreview(false)}
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
