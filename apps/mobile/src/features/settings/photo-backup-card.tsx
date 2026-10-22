import { useRef, useState } from "react";
import { Alert, Platform, StyleSheet, Switch, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Button, ListGroup, ListRow, SectionHeader } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import {
  removePhotoBackups,
  savePhotoBackupEnabled,
  waitForPhotoBackupSync,
  usePhotoBackupEnabled,
} from "@/features/private-photos";

/** "Back up photos" (ADR-0079): meal and boulder photos stay on this phone unless turned on. */
export function PhotoBackupCard({ userId }: { readonly userId?: string }) {
  const theme = useTheme();
  const enabled = usePhotoBackupEnabled(userId ?? null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const owner = useRef(userId);
  owner.current = userId;

  const removeBackups = async () => {
    if (!userId || busy) return;
    setBusy(true);
    setFeedback("Saving photos to this phone and removing backups…");
    // Let a background upload in flight finish so the list includes it.
    await waitForPhotoBackupSync();
    const result = await removePhotoBackups(userId, {
      isCurrent: () => owner.current === userId,
      onProgress: (done, total) =>
        setFeedback(`Removing backups… ${done} of ${total}`),
    }).catch(() => null);
    if (owner.current !== userId) return;
    setBusy(false);
    if (!result) {
      setFeedback("Backups could not be checked. Try again.");
      return;
    }
    const parts = [
      result.removed === 1
        ? "Removed 1 backed-up photo."
        : `Removed ${result.removed} backed-up photos.`,
    ];
    if (result.kept > 0)
      parts.push(
        `${result.kept} couldn't be saved to this phone first, so their backup was kept. Try again later.`,
      );
    if (result.truncated) parts.push("Run this again to remove the rest.");
    setFeedback(parts.join(" "));
  };

  const setEnabled = async (next: boolean) => {
    if (!userId || busy) return;
    if (next) {
      const saved = await savePhotoBackupEnabled(userId, true);
      setFeedback(
        saved
          ? "Backup is on. Photos only on this phone will upload in the background (meal photos with Pro)."
          : "The setting could not be saved. Try again.",
      );
      return;
    }
    Alert.alert(
      "Turn off photo backup?",
      "New photos will stay only on this phone. Photos already backed up can stay backed up or be removed from Mizyun's servers.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Keep backed-up copies",
          onPress: () =>
            void savePhotoBackupEnabled(userId, false).then((saved) =>
              setFeedback(
                saved
                  ? "Backup is off. Existing backups were kept."
                  : "The setting could not be saved. Try again.",
              ),
            ),
        },
        {
          text: "Remove backed-up copies",
          style: "destructive",
          onPress: () =>
            void savePhotoBackupEnabled(userId, false).then((saved) => {
              if (saved) void removeBackups();
              else setFeedback("The setting could not be saved. Try again.");
            }),
        },
      ],
    );
  };

  return (
    <View style={styles.page}>
      <SectionHeader title="Meal & boulder photos" />
      <ListGroup>
        <ListRow
          title="Back up photos"
          subtitle="Photos you keep with meals and boulders are stored on this phone. Turn this on to also keep a private copy on Mizyun's servers, so they come back on a new phone. Meal photo backup needs Pro."
          trailing={
            <Switch
              accessibilityLabel="Back up photos"
              value={enabled === true}
              disabled={enabled === null || busy || !userId}
              onValueChange={(value) => void setEnabled(value)}
              trackColor={{ true: theme.primary }}
            />
          }
        />
      </ListGroup>
      <ThemedText type="footnote" themeColor="textSecondary">
        {Platform.OS === "ios"
          ? "With backup off, photos are included only in this iPhone's own iCloud or computer backup. Deleting the app removes them."
          : "With backup off, photos are not included in Android's phone backup. Deleting the app or changing phones removes them."}{" "}
        Community posts are uploaded separately when you share.
      </ThemedText>
      {enabled === false ? (
        <Button
          variant="plain"
          label={busy ? "Removing backups…" : "Remove backed-up copies"}
          accessibilityLabel="Remove backed-up photo copies from Mizyun's servers"
          disabled={busy || !userId}
          onPress={() =>
            Alert.alert(
              "Remove backed-up copies?",
              "Each photo is saved to this phone first, then its copy on Mizyun's servers is deleted.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Remove",
                  style: "destructive",
                  onPress: () => void removeBackups(),
                },
              ],
            )
          }
        />
      ) : null}
      {feedback ? (
        <ThemedText
          type="footnote"
          themeColor="primary"
          accessibilityLiveRegion="polite"
        >
          {feedback}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: Spacing.three },
});
