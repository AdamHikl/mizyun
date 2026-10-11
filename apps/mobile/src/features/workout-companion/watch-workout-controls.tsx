import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState, Pressable, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { randomUUID } from "expo-crypto";
import type { CompanionCommand } from "@mizyun/contracts";
import { getAppVariant } from "@/composition/app-variant";
import { ThemedText } from "@/components/themed-text";
import {
  addCompanionMessageListener,
  clearCompanion,
  publishCompanionMessage,
  isCompanionNativeAvailable,
} from "../../../modules/mizyun-workout-companion";
import {
  WorkoutCompanionController,
  type CompanionOutcome,
  type CompanionWorkoutView,
} from "./controller";

export function WatchWorkoutControls({
  ownerId,
  view,
  execute,
}: {
  ownerId: string;
  view: CompanionWorkoutView;
  execute(command: CompanionCommand): Promise<CompanionOutcome>;
}) {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState("");
  const executeRef = useRef(execute);
  executeRef.current = execute;
  const controllerRef = useRef<WorkoutCompanionController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = new WorkoutCompanionController({
      uuid: randomUUID,
      now: Date.now,
      publish: async (message) => {
        if (!(await publishCompanionMessage(JSON.stringify(message))))
          throw new Error("unavailable");
      },
      clear: clearCompanion,
      execute: (command) => executeRef.current(command),
      onStatus: setStatus,
      onRetired: () => setEnabled(false),
    });
  }
  const ownerRef = useRef(ownerId);
  if (ownerRef.current !== ownerId) {
    controllerRef.current.disable();
    ownerRef.current = ownerId;
  }
  const disable = useCallback(() => {
    controllerRef.current?.disable();
    setEnabled(false);
  }, []);
  useFocusEffect(useCallback(() => disable, [disable]));
  useEffect(() => {
    controllerRef.current?.update(view);
  }, [view]);
  useEffect(() => {
    if (!enabled || getAppVariant() !== "dev") return;
    const listener = addCompanionMessageListener((json) => {
      void controllerRef.current?.receive(json);
    });
    const appState = AppState.addEventListener("change", (state) => {
      if (state !== "active") disable();
    });
    const timer = setInterval(
      () => void controllerRef.current?.refresh(),
      30_000,
    );
    return () => {
      listener.remove();
      appState.remove();
      clearInterval(timer);
      controllerRef.current?.disable();
    };
  }, [enabled, disable]);
  useEffect(() => disable, [disable]);
  if (getAppVariant() !== "dev") return null;
  if (!isCompanionNativeAvailable()) return null;
  return (
    <View style={{ paddingVertical: 8, gap: 6 }}>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          if (enabled) disable();
          else
            Alert.alert(
              "Use watch controls?",
              "Check your saved sets before connecting. Keep this workout open on your phone. If a save is uncertain, check the phone before entering another set.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Connect watch",
                  onPress: () => {
                    controllerRef.current?.update(view);
                    setEnabled(controllerRef.current?.enable() === true);
                  },
                },
              ],
            );
        }}
        style={{ paddingVertical: 8, minHeight: 44, justifyContent: "center" }}
      >
        <ThemedText type="smallBold">
          {enabled ? "Disconnect watch" : "Use watch controls"}
        </ThemedText>
      </Pressable>
      {status.length > 0 && <ThemedText type="small">{status}</ThemedText>}
    </View>
  );
}
