import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

export interface AiConsentModalProps {
  readonly visible: boolean;
  readonly onConsent: () => void;
  readonly onDecline: () => void;
}

/**
 * Explicit disclosure and consent dialog for third-party AI processing.
 * Addresses Finding R5 (REL-AUD-005):
 * - Discloses Google LLC (Google Gemini API) as the processing provider.
 * - Details what data is sent (meal photos, meal descriptions, coaching context).
 * - Clarifies data handling (transient processing, not used for public model training).
 * - Enforces adult eligibility requirement (18+).
 * - Apple App Store Guideline compliance (explicit consent before third-party sharing).
 */
export function AiConsentModal({
  visible,
  onConsent,
  onDecline,
}: AiConsentModalProps) {
  const theme = useTheme();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onDecline}
    >
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
          <View style={styles.header}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              MIZYUN AI DISCLOSURE
            </ThemedText>
            <ThemedText type="subtitle" style={styles.title}>
              Third-Party AI &amp; Privacy
            </ThemedText>
          </View>

          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={true}
          >
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold" style={styles.cardHeader}>
                1. Third-Party Provider
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                AI features in Mizyun (Coach conversation and photo-based meal
                drafting) are powered by Google LLC (&ldquo;Google Gemini
                API&rdquo;).
              </ThemedText>
            </ThemedView>

            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold" style={styles.cardHeader}>
                2. Data Shared with Google
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                When you choose to chat with Coach or submit meal photos for
                nutrition estimation, the text of your questions, confirmed
                fitness context (workout totals, weight trends, confirmed meals,
                and active goals), and photo bytes are transmitted to Google
                Gemini for inference.
              </ThemedText>
            </ThemedView>

            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold" style={styles.cardHeader}>
                3. Privacy &amp; Model Training
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Under the Google Gemini API Terms of Service, data sent through
                the API is processed transiently to generate your response. Your
                personal logs and meal photos are{" "}
                <ThemedText type="smallBold">not</ThemedText> used to train
                Google&rsquo;s public foundation models. Limited logs may be
                retained by Google for abuse monitoring up to 30 days.
              </ThemedText>
            </ThemedView>

            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold" style={styles.cardHeader}>
                4. Adult Eligibility (18+)
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Google&rsquo;s API Terms require that AI features only be used
                by individuals who are 18 years of age or older. By continuing,
                you confirm that you are at least 18 years old.
              </ThemedText>
            </ThemedView>

            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold" style={styles.cardHeader}>
                5. Advisory &amp; Wellness Only
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                AI suggestions are advisory and may contain inaccuracies. Mizyun
                is for fitness and general wellness guidance only—never medical
                diagnosis, dietary prescriptions, or medical treatment.
              </ThemedText>
            </ThemedView>
          </ScrollView>

          <View
            style={[
              styles.buttonContainer,
              {
                borderTopColor: theme.border,
              },
            ]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Confirm adult eligibility and grant AI consent"
              onPress={onConsent}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.pressed,
              ]}
            >
              <ThemedText type="smallBold" style={styles.primaryButtonText}>
                I am 18+ and I Consent
              </ThemedText>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Decline AI consent"
              onPress={onDecline}
              style={({ pressed }) => [
                styles.secondaryButton,
                pressed && styles.pressed,
              ]}
            >
              <ThemedText type="smallBold" themeColor="textSecondary">
                Not Now / Decline
              </ThemedText>
            </Pressable>
          </View>
        </SafeAreaView>
      </ThemedView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  header: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.three,
    gap: 4,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.four,
    gap: Spacing.three,
  },
  card: {
    padding: Spacing.four,
    borderRadius: 16,
    gap: 8,
  },
  cardHeader: {
    fontSize: 15,
  },
  buttonContainer: {
    padding: Spacing.four,
    borderTopWidth: 1,
    gap: Spacing.two,
  },
  primaryButton: {
    backgroundColor: "#10B981",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
  },
  secondaryButton: {
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.8,
  },
});
