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
import { isStretchAiEnabled } from "@/composition/app-variant";
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
 * - Discloses both processing providers and which features use each:
 *   Anthropic (Claude) for Coach chat, typed meal estimates and draft
 *   changes and Log activity descriptions; Google (Gemini API) for
 *   meal/label/ingredient photos (including Coach photos), the cooking
 *   assistant, meal illustrations and the evening stretch. On Apple
 *   Intelligence iPhones, Log activity drafts stay on the device (ADR-0074).
 * - Lists the data each feature sends.
 * - States each provider's retention and training terms conservatively.
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
  const stretchAi = isStretchAiEnabled();
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
              <ThemedText type="headline">1. AI Providers</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Mizyun&rsquo;s AI features use two outside providers, depending
                on the feature:
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                &bull; Anthropic (Claude): Coach chat, meal estimates from typed
                descriptions, changes you ask for to a meal draft, and filling
                in Log activity from a description.
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                &bull; Google (Gemini API): meal and nutrition-label photos,
                including photos you send in Coach, ingredient photos, the
                cooking assistant,{" "}
                {stretchAi
                  ? "meal illustrations, and tailoring the evening stretch to your workout."
                  : "and meal illustrations."}
              </ThemedText>
              {Platform.OS === "ios" ? (
                <ThemedText type="small" themeColor="textSecondary">
                  When Apple Intelligence is on and ready on your iPhone, Log
                  activity first tries to fill in on the iPhone and sends the
                  description to Anthropic only if that doesn&rsquo;t work.
                </ThemedText>
              ) : null}
            </Card>

            <Card>
              <ThemedText type="headline">2. Data Shared</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Data is sent only for these features:
              </ThemedText>
              <ThemedText type="smallBold">Sent to Anthropic</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                &bull; Coach: your messages, your recent conversation, saved
                Coach memories, and confirmed context from your profile and logs
                (workouts and runs, weight and measurements, meals, goals, and
                calorie and protein targets).
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                &bull; Meals: the descriptions you type for nutrition estimates,
                your country setting, and the current draft when you ask for
                changes. Descriptions that name a brand or restaurant may also
                be looked up on the web.
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                &bull; Log activity: the description you type and your
                phone&rsquo;s current date and time.
              </ThemedText>
              <ThemedText type="smallBold">Sent to Google</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                &bull; Meal photos: the meal and nutrition-label photos you
                submit, in Log meal or Coach, any text you add with them, and
                your country setting.
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                &bull; Recipes: ingredient photos, your cooking assistant
                messages, the ingredients and ideas on screen, your saved diet
                preferences, and the protein, carbs and fat left for today.
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                &bull; Illustrations: a meal&rsquo;s name, sent automatically to
                create an illustration for meals you save without a photo.
              </ThemedText>
              {stretchAi ? (
                <ThemedText type="small" themeColor="textSecondary">
                  &bull; Evening stretch: the names and set counts of the
                  exercises you finished today and whether you ran or climbed,
                  sent automatically when you open the stretch on a training day
                  (at most twice a day).
                </ThemedText>
              ) : null}
            </Card>

            <Card>
              <ThemedText type="headline">
                3. Privacy &amp; Model Training
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Each provider processes submitted data to generate your
                response.
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                &bull; Anthropic&rsquo;s commercial terms say it does not train
                models on this data. It normally deletes it within 30 days, but
                may keep it longer to enforce its usage policy or where the law
                requires.
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                &bull; Google may retain prompts, context, and output for abuse
                monitoring for up to 55 days. Additional use depends on the
                applicable Gemini API service terms, billing status, and region;
                Mizyun does not promise that every submission is excluded from
                Google product improvement.
              </ThemedText>
            </Card>

            <Card>
              <ThemedText type="headline">
                4. Adult Eligibility (18+)
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Google&rsquo;s API Terms require users to be 18 or older, and
                Mizyun applies this to all AI features. By continuing, you
                confirm that you are at least 18 years old.
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
