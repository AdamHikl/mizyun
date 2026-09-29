import { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

export interface AiConsentModalProps {
  readonly visible: boolean;
  readonly isSaving?: boolean;
  readonly error?: string | null;
  readonly currentBirthYear?: number | null;
  readonly onConsent: (birthYear?: number) => void | Promise<void>;
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
  isSaving = false,
  error = null,
  currentBirthYear = null,
  onConsent,
  onDecline,
}: AiConsentModalProps) {
  const theme = useTheme();
  const [birthYearInput, setBirthYearInput] = useState("");

  const currentYear = new Date().getFullYear();
  const needsBirthYear = currentBirthYear == null;

  let parsedBirthYear: number | undefined = undefined;
  let validationError: string | null = null;

  if (needsBirthYear) {
    const trimmed = birthYearInput.trim();
    if (trimmed.length > 0) {
      const num = Number(trimmed);
      if (!Number.isInteger(num) || num < 1900 || num > currentYear) {
        validationError = "Please enter a valid birth year (e.g. 1995).";
      } else if (currentYear - num < 18) {
        validationError =
          "Mizyun AI features require you to be 18 years or older.";
      } else {
        parsedBirthYear = num;
      }
    }
  } else if (currentBirthYear !== null && currentYear - currentBirthYear < 18) {
    validationError =
      "Mizyun AI features require adult eligibility (18 years or older).";
  }

  const isConsentDisabled =
    isSaving ||
    (needsBirthYear && parsedBirthYear === undefined) ||
    validationError !== null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={
        Platform.OS === "ios"
          ? Platform.isPad
            ? "formSheet"
            : "pageSheet"
          : undefined
      }
      onRequestClose={isSaving ? undefined : onDecline}
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
                Google processes submitted data to generate your response and
                may retain prompts, context, and output for abuse monitoring for
                up to 55 days. Additional use depends on the applicable Gemini
                API service terms, billing status, and region; Mizyun does not
                promise that every submission is excluded from Google product
                improvement.
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
              {needsBirthYear && (
                <View style={styles.birthYearSection}>
                  <ThemedText type="smallBold">
                    Confirm your birth year:
                  </ThemedText>
                  <TextInput
                    style={[
                      styles.birthYearInput,
                      {
                        color: theme.text,
                        borderColor: validationError ? "#EF4444" : theme.border,
                        backgroundColor: theme.backgroundElement,
                      },
                    ]}
                    placeholder={`YYYY (e.g. ${currentYear - 25})`}
                    placeholderTextColor="#64748B"
                    keyboardType="number-pad"
                    maxLength={4}
                    value={birthYearInput}
                    onChangeText={setBirthYearInput}
                    editable={!isSaving}
                    accessibilityLabel="Birth year for adult verification"
                  />
                  {validationError && (
                    <ThemedText type="small" style={styles.validationText}>
                      {validationError}
                    </ThemedText>
                  )}
                </View>
              )}
              {!needsBirthYear && validationError && (
                <ThemedText type="small" style={styles.validationText}>
                  {validationError}
                </ThemedText>
              )}
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
            {error && (
              <View style={styles.errorBanner}>
                <ThemedText type="small" style={styles.errorBannerText}>
                  {error}
                </ThemedText>
              </View>
            )}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Confirm adult eligibility and grant AI consent"
              accessibilityState={{
                disabled: isConsentDisabled,
                busy: isSaving,
              }}
              disabled={isConsentDisabled}
              onPress={() => void onConsent(parsedBirthYear)}
              style={({ pressed }) => [
                styles.primaryButton,
                isConsentDisabled && styles.disabledPrimaryButton,
                pressed && !isConsentDisabled && styles.pressed,
              ]}
            >
              {isSaving ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <ThemedText type="smallBold" style={styles.primaryButtonText}>
                  I am 18+ and I Consent
                </ThemedText>
              )}
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Decline AI consent"
              accessibilityState={{ disabled: isSaving }}
              disabled={isSaving}
              onPress={onDecline}
              style={({ pressed }) => [
                styles.secondaryButton,
                isSaving && styles.disabledSecondaryButton,
                pressed && !isSaving && styles.pressed,
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
  birthYearSection: {
    marginTop: Spacing.two,
    gap: Spacing.one,
  },
  birthYearInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
    fontSize: 16,
  },
  validationText: {
    color: "#EF4444",
    marginTop: 2,
  },
  buttonContainer: {
    padding: Spacing.four,
    borderTopWidth: 1,
    gap: Spacing.two,
  },
  errorBanner: {
    backgroundColor: "rgba(239, 68, 68, 0.12)",
    borderColor: "#EF4444",
    borderWidth: 1,
    borderRadius: 8,
    padding: Spacing.two,
  },
  errorBannerText: {
    color: "#EF4444",
    textAlign: "center",
  },
  primaryButton: {
    backgroundColor: "#10B981",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  disabledPrimaryButton: {
    backgroundColor: "#6EE7B7",
    opacity: 0.6,
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
    minHeight: 44,
  },
  disabledSecondaryButton: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.8,
  },
});
