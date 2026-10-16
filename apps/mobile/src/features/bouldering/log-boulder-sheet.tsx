import { Image } from "expo-image";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  BOULDER_NOTE_MAX,
  type BoulderResult,
  type HoldColour,
} from "@mizyun/core";
import type {
  BoulderAscentRecord,
  BoulderProjectRecord,
} from "@mizyun/contracts";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import {
  Button,
  Chip,
  FormTextInput,
  Icon,
  IconButton,
  Notice,
  SegmentedControl,
} from "@/components/ui";
import { MinTouchTarget, Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { GradeChips } from "./grade-chips";
import {
  allowedBoulderResults,
  attemptsBounds,
  boulderFormError,
  sameAgainForm,
  selectBoulderResult,
  showsAttemptsStepper,
  stepBoulderAttempts,
  toggleUnknownAttempts,
  type BoulderForm,
} from "./log-boulder-form";
import {
  HOLD_COLOUR_ORDER,
  HOLD_COLOUR_STYLES,
  RESULT_LABELS,
} from "./presentation";
import { projectName, triedInSessionsText } from "./progress";
import type { PreparedBoulderPhoto } from "./boulder-photo";
import { pickBoulderPhoto } from "./boulder-photo-picker";

/** What the sheet asks the screen to do with the boulder's photo. */
export type BoulderPhotoChoice =
  | { readonly kind: "keep" }
  | { readonly kind: "remove" }
  | { readonly kind: "new"; readonly photo: PreparedBoulderPhoto };

const RESULT_OPTIONS: readonly {
  value: BoulderResult;
  label: string;
  accessibilityLabel: string;
}[] = [
  {
    value: "flash",
    label: RESULT_LABELS.flash,
    accessibilityLabel: "Flash: sent on the first attempt",
  },
  { value: "sent", label: RESULT_LABELS.sent, accessibilityLabel: "Sent" },
  {
    value: "not_yet",
    label: RESULT_LABELS.not_yet,
    accessibilityLabel: "Not yet: not sent this time",
  },
];

export function HoldColourSwatch({
  colour,
  size = 16,
}: {
  colour: HoldColour;
  size?: number;
}) {
  const theme = useTheme();
  const style = HOLD_COLOUR_STYLES[colour];
  return (
    <View
      accessible={false}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: style.swatch,
        borderWidth: style.outline ? StyleSheet.hairlineWidth * 2 : 0,
        borderColor: theme.textTertiary,
        borderStyle: colour === "other" ? "dashed" : "solid",
      }}
    />
  );
}

/** The project a "Try again" boulder links to. */
export type TryAgainProject = Pick<
  BoulderProjectRecord,
  "id" | "grade" | "holdColour" | "sessions"
>;

/**
 * Log-a-boulder sheet (ADR-0066 sketch): grade chips, result, attempts for
 * Sent/Not yet, collapsed More (colour, note, photo), Same again and Save.
 * `onSave` resolves to an error message to keep the sheet open, or null.
 */
export function LogBoulderSheet({
  visible,
  mode,
  initialForm,
  lastAscent,
  hasExistingPhoto = false,
  project = null,
  onClose,
  onSave,
  onDelete,
}: {
  visible: boolean;
  mode: "create" | "edit";
  initialForm: BoulderForm;
  lastAscent?: Pick<BoulderAscentRecord, "grade" | "holdColour"> | null;
  hasExistingPhoto?: boolean;
  /** "Try again": the create links to this project unless the user unlinks. */
  project?: TryAgainProject | null;
  onClose: () => void;
  onSave: (
    form: BoulderForm,
    photo: BoulderPhotoChoice,
    projectId: string | null,
  ) => Promise<string | null>;
  onDelete?: () => void;
}) {
  const theme = useTheme();
  const [form, setForm] = useState(initialForm);
  const [moreOpen, setMoreOpen] = useState(
    mode === "edit" &&
      (initialForm.holdColour !== null ||
        initialForm.note !== "" ||
        hasExistingPhoto),
  );
  const [photo, setPhoto] = useState<BoulderPhotoChoice>({ kind: "keep" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [linked, setLinked] = useState(mode === "create" && project !== null);
  const linkedProject = linked && project ? project : null;
  const resultOptions = RESULT_OPTIONS.filter((option) =>
    allowedBoulderResults(linkedProject !== null).includes(option.value),
  );

  const validation = boulderFormError(form);
  const bounds = attemptsBounds(form.result);
  const showsPhoto =
    photo.kind === "new" || (photo.kind === "keep" && hasExistingPhoto);

  const save = async () => {
    if (saving || validation) return;
    setSaving(true);
    setError(null);
    try {
      const failure = await onSave(form, photo, linkedProject?.id ?? null);
      if (failure) setError(failure);
    } finally {
      setSaving(false);
    }
  };

  const choosePhoto = async (source: "camera" | "library") => {
    setPhotoBusy(true);
    setError(null);
    const picked = await pickBoulderPhoto(source);
    setPhotoBusy(false);
    if (picked.kind === "photo") setPhoto({ kind: "new", photo: picked.photo });
    else if (picked.kind === "error") setError(picked.message);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <ThemedView style={styles.page}>
        <SafeAreaView style={styles.page} edges={["top", "bottom"]}>
          <KeyboardAvoidingView
            style={styles.page}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
            <View style={styles.header}>
              <ThemedText type="title3" accessibilityRole="header">
                {mode === "create" ? "Log a boulder" : "Edit boulder"}
              </ThemedText>
              <IconButton
                icon="close"
                accessibilityLabel="Close without saving"
                variant="plain"
                onPress={onClose}
              />
            </View>
            <ScrollView
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
            >
              {mode === "create" && project ? (
                <View
                  style={[styles.projectBanner, { borderColor: theme.border }]}
                >
                  <Icon name="target" size={16} color="textSecondary" />
                  <View style={styles.grow}>
                    <ThemedText
                      type="smallBold"
                      accessibilityLabel={
                        linkedProject
                          ? `Trying project ${projectName(project, true)}. ${triedInSessionsText(project.sessions)}`
                          : `Not linked to project ${projectName(project, true)}`
                      }
                    >
                      {linkedProject
                        ? `Trying project ${projectName(project)}`
                        : `Not linked to ${projectName(project)}`}
                    </ThemedText>
                    {linkedProject ? (
                      <ThemedText type="footnote" themeColor="textSecondary">
                        {`${triedInSessionsText(project.sessions)} · Flash isn't available for a project`}
                      </ThemedText>
                    ) : null}
                  </View>
                  <Button
                    label={linkedProject ? "Don't link" : "Link"}
                    variant="plain"
                    size="small"
                    accessibilityLabel={
                      linkedProject
                        ? "Log as a new boulder instead of this project"
                        : "Link this boulder to the project"
                    }
                    onPress={() => {
                      if (!linkedProject && form.result === "flash")
                        setForm((f) => ({
                          ...f,
                          result: null,
                          attempts: null,
                        }));
                      setLinked((value) => !value);
                    }}
                  />
                </View>
              ) : null}

              <ThemedText type="footnote" themeColor="textSecondary">
                Grade
              </ThemedText>
              <GradeChips
                value={form.grade}
                onChange={(grade) => setForm((f) => ({ ...f, grade }))}
              />

              <ThemedText type="footnote" themeColor="textSecondary">
                Result
              </ThemedText>
              <SegmentedControl<BoulderResult | "none">
                accessibilityLabel="Result"
                value={form.result ?? "none"}
                onChange={(value) => {
                  if (value !== "none")
                    setForm((f) => selectBoulderResult(f, value));
                }}
                options={resultOptions}
              />

              {showsAttemptsStepper(form.result) && bounds ? (
                <View style={styles.attemptsRow}>
                  <ThemedText type="default" style={styles.grow}>
                    Attempts
                  </ThemedText>
                  <IconButton
                    icon="minus"
                    accessibilityLabel="Fewer attempts"
                    disabled={
                      form.attempts === null || form.attempts <= bounds.min
                    }
                    onPress={() => setForm((f) => stepBoulderAttempts(f, -1))}
                  />
                  <ThemedText
                    type="headline"
                    style={styles.attemptsValue}
                    accessibilityLiveRegion="polite"
                    accessibilityLabel={
                      form.attempts === null
                        ? "Attempts unknown"
                        : `${form.attempts} attempts`
                    }
                  >
                    {form.attempts === null ? "–" : String(form.attempts)}
                  </ThemedText>
                  <IconButton
                    icon="add"
                    accessibilityLabel="More attempts"
                    disabled={
                      form.attempts !== null && form.attempts >= bounds.max
                    }
                    onPress={() => setForm((f) => stepBoulderAttempts(f, 1))}
                  />
                  <Chip
                    label="Don't know"
                    selected={form.attempts === null}
                    accessibilityLabel="Attempts unknown"
                    onPress={() => setForm((f) => toggleUnknownAttempts(f))}
                  />
                </View>
              ) : null}

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="More: hold colour, note and photo"
                accessibilityState={{ expanded: moreOpen }}
                onPress={() => setMoreOpen((open) => !open)}
                style={styles.moreToggle}
              >
                <Icon
                  name={moreOpen ? "chevronDown" : "chevronRight"}
                  size={14}
                  color="textSecondary"
                />
                <ThemedText type="default" themeColor="textSecondary">
                  More: colour · note · photo
                </ThemedText>
              </Pressable>

              {moreOpen ? (
                <View style={styles.more}>
                  <ThemedText type="footnote" themeColor="textSecondary">
                    Hold colour
                  </ThemedText>
                  <View
                    style={styles.swatches}
                    accessibilityRole="radiogroup"
                    accessibilityLabel="Hold colour"
                  >
                    {HOLD_COLOUR_ORDER.map((colour) => {
                      const selected = form.holdColour === colour;
                      const label = HOLD_COLOUR_STYLES[colour].label;
                      return (
                        <Pressable
                          key={colour}
                          accessibilityRole="radio"
                          accessibilityLabel={label}
                          accessibilityState={{ selected, checked: selected }}
                          onPress={() =>
                            setForm((f) => ({
                              ...f,
                              holdColour: selected ? null : colour,
                            }))
                          }
                          style={[
                            styles.swatchButton,
                            {
                              borderColor: selected
                                ? theme.primary
                                : theme.border,
                              backgroundColor: selected
                                ? theme.primaryLight
                                : theme.backgroundElement,
                            },
                          ]}
                        >
                          <HoldColourSwatch colour={colour} />
                          <ThemedText type="footnote">{label}</ThemedText>
                          {selected ? (
                            <Icon name="check" size={12} color="primary" />
                          ) : null}
                        </Pressable>
                      );
                    })}
                  </View>

                  <ThemedText type="footnote" themeColor="textSecondary">
                    Note
                  </ThemedText>
                  <FormTextInput
                    accessibilityLabel="Note"
                    placeholder="Optional, private"
                    value={form.note}
                    maxLength={BOULDER_NOTE_MAX}
                    multiline
                    onChangeText={(note) => setForm((f) => ({ ...f, note }))}
                  />
                  <ThemedText type="caption" themeColor="textTertiary">
                    {form.note.length}/{BOULDER_NOTE_MAX}
                  </ThemedText>

                  <ThemedText type="footnote" themeColor="textSecondary">
                    Photo (private)
                  </ThemedText>
                  {showsPhoto ? (
                    <View style={styles.photoRow}>
                      {photo.kind === "new" ? (
                        <Image
                          source={{ uri: photo.photo.uri }}
                          style={styles.thumb}
                          accessibilityLabel="Selected boulder photo"
                        />
                      ) : (
                        <Icon name="photo" size={22} color="textSecondary" />
                      )}
                      <ThemedText type="small" style={styles.grow}>
                        {photo.kind === "new"
                          ? "Photo selected"
                          : "Photo attached"}
                      </ThemedText>
                      <Button
                        label="Remove photo"
                        variant="plain"
                        size="small"
                        onPress={() =>
                          setPhoto(
                            hasExistingPhoto
                              ? { kind: "remove" }
                              : { kind: "keep" },
                          )
                        }
                      />
                    </View>
                  ) : (
                    <View style={styles.photoRow}>
                      <Button
                        label="Take photo"
                        icon="camera"
                        variant="secondary"
                        size="small"
                        disabled={photoBusy}
                        onPress={() => void choosePhoto("camera")}
                      />
                      <Button
                        label="Choose photo"
                        icon="photo"
                        variant="secondary"
                        size="small"
                        disabled={photoBusy}
                        onPress={() => void choosePhoto("library")}
                      />
                    </View>
                  )}
                  {photo.kind === "remove" ? (
                    <ThemedText type="footnote" themeColor="textSecondary">
                      The photo will be deleted when you save.
                    </ThemedText>
                  ) : null}
                </View>
              ) : null}

              {error ? (
                <View accessibilityRole="alert">
                  <Notice tone="danger" message={error} />
                </View>
              ) : null}
              {mode === "edit" && onDelete ? (
                <Button
                  label="Delete boulder"
                  icon="trash"
                  variant="destructive"
                  onPress={onDelete}
                />
              ) : null}
            </ScrollView>

            <View style={[styles.footer, { borderTopColor: theme.separator }]}>
              {mode === "create" && lastAscent && !linkedProject ? (
                <Button
                  label="Same again"
                  icon="repeat"
                  variant="secondary"
                  accessibilityLabel="Same again: repeat the last grade and colour"
                  onPress={() =>
                    setForm(sameAgainForm(lastAscent, initialForm.grade))
                  }
                />
              ) : null}
              <View style={styles.grow}>
                <Button
                  label={saving ? "Saving…" : "Save"}
                  block
                  loading={saving}
                  disabled={validation !== null || saving}
                  accessibilityHint={validation ?? undefined}
                  onPress={() => void save()}
                />
              </View>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </ThemedView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  projectBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    padding: Spacing.two,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  content: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.four,
    gap: Spacing.two,
  },
  grow: { flexGrow: 1, flexShrink: 1 },
  attemptsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: Spacing.two,
    minHeight: MinTouchTarget,
  },
  attemptsValue: { minWidth: 32, textAlign: "center" },
  moreToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    minHeight: MinTouchTarget,
  },
  more: { gap: Spacing.two },
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  swatchButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one + Spacing.half,
    minHeight: MinTouchTarget,
    paddingHorizontal: Spacing.two + Spacing.half,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  photoRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: Spacing.two,
  },
  thumb: { width: 56, height: 56, borderRadius: Radius.sm },
  footer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
    padding: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
