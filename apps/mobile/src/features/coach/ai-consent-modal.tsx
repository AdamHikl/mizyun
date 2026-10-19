import { useState } from "react";
import {
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Button, Card, Notice } from "@/components/ui";
import {
  MaxContentWidth,
  PageGutter,
  Radius,
  Spacing,
} from "@/constants/theme";
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
 * - Lists each AI feature and the data it sends (Coach, meal drafts and
 *   illustrations, recipes, Log activity descriptions).
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
            <ThemedText type="footnote" themeColor="textSecondary">
              Mizyun AI disclosure
            </ThemedText>
            <ThemedText type="subtitle" accessibilityRole="header">
              Third-Party AI &amp; Privacy
            </ThemedText>
          </View>

          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={true}
          >
            <Card>
              <ThemedText type="headline">1. Third-Party Provider</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                AI features in Mizyun are powered by Google LLC (&ldquo;Google
                Gemini API&rdquo;): Coach, meal drafts from photos or
                descriptions, meal illustrations, recipe ideas and the cooking
                assistant, and filling in Log activity from a description.
              </ThemedText>
            </Card>

            <Card>
              <ThemedText type="headline">
                2. Data Shared with Google
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Data is sent to Google Gemini only for these features:
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                &bull; Coach: your messages and photos, your recent
                conversation, saved Coach memories, and confirmed context from
                your profile and logs (workouts and runs, weight and
                measurements, meals, goals, and calorie and protein targets).
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                &bull; Meals: the photos and descriptions you submit for
                nutrition estimates, your country setting, and the current draft
                when you ask for changes. Descriptions that name a brand or
                restaurant may also be looked up with Google Search. A
                meal&rsquo;s name is sent automatically to create an
                illustration for meals you save without a photo.
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                &bull; Recipes: ingredient photos, your messages and the
                ingredients and ideas on screen, your saved diet preferences,
                and the protein, carbs and fat left for today.
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                &bull; Log activity: the description you type and your
                phone&rsquo;s current date and time.
              </ThemedText>
            </Card>

            <Card>
              <ThemedText type="headline">
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
            </Card>

            <Card>
              <ThemedText type="headline">
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
                        borderColor: validationError
                          ? theme.danger
                          : theme.border,
                        backgroundColor: theme.backgroundSelected,
                      },
                    ]}
                    placeholder={`YYYY (e.g. ${currentYear - 25})`}
                    placeholderTextColor={theme.textTertiary}
                    keyboardType="number-pad"
                    maxLength={4}
                    value={birthYearInput}
                    onChangeText={setBirthYearInput}
                    editable={!isSaving}
                    accessibilityLabel="Birth year for adult verification"
                  />
                  {validationError && (
                    <ThemedText
                      type="footnote"
                      themeColor="danger"
                      style={styles.validationText}
                    >
                      {validationError}
                    </ThemedText>
                  )}
                </View>
              )}
              {!needsBirthYear && validationError && (
                <ThemedText
                  type="footnote"
                  themeColor="danger"
                  style={styles.validationText}
                >
                  {validationError}
                </ThemedText>
              )}
            </Card>

            <Card>
              <ThemedText type="headline">
                5. Advisory &amp; Wellness Only
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                AI suggestions are advisory and may contain inaccuracies. Mizyun
                is for fitness and general wellness guidance only—never medical
                diagnosis, dietary prescriptions, or medical treatment.
              </ThemedText>
            </Card>
          </ScrollView>

          <View
            style={[
              styles.buttonContainer,
              {
                borderTopColor: theme.separator,
              },
            ]}
          >
            {error && <Notice tone="danger" message={error} />}

            <Button
              label="I am 18+ and I Consent"
              block
              accessibilityLabel="Confirm adult eligibility and grant AI consent"
              disabled={isConsentDisabled}
              loading={isSaving}
              onPress={() => void onConsent(parsedBirthYear)}
            />

            <Button
              label="Not Now / Decline"
              variant="plain"
              block
              accessibilityLabel="Decline AI consent"
              disabled={isSaving}
              onPress={onDecline}
            />
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
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    paddingHorizontal: PageGutter,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.three,
    gap: Spacing.one,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    paddingHorizontal: PageGutter,
    paddingBottom: Spacing.four,
    gap: Spacing.three,
  },
  birthYearSection: {
    marginTop: Spacing.two,
    gap: Spacing.one,
  },
  birthYearInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
    minHeight: 44,
    // TextInput needs an explicit size; matches the body text style.
    fontSize: 17,
  },
  validationText: {
    marginTop: Spacing.half,
  },
  buttonContainer: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    paddingHorizontal: PageGutter,
    paddingVertical: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.two,
  },
});
