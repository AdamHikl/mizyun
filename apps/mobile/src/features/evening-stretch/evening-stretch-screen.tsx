import {
  buildEveningStretchSession,
  formatStretchFocus,
  type StretchSessionPlan,
} from "@mizyun/core";
import { Stack, router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Button, Card, Notice } from "@/components/ui";
import {
  BottomTabInset,
  MaxContentWidth,
  PageGutter,
  Spacing,
} from "@/constants/theme";
import { apiClient } from "@/composition/api-client";
import { isStretchAiEnabled } from "@/composition/app-variant";
import { useAuth } from "@/features/auth/auth-context";
import { loadAiConsent } from "@/features/coach/ai-consent";
import { useAiConsentController } from "@/features/coach/ai-consent-controller";
import {
  isoLocalDate,
  markEveningStretchDone,
} from "./evening-stretch-reminder";
import {
  loadTailoredStretchPlan,
  peekTailoredStretchPlan,
} from "./stretch-ai-refine";
import {
  applyTailoredPlan,
  shouldTailorStretch,
  type LoadedStretch,
} from "./stretch-tailoring";
import {
  advanceProgress,
  formatMinutes,
  sideLabel,
  skipStretch,
  startProgress,
  tickProgress,
  togglePause,
  type StretchProgress,
} from "./stretch-progress";
import { fetchTodayTraining, type TodayTraining } from "./today-training-data";
import { mayTailorStretch } from "./tonight-stretch";

type Loaded = LoadedStretch;

const aiPorts = {
  variantEnabled: isStretchAiEnabled,
  consent: (userId: string) => loadAiConsent(userId, SecureStore),
};

const capitalize = (text: string): string =>
  text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1);

/** Guided evening stretch built from today's training (#298). */
export function EveningStretchScreen() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  const [progress, setProgress] = useState<StretchProgress>({
    phase: "overview",
  });
  const [training, setTraining] = useState<TodayTraining | null>(null);
  const [tailoring, setTailoring] = useState(false);
  // A tailored plan may replace the list only before the session starts.
  const phaseRef = useRef(progress.phase);
  phaseRef.current = progress.phase;
  // Only accounts that already gave AI consent are tailored; nobody is prompted.
  const { consentGranted, confirmedAdult } = useAiConsentController({
    userId,
    apiClient,
  });
  const tailor = shouldTailorStretch({
    variantEnabled: isStretchAiEnabled(),
    consentGranted,
    confirmedAdult,
    userId,
    trained: training?.trained ?? null,
  });

  useEffect(() => {
    let active = true;
    setLoaded({ status: "loading" });
    setTraining(null);
    void fetchTodayTraining()
      .catch(() => null)
      .then(async (read) => {
        // Tonight's plan prepared at reminder time (or on an earlier open)
        // is shown as is, without tailoring it again, while the account
        // may still use AI stretches.
        const prepared =
          read?.trained &&
          userId !== null &&
          (await mayTailorStretch(userId, aiPorts))
            ? await peekTailoredStretchPlan(
                userId,
                read.input,
                isoLocalDate(new Date()),
              ).catch(() => null)
            : null;
        if (!active) return;
        setTraining(read);
        setLoaded({
          status: "ready",
          plan:
            prepared ??
            buildEveningStretchSession(
              read?.input ?? { exercises: [], activities: [] },
            ),
          fallback: read === null,
          tailored: prepared !== null,
        });
      });
    return () => {
      active = false;
    };
  }, [userId]);

  const untailored = loaded.status === "ready" && !loaded.tailored;
  useEffect(() => {
    if (!tailor || !untailored || userId === null || training === null) {
      return;
    }
    let active = true;
    setTailoring(true);
    void loadTailoredStretchPlan(
      userId,
      training.input,
      isoLocalDate(new Date()),
      apiClient,
      SecureStore,
      async () => active && (await mayTailorStretch(userId, aiPorts)),
    )
      .catch(() => null)
      .then((plan) => {
        if (!active) return;
        setTailoring(false);
        setLoaded((current) =>
          applyTailoredPlan(phaseRef.current, current, plan),
        );
      });
    return () => {
      active = false;
      setTailoring(false);
    };
  }, [tailor, untailored, userId, training]);

  const steps = useMemo(
    () => (loaded.status === "ready" ? loaded.plan.steps : []),
    [loaded],
  );

  const running = progress.phase === "holding" && progress.endsAt !== null;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      setProgress((current) => tickProgress(steps, current, Date.now()));
    }, 250);
    return () => clearInterval(timer);
  }, [running, steps]);

  const finished = progress.phase === "done";
  useEffect(() => {
    if (finished && userId !== null) {
      void markEveningStretchDone(userId).catch(() => {});
    }
  }, [finished, userId]);

  return (
    <ThemedView style={styles.flex}>
      <Stack.Screen options={{ title: "Evening stretch" }} />
      <SafeAreaView style={styles.flex} edges={["bottom"]}>
        <ScrollView
          contentContainerStyle={styles.content}
          contentInsetAdjustmentBehavior="automatic"
        >
          <View style={styles.inner}>
            {loaded.status === "loading" ? (
              <ActivityIndicator accessibilityLabel="Building your stretch" />
            ) : progress.phase === "overview" ? (
              <Overview
                plan={loaded.plan}
                fallback={loaded.fallback}
                tailored={loaded.tailored}
                tailoring={tailoring}
                onStart={() => setProgress(startProgress(steps, Date.now()))}
              />
            ) : progress.phase === "holding" ? (
              <Holding
                plan={loaded.plan}
                progress={progress}
                onPause={() =>
                  setProgress((current) => togglePause(current, Date.now()))
                }
                onNext={() =>
                  setProgress((current) =>
                    advanceProgress(steps, current, Date.now()),
                  )
                }
                onSkip={() =>
                  setProgress((current) =>
                    skipStretch(steps, current, Date.now()),
                  )
                }
                onFinish={() =>
                  // Ending before any hold is a misstep, not a finished stretch.
                  progress.index === 0 && progress.side === 0
                    ? router.back()
                    : setProgress({ phase: "done" })
                }
              />
            ) : (
              <Done onClose={() => router.back()} />
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Overview({
  plan,
  fallback,
  tailored,
  tailoring,
  onStart,
}: {
  readonly plan: StretchSessionPlan;
  readonly fallback: boolean;
  readonly tailored: boolean;
  readonly tailoring: boolean;
  readonly onStart: () => void;
}) {
  return (
    <>
      <View style={styles.header}>
        <ThemedText type="title3">
          {plan.basis === "general"
            ? "Full-body stretch"
            : tailored
              ? "Tailored to today's training"
              : "Built from today's training"}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {formatStretchFocus(plan)} · {plan.steps.length} stretches · about{" "}
          {formatMinutes(plan.totalSeconds)}
        </ThemedText>
        {tailored ? (
          <ThemedText type="footnote" themeColor="textSecondary">
            AI picked these from Mizyun's stretch library for the exercises you
            did today.
          </ThemedText>
        ) : tailoring ? (
          <ThemedText
            type="footnote"
            themeColor="textSecondary"
            accessibilityLiveRegion="polite"
          >
            Tailoring with AI…
          </ThemedText>
        ) : null}
      </View>
      {fallback ? (
        <Notice message="Today's training couldn't be loaded, so this is a general full-body stretch." />
      ) : null}
      <Card style={styles.list}>
        {plan.steps.map((step, index) => (
          <View key={step.exerciseId} style={styles.row}>
            <ThemedText type="headline">
              {index + 1}. {step.name}
            </ThemedText>
            <ThemedText type="footnote" themeColor="textSecondary">
              {capitalize(step.targetMuscles.join(", "))} · {step.holdSeconds} s
              {step.bothSides ? " each side" : ""}
            </ThemedText>
          </View>
        ))}
      </Card>
      <Button label="Start stretching" block onPress={onStart} />
      <ThemedText type="caption" themeColor="textSecondary">
        General guidance, not medical advice. Move gently, stay within a
        comfortable range and stop if anything hurts.
      </ThemedText>
    </>
  );
}

function Holding({
  plan,
  progress,
  onPause,
  onNext,
  onSkip,
  onFinish,
}: {
  readonly plan: StretchSessionPlan;
  readonly progress: Extract<StretchProgress, { phase: "holding" }>;
  readonly onPause: () => void;
  readonly onNext: () => void;
  readonly onSkip: () => void;
  readonly onFinish: () => void;
}) {
  const step = plan.steps[progress.index];
  if (!step) return null;
  const seconds = Math.ceil(progress.remainingMs / 1000);
  const side = sideLabel(step, progress.side);
  const paused = progress.endsAt === null;
  const isLast = progress.index === plan.steps.length - 1;
  return (
    <>
      <View style={styles.header}>
        <ThemedText type="footnote" themeColor="textSecondary">
          Stretch {progress.index + 1} of {plan.steps.length}
          {side ? ` · ${side}` : ""}
        </ThemedText>
        <ThemedText type="title3">{step.name}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {capitalize(step.targetMuscles.join(", "))}
        </ThemedText>
      </View>
      <View style={styles.timer}>
        <ThemedText
          type="largeTitle"
          accessibilityRole="timer"
          accessibilityLabel={`${seconds} seconds left${paused ? ", paused" : ""}`}
        >
          {seconds}
        </ThemedText>
        <ThemedText type="footnote" themeColor="textSecondary">
          {paused ? "Paused" : "seconds"}
        </ThemedText>
      </View>
      <View style={styles.actions}>
        <Button
          label={paused ? "Resume" : "Pause"}
          variant="tinted"
          style={styles.action}
          onPress={onPause}
        />
        <Button
          label={
            isLast && !(step.bothSides && progress.side === 0)
              ? "Finish"
              : "Next"
          }
          style={styles.action}
          onPress={onNext}
        />
      </View>
      <Card style={styles.list}>
        {step.instructions.map((line, index) => (
          <ThemedText key={index} type="small">
            {index + 1}. {line}
          </ThemedText>
        ))}
      </Card>
      <View style={styles.actions}>
        {isLast ? null : (
          <Button label="Skip stretch" variant="plain" onPress={onSkip} />
        )}
        <Button label="End session" variant="plain" onPress={onFinish} />
      </View>
    </>
  );
}

function Done({ onClose }: { readonly onClose: () => void }) {
  return (
    <>
      <View style={styles.header}>
        <ThemedText type="title3">Nice work</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Tonight's stretch is done. There's no more reminder today.
        </ThemedText>
      </View>
      <Button label="Done" block onPress={onClose} />
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    paddingHorizontal: PageGutter,
    paddingTop: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.four,
    alignItems: "center",
  },
  inner: { width: "100%", maxWidth: MaxContentWidth, gap: Spacing.three },
  header: { gap: Spacing.one },
  list: { gap: Spacing.two },
  row: { gap: Spacing.half },
  timer: { alignItems: "center", paddingVertical: Spacing.three },
  actions: { flexDirection: "row", gap: Spacing.two, flexWrap: "wrap" },
  action: { flex: 1 },
});
