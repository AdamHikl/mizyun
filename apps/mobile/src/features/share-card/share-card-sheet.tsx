import { useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
  useWindowDimensions,
} from "react-native";
import {
  SHARE_CARD_GYM_NAME_MAX,
  type ShareCardContent,
  type ShareCardOptions,
} from "@mizyun/core";

import { ThemedText } from "@/components/themed-text";
import {
  Button,
  FormTextInput,
  IconButton,
  ListGroup,
  ListRow,
  Notice,
  SegmentedControl,
} from "@/components/ui";
import { Radius, Spacing } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTheme } from "@/hooks/use-theme";
import { trackShareCardResult } from "@/features/analytics/ui-analytics";
import { releaseShareCardImage, shareCardImage } from "./share-card-native";
import { shareCardMark } from "./share-card-mark";
import {
  DEFAULT_SHARE_CARD_PREFERENCES,
  loadShareCardPreferences,
  saveShareCardPreferences,
  type ShareCardPreferences,
} from "./share-card-preferences";
import {
  SHARE_CARD_WIDTH,
  ShareCardView,
  type ShareCardScheme,
} from "./share-card-view";

export interface ShareCardSheetProps {
  readonly visible: boolean;
  readonly userId: string;
  /** Builds the card from core's allowlist for the current choices. */
  readonly build: (options: ShareCardOptions) => ShareCardContent;
  /** Set only for an enrolled Community member with a handle. */
  readonly communityHandle: string | null;
  readonly onClose: () => void;
}

const SCHEME_OPTIONS = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

/**
 * Preview-before-share for the session card (ADR-0082). The preview is the
 * very view that is captured, so what the user sees is what is shared.
 * Nothing is sent anywhere until they pick a target in the system sheet.
 */
export function ShareCardSheet({
  visible,
  userId,
  build,
  communityHandle,
  onClose,
}: ShareCardSheetProps) {
  const theme = useTheme();
  const systemScheme = useColorScheme();
  const { width: windowWidth } = useWindowDimensions();
  const cardRef = useRef<View>(null);
  const [preferences, setPreferences] = useState<ShareCardPreferences>(
    DEFAULT_SHARE_CARD_PREFERENCES,
  );
  const [gymName, setGymName] = useState("");
  const [includeHandle, setIncludeHandle] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Inputs stay disabled until the stored choices load, so a late load can
  // never overwrite what the user typed or toggled.
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!visible || !userId) return;
    let current = true;
    setLoaded(false);
    setMessage(null);
    setIncludeHandle(false);
    void loadShareCardPreferences(userId).then((stored) => {
      if (!current) return;
      setPreferences(stored);
      setGymName(stored.gymName ?? "");
      setLoaded(true);
    });
    return () => {
      current = false;
    };
  }, [visible, userId]);

  useEffect(
    () => () => {
      void releaseShareCardImage();
    },
    [],
  );

  const close = () => {
    void releaseShareCardImage();
    onClose();
  };

  const scheme: ShareCardScheme = preferences.scheme ?? systemScheme;
  const content = useMemo(
    () =>
      build({
        gymName,
        handle: {
          communityMember: communityHandle !== null,
          include: includeHandle,
          handle: communityHandle,
        },
      }),
    [build, gymName, includeHandle, communityHandle],
  );
  const cardWidth = Math.min(SHARE_CARD_WIDTH, windowWidth - Spacing.three * 4);

  const update = (next: ShareCardPreferences) => {
    setPreferences(next);
    void saveShareCardPreferences(userId, next);
  };

  const share = async () => {
    setSharing(true);
    setMessage(null);
    if (preferences.rememberGymName) update({ ...preferences, gymName });
    const outcome = await shareCardImage(cardRef);
    setSharing(false);
    trackShareCardResult(
      content.kind,
      outcome.kind === "shared" ? "share_sheet_shown" : outcome.kind,
    );
    if (outcome.kind === "failed") setMessage(outcome.message);
    else if (outcome.kind === "unavailable")
      setMessage("Sharing images needs the latest version of the app.");
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={close}
    >
      {/* The backdrop is a sibling, not a parent: a ScrollView inside a
          touch-capturing Pressable did not scroll (climber audit gap 3). */}
      <View style={styles.overlay}>
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.overlay }]}
          onPress={close}
          accessible={false}
        />
        <View style={[styles.sheet, { backgroundColor: theme.background }]}>
          <View style={styles.header}>
            <ThemedText
              type="subtitle"
              accessibilityRole="header"
              style={styles.headerTitle}
            >
              Share as image
            </ThemedText>
            <IconButton
              icon="close"
              accessibilityLabel="Close share preview"
              onPress={close}
            />
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            <ThemedText type="small" themeColor="textSecondary">
              This exact image is what you share. It never includes food,
              weight, measurements, photos, notes or Coach text.
              {content.kind === "workout"
                ? " Exercise names appear as you typed them."
                : ""}
            </ThemedText>

            <View style={styles.preview}>
              <ShareCardView
                ref={cardRef}
                content={content}
                scheme={scheme}
                width={cardWidth}
                mark={shareCardMark()}
              />
            </View>

            <SegmentedControl
              accessibilityLabel="Card style"
              options={SCHEME_OPTIONS}
              value={scheme}
              onChange={(value) => {
                if (loaded) update({ ...preferences, scheme: value });
              }}
            />

            <View style={styles.field}>
              <ThemedText type="footnote" themeColor="textSecondary">
                Gym name (optional)
              </ThemedText>
              <FormTextInput
                value={gymName}
                onChangeText={setGymName}
                editable={loaded}
                placeholder="Leave empty to hide"
                maxLength={SHARE_CARD_GYM_NAME_MAX}
                autoCorrect={false}
                returnKeyType="done"
                accessibilityLabel="Gym name on the card"
                accessibilityHint="Optional. Leave empty to keep your gym off the card."
              />
            </View>

            <ListGroup>
              <ListRow
                title="Remember gym name"
                subtitle="Kept on this device only"
                trailing={
                  <Switch
                    accessibilityLabel="Remember gym name on this device"
                    value={preferences.rememberGymName}
                    disabled={!loaded}
                    onValueChange={(rememberGymName) =>
                      update({ ...preferences, rememberGymName, gymName })
                    }
                  />
                }
              />
              {communityHandle !== null ? (
                <ListRow
                  title={`Show @${communityHandle}`}
                  subtitle="Your Community handle"
                  trailing={
                    <Switch
                      accessibilityLabel={`Show your Community handle @${communityHandle} on the card`}
                      value={includeHandle}
                      disabled={!loaded}
                      onValueChange={setIncludeHandle}
                    />
                  }
                />
              ) : null}
            </ListGroup>
          </ScrollView>

          {/* Pinned below the scroll area so it stays reachable at any text size. */}
          <View style={styles.footer}>
            {message ? <Notice tone="warning" message={message} /> : null}
            <Button
              label={sharing ? "Preparing…" : "Share image"}
              icon="share"
              block
              loading={sharing}
              disabled={!loaded}
              accessibilityHint="Opens the system share sheet with this image"
              onPress={() => void share()}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.three,
  },
  sheet: {
    width: "100%",
    maxWidth: 440,
    maxHeight: "92%",
    borderRadius: Radius.xl,
    borderCurve: "continuous",
    padding: Spacing.three,
    gap: Spacing.three,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: Spacing.two,
  },
  headerTitle: { flex: 1 },
  // Sizes to its content but shrinks to fit the sheet's maximum height.
  scroll: { flexGrow: 0, flexShrink: 1 },
  content: { gap: Spacing.three },
  footer: { gap: Spacing.two },
  preview: {
    alignItems: "center",
    borderRadius: Radius.md,
    overflow: "hidden",
  },
  field: { gap: Spacing.one },
});
