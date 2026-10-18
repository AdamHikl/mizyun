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
    variant: "secondary" | "primary" | "chip" | "icon" | "text" = "secondary",
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
      hitSlop={variant === "icon" ? 4 : undefined}
      onPress={action}
      style={[
        variant === "primary"
          ? styles.primaryButton
          : variant === "chip"
            ? styles.chip
            : variant === "icon"
              ? styles.iconButton
              : variant === "text"
                ? styles.textButton
                : styles.button,
        variant === "text"
          ? { opacity: disabled ? 0.5 : 1 }
          : {
              borderColor:
                variant === "primary"
                  ? "transparent"
                  : selected
                    ? theme.primary
                    : theme.border,
              backgroundColor:
                variant === "primary"
                  ? theme.primary
                  : selected
                    ? theme.primaryLight
                    : theme.backgroundElement,
              opacity: disabled ? 0.5 : 1,
            },
      ]}
    >
      <ThemedText
        type={variant === "chip" ? "small" : "smallBold"}
        themeColor={
          variant === "primary"
            ? "onPrimary"
            : variant === "text"
              ? "textSecondary"
              : undefined
        }
      >
        {visibleLabel}
      </ThemedText>
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
  const cardStyle = [
    styles.card,
    { backgroundColor: theme.backgroundElement, borderColor: theme.border },
  ];
  const maximumImages = snapshot.capabilities?.maximumImages ?? 0;
  const photoOff =
    snapshot.aiRetired || snapshot.capabilities?.recognizeIngredients === false;
  const enabledCount = snapshot.ingredients.filter((row) => row.enabled).length;
  const notice = localMessage ?? snapshot.message;
  const progress =
    snapshot.phase === "initializing"
      ? "Loading ingredient review…"
      : snapshot.phase === "picking"
        ? "Selecting a photo…"
        : snapshot.phase === "analyzing"
          ? "Analyzing photos… You can keep editing typed ingredients."
          : null;
  return (
    <View style={styles.container}>
      <View style={cardStyle}>
        <View style={styles.header}>
          <ThemedText accessibilityRole="header" style={styles.title}>
            Scan your kitchen
          </ThemedText>
          {maximumImages > 0 && !photoOff && (
            <ThemedText type="small" themeColor="textSecondary">
              {`${snapshot.photos.length} of ${maximumImages} photo${maximumImages === 1 ? "" : "s"}`}
            </ThemedText>
          )}
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          {photoOff
            ? "Photo analysis is off. You can still edit and confirm typed ingredients."
            : snapshot.capabilities
              ? "Snap your fridge or cupboard and we’ll suggest what’s inside."
              : "Photo analysis access is unavailable until checked. You can type ingredients."}
        </ThemedText>
        <View style={styles.segment}>
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
              "button",
              undefined,
              "chip",
            ),
          )}
        </View>
        {snapshot.photos.length > 0 && (
          <View style={styles.thumbnails}>
            {snapshot.photos.map((photo, index) => (
              <View
                key={photo.id}
                style={[styles.thumbnail, { borderColor: theme.border }]}
              >
                <Image
                  source={{ uri: photo.uri }}
                  cachePolicy="none"
                  contentFit="cover"
                  accessibilityLabel={`${photo.location} photo ${index + 1}`}
                  style={styles.preview}
                />
                <View style={styles.thumbnailRemove}>
                  {button(
                    `Remove photo ${index + 1}`,
                    () => {
                      void run(() => controller.removePhoto(photo.id));
                    },
                    busy,
                    undefined,
                    "button",
                    "✕",
                    "icon",
                  )}
                </View>
              </View>
            ))}
          </View>
        )}
        <View style={styles.split}>
          {button(
            "Camera",
            () => {
              void run(() =>
                controller.addPhoto({ source: "camera", location }),
              );
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
            undefined,
            "button",
            "Library",
          )}
        </View>
        {snapshot.photos.length > 0 &&
          button(
            "Analyze photos",
            () => {
              void run(() => controller.analyze());
            },
            !photoEnabled,
            undefined,
            "button",
            snapshot.photos.length === 1
              ? "Find ingredients in 1 photo"
              : `Find ingredients in ${snapshot.photos.length} photos`,
            "primary",
          )}
        {progress && (
          <ThemedText
            type="small"
            themeColor="textSecondary"
            accessibilityLiveRegion="polite"
          >
            {progress}
          </ThemedText>
        )}
      </View>
      {(notice ||
        snapshot.recoveryRequiresReselect ||
        snapshot.warnings.length > 0 ||
        snapshot.cleanupPending > 0) && (
        <View
          style={[
            styles.notice,
            { backgroundColor: theme.warningLight, borderColor: theme.border },
          ]}
        >
          {notice ? (
            <ThemedText
              type="small"
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
            >
              {notice}
            </ThemedText>
          ) : null}
          {!snapshot.message && snapshot.recoveryRequiresReselect && (
            <ThemedText type="small">
              Photos were not retained. Reselect photos to analyze again. Review
              the recovered ingredients below.
            </ThemedText>
          )}
          {snapshot.warnings.map((warning, index) => (
            <ThemedText type="small" key={`${index}-${warning}`}>
              {warning}
            </ThemedText>
          ))}
          {snapshot.cleanupPending > 0 && (
            <>
              <ThemedText type="small">
                Temporary photo cleanup needs a retry before continuing.
              </ThemedText>
              {button(
                "Retry photo cleanup",
                () => {
                  void run(() => controller.retryCleanup());
                },
                submitting,
              )}
            </>
          )}
        </View>
      )}
      <View style={cardStyle}>
        <View style={styles.header}>
          <ThemedText accessibilityRole="header" style={styles.title}>
            Your ingredients
          </ThemedText>
          {snapshot.ingredients.length > 0 && (
            <ThemedText type="small" themeColor="textSecondary">
              {`${enabledCount} selected`}
            </ThemedText>
          )}
        </View>
        <View style={styles.addRow}>
          <TextInput
            accessibilityLabel="Ingredient to add"
            placeholder="e.g. eggs, spinach, rice"
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
            style={[...inputStyle, styles.addInput]}
          />
          {button(
            "Add ingredient",
            () => {
              void addTyped();
            },
            !editable || !typed.trim(),
            undefined,
            "button",
            "Add",
          )}
        </View>
        {snapshot.ingredients.some((row) => row.source === "photo") && (
          <ThemedText type="small" themeColor="textSecondary">
            Possible ingredients from the combined photos. Correct or remove
            anything uncertain.
          </ThemedText>
        )}
        {snapshot.ingredients.length > 0 && (
          <ThemedText type="small" themeColor="textSecondary">
            Amounts are unknown; check what is available before cooking.
          </ThemedText>
        )}
        {snapshot.ingredients.length === 0 && (
          <ThemedText type="small" themeColor="textSecondary">
            Nothing here yet. Type an ingredient or scan a photo.
          </ThemedText>
        )}
        {snapshot.ingredients.map((row, index) => (
          <View
            key={row.id}
            style={[
              styles.row,
              {
                borderColor: theme.border,
                backgroundColor: theme.background,
                opacity: row.enabled ? 1 : 0.6,
              },
            ]}
          >
            <View style={styles.rowHeader}>
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
                row.enabled ? "✓" : " ",
                "icon",
              )}
              <TextInput
                accessibilityLabel={`Ingredient ${index + 1} name`}
                value={names[row.id] ?? row.name}
                editable={editable}
                maxLength={160}
                onChangeText={(name) => setNames({ ...names, [row.id]: name })}
                onEndEditing={({ nativeEvent: { text: name } }) => {
                  void run(() => controller.updateIngredient(row.id, { name }));
                }}
                style={[styles.nameInput, { color: theme.text }]}
              />
              {button(
                `Remove ${row.name}`,
                () => {
                  void run(() => controller.removeIngredient(row.id));
                },
                !editable,
                undefined,
                "button",
                "✕",
                "icon",
              )}
            </View>
            <View style={styles.segment}>
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
                  "chip",
                ),
              )}
            </View>
            {row.source === "photo" && (
              <ThemedText type="small" themeColor="textSecondary">
                From your photo — check the name and state
              </ThemedText>
            )}
          </View>
        ))}
      </View>
      {button(
        "Confirm ingredients",
        () => {
          void confirm();
        },
        busy ||
          snapshot.cleanupPending > 0 ||
          !snapshot.ingredients.some((row) => row.enabled),
        undefined,
        "button",
        enabledCount > 0
          ? `Use ${enabledCount} ingredient${enabledCount === 1 ? "" : "s"}`
          : "Confirm ingredients",
        "primary",
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
        undefined,
        "button",
        "Cancel",
        "text",
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  container: { gap: 16 },
  card: { gap: 14, padding: 18, borderRadius: 20, borderWidth: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  title: { fontSize: 18, lineHeight: 24, fontWeight: "600", flexShrink: 1 },
  segment: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  split: { flexDirection: "row", gap: 10 },
  addRow: { flexDirection: "row", gap: 8, alignItems: "stretch" },
  addInput: { flex: 1 },
  button: {
    minHeight: 48,
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButton: {
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  chip: {
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: 22,
    justifyContent: "center",
  },
  iconButton: {
    minHeight: 44,
    minWidth: 44,
    borderWidth: 1,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  textButton: {
    minHeight: 44,
    alignSelf: "center",
    paddingHorizontal: 16,
    justifyContent: "center",
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  nameInput: { flex: 1, minHeight: 44, fontSize: 17, fontWeight: "600" },
  row: { gap: 10, padding: 12, borderWidth: 1, borderRadius: 16 },
  rowHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  notice: { gap: 10, padding: 14, borderRadius: 16, borderWidth: 1 },
  thumbnails: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  thumbnail: {
    width: 96,
    height: 96,
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
  },
  preview: { width: "100%", height: "100%" },
  thumbnailRemove: { position: "absolute", top: 4, right: 4 },
});
