import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, Stack } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { LoggingFlowMeasurement } from "@mizyun/observability";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { BottomTabInset, MaxContentWidth, Spacing } from "@/constants/theme";
import { useAuth } from "@/features/auth/auth-context";
import { useTheme } from "@/hooks/use-theme";
import { analyticsClient } from "@/composition/analytics-client";
import {
  classifyAnalyticsFailure,
  isRetryableAnalyticsFailure,
} from "@/features/analytics/classify-failure";
import { lengthUnitLabel } from "@/lib/length-units";
import {
  clearLoggingDraft,
  loadLoggingDraft,
  saveLoggingDraft,
} from "@/features/logging-draft-storage";

import { submitLogWeight } from "./log-weight-data";

export function LogWeightScreen() {
  const { profile, session } = useAuth();
  const theme = useTheme();
  const [weight, setWeight] = useState("");
  const [waist, setWaist] = useState("");
  const [chest, setChest] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const measurement = useRef<LoggingFlowMeasurement | null>(null);
  const hadFailure = useRef(false);
  const userId = session?.user.id ?? null;
  const unitSystem = profile?.unitSystem ?? "metric";
  const unitLabel = unitSystem === "imperial" ? "lb" : "kg";

  useEffect(() => {
    measurement.current = new LoggingFlowMeasurement(
      "body_measurement",
      analyticsClient,
    );
    return () => {
      measurement.current = null;
    };
  }, []);

  useEffect(() => {
    if (userId === null) return;
    let active = true;
    void loadLoggingDraft(userId, "weight", isWeightDraft).then((draft) => {
      if (!active) return;
      if (draft !== null && draft.unitSystem === unitSystem) {
        setWeight(draft.weight);
        setWaist(draft.waist ?? "");
        setChest(draft.chest ?? "");
      }
      setDraftLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [unitSystem, userId]);

  useEffect(() => {
    if (!draftLoaded || userId === null) return;
    void saveLoggingDraft(userId, "weight", {
      weight,
      waist,
      chest,
      unitSystem,
    });
  }, [chest, draftLoaded, unitSystem, userId, waist, weight]);

  const onSubmit = useCallback(async () => {
    measurement.current?.tap();
    if (hadFailure.current) measurement.current?.retry();
    setSubmitting(true);
    setError(null);
    const result = await submitLogWeight({
      weight,
      waist,
      chest,
      unitSystem,
    });
    setSubmitting(false);
    if (result.ok) {
      measurement.current?.complete();
      if (userId !== null) await clearLoggingDraft(userId, "weight");
      router.back();
      return;
    }
    hadFailure.current = true;
    const reason = classifyAnalyticsFailure(result.message);
    measurement.current?.fail(
      reason === "invalid_input" ? "validation" : "submit",
      reason,
      isRetryableAnalyticsFailure(reason),
    );
    setError(result.message);
  }, [chest, unitSystem, userId, waist, weight]);

  return (
    <ThemedView style={styles.page}>
      <Stack.Screen options={{ title: "Add weight" }} />
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
        <ScrollView
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={styles.content}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
        >
          <ThemedText type="subtitle">Today's measurement.</ThemedText>
          <ThemedText themeColor="textSecondary" type="small">
            Weight is optional when you only want to record a body measurement.
            Mizyun stores canonical metric values without changing what you see.
          </ThemedText>

          <Field
            testID="body-weight-input"
            label={`Weight (${unitLabel})`}
            value={weight}
            onChangeText={setWeight}
            onFocus={() => measurement.current?.tap()}
            placeholder="72.5"
            keyboardType="numeric"
            autoFocus
            inputColor={theme.text}
          />

          <Field
            testID="body-waist-input"
            label={`Waist (${lengthUnitLabel(unitSystem)}, optional)`}
            value={waist}
            onChangeText={setWaist}
            onFocus={() => measurement.current?.tap()}
            placeholder="81"
            keyboardType="numeric"
            inputColor={theme.text}
          />

          <Field
            testID="body-chest-input"
            label={`Chest (${lengthUnitLabel(unitSystem)}, optional)`}
            value={chest}
            onChangeText={setChest}
            onFocus={() => measurement.current?.tap()}
            placeholder="100"
            keyboardType="numeric"
            inputColor={theme.text}
          />

          {error !== null ? (
            <ThemedText
              type="small"
              themeColor="textSecondary"
              style={styles.errorText}
              accessibilityRole="alert"
            >
              {error}
            </ThemedText>
          ) : null}

          <Pressable
            accessibilityRole="button"
            disabled={submitting}
            accessibilityState={{ disabled: submitting, busy: submitting }}
            onPress={() => {
              void onSubmit();
            }}
            style={({ pressed }) => [
              styles.submit,
              (pressed || submitting) && styles.submitPressed,
            ]}
          >
            <ThemedText type="smallBold" style={styles.submitText}>
              {submitting ? "Saving…" : "Save measurement"}
            </ThemedText>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Field(props: {
  readonly testID: string;
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (next: string) => void;
  readonly onFocus?: () => void;
  readonly placeholder?: string;
  readonly autoFocus?: boolean;
  readonly keyboardType?: "default" | "numeric";
  readonly inputColor: string;
}) {
  return (
    <View style={styles.field}>
      <ThemedText type="small" themeColor="textSecondary">
        {props.label}
      </ThemedText>
      <TextInput
        testID={props.testID}
        value={props.value}
        onChangeText={props.onChangeText}
        onFocus={props.onFocus}
        placeholder={props.placeholder}
        placeholderTextColor="#8A8D91"
        autoFocus={props.autoFocus === true}
        keyboardType={props.keyboardType ?? "default"}
        accessibilityLabel={props.label}
        style={[styles.input, { color: props.inputColor }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  safeArea: { flex: 1 },
  content: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.six,
    gap: Spacing.three,
  },
  field: { gap: Spacing.one },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#8A8D91",
    borderRadius: Spacing.two,
    padding: Spacing.three,
    fontSize: 16,
  },
  submit: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#1F1F23",
    borderRadius: Spacing.three,
    padding: Spacing.three,
    alignItems: "center",
    backgroundColor: "#1F1F23",
  },
  submitText: {
    color: "#FFFFFF",
  },
  submitPressed: { opacity: 0.65 },
  errorText: { marginTop: Spacing.one },
});

interface WeightDraft {
  readonly weight: string;
  readonly waist?: string;
  readonly chest?: string;
  readonly unitSystem: "metric" | "imperial";
}

const isWeightDraft = (value: unknown): value is WeightDraft =>
  typeof value === "object" &&
  value !== null &&
  "weight" in value &&
  typeof value.weight === "string" &&
  "unitSystem" in value &&
  (value.unitSystem === "metric" || value.unitSystem === "imperial");
