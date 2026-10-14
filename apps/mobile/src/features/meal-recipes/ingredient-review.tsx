import { useRef, useState, useSyncExternalStore } from "react";
import { Image } from "expo-image";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import type {
  IngredientReviewController,
  ConfirmedIngredientReview,
} from "./ingredient-review-controller";
import type { IngredientPhotoLocation } from "./ingredient-photos";

export interface IngredientReviewProps {
  controller: IngredientReviewController;
  onConfirmed: (review: ConfirmedIngredientReview) => void;
  onCancel?: () => void;
}
const locations = ["fridge", "cabinet", "other"] as const;
const states = [
  ["raw", "Raw"],
  ["cooked", "Cooked"],
  ["as_sold", "As sold"],
  ["unknown", "Unsure"],
] as const;

/** Embedded review: its owner controls initialization, account fencing and disposal. */
export function IngredientReview({
  controller,
  onConfirmed,
  onCancel,
}: IngredientReviewProps) {
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const theme = useTheme();
  const [typed, setTyped] = useState("");
  const [names, setNames] = useState<Record<string, string>>({});
  const [location, setLocation] = useState<IngredientPhotoLocation>("fridge");
  const [localMessage, setLocalMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submissionInFlight = useRef(false);
  const busy = snapshot.phase !== "idle" || submitting;
  const editable =
    snapshot.phase !== "initializing" && snapshot.phase !== "retired";
  const photoEnabled =
    !busy &&
    !snapshot.aiRetired &&
    snapshot.capabilities?.recognizeIngredients === true &&
    snapshot.cleanupPending === 0;
  const canAddPhoto =
    photoEnabled &&
    snapshot.photos.length < (snapshot.capabilities?.maximumImages ?? 0);
  const run = async (action: () => Promise<unknown>) => {
    setLocalMessage(null);
    try {
      await action();
    } catch {
      setLocalMessage("This action could not finish. Please try again.");
    }
  };
  const addTyped = () =>
    run(async () => {
      if (!typed.trim() || !editable) return;
      await controller.addTyped(typed);
      setTyped("");
    });
  const confirm = () =>
    run(async () => {
      if (
        submissionInFlight.current ||
        busy ||
        snapshot.cleanupPending > 0 ||
        !snapshot.ingredients.some((row) => row.enabled)
      )
        return;
      submissionInFlight.current = true;
      setSubmitting(true);
      try {
        for (const row of snapshot.ingredients) {
          const name = names[row.id];
          if (name !== undefined) {
            if (!name.trim()) {
              setLocalMessage("Enter a name or remove the empty ingredient.");
              return;
            }
            await controller.updateIngredient(row.id, { name });
          }
        }
        const result = await controller.confirm();
        if (result) onConfirmed(result);
      } finally {
        submissionInFlight.current = false;
        setSubmitting(false);
      }
    });
  const button = (
    label: string,
    action: () => void,
    disabled = false,
    selected?: boolean,
    role: "button" | "checkbox" = "button",
    visibleLabel = label,
  ) => (
    <Pressable
      key={label}
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityState={{
        disabled,
        ...(role === "checkbox"
          ? { checked: selected }
          : selected !== undefined
            ? { selected }
            : {}),
      }}
      disabled={disabled}
      onPress={action}
      style={[
        styles.button,
        {
          borderColor: theme.border,
          backgroundColor: selected
            ? theme.backgroundSelected
            : theme.backgroundElement,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <ThemedText>{visibleLabel}</ThemedText>
    </Pressable>
  );
  const inputStyle = [
    styles.input,
    {
      color: theme.text,
      borderColor: theme.border,
      backgroundColor: theme.background,
    },
  ];
  return (
    <View style={styles.container}>
      <ThemedText accessibilityRole="header" type="smallBold">
        Review ingredients
      </ThemedText>
      <ThemedText>
        Type what you have, or review suggestions from photos. Amounts are
        unknown; check what is available before cooking.
      </ThemedText>
      <TextInput
        accessibilityLabel="Ingredient to add"
        placeholder="Add an ingredient"
        placeholderTextColor={theme.textSecondary}
        value={typed}
        onChangeText={setTyped}
        editable={editable}
        maxLength={160}
        autoCapitalize="sentences"
        returnKeyType="done"
        onSubmitEditing={() => {
          void addTyped();
        }}
        style={inputStyle}
      />
      <View style={styles.actions}>
        {button(
          "Add ingredient",
          () => {
            void addTyped();
          },
          !editable || !typed.trim(),
        )}
      </View>
      <ThemedText type="smallBold">Photo location</ThemedText>
      <View style={styles.actions}>
        {locations.map((item) =>
          button(
            item === "fridge"
              ? "Fridge"
              : item === "cabinet"
                ? "Cabinet"
                : "Other",
            () => setLocation(item),
            busy,
            location === item,
          ),
        )}
      </View>
      <ThemedText>
        {snapshot.capabilities
          ? `This account can use up to ${snapshot.capabilities.maximumImages} photo${snapshot.capabilities.maximumImages === 1 ? "" : "s"}.`
          : "Photo analysis access is unavailable until checked. You can type ingredients."}
      </ThemedText>
      {(snapshot.aiRetired ||
        snapshot.capabilities?.recognizeIngredients === false) && (
        <ThemedText>
          Photo analysis is off. You can still edit and confirm typed
          ingredients.
        </ThemedText>
      )}
      <View style={styles.actions}>
        {button(
          "Camera",
          () => {
            void run(() => controller.addPhoto({ source: "camera", location }));
          },
          !canAddPhoto,
        )}
        {button(
          "Photo library",
          () => {
            void run(() =>
              controller.addPhoto({ source: "library", location }),
            );
          },
          !canAddPhoto,
        )}
      </View>
      {snapshot.photos.map((photo, index) => (
        <View key={photo.id} style={styles.photo}>
          <Image
            source={{ uri: photo.uri }}
            cachePolicy="none"
            contentFit="contain"
            accessibilityLabel={`${photo.location} photo ${index + 1}`}
            style={styles.preview}
          />
          {button(
            `Remove photo ${index + 1}`,
            () => {
              void run(() => controller.removePhoto(photo.id));
            },
            busy,
          )}
        </View>
      ))}
      <View style={styles.actions}>
        {button(
          "Analyze photos",
          () => {
            void run(() => controller.analyze());
          },
          !photoEnabled || snapshot.photos.length === 0,
        )}
      </View>
      {snapshot.phase === "initializing" && (
        <ThemedText accessibilityLiveRegion="polite">
          Loading ingredient review…
        </ThemedText>
      )}
      {snapshot.phase === "picking" && (
        <ThemedText accessibilityLiveRegion="polite">
          Selecting a photo…
        </ThemedText>
      )}
      {snapshot.phase === "analyzing" && (
        <ThemedText accessibilityLiveRegion="polite">
          Analyzing photos… You can keep editing typed ingredients.
        </ThemedText>
      )}
      {snapshot.recoveryRequiresReselect && (
        <ThemedText>
          Photos were not retained. Reselect photos to analyze again. Review the
          recovered ingredients below.
        </ThemedText>
      )}
      {(snapshot.message || localMessage) && (
        <ThemedText accessibilityRole="alert" accessibilityLiveRegion="polite">
          {localMessage ?? snapshot.message}
        </ThemedText>
      )}
      {snapshot.warnings.map((warning, index) => (
        <ThemedText key={`${index}-${warning}`}>{warning}</ThemedText>
      ))}
      {snapshot.cleanupPending > 0 && (
        <View style={styles.actions}>
          <ThemedText>
            Temporary photo cleanup needs a retry before continuing.
          </ThemedText>
          {button(
            "Retry photo cleanup",
            () => {
              void run(() => controller.retryCleanup());
            },
            submitting,
          )}
        </View>
      )}
      {snapshot.ingredients.some((row) => row.source === "photo") && (
        <ThemedText>
          Possible ingredients from the combined photos. Correct or remove
          anything uncertain.
        </ThemedText>
      )}
      {snapshot.ingredients.length === 0 && (
        <ThemedText>
          No ingredients yet. Add an ingredient to continue.
        </ThemedText>
      )}
      {snapshot.ingredients.map((row, index) => (
        <View key={row.id} style={[styles.row, { borderColor: theme.border }]}>
          <TextInput
            accessibilityLabel={`Ingredient ${index + 1} name`}
            value={names[row.id] ?? row.name}
            editable={editable}
            maxLength={160}
            onChangeText={(name) => setNames({ ...names, [row.id]: name })}
            onEndEditing={({ nativeEvent: { text: name } }) => {
              void run(() => controller.updateIngredient(row.id, { name }));
            }}
            style={inputStyle}
          />
          <ThemedText type="small">
            {row.source === "photo"
              ? "Photo suggestion — check the name and state"
              : "Typed ingredient"}
          </ThemedText>
          <View style={styles.actions}>
            {states.map(([state, label]) =>
              button(
                `${label}: ${row.name}`,
                () => {
                  void run(() =>
                    controller.updateIngredient(row.id, {
                      preparationState: state,
                    }),
                  );
                },
                !editable,
                row.preparationState === state,
                "button",
                label,
              ),
            )}
          </View>
          <View style={styles.actions}>
            {button(
              `Include ${row.name}`,
              () => {
                void run(() =>
                  controller.updateIngredient(row.id, {
                    enabled: !row.enabled,
                  }),
                );
              },
              !editable,
              row.enabled,
              "checkbox",
            )}
            {button(
              `Remove ${row.name}`,
              () => {
                void run(() => controller.removeIngredient(row.id));
              },
              !editable,
            )}
          </View>
        </View>
      ))}
      <View style={styles.actions}>
        {button(
          "Confirm ingredients",
          () => {
            void confirm();
          },
          busy ||
            snapshot.cleanupPending > 0 ||
            !snapshot.ingredients.some((row) => row.enabled),
        )}
        {button(
          "Cancel ingredient review",
          () => {
            void run(async () => {
              await controller.cancel();
              onCancel?.();
            });
          },
          submitting,
        )}
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  container: { gap: 12 },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "center",
  },
  button: {
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderRadius: 10,
    justifyContent: "center",
    flexShrink: 1,
  },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
  },
  row: { gap: 8, paddingVertical: 12, borderTopWidth: 1 },
  photo: { gap: 8, alignItems: "flex-start" },
  preview: { width: "100%", height: 140 },
});
