import { Modal, Pressable, StyleSheet, View } from "react-native";

import { Spacing } from "@/constants/theme";

import { ThemedText } from "./themed-text";
import { ThemedView } from "./themed-view";

export interface BetaNoticeModalProps {
  readonly visible: boolean;
  readonly onClose: () => void;
}

export function BetaNoticeModal({ visible, onClose }: BetaNoticeModalProps) {
  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <View accessibilityViewIsModal style={styles.scrim}>
        <ThemedView style={styles.dialog}>
          <BetaNoticeContent />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close beta notice"
            onPress={onClose}
            style={({ pressed }) => [
              styles.dismissButton,
              pressed && styles.pressed,
            ]}
          >
            <ThemedText type="smallBold" style={styles.dismissButtonText}>
              Got it
            </ThemedText>
          </Pressable>
        </ThemedView>
      </View>
    </Modal>
  );
}

export function BetaNoticeCard() {
  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <BetaNoticeContent />
    </ThemedView>
  );
}

function BetaNoticeContent() {
  return (
    <View style={styles.content}>
      <ThemedText type="smallBold" style={styles.eyebrow}>
        MIZYUN BETA
      </ThemedText>
      <ThemedText type="smallBold">You’re helping us test Mizyun.</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        You may find bugs, some features may behave differently than expected,
        and some may not be enabled yet.
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        We highly value every kind of feedback—please tell us what works and
        what does not.
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderColor: "rgba(12, 112, 237, 0.4)",
    borderRadius: 14,
    borderWidth: 1,
    gap: Spacing.three,
    padding: Spacing.four,
  },
  content: {
    gap: Spacing.two,
  },
  dialog: {
    borderRadius: 20,
    gap: Spacing.four,
    maxWidth: 420,
    padding: Spacing.four,
    width: "100%",
  },
  dismissButton: {
    alignItems: "center",
    backgroundColor: "#0C70ED",
    borderRadius: 12,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: Spacing.three,
  },
  dismissButtonText: {
    color: "#FFFFFF",
  },
  eyebrow: {
    color: "#0C70ED",
    fontSize: 11,
    letterSpacing: 0.8,
  },
  pressed: {
    opacity: 0.75,
  },
  scrim: {
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    flex: 1,
    justifyContent: "center",
    padding: Spacing.four,
  },
});
