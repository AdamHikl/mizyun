import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, ScrollView, StyleSheet, Switch, View } from "react-native";
import { router, type Href } from "expo-router";
import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import type {
  HistoryImportBatch,
  HistoryImportConfirmRequest,
  HistoryImportPreview,
} from "@mizyun/contracts";
import type { CatalogExercise } from "@mizyun/core";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import {
  Button,
  Card,
  ChoiceChip,
  ChoiceGroup,
  FormField,
  FormStatus,
  FormTextInput,
  ListGroup,
  ListRow,
  Notice,
  SectionHeader,
} from "@/components/ui";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { invalidateSessionReads } from "@/composition/api-client";
import { isHistoryImportsEnabled } from "@/composition/app-variant";
import { useAuth } from "@/features/auth/auth-context";
import { noteTrainingSaved } from "@/features/evening-stretch/public-data";
import { ExerciseLibraryModal } from "@/features/workouts/exercise-library-modal";
import {
  FORMAT_LABELS,
  batchSubtitle,
  batchTitle,
  dateRangeLabel,
  hiddenIssueCount,
  importButtonLabel,
  importableCount,
  issueLines,
  issuesSummary,
  previewCounts,
  resultSummary,
  skippedActivitiesMessage,
  undoConfirmMessage,
  unitsAssumedMessage,
} from "./history-import-copy";
import {
  confirmHistoryImport,
  listHistoryImportBatches,
  previewHistoryImport,
  removeHistoryImportBatch,
  type ImportResult,
} from "./history-import-data";
import {
  checkFileText,
  checkPickedFile,
  defaultUnits,
  stripByteOrderMark,
  type DistanceUnit,
  type WeightUnit,
} from "./history-import-files";
import {
  buildConfirmRequest,
  checkCustomName,
  choiceLabel,
  defaultChoices,
  mappingTotals,
  setsAndWorkoutsLabel,
  type ChoiceMap,
  type ExerciseChoice,
} from "./history-import-mapping";

type Step = "pick" | "review" | "map" | "confirm" | "result";

interface PickedFile {
  readonly name: string;
  readonly content: string;
}

interface SendFailure {
  readonly message: string;
  readonly retryable: boolean;
  readonly conflict: boolean;
}

const deviceTimezone = (): string =>
  Intl.DateTimeFormat().resolvedOptions().timeZone;

export const historyImportAvailable = (): boolean => isHistoryImportsEnabled();

export function HistoryImportScreen() {
  const { session } = useAuth();
  if (!session || !historyImportAvailable())
    return (
      <ThemedView style={styles.fill}>
        <View style={styles.content}>
          <ThemedText>
            Importing history isn't available in this build.
          </ThemedText>
        </View>
      </ThemedView>
    );
  // Keyed on the account so a switch never carries file text across users.
  return <HistoryImportContent key={session.user.id} />;
}

function HistoryImportContent() {
  const { profile } = useAuth();
  const theme = useTheme();
  const initialUnits = defaultUnits(profile?.unitSystem);
  const [step, setStep] = useState<Step>("pick");
  const [file, setFile] = useState<PickedFile | null>(null);
  const [weightUnit, setWeightUnit] = useState<WeightUnit>(
    initialUnits.weightUnit,
  );
  const [distanceUnit, setDistanceUnit] = useState<DistanceUnit>(
    initialUnits.distanceUnit,
  );
  const [reading, setReading] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<HistoryImportPreview | null>(null);
  const [showIssues, setShowIssues] = useState(false);
  const [choices, setChoices] = useState<ChoiceMap>({});
  const [skipOverlaps, setSkipOverlaps] = useState(true);
  // Built once when entering the confirm step and re-sent unchanged on retry.
  const [request, setRequest] = useState<HistoryImportConfirmRequest | null>(
    null,
  );
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<SendFailure | null>(null);
  const [batch, setBatch] = useState<HistoryImportBatch | null>(null);
  const [batches, setBatches] = useState<HistoryImportBatch[] | null>(null);
  const [batchesError, setBatchesError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const previewToken = useRef(0);
  const sendingRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const loadBatches = useCallback(async () => {
    const result = await listHistoryImportBatches();
    if (!mounted.current) return;
    if (result.ok) {
      setBatches(result.value);
      setBatchesError(null);
    } else setBatchesError(result.message);
  }, []);
  useEffect(() => {
    void loadBatches();
  }, [loadBatches]);

  const runPreview = async (
    source: PickedFile,
    weight: WeightUnit,
    distance: DistanceUnit,
  ): Promise<boolean> => {
    const token = ++previewToken.current;
    setPreviewing(true);
    setError(null);
    const result = await previewHistoryImport({
      fileName: source.name,
      content: source.content,
      timezone: deviceTimezone(),
      weightUnit: weight,
      distanceUnit: distance,
    });
    if (!mounted.current || token !== previewToken.current) return false;
    setPreviewing(false);
    if (!result.ok) {
      setError(result.message);
      return false;
    }
    setPreview(result.value);
    setChoices(defaultChoices(result.value));
    setShowIssues(false);
    return true;
  };

  const chooseFile = async () => {
    setError(null);
    setNotice(null);
    let picked: DocumentPicker.DocumentPickerResult;
    try {
      picked = await DocumentPicker.getDocumentAsync({
        // Android providers often label CSV as octet-stream; validate instead.
        type: "*/*",
        copyToCacheDirectory: true,
        multiple: false,
      });
    } catch {
      setError("Couldn't open the file picker. Try again.");
      return;
    }
    const asset = picked.canceled ? null : picked.assets[0];
    if (!asset) return;
    const check = checkPickedFile(asset);
    if (!check.ok) {
      setError(check.message);
      discard(asset.uri);
      return;
    }
    setReading(true);
    let text: string;
    try {
      text = stripByteOrderMark(await new File(asset.uri).text());
    } catch {
      setReading(false);
      setError("Couldn't read that file. Pick a CSV file and try again.");
      return;
    } finally {
      discard(asset.uri);
    }
    setReading(false);
    const textCheck = checkFileText(text);
    if (!textCheck.ok) {
      setError(textCheck.message);
      return;
    }
    const next = { name: asset.name, content: text };
    setFile(next);
    setPreview(null);
    if (await runPreview(next, weightUnit, distanceUnit)) setStep("review");
  };

  const changeUnits = (weight: WeightUnit, distance: DistanceUnit) => {
    setWeightUnit(weight);
    setDistanceUnit(distance);
    if (file) void runPreview(file, weight, distance);
  };

  const startOver = () => {
    previewToken.current++;
    setFile(null);
    setPreview(null);
    setRequest(null);
    setFailure(null);
    setError(null);
    setChoices({});
    setStep("pick");
  };

  const goConfirm = () => {
    if (!file || !preview) return;
    setFailure(null);
    setRequest(
      buildConfirmRequest({
        preview,
        choices,
        content: file.content,
        fileName: file.name,
        timezone: deviceTimezone(),
        weightUnit,
        distanceUnit,
        batchId: Crypto.randomUUID(),
        skipOverlaps,
      }),
    );
    setStep("confirm");
  };

  const send = async () => {
    if (!request || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setFailure(null);
    const result: ImportResult<HistoryImportBatch> =
      await confirmHistoryImport(request);
    sendingRef.current = false;
    if (!mounted.current) return;
    setSending(false);
    if (!result.ok) {
      setFailure(result);
      return;
    }
    invalidateSessionReads();
    noteTrainingSaved();
    setBatch(result.value);
    setFile(null);
    setRequest(null);
    setStep("result");
    void loadBatches();
  };

  const backFromConfirm = () => {
    // A new request (and batch id) is built on re-entry; this one is dropped.
    setRequest(null);
    setFailure(null);
    setStep(preview && preview.exercises.length > 0 ? "map" : "review");
  };

  const undo = (target: HistoryImportBatch, afterRemoval?: () => void) =>
    Alert.alert("Undo this import?", undoConfirmMessage(target), [
      { text: "Cancel", style: "cancel" },
      {
        text: "Undo import",
        style: "destructive",
        onPress: () => {
          void (async () => {
            setRemoving(target.id);
            setNotice(null);
            const result = await removeHistoryImportBatch(target.id);
            if (!mounted.current) return;
            setRemoving(null);
            if (!result.ok) {
              setBatchesError(result.message);
              return;
            }
            invalidateSessionReads();
            const { workouts, runs } = result.value;
            setNotice(
              `Removed ${workouts} ${workouts === 1 ? "workout" : "workouts"} and ${runs} ${runs === 1 ? "run" : "runs"}.`,
            );
            afterRemoval?.();
            void loadBatches();
          })();
        },
      },
    ]);

  const done = () => router.replace("/(tabs)/workouts" as Href);

  return (
    <ThemedView style={styles.fill}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {error ? <Notice tone="warning" message={error} /> : null}
        {notice ? <Notice tone="success" message={notice} /> : null}

        {step === "pick" ? (
          <PickStep
            reading={reading || previewing}
            weightUnit={weightUnit}
            distanceUnit={distanceUnit}
            onUnits={changeUnits}
            onChoose={() => void chooseFile()}
            batches={batches}
            batchesError={batchesError}
            removing={removing}
            onUndo={(b) => undo(b)}
          />
        ) : null}

        {step === "review" && preview && file ? (
          <ReviewStep
            preview={preview}
            fileName={file.name}
            weightUnit={weightUnit}
            distanceUnit={distanceUnit}
            previewing={previewing}
            showIssues={showIssues}
            onToggleIssues={() => setShowIssues((v) => !v)}
            onUnits={changeUnits}
            skipOverlaps={skipOverlaps}
            onSkipOverlaps={setSkipOverlaps}
            trackColor={theme.primary}
            onNext={() =>
              preview.exercises.length > 0 ? setStep("map") : goConfirm()
            }
            onCancel={startOver}
          />
        ) : null}

        {step === "map" && preview ? (
          <MapStep
            preview={preview}
            choices={choices}
            onChoice={(sourceName, choice) =>
              setChoices((current) => ({ ...current, [sourceName]: choice }))
            }
            onBack={() => setStep("review")}
            onNext={goConfirm}
          />
        ) : null}

        {step === "confirm" && preview && request ? (
          <ConfirmStep
            preview={preview}
            choices={choices}
            skipOverlaps={request.skipOverlaps}
            sending={sending}
            failure={failure}
            onSend={() => void send()}
            onBack={backFromConfirm}
            onPreviewAgain={() => {
              setRequest(null);
              setFailure(null);
              if (file) {
                void runPreview(file, weightUnit, distanceUnit).then((ok) => {
                  if (ok) setStep("review");
                });
              } else startOver();
            }}
          />
        ) : null}

        {step === "result" && batch ? (
          <>
            <Notice tone="success" message={resultSummary(batch)} />
            <ThemedText type="small" themeColor="textSecondary">
              Imported records appear in your history. You can remove this whole
              import again if something looks wrong.
            </ThemedText>
            <Button label="Done" onPress={done} />
            <Button
              label={removing === batch.id ? "Removing…" : "Undo import"}
              variant="destructive"
              disabled={removing !== null}
              onPress={() =>
                undo(batch, () => {
                  setBatch(null);
                  setStep("pick");
                })
              }
            />
          </>
        ) : null}
      </ScrollView>
    </ThemedView>
  );
}

/** Removes the picker's cached copy; failure only leaves a temp file. */
function discard(uri: string): void {
  try {
    const cached = new File(uri);
    if (cached.exists) cached.delete();
  } catch {
    // Best effort: the cache directory is cleared by the system.
  }
}

function UnitChoice({
  weightUnit,
  distanceUnit,
  onUnits,
  disabled,
}: {
  weightUnit: WeightUnit;
  distanceUnit: DistanceUnit;
  onUnits: (weight: WeightUnit, distance: DistanceUnit) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.units}>
      <FormField label="Weight">
        <ChoiceGroup>
          {(["kg", "lb"] as const).map((unit) => (
            <ChoiceChip
              key={unit}
              label={unit}
              selected={weightUnit === unit}
              disabled={disabled}
              onPress={() => onUnits(unit, distanceUnit)}
            />
          ))}
        </ChoiceGroup>
      </FormField>
      <FormField label="Distance">
        <ChoiceGroup>
          {(["km", "mi"] as const).map((unit) => (
            <ChoiceChip
              key={unit}
              label={unit}
              selected={distanceUnit === unit}
              disabled={disabled}
              onPress={() => onUnits(weightUnit, unit)}
            />
          ))}
        </ChoiceGroup>
      </FormField>
    </View>
  );
}

function PickStep({
  reading,
  weightUnit,
  distanceUnit,
  onUnits,
  onChoose,
  batches,
  batchesError,
  removing,
  onUndo,
}: {
  reading: boolean;
  weightUnit: WeightUnit;
  distanceUnit: DistanceUnit;
  onUnits: (weight: WeightUnit, distance: DistanceUnit) => void;
  onChoose: () => void;
  batches: HistoryImportBatch[] | null;
  batchesError: string | null;
  removing: string | null;
  onUndo: (batch: HistoryImportBatch) => void;
}) {
  return (
    <>
      <ThemedText type="small" themeColor="textSecondary">
        Bring your past workouts and runs into Mizyun from a file. You'll see a
        preview first, and nothing is saved until you confirm. Only the file's
        text is sent, and it isn't kept on this phone.
      </ThemedText>
      <Card>
        <ThemedText type="smallBold">Where to get the file</ThemedText>
        <ThemedText type="small">
          Hevy: Settings › Export & Import Data › Export workouts.
        </ThemedText>
        <ThemedText type="small">
          Strong: Settings › Export Strong Data.
        </ThemedText>
        <ThemedText type="small">
          Strava: request your archive on strava.com (Settings › My Account ›
          Download or delete your account), open the zip in Files and pick
          activities.csv. Route files are never read.
        </ThemedText>
        <ThemedText type="small">
          Other apps: a CSV with date, exercise, reps, weight… columns.
        </ThemedText>
      </Card>
      <UnitChoice
        weightUnit={weightUnit}
        distanceUnit={distanceUnit}
        onUnits={onUnits}
        disabled={reading}
      />
      <ThemedText type="footnote" themeColor="textSecondary">
        Used when the file doesn't state its units.
      </ThemedText>
      <Button
        label={reading ? "Reading file…" : "Choose file"}
        icon="history"
        loading={reading}
        onPress={onChoose}
        accessibilityLabel="Choose a file to import"
      />
      {batchesError ? (
        <FormStatus tone="error">{batchesError}</FormStatus>
      ) : null}
      {batches && batches.length > 0 ? (
        <>
          <SectionHeader title="Previous imports" />
          <ListGroup>
            {batches.map((b) => (
              <ListRow
                key={b.id}
                title={batchTitle(b)}
                subtitle={batchSubtitle(b)}
                chevron={false}
                trailing={
                  <Button
                    label={removing === b.id ? "Removing…" : "Undo"}
                    size="small"
                    variant="destructive"
                    disabled={removing !== null}
                    accessibilityLabel={`Undo import, ${batchTitle(b)}`}
                    onPress={() => onUndo(b)}
                  />
                }
              />
            ))}
          </ListGroup>
        </>
      ) : null}
    </>
  );
}

function ReviewStep({
  preview,
  fileName,
  weightUnit,
  distanceUnit,
  previewing,
  showIssues,
  onToggleIssues,
  onUnits,
  skipOverlaps,
  onSkipOverlaps,
  trackColor,
  onNext,
  onCancel,
}: {
  preview: HistoryImportPreview;
  fileName: string;
  weightUnit: WeightUnit;
  distanceUnit: DistanceUnit;
  previewing: boolean;
  showIssues: boolean;
  onToggleIssues: () => void;
  onUnits: (weight: WeightUnit, distance: DistanceUnit) => void;
  skipOverlaps: boolean;
  onSkipOverlaps: (value: boolean) => void;
  trackColor: string;
  onNext: () => void;
  onCancel: () => void;
}) {
  const timezone = deviceTimezone();
  const range = dateRangeLabel(preview, timezone);
  const skipped = skippedActivitiesMessage(preview);
  const issues = issuesSummary(preview);
  const nothing = importableCount(preview) === 0;
  const strava = preview.format === "strava";
  return (
    <>
      <Card>
        <ThemedText type="headline">{FORMAT_LABELS[preview.format]}</ThemedText>
        <ThemedText type="footnote" themeColor="textSecondary" selectable>
          {fileName}
        </ThemedText>
        <ThemedText>{previewCounts(preview)}</ThemedText>
        {range ? <ThemedText type="small">{range}</ThemedText> : null}
        {preview.alreadyImported > 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            {preview.alreadyImported} already imported earlier
          </ThemedText>
        ) : null}
        {preview.overlapping > 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            {preview.overlapping} overlap workouts or runs you already have
          </ThemedText>
        ) : null}
      </Card>
      {!preview.unitsFromFile ? (
        <Notice
          tone="info"
          message={unitsAssumedMessage(weightUnit, distanceUnit, strava)}
        />
      ) : null}
      {!preview.unitsFromFile || strava ? (
        <UnitChoice
          weightUnit={weightUnit}
          distanceUnit={distanceUnit}
          onUnits={onUnits}
          disabled={previewing}
        />
      ) : null}
      {skipped ? <Notice tone="info" message={skipped} /> : null}
      {issues ? (
        <Card>
          <ThemedText type="smallBold">{issues}</ThemedText>
          <Button
            label={showIssues ? "Hide details" : "Show details"}
            size="small"
            variant="plain"
            onPress={onToggleIssues}
            accessibilityState={{ expanded: showIssues }}
          />
          {showIssues ? (
            <>
              {issueLines(preview).map((line) => (
                <ThemedText key={line.key} type="footnote">
                  {line.text}
                </ThemedText>
              ))}
              {hiddenIssueCount(preview) > 0 ? (
                <ThemedText type="footnote" themeColor="textSecondary">
                  and {hiddenIssueCount(preview)} more
                </ThemedText>
              ) : null}
            </>
          ) : null}
        </Card>
      ) : null}
      <View style={styles.switchRow}>
        <ThemedText type="small" style={styles.grow}>
          Skip records that overlap workouts or runs you already have
        </ThemedText>
        <Switch
          value={skipOverlaps}
          onValueChange={onSkipOverlaps}
          trackColor={{ true: trackColor }}
          accessibilityLabel="Skip records that overlap workouts or runs you already have"
        />
      </View>
      {nothing ? (
        <Notice
          tone="warning"
          message="Nothing in this file can be imported. Check the file or the units and try again."
        />
      ) : null}
      <Button
        label={
          previewing
            ? "Updating preview…"
            : preview.exercises.length > 0
              ? "Match exercises"
              : "Continue"
        }
        disabled={previewing || nothing}
        onPress={onNext}
      />
      <Button
        label="Choose a different file"
        variant="secondary"
        onPress={onCancel}
      />
    </>
  );
}

function MapStep({
  preview,
  choices,
  onChoice,
  onBack,
  onNext,
}: {
  preview: HistoryImportPreview;
  choices: ChoiceMap;
  onChoice: (sourceName: string, choice: ExerciseChoice) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [library, setLibrary] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const totals = mappingTotals(preview, choices);

  const toggle = (sourceName: string) => {
    if (open === sourceName) return setOpen(null);
    const current = choices[sourceName];
    setDraftName(current?.kind === "custom" ? current.name : sourceName);
    setNameError(null);
    setOpen(sourceName);
  };
  const saveCustom = (sourceName: string) => {
    const checked = checkCustomName(draftName);
    if (!checked.ok) return setNameError(checked.message);
    onChoice(sourceName, { kind: "custom", name: checked.name });
    setOpen(null);
  };
  const pickCatalog = (exercise: CatalogExercise) => {
    if (library)
      onChoice(library, {
        kind: "catalog",
        catalogId: exercise.id,
        name: exercise.name,
        suggested: false,
      });
    setLibrary(null);
    setOpen(null);
  };

  return (
    <>
      <ThemedText type="small" themeColor="textSecondary">
        Match each exercise in the file to one in Mizyun. Tap a row to change
        it, make a custom exercise, or skip it.
      </ThemedText>
      <ListGroup>
        {preview.exercises.map((exercise) => {
          const choice = choices[exercise.sourceName]!;
          const expanded = open === exercise.sourceName;
          return (
            <View key={exercise.sourceName}>
              <ListRow
                title={exercise.sourceName}
                subtitle={`${setsAndWorkoutsLabel(exercise)} · ${choiceLabel(choice)}`}
                accessibilityLabel={`${exercise.sourceName}, ${setsAndWorkoutsLabel(exercise)}, ${choiceLabel(choice)}`}
                accessibilityHint={
                  expanded ? "Closes the options" : "Opens the options"
                }
                accessibilityState={{ expanded }}
                onPress={() => toggle(exercise.sourceName)}
              />
              {expanded ? (
                <View style={styles.chooser}>
                  <Button
                    label="Choose from exercise library"
                    variant="secondary"
                    size="small"
                    onPress={() => setLibrary(exercise.sourceName)}
                  />
                  <FormField label="Or create a custom exercise">
                    <FormTextInput
                      value={draftName}
                      onChangeText={(text) => {
                        setDraftName(text);
                        setNameError(null);
                      }}
                      maxLength={120}
                      autoCapitalize="words"
                      accessibilityLabel={`Custom exercise name for ${exercise.sourceName}`}
                    />
                  </FormField>
                  {nameError ? (
                    <FormStatus tone="error">{nameError}</FormStatus>
                  ) : null}
                  <Button
                    label="Use custom exercise"
                    variant="tinted"
                    size="small"
                    onPress={() => saveCustom(exercise.sourceName)}
                  />
                  <Button
                    label="Skip this exercise"
                    variant="plain"
                    size="small"
                    onPress={() => {
                      onChoice(exercise.sourceName, { kind: "skip" });
                      setOpen(null);
                    }}
                  />
                </View>
              ) : null}
            </View>
          );
        })}
      </ListGroup>
      {totals.unchecked > 0 ? (
        <FormStatus tone="neutral">
          {totals.unchecked} suggested{" "}
          {totals.unchecked === 1 ? "match is" : "matches are"} worth a quick
          check.
        </FormStatus>
      ) : null}
      <Button label="Continue" onPress={onNext} />
      <Button label="Back" variant="secondary" onPress={onBack} />
      <ExerciseLibraryModal
        visible={library !== null}
        onClose={() => setLibrary(null)}
        onSelectExercise={pickCatalog}
      />
    </>
  );
}

function ConfirmStep({
  preview,
  choices,
  skipOverlaps,
  sending,
  failure,
  onSend,
  onBack,
  onPreviewAgain,
}: {
  preview: HistoryImportPreview;
  choices: ChoiceMap;
  skipOverlaps: boolean;
  sending: boolean;
  failure: SendFailure | null;
  onSend: () => void;
  onBack: () => void;
  onPreviewAgain: () => void;
}) {
  const totals = mappingTotals(preview, choices);
  return (
    <>
      <Card>
        <ThemedText type="headline">Ready to import</ThemedText>
        <ThemedText>
          {previewCounts(preview)}
          {preview.exercises.length > 0
            ? ` across ${totals.imported} ${totals.imported === 1 ? "exercise" : "exercises"}`
            : ""}
          .
        </ThemedText>
        {totals.skipped > 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            {totals.skipped} {totals.skipped === 1 ? "exercise" : "exercises"}{" "}
            skipped.
          </ThemedText>
        ) : null}
        {totals.custom > 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            {totals.custom} new custom{" "}
            {totals.custom === 1 ? "exercise" : "exercises"} will be created.
          </ThemedText>
        ) : null}
        <ThemedText type="small" themeColor="textSecondary">
          {skipOverlaps
            ? "Records that overlap existing ones, and ones imported before, are skipped."
            : "Records imported before are skipped; overlapping ones are included."}{" "}
          You can undo the whole import afterwards.
        </ThemedText>
      </Card>
      {failure ? (
        <Notice
          tone="warning"
          message={failure.message}
          action={
            failure.conflict ? (
              <Button
                label="Preview again"
                size="small"
                variant="tinted"
                onPress={onPreviewAgain}
              />
            ) : null
          }
        />
      ) : null}
      {failure && failure.conflict ? null : (
        <Button
          label={
            sending
              ? "Importing…"
              : failure?.retryable
                ? "Retry"
                : importButtonLabel(preview)
          }
          loading={sending}
          disabled={sending}
          onPress={onSend}
        />
      )}
      {sending ? (
        <ThemedText type="footnote" themeColor="textSecondary">
          Large files can take a minute. Keep this screen open.
        </ThemedText>
      ) : null}
      <Button
        label="Back"
        variant="secondary"
        disabled={sending}
        onPress={onBack}
      />
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: {
    padding: Spacing.four,
    gap: Spacing.three,
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    paddingBottom: 64,
  },
  units: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.four },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
  },
  grow: { flex: 1 },
  chooser: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.three,
  },
});
